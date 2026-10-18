import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { execFileSync, execSync, spawn } from 'child_process';
import { Readable, Transform } from 'stream';
import { createHash } from 'crypto';

const BIN_DIR = path.join(process.cwd(), 'bin');
const OS = process.platform; // 'win32', 'darwin', 'linux'
const HOST_ARCH = process.arch; // 'x64', 'arm64', ...
const FORCE = process.argv.includes('--force') || process.env.FLUCTO_FORCE_BINARIES === '1';
const UNIVERSAL =
  process.argv.includes('--universal')
  || process.env.FLUCTO_UNIVERSAL_BINARIES === '1';
const SKIP =
  process.env.FLUCTO_SKIP_BINARIES === '1'
  || process.env.FLUCTO_SKIP_BINARIES === 'true';
// Soft failure is reserved for `npm run postinstall` style invocations where a
// failed download must not break `npm install`. Direct runs (CI packaging,
// `flucto setup` flows) fail hard so a release never ships without binaries.
const WARN_ONLY =
  process.env.FLUCTO_BINARY_SETUP_WARN_ONLY === '1'
  || process.env.npm_lifecycle_event === 'postinstall';
const DOWNLOAD_TIMEOUT_MS = 120000;
const MAX_AV_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_AV_DECOMPRESSED_TAR_BYTES = 1024 * 1024 * 1024;
const MAX_AV_MEMBER_BYTES = 256 * 1024 * 1024;
const MAC_UNIVERSAL_ARCHES = ['x86_64', 'arm64'];
const NODE_TO_MACHO_ARCH = { x64: 'x86_64', arm64: 'arm64' };

// GPL-enabled binaries: redistribution/licensing review remains a release gate.
const PINNED_AV = {
  'win32/x64': {
    ffmpeg: { url: 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip', sha256: 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec' },
    ffprobe: { url: 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip', sha256: 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec' },
  },
  'linux/x64': { ffmpeg: { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-18-13-01/ffmpeg-N-127651-gb60ab6c9a4-linux64-gpl.tar.xz', sha256: 'a5f2aed198efa8ef4c12d9112f42e7cefbdf11dced1b59a87503ca689bc52277' }, ffprobe: { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-18-13-01/ffmpeg-N-127651-gb60ab6c9a4-linux64-gpl.tar.xz', sha256: 'a5f2aed198efa8ef4c12d9112f42e7cefbdf11dced1b59a87503ca689bc52277' } },
  'linux/arm64': { ffmpeg: { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-18-13-01/ffmpeg-N-127651-gb60ab6c9a4-linuxarm64-gpl.tar.xz', sha256: '3d1ccdb45b01635e8404da39869f3a0c7a535b9e63470439bc3e677cf12fe266' }, ffprobe: { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-18-13-01/ffmpeg-N-127651-gb60ab6c9a4-linuxarm64-gpl.tar.xz', sha256: '3d1ccdb45b01635e8404da39869f3a0c7a535b9e63470439bc3e677cf12fe266' } },
  'darwin/x64': { ffmpeg: { url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip', sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4' }, ffprobe: { url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffprobe.zip', sha256: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd' } },
  'darwin/arm64': { ffmpeg: { url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip', sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924' }, ffprobe: { url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffprobe.zip', sha256: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6' } },
};

export const pinnedAvSourceFor = (name, os = OS, arch = HOST_ARCH) => {
  const source = PINNED_AV[`${os}/${arch}`]?.[name];
  if (!source) throw new Error(`No pinned ${name} source for ${os}/${arch}`);
  return source;
};

// URL configuration. Order matters: earlier entries are tried first and
// fallbacks are only used when they are architecturally compatible with the
// requested CPU. evermeet.cx only ships x86_64, so it is never offered to
// arm64; ffmpeg-static ships per-arch gzip'd binaries for both slices.
const URLS = {
  yt_dlp: {
    win32: 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe',
    // yt-dlp_macos is a universal2 (x86_64+arm64) Mach-O binary.
    darwin: 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos',
    linuxByArch: {
      x64: 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux',
      arm64: 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux_aarch64',
    },
  },
};

