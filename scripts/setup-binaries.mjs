import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { platform } from 'os';
import { execSync } from 'child_process';

const BIN_DIR = path.join(process.cwd(), 'bin');
const OS = platform(); // 'win32', 'darwin', 'linux'
const YTDLP_VERSION = 'latest'; // 'latest' for auto-update, or specify version like '2025.11.12'
// URL Configuration
const URLS = {
  yt_dlp: {
    win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
  },
  ffmpeg: {
    // Using reliable sources for FFmpeg binaries
    win32: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    darwin: 'https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip',
    linux: [
      'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
      'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
    ],
  }
};

async function downloadFile(url, destPath) {
  const writer = fs.createWriteStream(destPath);
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 120000,
      maxRedirects: 5,
      headers: {
        'User-Agent': `Flucto binary setup (${OS})`,
        Accept: 'application/octet-stream,*/*',
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } catch (error) {
    writer.destroy();
    try {
      fs.rmSync(destPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw new Error(`Failed to download ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function extractZip(zipPath, extractTo) {
  const admzip = await import('adm-zip');
  const zip = new admzip.default(zipPath);
  zip.extractAllTo(extractTo, true);
  return true;
}

async function extractTar(tarPath, extractTo) {
  const { execSync } = await import('child_process');
  execSync(`tar -xf "${tarPath}" -C "${extractTo}"`, { stdio: 'inherit' });
  return true;
}

function findFileNamed(directory, filename) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === filename) return candidate;
    if (entry.isDirectory()) {
      const nested = findFileNamed(candidate, filename);
      if (nested) return nested;
    }
  }
  return null;
}

async function setup() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR);
  }

  console.log(`🚀 [Flucto] Setting up binaries for ${OS}...`);

  // 1. Download yt-dlp
  const ytDlpName = OS === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const ytDlpPath = path.join(BIN_DIR, ytDlpName);
  
  if (!fs.existsSync(ytDlpPath)) {
    console.log(`⬇️  Downloading yt-dlp...`);
    await downloadFile(URLS.yt_dlp[OS], ytDlpPath);
    if (OS !== 'win32') {
      execSync(`chmod +x "${ytDlpPath}"`);
    }
    console.log(`✅ yt-dlp ready.`);
  } else {
    console.log(`✅ yt-dlp already exists.`);
  }

  // 2. Download FFmpeg
  const ffmpegName = OS === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffmpegPath = path.join(BIN_DIR, ffmpegName);

  if (!fs.existsSync(ffmpegPath)) {
    console.log(`⬇️  Downloading FFmpeg...`);
    
    if (OS === 'win32') {
      const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
      console.log(`⬇️  Downloading FFmpeg from ${URLS.ffmpeg.win32}...`);
      await downloadFile(URLS.ffmpeg.win32, zipPath);
      console.log(`📦 Extracting FFmpeg...`);
      
      const extractTemp = path.join(BIN_DIR, 'ffmpeg-temp');
      await extractZip(zipPath, extractTemp);
      
      // Find ffmpeg.exe recursively
      const findFfmpeg = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const found = findFfmpeg(fullPath);
            if (found) return found;
          } else if (file === 'ffmpeg.exe') {
            return fullPath;
          }
        }
        return null;
      };

      const ffmpegSrc = findFfmpeg(extractTemp);
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
      await downloadFile(URLS.ffmpeg.darwin, zipPath);
      await extractZip(zipPath, BIN_DIR);
      fs.unlinkSync(zipPath);
      execSync(`chmod +x "${ffmpegPath}"`);
      console.log(`✅ FFmpeg ready.`);
    } else {
      let lastError = null;
      for (const url of URLS.ffmpeg.linux) {
        const tarPath = path.join(BIN_DIR, path.basename(new URL(url).pathname));
        const extractTemp = path.join(BIN_DIR, `ffmpeg-linux-${Date.now()}`);
        try {
          await downloadFile(url, tarPath);
          fs.mkdirSync(extractTemp, { recursive: true });
          await extractTar(tarPath, extractTemp);
          const extractedFfmpegPath = findFileNamed(extractTemp, 'ffmpeg');
          if (!extractedFfmpegPath) {
            throw new Error(`ffmpeg not found in ${url}`);
          }
          fs.copyFileSync(extractedFfmpegPath, ffmpegPath);
          execSync(`chmod +x "${ffmpegPath}"`);
          console.log(`✅ FFmpeg ready.`);
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
    console.log(`✅ FFmpeg already exists.`);
  }

  console.log('\n🎉 Setup complete!');
  console.log(`📁 Binary directory: ${BIN_DIR}`);
  console.log('🔧 If FFmpeg extraction failed, please manually copy the binary to the bin directory.');
}

setup().catch((err) => {
  console.error(err);
  process.exit(1);
});
