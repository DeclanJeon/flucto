#!/usr/bin/env node
// Release tooling for the Release workflow.
//   prepare                        predict conventional-commit release version without publishing/authentication
//   verify   <version> <dir>       validate installer/internal artifacts + generate checksums-sha256.txt
//   source   <run-id> <version>    validate the source run and the release tag
//   recover  <run-id> <version> <dir> <source-dir>  finish a partially published release
//   notes    <version> <dir>       print the four user-facing installation downloads
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { load as loadYaml } from 'js-yaml';

const execFileAsync = promisify(execFile);

export class ReleaseToolsError extends Error {}
export class UsageError extends ReleaseToolsError {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}
export class HttpError extends ReleaseToolsError {
  constructor(status, request, body = '') {
    super(`HTTP ${status} for ${request}${body ? ` — ${body}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-])[0-9A-Za-z.-]*))?$/;
const RELEASE_BRANCHES = new Set(['main', 'master']);
const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';
const RELEASE_FILE_ALLOWLIST = new Set(['package.json', 'package-lock.json', 'CHANGELOG.md']);
const CHECKSUMS_FILE = 'checksums-sha256.txt';
const BUILD_MATRIX = {
  'ubuntu-latest': {
    manifest: 'latest-linux.yml',
    suffixes: (v) => [`-${v}-x86_64.AppImage`],
  },
  'windows-latest': {
    manifest: 'latest.yml',
    suffixes: (v) => [`-${v}-x64-setup.exe`],
  },
  'macos-latest': {
    manifest: 'latest-mac.yml',
    suffixes: (v) => [`-${v}-universal.dmg`, `-${v}-universal.zip`],
  },
};
// CLI setup ZIPs are not electron-updater archives. AppImage blockmaps are embedded.
const BLOCKMAP_REQUIRED_RE = /(?:-setup\.exe|\.dmg|-universal\.zip)$/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const USAGE = `Usage:
  node scripts/release-tools.mjs prepare
  node scripts/release-tools.mjs verify <version> <artifact-dir>
  node scripts/release-tools.mjs notes <version> <artifact-dir>
  node scripts/release-tools.mjs guard-source
  node scripts/release-tools.mjs publish <version> <artifact-dir>
  node scripts/release-tools.mjs source <source-run-id> <version>
  node scripts/release-tools.mjs recover <source-run-id> <version> <artifact-dir> <source-dir>`;

const sanitize = (message, env = {}) => {
  let out = String(message);
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    const value = env[key];
    if (value) out = out.split(value).join('***');
  }
  return out;
};

const normalizeVersion = (input) => {
  const value = String(input ?? '').trim().replace(/^v/, '');
  if (!SEMVER_RE.test(value)) {
    throw new UsageError(`invalid release version "${input}" — expected plain semver like 1.17.0`);
  }
  return value;
};

const normalizeRunId = (input) => {
  const value = String(input ?? '').trim();
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`invalid source run id "${input}" — expected a numeric GitHub Actions run id`);
  }
  return value;
};

export const parseVersion = (version) => {
  const match = SEMVER_RE.exec(String(version).replace(/^v/, ''));
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? null };
};

export const compareVersions = (a, b) => {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) throw new ReleaseToolsError(`cannot compare versions "${a}" and "${b}"`);
  for (const key of ['major', 'minor', 'patch']) {
    if (va[key] !== vb[key]) return va[key] - vb[key];
  }
  if (va.pre === vb.pre) return 0;
  if (va.pre === null) return 1; // stable > prerelease
  if (vb.pre === null) return -1;
  return va.pre < vb.pre ? -1 : 1;
};

const hashFile = async (filePath, algorithm) => {
  const hash = createHash(algorithm);
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest();
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
};

// Release commits may only re-bump version fields; every other key must match byte-for-byte.
const stripVersionFields = (file, jsonText) => {
  const data = JSON.parse(jsonText);
  if (file === 'package.json') {
    delete data.version;
  } else if (file === 'package-lock.json') {
    delete data.version;
    if (data.packages?.['']) delete data.packages[''].version;
  }
  return JSON.stringify(canonicalize(data));
};

