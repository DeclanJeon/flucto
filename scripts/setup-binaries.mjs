import fs from 'fs';
import path from 'path';
import { platform } from 'os';
import { execSync } from 'child_process';

const BIN_DIR = path.join(process.cwd(), 'bin');
const OS = platform(); // 'win32', 'darwin', 'linux'
const FORCE = process.argv.includes('--force') || process.env.FLUCTO_FORCE_BINARIES === '1';
const SKIP =
  process.env.FLUCTO_SKIP_BINARIES === '1'
  || process.env.FLUCTO_SKIP_BINARIES === 'true'
  || process.env.CI === 'true';
const DOWNLOAD_TIMEOUT_MS = 120000;

// URL Configuration
const URLS = {
  yt_dlp: {
    win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
  },
  ffmpeg: {
    // Prefer GitHub-hosted builds; keep vendor mirrors as fallback.
    win32: [
      'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip',
      'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    ],
    darwin: 'https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip',
    linux: [
      'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
      'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
    ],
  }
};

async function downloadFile(url, destPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': `Flucto binary setup (${OS})`,
      Accept: 'application/octet-stream,*/*',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
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

async function downloadFirstAvailable(urls, destPath) {
  const candidates = Array.isArray(urls) ? urls : [urls];
  let lastError = null;
  for (const url of candidates) {
    try {
      console.log(`⬇️  Downloading from ${url}...`);
      await downloadFileWithRetry(url, destPath);
      return url;
    } catch (error) {
      lastError = error;
      console.warn(`⚠️  Source failed: ${url}`);
      try {
        fs.rmSync(destPath, { force: true });
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
  throw lastError ?? new Error('No download sources available');
}

async function extractZip(zipPath, extractTo) {
  const admzip = await import('adm-zip');
  const zip = new admzip.default(zipPath);
  zip.extractAllTo(extractTo, true);
  return true;
}

async function extractTar(tarPath, extractTo) {
  const { execSync: execSyncLocal } = await import('child_process');
  execSyncLocal(`tar -xf "${tarPath}" -C "${extractTo}"`, { stdio: 'inherit' });
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

async function fetchLatestYtDlpVersion() {
  try {
    const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
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

function localBinaryVersion(binaryPath) {
  try {
    return execSync(`"${binaryPath}" --version`, { encoding: 'utf8' })
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() || null;
  } catch {
    return null;
  }
}

async function setup() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR);
  }

  console.log(`🚀 [Flucto] Setting up binaries for ${OS}...`);

  // 1. Download yt-dlp
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

  if (shouldRefreshYtDlp) {
    if (ytDlpExists && ytDlpOutdated) {
      console.log(`⬇️  Updating yt-dlp (${localYtDlpVersion} → ${latestYtDlpVersion})...`);
    } else if (ytDlpExists && FORCE) {
      console.log('⬇️  Re-downloading yt-dlp (--force)...');
    } else {
      console.log('⬇️  Downloading yt-dlp...');
    }
    await downloadFileWithRetry(URLS.yt_dlp[OS], ytDlpPath);
    if (OS !== 'win32') {
      execSync(`chmod +x "${ytDlpPath}"`);
    }
    const installedVersion = localBinaryVersion(ytDlpPath) ?? 'unknown';
    console.log(`✅ yt-dlp ready (${installedVersion}).`);
  } else {
    console.log(`✅ yt-dlp already up to date (${localYtDlpVersion ?? 'unknown'}).`);
  }

  // 2. Download FFmpeg
  const ffmpegName = OS === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffmpegPath = path.join(BIN_DIR, ffmpegName);

  if (!fs.existsSync(ffmpegPath) || FORCE) {
    console.log(FORCE && fs.existsSync(ffmpegPath) ? '⬇️  Re-downloading FFmpeg (--force)...' : '⬇️  Downloading FFmpeg...');

    if (OS === 'win32') {
      const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
      await downloadFirstAvailable(URLS.ffmpeg.win32, zipPath);
      console.log('📦 Extracting FFmpeg...');

      const extractTemp = path.join(BIN_DIR, 'ffmpeg-temp');
      await extractZip(zipPath, extractTemp);

      // Find ffmpeg.exe recursively
      const ffmpegSrc = findFileNamed(extractTemp, 'ffmpeg.exe');
      if (ffmpegSrc) {
        fs.copyFileSync(ffmpegSrc, ffmpegPath);
        console.log(`✅ FFmpeg extracted to ${ffmpegPath}`);
      } else {
        throw new Error('ffmpeg.exe not found in downloaded zip');
      }

      // Cleanup
      fs.unlinkSync(zipPath);
      fs.rmSync(extractTemp, { recursive: true, force: true });

    } else if (OS === 'darwin') {
      const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
      await downloadFileWithRetry(URLS.ffmpeg.darwin, zipPath);
      await extractZip(zipPath, BIN_DIR);
      fs.unlinkSync(zipPath);
      execSync(`chmod +x "${ffmpegPath}"`);
      console.log('✅ FFmpeg ready.');
    } else {
      let lastError = null;
      for (const url of URLS.ffmpeg.linux) {
        const tarPath = path.join(BIN_DIR, path.basename(new URL(url).pathname));
        const extractTemp = path.join(BIN_DIR, `ffmpeg-linux-${Date.now()}`);
        try {
          await downloadFileWithRetry(url, tarPath);
          fs.mkdirSync(extractTemp, { recursive: true });
          await extractTar(tarPath, extractTemp);
          const extractedFfmpegPath = findFileNamed(extractTemp, 'ffmpeg');
          if (!extractedFfmpegPath) {
            throw new Error(`ffmpeg not found in ${url}`);
          }
          fs.copyFileSync(extractedFfmpegPath, ffmpegPath);
          execSync(`chmod +x "${ffmpegPath}"`);
          console.log('✅ FFmpeg ready.');
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          console.warn(`⚠️  FFmpeg source failed: ${url}`);
        } finally {
          fs.rmSync(extractTemp, { recursive: true, force: true });
          fs.rmSync(tarPath, { force: true });
        }
      }
      if (lastError) throw lastError;
    }
  } else {
    console.log('✅ FFmpeg already exists.');
  }

  console.log('\n🎉 Setup complete!');
  console.log(`📁 Binary directory: ${BIN_DIR}`);
  console.log('🔧 If FFmpeg extraction failed, please manually copy the binary to the bin directory.');
}

if (SKIP) {
  console.log('⏭️  [Flucto] Skipping binary setup (FLUCTO_SKIP_BINARIES/CI detected).');
  console.log('   Run `flucto setup` (or `npm run postinstall`) later to provision yt-dlp/ffmpeg.');
} else {
  // Never hard-fail the npm install on download problems: degrade to a warning and
  // let `flucto setup` (or the CLI's first-run provisioning) handle it later.
  setup().catch((err) => {
    console.error(err);
    console.warn('\n⚠️  [Flucto] Binary setup failed, but the install will continue.');
    console.warn('   Run `flucto setup` later to provision yt-dlp/ffmpeg.');
  });
}
