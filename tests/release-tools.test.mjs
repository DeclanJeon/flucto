import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  compareVersions,
  createGitHubClient,
  ensureGitHubRelease,
  fetchNpmPackageInfo,
  main,
  planNpmPublish,
  runRecover,
  validateSource,
  validateSourceRun,
  verifyArtifacts,
} from '../scripts/release-tools.mjs';

const VERSION = '1.17.0';
const RUN_ID = '37508545685';
const REPO = 'DeclanJeon/flucto';

const tempDirs = [];
const tmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const sha512b64 = (buf) => crypto.createHash('sha512').update(buf).digest('base64');
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---- fixtures ---------------------------------------------------------------

const write = (dir, rel, content) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const writePackageJson = (dir, version, extras = {}) =>
  write(dir, 'package.json', `${JSON.stringify({ name: 'flucto', version, ...extras }, null, 2)}\n`);

const writePackageLock = (dir, version, deps = {}) =>
  write(
    dir,
    'package-lock.json',
    `${JSON.stringify(
      { name: 'flucto', version, lockfileVersion: 3, packages: { '': { name: 'flucto', version }, ...deps } },
      null,
      2,
    )}\n`,
  );

// A repo whose head commit ("the build") is followed by a release commit that
// only bumps versions + changelog, tagged vX.Y.Z — the shape recovery validates.
const makeSourceRepo = ({ version = VERSION, mutate = null } = {}) => {
  const dir = tmp('rt-repo-');
  gitIn(dir, 'init', '-b', 'main');
  gitIn(dir, 'config', 'user.email', 'release-tools@test.invalid');
  gitIn(dir, 'config', 'user.name', 'Release Tools Test');
  write(dir, 'src/app.js', 'export const app = 1;\n');
  writePackageJson(dir, '1.16.4');
  writePackageLock(dir, '1.16.4');
  write(dir, 'CHANGELOG.md', '# Changelog\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-m', 'feat: add feature');
  const headSha = gitIn(dir, 'rev-parse', 'HEAD');

  writePackageJson(dir, version);
  writePackageLock(dir, version);
  write(dir, 'CHANGELOG.md', `# Changelog\n\n## ${version}\n- feat: add feature\n`);
  if (mutate) mutate(dir);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-m', `chore(release): ${version}`);
  gitIn(dir, 'tag', `v${version}`);
  return { dir, headSha, tagSha: gitIn(dir, 'rev-parse', `v${version}^{commit}`) };
};

const checkoutTag = (repoDir, tag) => {
  const dir = tmp('rt-source-');
  gitIn(repoDir, 'clone', repoDir, dir);
  gitIn(dir, 'checkout', tag);
  return dir;
};

const runFixture = (headSha, overrides = {}) => ({
  id: Number(RUN_ID),
  name: 'Release',
  path: '.github/workflows/release.yml',
  event: 'push',
  status: 'completed',
  conclusion: 'failure',
  head_branch: 'main',
  head_sha: headSha,
  ...overrides,
});

const jobsFixture = (overrides = {}) =>
  ['ubuntu-latest', 'windows-latest', 'macos-latest'].map((os) => ({
    name: `Build ${os}`,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  }));

const manifestYaml = (version, entries) =>
  [
    `version: ${version}`,
    'files:',
    ...entries.flatMap((e) => [`  - url: ${e.url}`, `    sha512: ${e.sha512}`, `    size: ${e.size}`]),
    `path: ${entries[0].url}`,
    `sha512: ${entries[0].sha512}`,
    "releaseDate: '2026-10-07T00:00:00.000Z'",
    '',
  ].join('\n');

const ARTIFACT_FILES = (version) => ({
  setup: `Flucto-${version}-x64-setup.exe`,
  portable: `Flucto-${version}-x64-portable.exe`,
  dmgX64: `Flucto-${version}-x64.dmg`,
  dmgArm: `Flucto-${version}-arm64.dmg`,
  zipX64: `Flucto-${version}-x64.zip`,
  zipArm: `Flucto-${version}-arm64.zip`,
  appImage: `Flucto-${version}-x86_64.AppImage`,
  deb: `Flucto-${version}-amd64.deb`,
});