const git = async (ctx, args, { cwd = ctx.cwd, allowFailure = false } = {}) => {
  try {
    const { stdout } = await execFileAsync(ctx.gitBin ?? 'git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    if (allowFailure) return { ok: false, stdout: (error.stdout ?? '').trim(), stderr: (error.stderr ?? '').trim() };
    const detail = sanitize((error.stderr || error.message || '').trim(), ctx.env);
    throw new ReleaseToolsError(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
};

export const writeGithubOutput = async (env, values) => {
  const lines = `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
  if (env.GITHUB_OUTPUT) {
    await fsp.appendFile(env.GITHUB_OUTPUT, lines, 'utf8');
  } else {
    process.stdout.write(lines);
  }
};

export const createGitHubClient = ({
  apiBase = 'https://api.github.com',
  repository,
  token,
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (!repository) throw new ReleaseToolsError('GITHUB_REPOSITORY (owner/repo) is required');
  if (!token) throw new ReleaseToolsError('GH_TOKEN or GITHUB_TOKEN is required');
  // GitHub credentials may only ever leave for api.github.com / uploads.github.com.
  const allowedHosts = new Set([new URL(apiBase).host, 'uploads.github.com']);

  const request = async (method, requestPath, { body, headers = {}, expected = [200] } = {}) => {
    let url = requestPath.startsWith('http')
      ? requestPath
      : `${apiBase.replace(/\/+$/, '')}${requestPath}`;
    let currentMethod = method;
    let currentBody = body;
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      const requestHeaders = {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'flucto-release-tools',
        ...headers,
      };
      let payload = currentBody;
      if (payload && typeof payload === 'object' && !(payload instanceof fs.ReadStream) && !(payload instanceof ReadableStream)) {
        payload = JSON.stringify(payload);
        requestHeaders['content-type'] = requestHeaders['content-type'] ?? 'application/json';
      }
      if (allowedHosts.has(new URL(url).host)) {
        requestHeaders.authorization = `Bearer ${token}`;
      } else {
        delete requestHeaders.authorization;
      }
      const isStream = payload instanceof fs.ReadStream || payload instanceof ReadableStream;
      const response = await fetchImpl(url, {
        method: currentMethod,
        headers: requestHeaders,
        body: payload,
        redirect: 'manual',
        // Node fetch requires an explicit duplex mode for streamed request bodies.
        ...(isStream ? { duplex: 'half' } : {}),
      });
      if (REDIRECT_STATUSES.has(response.status) && response.headers.get('location')) {
        const location = new URL(response.headers.get('location'), url).href;
        await response.arrayBuffer().catch(() => {});
        if ((response.status === 307 || response.status === 308) && currentBody instanceof fs.ReadStream) {
          throw new ReleaseToolsError(`cannot follow ${response.status} redirect for streamed upload of ${requestPath} — refusing to replay the request`);
        }
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod !== 'GET' && currentMethod !== 'HEAD')) {
          currentMethod = 'GET';
          currentBody = null;
          delete headers['content-type'];
          delete headers['content-length'];
        }
        url = location;
        continue;
      }
      const text = await response.text().catch(() => '');
      // A 404 only means "absent" for lookups — anything else is a hard error.
      if (response.status === 404 && currentMethod === 'GET') return { status: 404, body: null };
      if (!expected.includes(response.status)) {
        throw new HttpError(response.status, `${currentMethod} ${url}`, text.slice(0, 500));
      }
      if (!text || response.status === 204) return { status: response.status, body: null };
      try {
        return { status: response.status, body: JSON.parse(text) };
      } catch {
        return { status: response.status, body: text };
      }
    }
    throw new ReleaseToolsError(`too many redirects requesting ${method} ${requestPath}`);
  };

  return {
    request,
    allowHost: (host) => allowedHosts.add(host),
    api: (method, requestPath, options) => request(method, `/repos/${repository}${requestPath}`, options),
  };
};

const fetchAllPages = async (client, requestPath, { key } = {}) => {
  const out = [];
  for (let page = 1; ; page += 1) {
    const separator = requestPath.includes('?') ? '&' : '?';
    const { body } = await client.api('GET', `${requestPath}${separator}per_page=100&page=${page}`, { expected: [200] });
    const items = key ? body?.[key] ?? [] : Array.isArray(body) ? body : [];
    out.push(...items);
    if (items.length < 100) return out;
  }
};

// ---- prepare ----------------------------------------------------------------

export const runPrepare = async (ctx) => {
  const { predictRelease } = await import('./version-tools.mjs');
  const { hasRelease, version } = await predictRelease(ctx.cwd);
  await writeGithubOutput(ctx.env, { has_release: hasRelease ? 'true' : 'false', version });
  ctx.log(hasRelease ? `next release version: ${version}` : 'no release-worthy commits');
  return { hasRelease, version };
};

// ---- verify -----------------------------------------------------------------

const parseManifest = (manifestPath, text, errors) => {
  let doc;
  try {
    doc = loadYaml(text);
  } catch (error) {
    errors.push(`${path.basename(manifestPath)} is not valid YAML: ${error.message}`);
    return [];
  }
  if (!doc || typeof doc !== 'object') {
    errors.push(`${path.basename(manifestPath)} is empty or not a mapping`);
    return [];
  }
  return [doc];
};

const manifestEntries = (doc) => {
  const entries = new Map();
  if (doc.path != null) entries.set(String(doc.path), { url: String(doc.path), sha512: doc.sha512 });
  for (const file of doc.files ?? []) {
    if (file?.url != null) entries.set(String(file.url), { url: String(file.url), sha512: file.sha512 });
  }
  return [...entries.values()];
};

export const verifyArtifacts = async (version, artifactDir) => {
  const stat = await fsp.stat(artifactDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new ReleaseToolsError(`artifact directory "${artifactDir}" does not exist — download the source run artifacts first`);
  }
  const names = new Set();
  for (const entry of await fsp.readdir(artifactDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== CHECKSUMS_FILE) names.add(entry.name);
  }
  const errors = [];

  // Exactly one desktop installation choice per OS; macOS ZIP is updater-only.
  const expected = new Set(Object.values(BUILD_MATRIX).map((spec) => spec.manifest));
  for (const [os, spec] of Object.entries(BUILD_MATRIX)) {
    for (const suffix of spec.suffixes(version)) {
      const matches = [...names].filter((name) => name.endsWith(suffix));
      if (matches.length === 0) errors.push(`missing ${os} installer matching "*${suffix}"`);
      if (matches.length > 1) errors.push(`multiple ${os} release files matching "*${suffix}"`);
      for (const name of matches) {
        expected.add(name);
        if (BLOCKMAP_REQUIRED_RE.test(name)) expected.add(`${name}.blockmap`);
      }
    }
  }
  const cliArchive = `Flucto-${version}-cli-setup.zip`;
  expected.add(cliArchive);
  if (!names.has(cliArchive)) errors.push(`missing CLI setup archive "${cliArchive}"`);
  for (const name of names) {
    if (!expected.has(name)) errors.push(`unexpected release file "${name}"`);
  }

  // 2. Every updater manifest must point at existing files whose sha512 matches.
  for (const [os, spec] of Object.entries(BUILD_MATRIX)) {
    const manifestName = spec.manifest;
    const manifestPath = path.join(artifactDir, manifestName);
    if (!names.has(manifestName)) {
      errors.push(`missing ${os} update manifest "${manifestName}"`);
      continue;
    }
    const [doc] = parseManifest(manifestPath, await fsp.readFile(manifestPath, 'utf8'), errors);
    if (!doc) continue;
    if (String(doc.version ?? '') !== version) {
      errors.push(`"${manifestName}" declares version "${doc.version}" but expected "${version}"`);
    }
    const entries = manifestEntries(doc);
    if (entries.length === 0) errors.push(`"${manifestName}" lists no files`);
    for (const entry of entries) {
      if (!names.has(entry.url)) {
        errors.push(`"${manifestName}" references "${entry.url}" which is absent from the artifact directory`);
        continue;
      }
      if (!entry.sha512) {
        errors.push(`"${manifestName}" has no sha512 for "${entry.url}"`);
        continue;
      }
      const digest = await hashFile(path.join(artifactDir, entry.url), 'sha512');
      const expected = String(entry.sha512).trim();
      if (digest.toString('base64') !== expected && digest.toString('hex') !== expected) {
        errors.push(`sha512 mismatch for "${entry.url}" listed in "${manifestName}"`);
      }
    }
  }

  // 3. Differential-update formats need their blockmap, and every blockmap needs its artifact.
  for (const name of names) {
    if (name.endsWith('.blockmap')) {
      if (!names.has(name.slice(0, -'.blockmap'.length))) {
        errors.push(`orphaned "${name}" — the artifact it belongs to is missing`);
      }
    } else if (BLOCKMAP_REQUIRED_RE.test(name) && !names.has(`${name}.blockmap`)) {
      errors.push(`missing "${name}.blockmap" for differential update artifact`);
    }
  }

  if (errors.length) {
    throw new ReleaseToolsError(`release artifact verification failed for v${version}:\n - ${errors.join('\n - ')}`);
  }

  // 4. Deterministic checksum manifest over every shipped file (sorted, unix lines).
  const sorted = [...names].sort();
  const lines = [];
  for (const name of sorted) {
    const digest = await hashFile(path.join(artifactDir, name), 'sha256');
    lines.push(`${digest.toString('hex')}  ${name}`);
  }
  const checksumsPath = path.join(artifactDir, CHECKSUMS_FILE);
  await fsp.writeFile(checksumsPath, `${lines.join('\n')}\n`, 'utf8');
  return { files: [...sorted, CHECKSUMS_FILE], checksumsFile: checksumsPath };
};

export const runVerify = async (ctx, version, artifactDir) => {
  const result = await verifyArtifacts(version, path.resolve(ctx.cwd, artifactDir));
  ctx.log(`verified ${result.files.length - 1} artifacts for v${version}; wrote ${CHECKSUMS_FILE}`);
  return result;
};

const installationNotes = (version, artifactFiles, repository) => {
  const choices = [
    ['Windows x64', `-${version}-x64-setup.exe`, 'Run the installer.'],
    ['macOS Intel + Apple Silicon', `-${version}-universal.dmg`, 'Open the DMG and drag Flucto into Applications.'],
    ['Linux x64', `-${version}-x86_64.AppImage`, 'Make executable and run; no DEB/portable choice is required.'],
    ['CLI — Windows / macOS / Linux', `Flucto-${version}-cli-setup.zip`, 'Extract once, then run install.cmd (Windows) or bash install.sh (macOS/Linux). Node, CLI, yt-dlp and FFmpeg are set up together.'],
  ];
  const rows = choices.map(([platform, suffix, instruction]) => {
    const matches = artifactFiles.filter((name) => name.endsWith(suffix));
    if (matches.length !== 1) throw new ReleaseToolsError(`expected one ${platform} installation file matching "${suffix}"`);
    const name = matches[0];
    const url = `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(name)}`;
    return `| ${platform} | [${name}](${url}) | ${instruction} |`;
  });
  return [
    '<!-- flucto-installation-downloads -->',
    '## Install Flucto',
    '',
    '**Choose just one desktop installer for your OS, or the CLI setup ZIP.**',
    '',
    '| Platform | Download | Installation |',
    '| --- | --- | --- |',
    ...rows,
    '',
    'The macOS DMG supports both Intel and Apple Silicon. This unsigned build uses DMG-based update installation; it does not silently replace the app. macOS may require explicit approval in Privacy & Security.',
    '',
    '### Internal update files — do not install these',
    '',
    'The universal macOS ZIP, latest*.yml, *.blockmap and checksums-sha256.txt support update discovery and integrity checks. They are not alternative installers. Keep these files available for the app/CLI updater.',
    '<!-- /flucto-installation-downloads -->',
  ].join('\n');
};

const runNotes = async (ctx, version, artifactDir) => {
  const entries = await fsp.readdir(path.resolve(ctx.cwd, artifactDir), { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const repository = ctx.env.GITHUB_REPOSITORY ?? 'DeclanJeon/flucto';
  let notes = installationNotes(version, files, repository);
  const changelog = await fsp.readFile(path.join(ctx.cwd, 'CHANGELOG.md'), 'utf8');
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,2} /.test(line) && line.includes(`[${version}]`));
  if (start >= 0) {
    const next = lines.findIndex((line, index) => index > start && /^#{1,2} /.test(line));
    notes += `\n\n${lines.slice(start, next < 0 ? undefined : next).join('\n').trim()}`;
  }
  ctx.log(notes);
  return notes;
};

// ---- publish: Git first, then trusted npm and a complete draft release -------

export const verifyPublicationSource = async (ctx, version) => {
  const sourceSha = ctx.env.GITHUB_SHA;
  const branch = ctx.env.GITHUB_REF_NAME;
  if (!sourceSha || !RELEASE_BRANCHES.has(branch)) {
    throw new ReleaseToolsError('publication requires the original GitHub Actions GITHUB_SHA and release branch');
  }
  const head = (await git(ctx, ['rev-parse', 'HEAD'])).stdout;
  const refNames = [`refs/heads/${branch}`];
  if (version) refNames.push(`refs/tags/v${version}`, `refs/tags/v${version}^{}`);
  const remote = (await git(ctx, ['ls-remote', 'origin', ...refNames])).stdout;
  const refs = new Map(remote.split('\n').filter(Boolean).map((line) => {
    const [sha, name] = line.split(/\s+/);
    return [name, sha];
  }));
  if (refs.get(`refs/heads/${branch}`) !== head) {
    throw new ReleaseToolsError(`source checkout is stale or its release commit was not pushed to ${branch}; refusing npm publication`);
  }
  if (!version) {
    if (head !== sourceSha) throw new ReleaseToolsError('checkout HEAD does not match the original Actions source SHA');
    return { head, sourceSha, branch };
  }
  const tag = `v${version}`;
  const tagCommit = (await git(ctx, ['rev-parse', '--verify', `${tag}^{commit}`])).stdout;
  const remoteTag = refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`);
  if (tagCommit !== head || remoteTag !== head) {
    throw new ReleaseToolsError(`release tag ${tag} was not pushed with the release commit; refusing npm publication`);
  }
  const ancestry = await git(ctx, ['merge-base', '--is-ancestor', sourceSha, head], { allowFailure: true });
  if (!ancestry.ok) throw new ReleaseToolsError('release commit is not descended from the original Actions source SHA');
  const changed = (await git(ctx, ['diff', '--name-only', sourceSha, head])).stdout.split('\n').filter(Boolean);
  const disallowed = changed.filter((file) => !RELEASE_FILE_ALLOWLIST.has(file));
  if (disallowed.length) throw new ReleaseToolsError(`release source changed after native builds: ${disallowed.join(', ')}`);
  for (const file of ['package.json', 'package-lock.json']) {
    const before = (await git(ctx, ['show', `${sourceSha}:${file}`])).stdout;
    const after = (await git(ctx, ['show', `${head}:${file}`])).stdout;
    if (stripVersionFields(file, before) !== stripVersionFields(file, after)) {
      throw new ReleaseToolsError(`${file} changed beyond release version fields after native builds`);
    }
  }
  const pkg = JSON.parse((await git(ctx, ['show', `${head}:package.json`])).stdout);
  if (pkg.version !== version) throw new ReleaseToolsError(`release commit package version ${pkg.version} does not match ${version}`);
  return { head, sourceSha, branch, tag, packageName: pkg.name };
};

export const runPublish = async (ctx, version, artifactDir) => {
  const source = await verifyPublicationSource(ctx, version);
  const resolvedArtifactDir = path.resolve(ctx.cwd, artifactDir);
  const { files } = await verifyArtifacts(version, resolvedArtifactDir);
  const npm = await publishNpmPackage(ctx, { version, sourceDir: ctx.cwd, packageName: source.packageName });
  const github = await ensureGitHubRelease(ctx, { tag: source.tag, version, artifactDir: resolvedArtifactDir, artifactFiles: files });
  ctx.log(`published ${source.tag}: npm ${npm.action}, GitHub release ${github.releaseId}`);
  return { npm, github };
};

// ---- source -----------------------------------------------------------------

export const validateSourceRun = (run, jobs) => {
  const runId = run.id ?? 'unknown';
  if (run.status !== 'completed') {
    throw new ReleaseToolsError(`source run ${runId} is ${run.status}; wait for it to finish before recovering`);
  }
  if (run.event !== 'push') {
    throw new ReleaseToolsError(`source run ${runId} was triggered by "${run.event}"; only release.yml push runs produce publishable artifacts`);
  }
  if (!RELEASE_BRANCHES.has(run.head_branch)) {
    throw new ReleaseToolsError(`source run ${runId} ran on branch "${run.head_branch}"; expected ${[...RELEASE_BRANCHES].join('/')}`);
  }
  if (run.path !== RELEASE_WORKFLOW_PATH) {
    throw new ReleaseToolsError(`source run ${runId} used workflow "${run.path}"; expected "${RELEASE_WORKFLOW_PATH}"`);
  }
  if (!run.head_sha) {
    throw new ReleaseToolsError(`source run ${runId} response has no head_sha — refusing to trust artifacts from an unidentified commit`);
  }
  const missing = [];
  const failed = [];
  for (const os of Object.keys(BUILD_MATRIX)) {
    const job = jobs.find((candidate) => candidate.name === `Build ${os}`);
    if (!job) {
      missing.push(os);
    } else if (job.conclusion !== 'success') {
      failed.push(`${job.name} (${job.conclusion ?? job.status})`);
    }
  }
  const intel = jobs.find((job) => job.name === 'Verify macOS Intel');
  if (!intel) missing.push('macos-15-intel');
  else if (intel.conclusion !== 'success') failed.push(`${intel.name} (${intel.conclusion ?? intel.status})`);
  if (missing.length) {
    throw new ReleaseToolsError(`source run ${runId} has no build job for: ${missing.join(', ')}`);
  }
  if (failed.length) {
    throw new ReleaseToolsError(`source run ${runId} has unsuccessful build jobs: ${failed.join(', ')}`);
  }
};

export const validateSource = async (ctx, sourceRunId, version) => {
  const { status, body: run } = await ctx.github.api('GET', `/actions/runs/${sourceRunId}`, { expected: [200] });
  const repository = ctx.repository ?? ctx.env.GITHUB_REPOSITORY ?? '';
  if (status === 404 || !run) {
    throw new ReleaseToolsError(`source run ${sourceRunId} not found${repository ? ` in ${repository}` : ''} — check the run id`);
  }
  const jobs = await fetchAllPages(ctx.github, `/actions/runs/${sourceRunId}/jobs`, { key: 'jobs' });
  validateSourceRun(run, jobs);

  const tag = `v${version}`;
  const tagResult = await git(ctx, ['rev-parse', '--verify', `${tag}^{commit}`], { allowFailure: true });
  if (!tagResult.ok) {
    throw new ReleaseToolsError(`git tag ${tag} not found — run "git fetch --tags" and confirm the release commit exists; recovery never creates tags`);
  }
  const tagCommit = tagResult.stdout;
  const headSha = run.head_sha;
  const headKnown = await git(ctx, ['cat-file', '-e', `${headSha}^{commit}`], { allowFailure: true });
  if (!headKnown.ok) {
    throw new ReleaseToolsError(`source run commit ${headSha} is not present locally — fetch the full history (fetch-depth: 0)`);
  }
  const ancestry = await git(ctx, ['merge-base', '--is-ancestor', headSha, tagCommit], { allowFailure: true });
  if (!ancestry.ok) {
    throw new ReleaseToolsError(`tag ${tag} (${tagCommit.slice(0, 12)}) is not a descendant of the source run commit ${headSha.slice(0, 12)}`);
  }

  const packageText = (await git(ctx, ['show', `${tagCommit}:package.json`])).stdout;
  let packageAtTag;
  try {
    packageAtTag = JSON.parse(packageText);
  } catch {
    throw new ReleaseToolsError(`package.json at ${tag} is not valid JSON`);
  }
  if (packageAtTag.version !== version) {
    throw new ReleaseToolsError(`package.json at ${tag} is version ${packageAtTag.version}, expected ${version}`);
  }

  const diff = (await git(ctx, ['diff', '--name-only', headSha, tagCommit])).stdout;
  const changedFiles = diff ? diff.split('\n').filter(Boolean) : [];
  const disallowed = changedFiles.filter((file) => !RELEASE_FILE_ALLOWLIST.has(file));
  if (disallowed.length) {
    throw new ReleaseToolsError(
      `commits between the source run (${headSha.slice(0, 12)}) and ${tag} modify non-release files: ${disallowed.join(', ')} — only package.json, package-lock.json and CHANGELOG.md may differ`,
    );
  }
  for (const file of ['package.json', 'package-lock.json']) {
    if (!changedFiles.includes(file)) continue;
    const before = (await git(ctx, ['show', `${headSha}:${file}`])).stdout;
    const after = (await git(ctx, ['show', `${tagCommit}:${file}`])).stdout;
    if (stripVersionFields(file, before) !== stripVersionFields(file, after)) {
      throw new ReleaseToolsError(`${file} changed between the source run and ${tag} beyond version fields — the tag does not match the build artifacts`);
    }
  }
  return { tag, tagCommit, sourceSha: headSha, packageName: packageAtTag.name };
};

export const runSource = async (ctx, sourceRunId, version) => {
  const result = await validateSource(ctx, sourceRunId, version);
  await writeGithubOutput(ctx.env, { tag: result.tag, source_sha: result.sourceSha });
  ctx.log(`source run ${sourceRunId} @ ${result.sourceSha.slice(0, 12)} verified against tag ${result.tag}`);
  return result;
};

// ---- recover ----------------------------------------------------------------

export const verifySourceCheckout = async (ctx, sourceDir, version, tagCommit, tag) => {
  const head = await git(ctx, ['rev-parse', 'HEAD'], { cwd: sourceDir, allowFailure: true });
  if (!head.ok) {
    throw new ReleaseToolsError(`"${sourceDir}" is not a git checkout — provide a clean checkout of ${tag} for the npm build`);
  }
  if (head.stdout !== tagCommit) {
    throw new ReleaseToolsError(`source dir HEAD is ${head.stdout.slice(0, 12)} but ${tag} is ${tagCommit.slice(0, 12)} — check out ${tag} exactly so the npm package matches the published artifacts`);
  }
  let pkg;
  try {
    pkg = JSON.parse(await fsp.readFile(path.join(sourceDir, 'package.json'), 'utf8'));
  } catch {
    throw new ReleaseToolsError(`cannot read package.json in "${sourceDir}"`);
  }
  if (pkg.version !== version) {
    throw new ReleaseToolsError(`source dir package.json is version ${pkg.version}, expected ${version}`);
  }
  return pkg;
};

export const fetchNpmPackageInfo = async ({ registry = 'https://registry.npmjs.org', name, fetchImpl = globalThis.fetch }) => {
  const url = `${registry.replace(/\/+$/, '')}/${name.replace('/', '%2F')}`;
  const response = await fetchImpl(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } });
  if (response.status === 404) return null; // only a real 404 means "not published"
  if (!response.ok) {
    throw new HttpError(response.status, `GET ${url}`, (await response.text().catch(() => '')).slice(0, 300));
  }
  return response.json();
};

