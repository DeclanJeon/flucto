import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';

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

const MAC_UNIVERSAL_ARCHES = ['x86_64', 'arm64'];
const NODE_TO_MACHO_ARCH = { x64: 'x86_64', arm64: 'arm64' };

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
  ffmpeg: {
    win32: [
      'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip',
      'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    ],
    darwinByArch: {
      x64: [
        'https://evermeet.cx/ffmpeg/getrelease/zip',
        'https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip',
        'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-darwin-x64.gz',
      ],
      arm64: [
        'https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip',
        'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-darwin-arm64.gz',
      ],
    },
    linuxByArch: {
      x64: [
        'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
      ],
      arm64: [
        'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz',
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz',
      ],
      arm: [
        'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-armhf-static.tar.xz',
      ],
      ia32: [
        'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-i686-static.tar.xz',
      ],
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

export const ffmpegSourcesFor = (os = OS, arch = HOST_ARCH) => {
  if (os === 'win32') return URLS.ffmpeg.win32;
  if (os === 'darwin') {
    const urls = URLS.ffmpeg.darwinByArch[arch];
    if (!urls) throw new Error(`No FFmpeg build is published for macOS/${arch}`);
    return urls;
  }
  if (os === 'linux') {
    const urls = URLS.ffmpeg.linuxByArch[arch];
    if (!urls) throw new Error(`No FFmpeg static build is published for linux/${arch}`);
    return urls;
  }
  throw new Error(`No FFmpeg download source for platform ${os}`);
};

async function downloadFile(url, destPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': `Flucto binary setup (${OS})`,
      Accept: 'application/octet-stream,*/*',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await fs.promises.writeFile(destPath, Buffer.from(await response.arrayBuffer()));
}

async function downloadFileWithRetry(url, destPath, { attempts = 3, delayMs = 1500 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await downloadFile(url, destPath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`⚠️  Download retry ${attempt}/${attempts - 1} for ${url}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError ?? new Error(`Failed to download ${url}`);
}

async function extractZip(zipPath, extractTo) {
  const admzip = await import('adm-zip');
  const zip = new admzip.default(zipPath);
  zip.extractAllTo(extractTo, true);
  return true;
}

async function extractTar(tarPath, extractTo) {
  execFileSync('tar', ['-xf', tarPath, '-C', extractTo], { stdio: 'inherit' });
  return true;
}

function findFileNamed(directory, filename) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === filename) return candidate;
    if (entry.isDirectory()) {
      const found = findFileNamed(candidate, filename);
      if (found) return found;
    }
  }
  return null;
}

function isZipArchive(filePath) {
  if (filePath.toLowerCase().endsWith('.zip')) return true;
  const file = fs.openSync(filePath, 'r');
  try {
    const signature = Buffer.allocUnsafe(4);
    return fs.readSync(file, signature, 0, 4, 0) === 4 && signature.readUInt32LE(0) === 0x04034b50;
  } finally {
    fs.closeSync(file);
  }
}

// ZIP endpoints may have no extension; inspect their signature before extraction.
async function installDownloadedBinary(archivePath, memberName, destPath) {
  const lower = archivePath.toLowerCase();
  const zip = isZipArchive(archivePath);
  if (zip || lower.endsWith('.tar.xz') || lower.endsWith('.tar.gz') || lower.endsWith('.tar')) {
    const extractTemp = `${destPath}.extract-${process.pid}`;
    fs.mkdirSync(extractTemp, { recursive: true });
    try {
      if (zip) {
        await extractZip(archivePath, extractTemp);
      } else {
        await extractTar(archivePath, extractTemp);
      }
      const found = findFileNamed(extractTemp, memberName);
      if (!found) throw new Error(`${memberName} not found inside ${path.basename(archivePath)}`);
      fs.copyFileSync(found, destPath);
    } finally {
      fs.rmSync(extractTemp, { recursive: true, force: true });
    }
    return;
  }
  if (lower.endsWith('.gz')) {
    await pipeline(fs.createReadStream(archivePath), zlib.createGunzip(), fs.createWriteStream(destPath));
    return;
  }
  fs.copyFileSync(archivePath, destPath);
}

async function provisionFromSources(sources, memberName, destPath) {
  const errors = [];
  const tempDir = fs.mkdtempSync(path.join(BIN_DIR, '.download-'));
  try {
    for (const url of sources) {
      const leaf = path.basename(new URL(url).pathname) || `${memberName}.download`;
      const archivePath = path.join(tempDir, leaf);
      try {
        console.log(`⬇️  Downloading from ${url}...`);
        await downloadFileWithRetry(url, archivePath);
        await installDownloadedBinary(archivePath, memberName, destPath);
        return url;
      } catch (error) {
        errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        console.warn(`⚠️  Source failed: ${url}`);
        fs.rmSync(archivePath, { force: true });
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  throw new Error(`All download sources failed for ${memberName}:\n  ${errors.join('\n  ')}`);
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
  await setupFfmpeg();

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