// A complete, correct artifact directory for the given version.
const makeArtifacts = (version, { omit = [], mutate = null } = {}) => {
  const dir = tmp('rt-artifacts-');
  const names = ARTIFACT_FILES(version);
  const fileContents = new Map();
  for (const name of Object.values(names)) {
    const content = `installer-bytes:${name}:${version}`;
    fileContents.set(name, content);
    if (!omit.includes(name)) write(dir, name, content);
    if (name.endsWith('-setup.exe') || name.endsWith('.dmg') || name.endsWith('.zip')) {
      write(dir, `${name}.blockmap`, `blockmap-bytes:${name}`);
    }
  }
  const entries = (names) =>
    names.map((name) => ({ url: name, sha512: sha512b64(fileContents.get(name)), size: fileContents.get(name).length }));
  const manifests = {
    'latest.yml': [names.setup],
    'latest-mac.yml': [names.dmgX64, names.dmgArm, names.zipX64, names.zipArm],
    'latest-linux.yml': [names.appImage, names.deb],
  };
  for (const [manifest, files] of Object.entries(manifests)) {
    if (!omit.includes(manifest)) write(dir, manifest, manifestYaml(version, entries(files)));
  }
  if (mutate) mutate(dir, names);
  return { dir, names };
};

// ---- fake HTTP servers ------------------------------------------------------

const startServer = (handler) =>
  new Promise((resolve) => {
    const requests = [];
    const server = http.createServer(handler(requests));
    server.listen(0, '127.0.0.1', () =>
      resolve({
        requests,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });

// Minimal in-memory GitHub API covering the endpoints recovery touches.
const startGitHub = async ({ run, jobs = jobsFixture(), release = null, latest = null } = {}) => {
  const state = {
    release: release ? { assets: [], ...release } : null,
    assets: release?.assets ? [...release.assets] : [],
    uploads: [],
    created: null,
    patched: [],
    nextAssetId: 900,
  };
  const server = await startServer((requests) => (req, res) => {
    const url = new URL(req.url, 'http://internal');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization });
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const json = (code, value) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      const p = url.pathname;
      const repoPrefix = `/repos/${REPO}`;
      const respond404 = () => json(404, { message: 'Not Found' });
      if (req.method === 'GET' && p === `${repoPrefix}/actions/runs/${RUN_ID}`) {
        return run ? json(200, run) : respond404();
      }
      if (req.method === 'GET' && p === `${repoPrefix}/actions/runs/${RUN_ID}/jobs`) {
        return json(200, { total_count: jobs.length, jobs });
      }
      if (req.method === 'GET' && p.startsWith(`${repoPrefix}/releases/tags/`)) {
        return state.release ? json(200, { ...state.release, assets: state.assets }) : respond404();
      }
      if (req.method === 'GET' && p === `${repoPrefix}/releases/latest`) {
        return latest ? json(200, latest) : respond404();
      }
      const assetsMatch = new RegExp(`^${repoPrefix}/releases/(\\d+)/assets$`).exec(p);
      if (req.method === 'GET' && assetsMatch) return json(200, state.assets);
      if (req.method === 'POST' && p === `${repoPrefix}/releases`) {
        const payload = JSON.parse(body.toString('utf8'));
        state.created = payload;
        state.release = {
          id: 77,
          tag_name: payload.tag_name,
          draft: true,
          upload_url: `http://${req.headers.host}/uploads{?name,label}`,
        };
        return json(201, state.release);
      }
      if (req.method === 'POST' && p === '/uploads') {
        const asset = { id: state.nextAssetId++, name: url.searchParams.get('name'), size: body.length, state: 'uploaded', digest: `sha256:${sha256hex(body)}` };
        state.uploads.push(asset);
        state.assets.push(asset);
        return json(201, asset);
      }
      const releaseMatch = new RegExp(`^${repoPrefix}/releases/(\\d+)$`).exec(p);
      if (req.method === 'PATCH' && releaseMatch) {
        const payload = JSON.parse(body.toString('utf8'));
        state.patched.push(payload);
        if (payload.draft === false) state.release.draft = false;
        return json(200, state.release);
      }
      const assetMatch = new RegExp(`^${repoPrefix}/releases/assets/(\\d+)$`).exec(p);
      if (req.method === 'DELETE' && assetMatch) {
        state.assets = state.assets.filter((asset) => asset.id !== Number(assetMatch[1]));
        res.writeHead(204);
        return res.end();
      }
      return respond404();
    });
  });
  return { ...server, state };
};

