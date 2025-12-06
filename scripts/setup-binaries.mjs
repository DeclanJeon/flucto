import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { platform } from 'os';
import { execSync } from 'child_process';

const BIN_DIR = path.join(process.cwd(), 'bin');
const OS = platform(); // 'win32', 'darwin', 'linux'

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
    linux: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
  }
};

async function downloadFile(url, destPath) {
  const writer = fs.createWriteStream(destPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
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
      await downloadFile(URLS.ffmpeg.win32, zipPath);
      console.log(`📦 FFmpeg downloaded as zip.`);
      console.log(`⚠️  Manual extraction required:`);
      console.log(`   1. Extract ${zipPath}`);
      console.log(`   2. Copy ffmpeg.exe to ${BIN_DIR}`);
      console.log(`   3. Delete the zip file`);
    } else if (OS === 'darwin') {
      const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
      await downloadFile(URLS.ffmpeg.darwin, zipPath);
      await extractZip(zipPath, BIN_DIR);
      fs.unlinkSync(zipPath);
      execSync(`chmod +x "${ffmpegPath}"`);
      console.log(`✅ FFmpeg ready.`);
    } else {
      const tarPath = path.join(BIN_DIR, 'ffmpeg.tar.xz');
      await downloadFile(URLS.ffmpeg.linux, tarPath);
      await extractTar(tarPath, BIN_DIR);
      
      // Find the ffmpeg binary in the extracted folder
      const extractedFiles = fs.readdirSync(BIN_DIR);
      const ffmpegDir = extractedFiles.find(f => f.startsWith('ffmpeg-') && fs.statSync(path.join(BIN_DIR, f)).isDirectory());
      
      if (ffmpegDir) {
        const extractedFfmpegPath = path.join(BIN_DIR, ffmpegDir, 'ffmpeg');
        if (fs.existsSync(extractedFfmpegPath)) {
          fs.copyFileSync(extractedFfmpegPath, ffmpegPath);
          execSync(`chmod +x "${ffmpegPath}"`);
          // Clean up the extracted directory
          fs.rmSync(path.join(BIN_DIR, ffmpegDir), { recursive: true, force: true });
          console.log(`✅ FFmpeg ready.`);
        }
      }
      fs.unlinkSync(tarPath);
    }
  } else {
    console.log(`✅ FFmpeg already exists.`);
  }

  console.log('\n🎉 Setup complete!');
  console.log(`📁 Binary directory: ${BIN_DIR}`);
  console.log('🔧 If FFmpeg extraction failed, please manually copy the binary to the bin directory.');
}

setup().catch(console.error);