export const planNpmPublish = (version, packageInfo) => {
  const publishedVersions = Object.keys(packageInfo?.versions ?? {});
  if (publishedVersions.includes(version)) {
    return { action: 'skip', reason: `npm already has version ${version}` };
  }
  const latest = packageInfo?.['dist-tags']?.latest;
  const newerLatest = Boolean(latest && compareVersions(latest, version) > 0);
  return {
    action: 'publish',
    // Publish under a non-latest dist-tag instead of downgrading "latest".
    distTag: newerLatest ? `release-${version}` : undefined,
    newerLatest,
  };
};

const runNpm = async (ctx, args, options) => {
  if (ctx.npmExec) return ctx.npmExec(args, options);
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    return await execFileAsync(npmBin, args, {
      cwd: options?.cwd ?? ctx.cwd,
      env: options?.env ?? ctx.env,
      shell: process.platform === 'win32',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const detail = sanitize((error.stderr || error.stdout || error.message || '').trim(), ctx.env);
    throw new ReleaseToolsError(`npm ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
};

export const publishNpmPackage = async (ctx, { version, sourceDir, packageName }) => {
  const registry = ctx.env.RELEASE_TOOLS_NPM_REGISTRY ?? ctx.env.npm_config_registry ?? 'https://registry.npmjs.org';
  const packageInfo = await fetchNpmPackageInfo({ registry, name: packageName, fetchImpl: ctx.fetchImpl });
  const plan = planNpmPublish(version, packageInfo);
  if (plan.action === 'skip') {
    ctx.log(plan.reason);
    return plan;
  }
  // npm pack runs prepack (npm run build:electron) so the published tarball is
  // compiled from the tag source, not from the control checkout.
  const packDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'release-tools-pack-'));
  try {
    await runNpm(ctx, ['pack', '--pack-destination', packDir], { cwd: sourceDir });
    const tarballs = (await fsp.readdir(packDir)).filter((name) => name.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      throw new ReleaseToolsError(`npm pack must produce exactly one tarball in ${packDir}`);
    }
    const tarball = path.join(packDir, tarballs[0]);
    const args = ['publish', tarball, '--access', 'public', '--provenance'];
    if (plan.distTag) args.push('--tag', plan.distTag);
    await runNpm(ctx, args, { cwd: sourceDir });
    ctx.log(`published npm ${packageName}@${version}${plan.distTag ? ` (dist-tag "${plan.distTag}" — newer latest preserved)` : ''}`);
    return { ...plan, tarball: path.basename(tarball) };
  } finally {
    await fsp.rm(packDir, { recursive: true, force: true });
  }
};

const listReleaseAssets = async (client, releaseId) =>
  fetchAllPages(client, `/releases/${releaseId}/assets`);

export const ensureGitHubRelease = async (ctx, { tag, version, artifactDir, artifactFiles }) => {
  const github = ctx.github;
  let { body: release } = await github.api('GET', `/releases/tags/${tag}`, { expected: [200] });
  let created = false;
  if (!release) {
    ({ body: release } = await github.api('POST', '/releases', {
      body: {
        tag_name: tag,
        name: tag,
        draft: true,
        generate_release_notes: true,
        body: await runNotes(ctx, version, artifactDir),
      },
      expected: [201],
    }));
    created = true;
  }
  const uploadBase = String(release.upload_url ?? '').replace(/\{[^}]*\}/, '');
  if (!uploadBase) throw new ReleaseToolsError(`release ${release.id} has no upload_url`);
  github.allowHost(new URL(uploadBase).host);
  const checksumByName = new Map(
    (await fsp.readFile(path.join(artifactDir, CHECKSUMS_FILE), 'utf8')).trim().split('\n').map((line) => {
      const [digest, name] = line.split('  ');
      return [name, `sha256:${digest}`];
    }),
  );

  const existing = new Map((await listReleaseAssets(github, release.id)).map((asset) => [asset.name, asset]));
  const uploaded = [];
  for (const name of artifactFiles) {
    const filePath = path.join(artifactDir, name);
    const { size } = await fsp.stat(filePath);
    const prior = existing.get(name);
    if (prior?.state === 'uploaded' && prior.size === size) {
      const digest = checksumByName.get(name) ?? `sha256:${(await hashFile(filePath, 'sha256')).toString('hex')}`;
      if (prior.digest === digest) continue;
    }
    if (prior) {
      // Partial/corrupt upload from a failed run — replace it.
      await github.api('DELETE', `/releases/assets/${prior.id}`, { expected: [204] });
    }
    const label = name.endsWith('-setup.exe') ? 'INSTALL — Windows desktop'
      : name.endsWith('.dmg') ? 'INSTALL — macOS desktop (Intel + Apple Silicon)'
        : name.endsWith('.AppImage') ? 'INSTALL — Linux desktop'
          : name.endsWith('-cli-setup.zip') ? 'INSTALL — CLI, all operating systems'
            : 'INTERNAL — updater/integrity, not an installer';
    await github.request('POST', `${uploadBase}?name=${encodeURIComponent(name)}&label=${encodeURIComponent(label)}`, {
      body: fs.createReadStream(filePath),
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) },
      expected: [201],
    });
    uploaded.push(name);
  }

  if (release.draft) {
    const { body: latest } = await github.api('GET', '/releases/latest', { expected: [200] });
    const latestVersion = latest?.tag_name ? parseVersion(latest.tag_name) : null;
    const newerLatest = Boolean(latest && latest.id !== release.id && latestVersion && compareVersions(latest.tag_name, version) > 0);
    await github.api('PATCH', `/releases/${release.id}`, {
      body: { draft: false, make_latest: newerLatest ? 'false' : 'true' },
      expected: [200],
    });
  }
  return { release, created, uploaded };
};

export const runRecover = async (ctx, { sourceRunId, version, artifactDir, sourceDir }) => {
  const source = await validateSource(ctx, sourceRunId, version);
  await verifySourceCheckout(ctx, sourceDir, version, source.tagCommit, source.tag);
  const resolvedArtifactDir = path.resolve(ctx.cwd, artifactDir);
  const { files } = await verifyArtifacts(version, resolvedArtifactDir);
  ctx.log(`artifacts verified (${files.length} release files)`);
  const npm = await publishNpmPackage(ctx, { version, sourceDir, packageName: source.packageName });
  const github = await ensureGitHubRelease(ctx, {
    tag: source.tag,
    version,
    artifactDir: resolvedArtifactDir,
    artifactFiles: files,
  });
  ctx.log(`GitHub release ${source.tag} ${github.created ? 'created' : 'completed'}; uploaded ${github.uploaded.length} assets`);
  return { source, npm, github };
};

// ---- CLI --------------------------------------------------------------------

const requireGithub = (ctx) =>
  (ctx.github ??= createGitHubClient({
    apiBase: ctx.env.GITHUB_API_URL ?? 'https://api.github.com',
    repository: ctx.env.GITHUB_REPOSITORY,
    token: ctx.env.GH_TOKEN ?? ctx.env.GITHUB_TOKEN,
    fetchImpl: ctx.fetchImpl,
  }));

export const main = async (argv, overrides = {}) => {
  const ctx = {
    cwd: process.cwd(),
    fetchImpl: globalThis.fetch,
    log: (message) => console.log(message),
    ...overrides,
  };
  ctx.env = { ...process.env, ...(overrides.env ?? {}) };
  const env = ctx.env;
  const [command, ...args] = argv;
  try {
    switch (command) {
      case 'prepare': {
        if (args.length !== 0) throw new UsageError('prepare takes no arguments');
        await runPrepare(ctx);
        return 0;
      }
      case 'verify': {
        if (args.length !== 2) throw new UsageError('verify requires <version> <artifact-dir>');
        await runVerify(ctx, normalizeVersion(args[0]), args[1]);
        return 0;
      }
      case 'notes': {
        if (args.length !== 2) throw new UsageError('notes requires <version> <artifact-dir>');
        await runNotes(ctx, normalizeVersion(args[0]), args[1]);
        return 0;
      }
      case 'guard-source': {
        if (args.length !== 0) throw new UsageError('guard-source takes no arguments');
        await verifyPublicationSource(ctx);
        return 0;
      }
      case 'publish': {
        if (args.length !== 2) throw new UsageError('publish requires <version> <artifact-dir>');
        ctx.repository = env.GITHUB_REPOSITORY;
        ctx.github = requireGithub(ctx);
        await runPublish(ctx, normalizeVersion(args[0]), args[1]);
        return 0;
      }
      case 'source': {
        if (args.length !== 2) throw new UsageError('source requires <source-run-id> <version>');
        ctx.repository = env.GITHUB_REPOSITORY;
        ctx.github = requireGithub(ctx);
        await runSource(ctx, normalizeRunId(args[0]), normalizeVersion(args[1]));
        return 0;
      }
      case 'recover': {
        if (args.length !== 4) throw new UsageError('recover requires <source-run-id> <version> <artifact-dir> <source-dir>');
        ctx.repository = env.GITHUB_REPOSITORY;
        ctx.github = requireGithub(ctx);
        await runRecover(ctx, {
          sourceRunId: normalizeRunId(args[0]),
          version: normalizeVersion(args[1]),
          artifactDir: args[2],
          sourceDir: path.resolve(ctx.cwd, args[3]),
        });
        return 0;
      }
      case 'help':
      case '--help':
      case '-h': {
        console.log(USAGE);
        return 0;
      }
      default:
        throw new UsageError(command ? `unknown command "${command}"` : 'missing command');
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`usage error: ${sanitize(error.message, env)}\n\n${USAGE}`);
      return 2;
    }
    console.error(`error: ${sanitize(error.message ?? error, env)}`);
    return 1;
  }
};

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