export const ytDlpUrlFor = (os = OS, arch = HOST_ARCH) => {
  if (os === 'win32' || os === 'darwin') return URLS.yt_dlp[os];
  if (os === 'linux') {
    const url = URLS.yt_dlp.linuxByArch[arch];
    if (!url) throw new Error(`No yt-dlp build is published for linux/${arch}`);
    return url;
  }
  throw new Error(`No yt-dlp download source for platform ${os}`);
};

export const ffmpegSourcesFor = (os = OS, arch = HOST_ARCH) => [pinnedAvSourceFor('ffmpeg', os, arch).url];

async function downloadFile(url, destPath, maxBytes = MAX_AV_ARCHIVE_BYTES) {
  const response = await fetch(url, {
    headers: { 'User-Agent': `Flucto binary setup (${OS})`, Accept: 'application/octet-stream,*/*' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > maxBytes) throw new Error('Downloaded archive exceeds size limit');
  if (!response.body) throw new Error('Download response has no body');
  let total = 0;
  const cap = new Transform({ transform(chunk, _encoding, callback) {
    total += chunk.length;
    callback(total > maxBytes ? new Error('Downloaded archive exceeds size limit') : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), cap, fs.createWriteStream(destPath, { flags: 'wx' }));
}

async function downloadFileWithRetry(url, destPath, { attempts = 3, delayMs = 1500 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await downloadFile(url, destPath);
      return;
    } catch (error) {
      lastError = error;
      fs.rmSync(destPath, { force: true });
      if (attempt < attempts) {
        console.warn(`⚠️  Download retry ${attempt}/${attempts - 1} for ${url}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError ?? new Error(`Failed to download ${url}`);
}

const sha256File = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pinnedSourceForUrl = (url) => Object.values(PINNED_AV).flatMap((pair) => Object.values(pair)).find((source) => source.url === url);
const safeArchivePath = (value) => {
  const p = value.replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) throw new Error(`Unsafe archive member path: ${value}`);
  return p;
};

export async function extractAvMember(archivePath, memberName, destination, decompressedTarCache) {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    const { default: AdmZip } = await import('adm-zip');
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    for (const entry of entries) {
      safeArchivePath(entry.entryName);
      if (((entry.header.attr >>> 16) & 0xf000) === 0xa000) throw new Error(`Archive symlink rejected: ${entry.entryName}`);
    }
    const matches = entries.filter((entry) => {
      const p = safeArchivePath(entry.entryName);
      return p === memberName || p.endsWith(`/${memberName}`);
    });
    if (matches.length !== 1) throw new Error(`Expected exactly one ${memberName} archive member; found ${matches.length}`);
    const entry = matches[0];
    if (!Number.isFinite(entry.header.size) || entry.header.size > MAX_AV_MEMBER_BYTES || !Number.isFinite(entry.header.compressedSize)
      || entry.header.size / Math.max(1, entry.header.compressedSize) > 1000) throw new Error('ZIP member size/compression ratio exceeds limit');
    const data = entry.getData();
    if (data.length !== entry.header.size || data.length > MAX_AV_MEMBER_BYTES) throw new Error('ZIP member actual size invalid');
    fs.writeFileSync(destination, data);
    return;
  }
  let tarFile = archivePath;
  let ownsTarFile = false;
  if (lower.endsWith('.tar.xz')) {
    tarFile = decompressedTarCache?.get(archivePath) ?? path.join(path.dirname(destination), `archive-${decompressedTarCache?.size ?? 0}.decompressed.tar`);
    const cached = decompressedTarCache?.has(archivePath) ?? false;
    if (!cached) {
      ownsTarFile = !decompressedTarCache;
      const child = spawn('xz', ['-dc', '--', archivePath], { stdio: ['ignore', 'pipe', 'ignore'], shell: false });
      const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      const timer = setTimeout(() => child.kill(), DOWNLOAD_TIMEOUT_MS);
      let expandedBytes = 0;
      const cap = new Transform({ transform(chunk, _encoding, callback) {
        expandedBytes += chunk.length;
        callback(expandedBytes > MAX_AV_DECOMPRESSED_TAR_BYTES ? new Error('Decompressed TAR exceeds size limit') : null, chunk);
      } });
      try {
        await pipeline(child.stdout, cap, fs.createWriteStream(tarFile, { flags: 'wx' }));
        const code = await closed;
        if (code !== 0) throw new Error(`xz failed with exit code ${code}`);
      } catch (error) {
        child.kill(); await closed.catch(() => undefined); fs.rmSync(tarFile, { force: true }); throw error;
      } finally { clearTimeout(timer); }
      decompressedTarCache?.set(archivePath, tarFile);
    }
  }
  const { x } = await import('tar');
  const extractDir = `${destination}.extract`;
  fs.mkdirSync(extractDir);
  let count = 0;
  let rejected = null;
  try {
    await x({ file: tarFile, cwd: extractDir, strict: true, filter: (raw, entry) => {
      let p;
      try { p = safeArchivePath(raw); } catch (error) { rejected = error; return false; }
      if (entry.type && !['File', 'Directory'].includes(entry.type)) { rejected = new Error(`TAR link/special member rejected: ${raw}`); return false; }
      if (p === memberName || p.endsWith(`/${memberName}`)) {
        count += 1;
        if (count !== 1 || entry.type !== 'File' || !Number.isFinite(entry.size) || entry.size > MAX_AV_MEMBER_BYTES) { rejected = new Error(`Ambiguous/invalid/oversized TAR member: ${raw}`); return false; }
        return true;
      }
      return entry.type === 'Directory';
    } });
    if (rejected) throw rejected;
    if (count !== 1) throw new Error(`Expected one TAR member ${memberName}`);
    const entries = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else entries.push(p); } };
    walk(extractDir);
    if (entries.length !== 1) throw new Error(`Unexpected TAR extraction entries: ${entries.length}`);
    if (fs.statSync(entries[0]).size > MAX_AV_MEMBER_BYTES) throw new Error('Extracted TAR member exceeds size limit');
    fs.copyFileSync(entries[0], destination);
  } finally { fs.rmSync(extractDir, { recursive: true, force: true }); if (ownsTarFile) fs.rmSync(tarFile, { force: true }); }
}

async function provisionFromSources(sources, memberName, destPath) {
  const tempDir = fs.mkdtempSync(path.join(path.dirname(destPath), '.download-'));
  try {
    for (const url of sources) {
      const source = pinnedSourceForUrl(url);
      if (!source) throw new Error(`No pinned SHA-256 configured for ${url}`);
      const archivePath = path.join(tempDir, path.basename(new URL(url).pathname));
      const staged = path.join(tempDir, path.basename(destPath));
      await downloadFileWithRetry(url, archivePath);
      const actual = sha256File(archivePath);
      if (actual !== source.sha256) throw new Error(`SHA-256 mismatch for ${url}`);
      await extractAvMember(archivePath, memberName, staged);
      if (OS !== 'win32') fs.chmodSync(staged, 0o755);
      const args = memberName.toLowerCase().includes('ffprobe') ? ['-version'] : ['-version'];
      if (!localBinaryVersion(staged, args)) throw new Error(`${memberName} failed staged version check`);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.renameSync(staged, destPath);
      return url;
    }
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
  throw new Error(`No pinned source configured for ${memberName}`);
}

async function fetchLatestYtDlpVersion() {
  try {
    const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest', {
      headers: {
        'User-Agent': `Flucto binary setup (${OS})`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const tag = typeof payload?.tag_name === 'string' ? payload.tag_name.trim() : '';
    return tag.replace(/^yt-dlp\s+/i, '').replace(/^v/i, '') || null;
  } catch (error) {
    console.warn(`⚠️  Could not resolve latest yt-dlp version: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function localBinaryVersion(binaryPath, versionArgs = ['--version']) {
  try {
    return execFileSync(binaryPath, versionArgs, { encoding: 'utf8' })
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() || null;
  } catch {
    return null;
  }
}

// Pure Mach-O header inspection so architecture checks work on any host
// (including CI logs/tests that run off-Mac). Returns Mach-O CPU names such as
// 'x86_64'/'arm64', or null when the file is not a Mach-O binary.
export function machOArchitectures(filePath) {
  const fd = fs.openSync(filePath, 'r');
  let header;
  try {
    header = Buffer.alloc(65536);
    const read = fs.readSync(fd, header, 0, header.length, 0);
    header = header.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
  if (header.length < 8) return null;

  const magic = header.readUInt32BE(0);
  const cpuName = (cputype) => {
    if (cputype === 0x01000007) return 'x86_64';
    if (cputype === 0x0100000c) return 'arm64';
    if (cputype === 0x00000007) return 'i386';
    if (cputype === 0x0000000c) return 'arm';
    return `cpu0x${cputype.toString(16)}`;
  };

  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const is64 = magic === 0xcafebabf;
    const entrySize = is64 ? 32 : 20;
    const count = header.readUInt32BE(4);
    const archs = [];
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * entrySize;
      if (offset + 4 > header.length) break;
      archs.push(cpuName(header.readUInt32BE(offset)));
    }
    return archs;
  }
  if (magic === 0xfeedface || magic === 0xfeedfacf || magic === 0xcefaedfe || magic === 0xcffaedfe) {
    return [cpuName(header.readUInt32LE(4))];
  }
  return null;
}

// Runs `binary --version` under each requested CPU slice. The host slice must
// always execute; non-host slices are exercised when the host can run them
// (arm64 Macs run x86_64 through Rosetta 2) and otherwise verified
// structurally via the Mach-O header.
export function executableArchs(binaryPath, archs, { log = console.warn, versionArgs = ['--version'] } = {}) {
  const hostMachO = NODE_TO_MACHO_ARCH[process.arch];
  const verified = [];
  for (const arch of archs) {
    try {
      execFileSync('arch', [`-${arch}`, binaryPath, ...versionArgs], { stdio: 'pipe' });
      verified.push(arch);
    } catch (error) {
      if (arch === hostMachO) {
        throw new Error(`${path.basename(binaryPath)} cannot run on this host (${arch}): ${error instanceof Error ? error.message : String(error)}`);
      }
      log(`⚠️  Cannot execute the ${arch} slice on this host; verified structurally only (${path.basename(binaryPath)})`);
    }
  }
  return verified;
}

export function assertUniversalMachO(filePath, label) {
  const archs = machOArchitectures(filePath);
  if (!archs) {
    throw new Error(`${label} is not a Mach-O binary (${filePath})`);
  }
  const missing = MAC_UNIVERSAL_ARCHES.filter((arch) => !archs.includes(arch));
  if (missing.length) {
    throw new Error(`${label} is missing universal slice(s) ${missing.join(', ')} (found: ${archs.join(', ') || 'none'})`);
  }
  return archs;
}

// Runs `lipo -create` to fuse per-arch binaries into a universal Mach-O.
function lipoCreateUniversal(inputs, output) {
  execFileSync('lipo', ['-create', '-output', output, ...inputs], { stdio: 'inherit' });
}

function assertMachOForHost(filePath, label) {
  const hostMachO = NODE_TO_MACHO_ARCH[HOST_ARCH];
  if (!hostMachO) return;
  const archs = machOArchitectures(filePath);
  if (archs && !archs.includes(hostMachO)) {
    throw new Error(`${label} cannot run on this Mac (contains ${archs.join(', ')}, needs ${hostMachO})`);
  }
}

async function setupYtDlp() {
  const ytDlpName = OS === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const ytDlpPath = path.join(BIN_DIR, ytDlpName);
  const ytDlpExists = fs.existsSync(ytDlpPath);
  const localYtDlpVersion = ytDlpExists ? localBinaryVersion(ytDlpPath) : null;
  const latestYtDlpVersion = (!FORCE && ytDlpExists) ? await fetchLatestYtDlpVersion() : null;
  const ytDlpOutdated = Boolean(
    ytDlpExists
    && latestYtDlpVersion
    && localYtDlpVersion
    && localYtDlpVersion !== latestYtDlpVersion,
  );
  const shouldRefreshYtDlp = FORCE || !ytDlpExists || ytDlpOutdated;

  if (!shouldRefreshYtDlp) {
    console.log(`✅ yt-dlp already up to date (${localYtDlpVersion ?? 'unknown'}).`);
  } else {
    if (ytDlpExists && ytDlpOutdated) {
      console.log(`⬇️  Updating yt-dlp (${localYtDlpVersion} → ${latestYtDlpVersion})...`);
    } else if (ytDlpExists && FORCE) {
      console.log('⬇️  Re-downloading yt-dlp (--force)...');
    } else {
      console.log('⬇️  Downloading yt-dlp...');
    }
    await downloadFileWithRetry(ytDlpUrlFor(), ytDlpPath);
    if (OS !== 'win32') {
      execSync(`chmod +x "${ytDlpPath}"`);
    }
  }

  if (OS === 'darwin') {
    if (UNIVERSAL) {
      assertUniversalMachO(ytDlpPath, 'yt-dlp');
      const executed = executableArchs(ytDlpPath, MAC_UNIVERSAL_ARCHES);
      console.log(`✅ yt-dlp universal (x86_64+arm64); executed on ${executed.join(', ') || 'host slice only'}.`);
      return;
    }
    assertMachOForHost(ytDlpPath, 'yt-dlp');
  }

  const installedVersion = localBinaryVersion(ytDlpPath) ?? 'unknown';
  console.log(`✅ yt-dlp ready (${installedVersion}).`);
}

async function setupFfmpegUniversal() {
  const ffmpegPath = path.join(BIN_DIR, 'ffmpeg');
  if (fs.existsSync(ffmpegPath) && !FORCE) {
    const archs = machOArchitectures(ffmpegPath);
    if (archs && MAC_UNIVERSAL_ARCHES.every((arch) => archs.includes(arch))) {
      console.log('✅ FFmpeg already universal.');
      executableArchs(ffmpegPath, MAC_UNIVERSAL_ARCHES, { versionArgs: ['-version'] });
      return;
    }
    console.log('⬇️  Existing FFmpeg is not universal; rebuilding slices...');
  }

  const slicePaths = [];
  for (const arch of ['x64', 'arm64']) {
    const slicePath = path.join(BIN_DIR, `ffmpeg-${arch}`);
    console.log(`⬇️  Provisioning FFmpeg ${arch} slice...`);
    await provisionFromSources(ffmpegSourcesFor('darwin', arch), 'ffmpeg', slicePath);
    execSync(`chmod +x "${slicePath}"`);
    slicePaths.push(slicePath);
  }

  console.log('🔀 Creating universal FFmpeg with lipo...');
  lipoCreateUniversal(slicePaths, ffmpegPath);
  for (const slicePath of slicePaths) fs.rmSync(slicePath, { force: true });
  execSync(`chmod +x "${ffmpegPath}"`);

  assertUniversalMachO(ffmpegPath, 'FFmpeg');
  const executed = executableArchs(ffmpegPath, MAC_UNIVERSAL_ARCHES, { versionArgs: ['-version'] });
  const version = localBinaryVersion(ffmpegPath, ['-version']) ?? 'unknown';
  console.log(`✅ FFmpeg universal (x86_64+arm64, ${version}); executed on ${executed.join(', ') || 'host slice only'}.`);
}

export function replaceAvPairAtomically(pairs, { rename = fs.renameSync, remove = fs.rmSync, exists = fs.existsSync } = {}) {
  if (!pairs || pairs.length !== 2) throw new Error('FFmpeg/FFprobe replacement requires exactly two staged binaries');
  const backupDir = fs.mkdtempSync(path.join(path.dirname(pairs[0].target), '.av-backup-'));
  const backups = [];
  const installed = [];
  try {
    for (const [index, pair] of pairs.entries()) {
      if (exists(pair.target)) {
        const backup = path.join(backupDir, `${index}-${path.basename(pair.target)}`);
        rename(pair.target, backup);
        backups.push({ target: pair.target, backup });
      }
    }
    for (const pair of pairs) { rename(pair.staged, pair.target); installed.push(pair.target); }
  } catch (error) {
    const rollbackErrors = [];
    for (const target of installed.reverse()) {
      try { remove(target, { force: true }); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    for (const item of backups.reverse()) {
      try { rename(item.backup, item.target); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `FFmpeg/FFprobe replacement failed and rollback was incomplete; preserved backups at ${backupDir}`);
    remove(backupDir, { recursive: true, force: true });
    throw error;
  }
  remove(backupDir, { recursive: true, force: true });
}

async function setupAvPair() {
  const stageDir = fs.mkdtempSync(path.join(BIN_DIR, '.av-pair-'));
  try {
    const staged = [];
    const arches = OS === 'darwin' && UNIVERSAL ? ['x64', 'arm64'] : [HOST_ARCH];
    const sourcePairs = arches.flatMap((arch) => ['ffmpeg', 'ffprobe'].map((tool) => ({ tool, arch, source: pinnedAvSourceFor(tool, OS, arch) })));
    const archives = new Map();
    for (const { source } of sourcePairs) {
      if (archives.has(source.url)) continue;
      const archivePath = path.join(stageDir, `archive-${archives.size}-${path.basename(new URL(source.url).pathname)}`);
      await downloadFileWithRetry(source.url, archivePath);
      if (sha256File(archivePath) !== source.sha256) throw new Error(`SHA-256 mismatch for ${source.url}`);
      archives.set(source.url, archivePath);
    }
    const decompressedTarCache = new Map();
    const stageMember = async (tool, source, output) => {
      const archivePath = archives.get(source.url);
      if (!archivePath) throw new Error(`Pinned archive missing: ${source.url}`);
      await extractAvMember(archivePath, tool, output, decompressedTarCache);
      if (OS !== 'win32') fs.chmodSync(output, 0o755);
      if (!localBinaryVersion(output, ['-version'])) throw new Error(`${tool} staged version validation failed`);
    };
    if (OS === 'darwin' && UNIVERSAL) {
      const slices = { ffmpeg: [], ffprobe: [] };
      for (const { tool, arch, source } of sourcePairs) {
        const slice = path.join(stageDir, `${tool}-${arch}`);
        await stageMember(tool, source, slice);
        slices[tool].push(slice);
      }
      for (const tool of ['ffmpeg', 'ffprobe']) {
        const output = path.join(stageDir, tool);
        lipoCreateUniversal(slices[tool], output);
        assertUniversalMachO(output, tool);
        if (!localBinaryVersion(output, ['-version'])) throw new Error(`${tool} universal staged version check failed`);
        staged.push({ staged: output, target: path.join(BIN_DIR, tool) });
      }
    } else {
      for (const { tool, source } of sourcePairs) {
        const executable = OS === 'win32' ? `${tool}.exe` : tool;
        const output = path.join(stageDir, executable);
        await stageMember(executable, source, output);
        staged.push({ staged: output, target: path.join(BIN_DIR, executable) });
      }
    }
    const versions = staged.map(({ staged: file }) => localBinaryVersion(file, ['-version']));
    const versionTag = (value) => value?.match(/version ([^ ]+)/)?.[1];
    if (!versions[0] || !versions[1] || versionTag(versions[0]) !== versionTag(versions[1])) throw new Error('Pinned FFmpeg/FFprobe staged versions do not match');
    replaceAvPairAtomically(staged);
    console.log(`✅ FFmpeg/FFprobe pinned pair installed (${versionTag(versions[0])}).`);
  } finally { fs.rmSync(stageDir, { recursive: true, force: true }); }
}

async function setupFfprobeUniversal() {
  const target = path.join(BIN_DIR, 'ffprobe');
  const ffmpegVersion = localBinaryVersion(path.join(BIN_DIR, 'ffmpeg'), ['-version']);
  if (fs.existsSync(target) && !FORCE) {
    try {
      assertUniversalMachO(target, 'FFprobe');
      const current = localBinaryVersion(target, ['-version']);
      if (current && ffmpegVersion && current.includes(ffmpegVersion.match(/version ([^ ]+)/)?.[1] ?? '\u0000')) return;
    } catch { /* rebuild invalid or mismatched installed probe */ }
  }
  const slices = [];
  for (const arch of ['x64', 'arm64']) {
    const slice = path.join(BIN_DIR, `ffprobe-${arch}`);
    await provisionFromSources([pinnedAvSourceFor('ffprobe', 'darwin', arch).url], 'ffprobe', slice);
    slices.push(slice);
  }
  const staged = path.join(BIN_DIR, '.ffprobe-universal-staged');
  lipoCreateUniversal(slices, staged);
  assertUniversalMachO(staged, 'FFprobe');
  if (!localBinaryVersion(staged, ['-version'])) throw new Error('Universal FFprobe failed version check');
  fs.renameSync(staged, target);
  for (const slice of slices) fs.rmSync(slice, { force: true });
}

async function setupFfprobe() {
  if (OS === 'darwin' && UNIVERSAL) return setupFfprobeUniversal();
  const target = path.join(BIN_DIR, OS === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const ffmpegVersion = localBinaryVersion(path.join(BIN_DIR, OS === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ['-version']);
  if (fs.existsSync(target) && !FORCE) {
    const currentVersion = localBinaryVersion(target, ['-version']);
    if (currentVersion && ffmpegVersion && currentVersion.includes(ffmpegVersion.match(/version ([^ ]+)/)?.[1] ?? '\u0000')) return;
  }
  const source = pinnedAvSourceFor('ffprobe', OS, HOST_ARCH);
  await provisionFromSources([source.url], OS === 'win32' ? 'ffprobe.exe' : 'ffprobe', target);
}

async function setupFfmpeg() {
  const ffmpegName = OS === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffmpegPath = path.join(BIN_DIR, ffmpegName);

  if (OS === 'darwin' && UNIVERSAL) {
    await setupFfmpegUniversal();
    return;
  }

  if (fs.existsSync(ffmpegPath) && !FORCE) {
    console.log('✅ FFmpeg already exists.');
    return;
  }

  console.log(FORCE && fs.existsSync(ffmpegPath) ? '⬇️  Re-downloading FFmpeg (--force)...' : '⬇️  Downloading FFmpeg...');
  const memberName = OS === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  await provisionFromSources(ffmpegSourcesFor(), memberName, ffmpegPath);
  if (OS !== 'win32') {
    execSync(`chmod +x "${ffmpegPath}"`);
  }

  if (OS === 'darwin') {
    assertMachOForHost(ffmpegPath, 'FFmpeg');
  }

  const version = localBinaryVersion(ffmpegPath, ['-version']);
  if (!version) {
    throw new Error(`FFmpeg was provisioned to ${ffmpegPath} but failed its -version check`);
  }
  console.log(`✅ FFmpeg ready (${version}).`);
}

export async function setup() {
  if (UNIVERSAL && OS !== 'darwin') {
    throw new Error('--universal packaging only applies to macOS builds');
  }

  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  console.log(`🚀 [Flucto] Setting up binaries for ${OS}/${HOST_ARCH}${UNIVERSAL ? ' (universal packaging)' : ''}...`);

  await setupYtDlp();
  await setupAvPair();

  console.log('\n🎉 Setup complete!');
  console.log(`📁 Binary directory: ${BIN_DIR}`);
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  if (SKIP) {
    console.log('⏭️  [Flucto] Skipping binary setup (FLUCTO_SKIP_BINARIES detected).');
    console.log('   Run `flucto setup` (or this script) later to provision yt-dlp/ffmpeg.');
  } else {
    setup().catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      if (WARN_ONLY) {
        console.warn('\n⚠️  [Flucto] Binary setup failed, but the install will continue.');
        console.warn('   Run `flucto setup` later to provision yt-dlp/ffmpeg.');
        return;
      }
      console.error('\n❌ [Flucto] Binary setup failed. Fix the download and re-run this script.');
      process.exitCode = 1;
    });
  }
}
