import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import { getBinaryPath, checkSystemHealth } from './utils.js';
import { logger } from './logger.js';
import { config } from './config.js';
import type { DownloadRequest } from '../shared/types.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 가비지 컬렉션 방지를 위한 전역 변수
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false, // 준비될 때까지 숨김 (깜빡임 방지)
    autoHideMenuBar: true,
    backgroundColor: '#111827', // 다크모드 배경색
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // HMR for development or load production build
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools(); // 개발자 도구 필요시 주석 해제
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

// --- App Lifecycle ---
app.whenReady().then(async () => {
  // 1. 시스템 무결성 검사
  const health = await checkSystemHealth();
  
  if (!health.valid) {
    logger.error('Missing required binaries:', { missing: health.missing });
    
    const response = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Flucto - System Error',
      message: 'Required system components are missing.',
      detail: `The following binaries were not found:\n${health.missing.join(', ')}\n\nPlease restart the application setup.`,
      buttons: ['Exit']
    });
    
    app.quit();
    return;
  }

  // 2. 윈도우 생성
  createWindow();
  logger.info('Electron application is ready and healthy.');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers ---

// 1. Get Video Info Handler
ipcMain.handle('get-video-info', async (_event, url: string) => {
  const ytDlpPath = getBinaryPath('yt-dlp');
  
  try {
    const { stdout } = await execa(ytDlpPath, [
      url,
      '--dump-json',
      '--no-warnings',
      '--no-playlist', // Don't download entire playlist, just get info for the video
    ]);
    
    const info = JSON.parse(stdout);
    return {
      id: info.id,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader,
      view_count: info.view_count,
    };
  } catch (error: any) {
    logger.error('Get Info Error:', { url, error: error.message });
    throw new Error('Failed to fetch video info');
  }
});

// 2. Download Multiple Videos Handler
ipcMain.handle('download-multiple', async (event, { urls, format }: { urls: string[], format: 'mp4' | 'mp3' }) => {
  const ytDlpPath = getBinaryPath('yt-dlp');
  const ffmpegPath = getBinaryPath('ffmpeg');
  const outputTemplate = path.join(config.paths.downloads, '%(title)s.%(ext)s');

  const downloadPromises = urls.map(async (url) => {
    try {
      event.sender.send('download-progress', { url, status: 'downloading', progress: 0 });

      const args = [
        url,
        '--output', outputTemplate,
        '--no-check-certificates',
        '--no-warnings',
        '--newline',
        '--add-header', 'referer:youtube.com',
        '--add-header', 'user-agent:googlebot',
        '--ffmpeg-location', path.dirname(ffmpegPath),
        '--yes-playlist', // Download entire playlist if URL contains playlist
      ];

      if (format === 'mp3') {
        args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
      } else {
        args.push('--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
      }

      const subprocess = execa(ytDlpPath, args);

      subprocess.stdout?.on('data', (data) => {
        const output = data.toString();
        const progressMatch = output.match(/(\d+\.?\d*)%.*?(\d+\.?\d*\w+\/s).*?ETA\s+(\d+:\d+)/);
        
        if (progressMatch) {
          event.sender.send('download-progress', {
            url,
            status: 'downloading',
            progress: parseFloat(progressMatch[1]),
            speed: progressMatch[2],
            eta: progressMatch[3],
          });
        }
      });

      await subprocess;
      event.sender.send('download-progress', { url, status: 'completed', progress: 100 });
    } catch (error: any) {
      logger.error(`Download Error for ${url}:`, { error: error.message });
      event.sender.send('download-progress', { url, status: 'error', progress: 0, error: error.message });
    }
  });

  await Promise.all(downloadPromises);
});

// 3. Download Video Handler (single)
ipcMain.handle('download-video', async (_event, args: DownloadRequest) => {
  const { url, format } = args;

  // 다운로드 경로 설정
  const outputTemplate = path.join(
    config.paths.downloads,
    '%(title)s.%(ext)s'
  );

  // 바이너리 경로 가져오기 (utils.ts 활용)
  const ytDlpPath = getBinaryPath('yt-dlp');
  const ffmpegPath = getBinaryPath('ffmpeg');

  logger.info(`Starting download: ${url} (Format: ${format})`);
  logger.debug(`Binaries - yt-dlp: ${ytDlpPath}, ffmpeg: ${ffmpegPath}`);

  try {
    const args = [
      url,
      '--output', outputTemplate,
      '--no-check-certificates',
      '--no-warnings',
      '--add-header', 'referer:youtube.com',
      '--add-header', 'user-agent:googlebot',
      '--ffmpeg-location', path.dirname(ffmpegPath),
    ];

    if (format === 'mp3') {
      args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      args.push('--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
    }

    logger.debug(`Executing: ${ytDlpPath} ${args.join(' ')}`);

    // 실행 (execa)
    await execa(ytDlpPath, args);

    return {
      success: true,
      message: 'Download Complete!',
      filePath: outputTemplate,
    };
  } catch (error: any) {
    logger.error('Download Error:', { error: error.message });
    return { success: false, message: error.message || 'Process Failed' };
  }
});

// 2. Open Folder Handler
ipcMain.handle('open-downloads-folder', async () => {
  await shell.openPath(config.paths.downloads);
});