const startRegistry = async ({ status = 404, metadata = null } = {}) =>
  startServer((requests) => (req, res) => {
    const url = new URL(req.url, 'http://internal');
    requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization });
    if (req.method === 'GET' && url.pathname === '/flucto') {
      if (status === 200) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(metadata));
      }
      res.writeHead(status, { 'content-type': 'text/plain' });
      return res.end(`registry status ${status}`);
    }
    res.writeHead(404);
    res.end('not found');
  });

const makeNpmExec = () => {
  const calls = [];
  const exec = async (args, { cwd } = {}) => {
    calls.push({ args: [...args], cwd });
    if (args[0] === 'pack') {
      const dest = args[args.indexOf('--pack-destination') + 1];
      fs.writeFileSync(path.join(dest, `flucto-${VERSION}.tgz`), 'tarball-bytes');
      return { stdout: `flucto-${VERSION}.tgz\n`, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { calls, exec };
};

const githubCtx = ({ controlDir, github, registry, npmExec = makeNpmExec().exec } = {}) => ({
  cwd: controlDir,
  env: {
    GH_TOKEN: 'ghp_test_secret_token',
    GITHUB_REPOSITORY: REPO,
    GITHUB_API_URL: github.baseUrl,
    RELEASE_TOOLS_NPM_REGISTRY: registry?.baseUrl ?? 'http://127.0.0.1:1',
  },
  github: createGitHubClient({
    apiBase: github.baseUrl,
    repository: REPO,
    token: 'ghp_test_secret_token',
  }),
  npmExec,
  log: () => {},
});

// ---- version helpers --------------------------------------------------------

test('compareVersions orders semver including prereleases', () => {
  assert.ok(compareVersions('1.17.0', '1.16.4') > 0);
  assert.ok(compareVersions('v1.17.0', '1.17.0') === 0);
  assert.ok(compareVersions('1.17.0-beta.1', '1.17.0') < 0);
  assert.ok(compareVersions('2.0.0', '1.99.9') > 0);
});

// ---- verify -----------------------------------------------------------------

test('verify accepts a complete artifact set and writes deterministic checksums', async () => {
  const { dir, names } = makeArtifacts(VERSION);
  const { files, checksumsFile } = await verifyArtifacts(VERSION, dir);
  const lines = fs.readFileSync(checksumsFile, 'utf8').trim().split('\n');
  const listed = lines.map((line) => line.split('  ')[1]);
  assert.deepEqual(listed, [...listed].sort());
  assert.deepEqual(files, [...listed, 'checksums-sha256.txt']);
  assert.ok(!listed.includes('checksums-sha256.txt'));
  const setupLine = lines.find((line) => line.endsWith(names.setup));
  assert.equal(setupLine.split('  ')[0], sha256hex(`installer-bytes:${names.setup}:${VERSION}`));
  // Deterministic: re-verifying produces byte-identical output.
  const first = fs.readFileSync(checksumsFile, 'utf8');
  await verifyArtifacts(VERSION, dir);
  assert.equal(fs.readFileSync(checksumsFile, 'utf8'), first);
});

test('verify rejects a missing required installer', async () => {
  const { dir, names } = makeArtifacts(VERSION);
  fs.rmSync(path.join(dir, names.deb));
  fs.rmSync(path.join(dir, 'latest-linux.yml'));
  write(
    dir,
    'latest-linux.yml',
    manifestYaml(VERSION, [
      {
        url: names.appImage,
        sha512: sha512b64(`installer-bytes:${names.appImage}:${VERSION}`),
        size: `installer-bytes:${names.appImage}:${VERSION}`.length,
      },
    ]),
  );
  await assert.rejects(() => verifyArtifacts(VERSION, dir), /missing ubuntu-latest installer/);
});

test('verify rejects a missing update manifest', async () => {
  const { dir } = makeArtifacts(VERSION, { omit: ['latest-mac.yml'] });
  await assert.rejects(() => verifyArtifacts(VERSION, dir), /missing macos-latest update manifest/);
});

test('verify rejects a manifest for the wrong version', async () => {
  const { dir } = makeArtifacts(VERSION, {
    mutate: (dirPath, names) => {
      const content = `installer-bytes:${names.setup}:${VERSION}`;
      write(dirPath, 'latest.yml', manifestYaml('9.9.9', [{ url: names.setup, sha512: sha512b64(content), size: content.length }]));
    },
  });
  await assert.rejects(() => verifyArtifacts(VERSION, dir), /declares version "9.9.9"/);
});

test('verify rejects a manifest sha512 that does not match the artifact', async () => {
  const { dir } = makeArtifacts(VERSION, {
    mutate: (dirPath, namesMap) => {
      fs.writeFileSync(path.join(dirPath, namesMap.appImage), 'tampered-bytes');
    },
  });
  await assert.rejects(() => verifyArtifacts(VERSION, dir), /sha512 mismatch/);
});

test('verify rejects a manifest entry pointing at a missing file', async () => {
  const { dir, names } = makeArtifacts(VERSION);
  fs.rmSync(path.join(dir, names.dmgArm));
  fs.rmSync(path.join(dir, `${names.dmgArm}.blockmap`));
  await assert.rejects(() => verifyArtifacts(VERSION, dir), new RegExp(`references "${names.dmgArm}"`));
});

test('verify rejects a missing blockmap for a differential artifact', async () => {
  const { dir, names } = makeArtifacts(VERSION);
  fs.rmSync(path.join(dir, `${names.dmgX64}.blockmap`));
  await assert.rejects(() => verifyArtifacts(VERSION, dir), /missing .*\.blockmap/);
});

test('verify rejects an orphaned blockmap', async () => {
  const { dir } = makeArtifacts(VERSION);
  write(dir, 'Ghost-9.9.9-x64.dmg.blockmap', 'stray');
  await assert.rejects(() => verifyArtifacts(VERSION, dir), /orphaned/);
});

test('verify fails when the artifact directory does not exist', async () => {
  await assert.rejects(
    () => verifyArtifacts(VERSION, path.join(tmp('rt-nodir-'), 'missing')),
    /does not exist/,
  );
});

// ---- source validation ------------------------------------------------------

test('validateSourceRun rejects runs that were not push releases', () => {
  const head = 'a'.repeat(40);
  const jobs = jobsFixture();
  assert.throws(() => validateSourceRun(runFixture(head, { event: 'workflow_dispatch' }), jobs), /triggered by "workflow_dispatch"/);
  assert.throws(() => validateSourceRun(runFixture(head, { head_branch: 'feature/x' }), jobs), /branch/);
  assert.throws(() => validateSourceRun(runFixture(head, { status: 'in_progress' }), jobs), /in_progress/);
  assert.throws(() => validateSourceRun(runFixture(head, { path: '.github/workflows/ci.yml' }), jobs), /workflow/);
  assert.throws(
    () => validateSourceRun(runFixture(head), jobs.map((job) => (job.name.includes('windows') ? { ...job, conclusion: 'failure' } : job))),
    /windows-latest \(failure\)/,
  );
  assert.throws(
    () => validateSourceRun(runFixture(head), jobs.filter((job) => !job.name.includes('macos'))),
    /no build job for: macos-latest/,
  );
});

test('validateSourceRun rejects successful checks paired with failed packaging', () => {
  const checks = jobsFixture().map((job) => ({ ...job, name: job.name.replace('Build ', 'Checks ') }));
  const builds = jobsFixture().map((job) => job.name === 'Build windows-latest' ? { ...job, conclusion: 'failure' } : job);
  assert.throws(() => validateSourceRun(runFixture('a'.repeat(40)), [...checks, ...builds]), /unsuccessful build jobs/);
});

test('validateSource accepts a valid run and release tag', async () => {
  const repo = makeSourceRepo();
  const github = await startGitHub({ run: runFixture(repo.headSha) });
  const result = await validateSource(githubCtx({ controlDir: repo.dir, github }), RUN_ID, VERSION);
  assert.equal(result.tag, `v${VERSION}`);
  assert.equal(result.sourceSha, repo.headSha);
  assert.equal(result.tagCommit, repo.tagSha);
  assert.equal(result.packageName, 'flucto');
  await github.close();
});

test('validateSource rejects an unknown run id', async () => {
  const repo = makeSourceRepo();
  const github = await startGitHub({ run: null });
  await assert.rejects(
    () => validateSource(githubCtx({ controlDir: repo.dir, github }), RUN_ID, VERSION),
    /not found/,
  );
  await github.close();
});

test('validateSource rejects when the release tag does not exist', async () => {
  const repo = makeSourceRepo();
  gitIn(repo.dir, 'tag', '-d', `v${VERSION}`);
  const github = await startGitHub({ run: runFixture(repo.headSha) });
  await assert.rejects(
    () => validateSource(githubCtx({ controlDir: repo.dir, github }), RUN_ID, VERSION),
    new RegExp(`tag v${VERSION} not found`),
  );
  await github.close();
});

test('validateSource rejects a tag that is not a descendant of the built commit', async () => {
  const repo = makeSourceRepo();
  // A newer commit on main after tagging: tag can no longer be a descendant of head.
  const laterSha = (() => {
    write(repo.dir, 'src/other.js', 'export const other = 1;\n');
    gitIn(repo.dir, 'add', '-A');
    gitIn(repo.dir, 'commit', '-m', 'feat: later change');
    return gitIn(repo.dir, 'rev-parse', 'HEAD');
  })();
  const github = await startGitHub({ run: runFixture(laterSha) });
  await assert.rejects(
    () => validateSource(githubCtx({ controlDir: repo.dir, github }), RUN_ID, VERSION),
    /not a descendant/,
  );
  await github.close();
});

test('validateSource rejects non-release files changed after the build', async () => {
  const repo = makeSourceRepo({ mutate: (dir) => write(dir, 'src/app.js', 'export const app = 2;\n') });
  const github = await startGitHub({ run: runFixture(repo.headSha) });
  await assert.rejects(
    () => validateSource(githubCtx({ controlDir: repo.dir, github }), RUN_ID, VERSION),
    /modify non-release files: src\/app\.js/,
  );
  await github.close();
});

test('validateSource rejects package.json changes beyond the version field', async () => {
  const repo = makeSourceRepo({
    mutate: (dir) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      pkg.description = 'sneaky metadata change';
      fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    },
  });
  const github = await startGitHub({ run: runFixture(repo.headSha) });
  await assert.rejects(
    () => validateSource(githubCtx({ controlDir: repo.dir, github }), RUN_ID, VERSION),
    /package\.json changed.*beyond version fields/,
  );
  await github.close();
});

test('validateSource rejects package-lock dependency changes between build and tag', async () => {
  const repo = makeSourceRepo({
    mutate: (dir) => {
      const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
      lock.packages[''].dependencies = { 'injected-dep': '1.0.0' };
      fs.writeFileSync(path.join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    },
  });
  const github = await startGitHub({ run: runFixture(repo.headSha) });
  await assert.rejects(
    () => validateSource(githubCtx({ controlDir: repo.dir, github }), RUN_ID, VERSION),
    /package-lock\.json changed.*beyond version fields/,
  );
  await github.close();
});

test('validateSource rejects a tag whose package version differs', async () => {
  const repo = makeSourceRepo();
  // Tag the build commit itself: version still reads 1.16.4 at that commit.
  gitIn(repo.dir, 'tag', '-d', `v${VERSION}`);
  gitIn(repo.dir, 'tag', `v${VERSION}`, repo.headSha);
  const github = await startGitHub({ run: runFixture(repo.headSha) });
  await assert.rejects(
    () => validateSource(githubCtx({ controlDir: repo.dir, github }), RUN_ID, VERSION),
    /package\.json at v1\.17\.0 is version 1\.16\.4/,
  );
  await github.close();
});

// ---- npm registry -----------------------------------------------------------

test('fetchNpmPackageInfo treats only a real 404 as unpublished', async () => {
  const missing = await startRegistry({ status: 404 });
  assert.equal(await fetchNpmPackageInfo({ registry: missing.baseUrl, name: 'flucto' }), null);
  await missing.close();

  const present = await startRegistry({
    status: 200,
    metadata: { 'dist-tags': { latest: '1.16.4' }, versions: { '1.16.4': {} } },
  });
  const info = await fetchNpmPackageInfo({ registry: present.baseUrl, name: 'flucto' });
  assert.equal(info['dist-tags'].latest, '1.16.4');
  await present.close();
});

test('fetchNpmPackageInfo fails hard on auth and server errors', async () => {
  const forbidden = await startRegistry({ status: 403 });
  await assert.rejects(
    () => fetchNpmPackageInfo({ registry: forbidden.baseUrl, name: 'flucto' }),
    (error) => error.status === 403,
  );
  await forbidden.close();
  const broken = await startRegistry({ status: 500 });
  await assert.rejects(
    () => fetchNpmPackageInfo({ registry: broken.baseUrl, name: 'flucto' }),
    (error) => error.status === 500,
  );
  await broken.close();
});

test('planNpmPublish skips published versions and protects a newer latest', () => {
  assert.equal(planNpmPublish('1.17.0', { versions: { '1.17.0': {} }, 'dist-tags': { latest: '1.17.0' } }).action, 'skip');
  const normal = planNpmPublish('1.17.0', { versions: {}, 'dist-tags': { latest: '1.16.4' } });
  assert.equal(normal.action, 'publish');
  assert.equal(normal.distTag, undefined);
  const newer = planNpmPublish('1.17.0', { versions: { '1.18.0': {} }, 'dist-tags': { latest: '1.18.0' } });
  assert.equal(newer.action, 'publish');
  assert.equal(newer.distTag, 'release-1.17.0');
});

// ---- GitHub client ----------------------------------------------------------

test('GitHub credentials never follow redirects to unrelated hosts', async () => {
  const redirectTarget = await startServer((requests) => (req, res) => {
    requests.push({ method: req.method, path: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  const entry = await startServer((requests) => (req, res) => {
    requests.push({ method: req.method, path: req.url, auth: req.headers.authorization });
    res.writeHead(302, { location: `${redirectTarget.baseUrl}/elsewhere` });
    res.end();
  });
  const client = createGitHubClient({ apiBase: entry.baseUrl, repository: REPO, token: 'ghp_leaked_secret' });
  const { body } = await client.api('GET', '/releases/tags/v9.9.9', { expected: [200] });
  assert.equal(body.ok, true);
  assert.equal(redirectTarget.requests[0].auth, undefined, 'authorization leaked to redirect host');
  await entry.close();
  await redirectTarget.close();
});

// ---- recover ----------------------------------------------------------------

const recoverCtx = async ({ run, jobs, release, latest, npmStatus = 404, npmMetadata = null } = {}) => {
  const repo = makeSourceRepo();
  const github = await startGitHub({
    run: run ?? runFixture(repo.headSha),
    jobs: jobs ?? jobsFixture(),
    release,
    latest,
  });
  const registry = await startRegistry({ status: npmStatus, metadata: npmMetadata });
  const npm = makeNpmExec();
  const ctx = githubCtx({ controlDir: repo.dir, github, registry, npmExec: npm.exec });
  const sourceDir = checkoutTag(repo.dir, `v${VERSION}`);
  return { repo, github, registry, npm, ctx, sourceDir };
};

test('recover finishes an orphaned tag: publishes npm, creates and publishes the GitHub release', async () => {
  const { dir: artifactDir } = makeArtifacts(VERSION);
  const { repo, github, registry, npm, ctx, sourceDir } = await recoverCtx();
  const result = await runRecover(ctx, { sourceRunId: RUN_ID, version: VERSION, artifactDir, sourceDir });

  // npm: packed from the tag source checkout, published as the missing version.
  assert.equal(result.npm.action, 'publish');
  assert.equal(npm.calls[0].args[0], 'pack');
  assert.equal(npm.calls[0].cwd, sourceDir);
  const publish = npm.calls.find((call) => call.args[0] === 'publish');
  assert.ok(publish.args[1].endsWith(`flucto-${VERSION}.tgz`));
  assert.ok(!publish.args.includes('--tag'), 'must not use a non-latest dist-tag for the newest version');
  assert.ok(!publish.args.join(' ').includes('ghp_'), 'github credentials must not leak to npm');

  // GitHub: release created on the existing tag, all verified files uploaded, draft published.
  assert.equal(github.state.created.tag_name, `v${VERSION}`);
  assert.deepEqual(github.state.uploads.map((asset) => asset.name).sort(), fs.readdirSync(artifactDir).sort());
  assert.ok(github.state.uploads.some((asset) => asset.name === 'checksums-sha256.txt'));
  assert.ok(github.state.uploads.some((asset) => asset.name === 'latest-linux.yml'));
  assert.ok(github.state.patched.some((payload) => payload.draft === false && payload.make_latest === 'true'));

  // The tag was reused, never deleted or moved.
  assert.equal(gitIn(repo.dir, 'rev-parse', `v${VERSION}^{commit}`), repo.tagSha);
  assert.equal(gitIn(repo.dir, 'tag', '-l'), `v${VERSION}`);

  await github.close();
  await registry.close();
});

test('recover does not republish an existing npm version but still completes the release', async () => {
  const { dir: artifactDir } = makeArtifacts(VERSION);
  const { github, registry, npm, ctx, sourceDir } = await recoverCtx({
    npmStatus: 200,
    npmMetadata: { 'dist-tags': { latest: '1.17.0' }, versions: { '1.17.0': {} } },
  });
  const result = await runRecover(ctx, { sourceRunId: RUN_ID, version: VERSION, artifactDir, sourceDir });
  assert.equal(result.npm.action, 'skip');
  assert.equal(npm.calls.length, 0, 'npm must not run when the version is already published');
  assert.deepEqual(github.state.uploads.map((asset) => asset.name).sort(), fs.readdirSync(artifactDir).sort());
  assert.ok(github.state.patched.some((payload) => payload.draft === false));
  await github.close();
  await registry.close();
});

test('recover fills missing assets on an existing draft release', async () => {
  const { dir: artifactDir, names } = makeArtifacts(VERSION);
  const existingSize = `installer-bytes:${names.setup}:${VERSION}`.length;
  const { github, registry, ctx, sourceDir } = await recoverCtx({
    release: {
      id: 77,
      tag_name: `v${VERSION}`,
      draft: true,
      upload_url: 'will-be-replaced',
      assets: [{ id: 1, name: names.setup, size: existingSize, state: 'uploaded', digest: `sha256:${sha256hex(`installer-bytes:${names.setup}:${VERSION}`)}` }],
    },
  });
  // upload_url must come from the server, so re-point it to the fake.
  github.state.release.upload_url = `${github.baseUrl}/uploads{?name,label}`;
  const result = await runRecover(ctx, { sourceRunId: RUN_ID, version: VERSION, artifactDir, sourceDir });
  assert.equal(result.github.created, false);
  assert.equal(github.state.created, null, 'must not recreate an existing release');
  assert.deepEqual(github.state.assets.map((asset) => asset.name).sort(), fs.readdirSync(artifactDir).sort());
  assert.ok(!github.state.uploads.some((asset) => asset.name === names.setup));
  assert.ok(github.state.patched.some((payload) => payload.draft === false));
  await github.close();
  await registry.close();
});

test('release recovery replaces a same-size asset with a different digest', async (t) => {
  const artifactDir = tmp('rt-same-size-');
  const name = 'Flucto-1.17.0-x64-setup.exe';
  const content = Buffer.from('correct installer');
  const digest = `sha256:${sha256hex(content)}`;
  write(artifactDir, name, content);
  write(artifactDir, 'checksums-sha256.txt', `${sha256hex(content)}  ${name}\n`);
  const github = await startGitHub({
    release: {
      id: 77, tag_name: 'v1.17.0', draft: true, upload_url: 'will-be-replaced',
      assets: [{ id: 1, name, size: content.length, state: 'uploaded', digest: `sha256:${sha256hex(Buffer.alloc(content.length))}` }],
    },
  });
  t.after(() => github.close());
  github.state.release.upload_url = `${github.baseUrl}/uploads{?name,label}`;
  await ensureGitHubRelease(
    { github: createGitHubClient({ apiBase: github.baseUrl, repository: REPO, token: 'test-token' }) },
    { tag: 'v1.17.0', version: VERSION, artifactDir, artifactFiles: [name] },
  );
  assert.equal(github.state.assets.find((asset) => asset.name === name)?.digest, digest);
  assert.equal(github.state.release.draft, false);
});

test('recover preserves a newer npm latest and GitHub latest', async () => {
  const { dir: artifactDir } = makeArtifacts(VERSION);
  const { github, registry, npm, ctx, sourceDir } = await recoverCtx({
    npmStatus: 200,
    npmMetadata: { 'dist-tags': { latest: '1.18.0' }, versions: { '1.18.0': {} } },
    latest: { id: 99, tag_name: 'v1.18.0', draft: false },
  });
  const result = await runRecover(ctx, { sourceRunId: RUN_ID, version: VERSION, artifactDir, sourceDir });
  const publish = npm.calls.find((call) => call.args[0] === 'publish');
  assert.ok(publish.args.includes('release-1.17.0'), 'older recovery must not steal the latest dist-tag');
  assert.ok(github.state.patched.some((payload) => payload.make_latest === 'false'));
  assert.equal(result.npm.newerLatest, true);
  await github.close();
  await registry.close();
});

test('recover refuses a wrong source run before touching npm or GitHub releases', async () => {
  const { dir: artifactDir } = makeArtifacts(VERSION);
  const { github, registry, npm, ctx, sourceDir } = await recoverCtx({
    run: runFixture('f'.repeat(40), { event: 'workflow_dispatch' }),
  });
  await assert.rejects(
    () => runRecover(ctx, { sourceRunId: RUN_ID, version: VERSION, artifactDir, sourceDir }),
    /workflow_dispatch/,
  );
  assert.equal(npm.calls.length, 0);
  assert.equal(github.state.created, null);
  assert.equal(github.state.uploads.length, 0);
  await github.close();
  await registry.close();
});

test('recover refuses corrupt artifacts before publishing', async () => {
  const { dir: artifactDir, names } = makeArtifacts(VERSION);
  fs.rmSync(path.join(artifactDir, names.zipArm));
  const { github, registry, npm, ctx, sourceDir } = await recoverCtx();
  await assert.rejects(
    () => runRecover(ctx, { sourceRunId: RUN_ID, version: VERSION, artifactDir, sourceDir }),
    /latest-mac\.yml.*absent|missing macos-latest installer|manifest.*absent/s,
  );
  assert.equal(npm.calls.length, 0);
  assert.equal(github.state.created, null);
  await github.close();
  await registry.close();
});

test('recover fails hard on npm registry errors instead of republishing', async () => {
  const { dir: artifactDir } = makeArtifacts(VERSION);
  const { github, registry, npm, ctx, sourceDir } = await recoverCtx({ npmStatus: 503 });
  await assert.rejects(
    () => runRecover(ctx, { sourceRunId: RUN_ID, version: VERSION, artifactDir, sourceDir }),
    (error) => error.status === 503,
  );
  assert.equal(npm.calls.length, 0, 'no publish attempt on an ambiguous registry response');
  await github.close();
  await registry.close();
});

// ---- CLI surface ------------------------------------------------------------

test('CLI rejects unknown commands and bad arguments', async () => {
  assert.equal(await main(['bogus']), 2);
  assert.equal(await main(['verify']), 2);
  assert.equal(await main(['verify', 'not-a-version', '/tmp']), 2);
  assert.equal(await main(['help']), 0);
});

test('CLI verify exits non-zero for a bad artifact dir', async () => {
  const dir = path.join(tmp('rt-cli-'), 'missing');
  assert.equal(await main(['verify', VERSION, dir]), 1);
});
