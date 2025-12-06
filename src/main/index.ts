import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
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

// 1. Get Playlist Info Handler [최종 수정]
ipcMain.handle('get-playlist-info', async (_event, url: string) => {
  const ytDlpPath = getBinaryPath('yt-dlp');
  
  try {
    logger.info(`Fetching playlist info for: ${url}`);

    // [보완 1] { reject: false } 추가: 일부 영상 다운 불가 에러로 인해 전체 프로세스가 멈추지 않도록 함
    const result = await execa(ytDlpPath, [
      url,
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      '--skip-download',
      '--ignore-errors',
      '--compat-options', 'no-youtube-unavailable-videos' // [보완 2] 삭제된 동영상 정보 제외
    ], { reject: false }); // <-- 중요: 에러가 발생해도 멈추지 않고 결과 반환

    // stdout이 아예 비어있으면 진짜 에러
    if (result.failed && !result.stdout.trim()) {
      throw new Error(result.stderr || 'Failed to fetch playlist info (No output)');
    }
    
    const playlistItems = result.stdout
      .split(/\r?\n/) // [보완 3] 윈도우(\r\n)와 리눅스(\n) 줄바꿈 모두 대응하는 정규식 사용
      .filter((line) => line.trim() !== '')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          // 파싱 실패한 줄은 경고 로그만 남기고 무시
          logger.warn('Skipping invalid JSON line', { error: e });
          return null;
        }
      })
      .filter((item) => {
        // [보완 4] 유효한 비디오 아이템인지 검증 (플레이리스트 자체 메타데이터 제외)
        return item !== null && item.id && item._type !== 'playlist';
      });

    if (playlistItems.length === 0) {
      logger.warn('Playlist is empty or all items were filtered out', { url });
    }

    return playlistItems.map((item: any) => ({
      id: item.id,
      title: item.title || 'Untitled Video',
      // flat-playlist 모드에서는 썸네일 배열이 없을 수도 있음
      thumbnail: item.thumbnails ? item.thumbnails[item.thumbnails.length - 1]?.url : null,
      duration: item.duration || 0,
      uploader: item.uploader || item.channel || 'Unknown',
      view_count: item.view_count || 0,
      originalUrl: item.url || `https://www.youtube.com/watch?v=${item.id}`,
    }));

  } catch (error: any) {
    logger.error('Get Playlist Info Error:', { url, error: error.message, stderr: error.stderr });
    throw new Error(`Failed to fetch playlist info: ${error.message}`);
  }
});

// 2. Get Video Info Handler
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
        '--flat-playlist', // Download all videos from playlist
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

// 4. Read Batch File Handler
ipcMain.handle('read-batch-file', async () => {
  if (!mainWindow) return null;

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Batch File (URL List)',
    properties: ['openFile'],
    filters: [{ name: 'Text Files', extensions: ['txt', 'list'] }],
  });

  if (canceled || filePaths.length === 0) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePaths[0], 'utf-8');
    
    // yt-dlp --batch-file 규칙에 따른 파싱
    const urls = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        // 빈 줄 제거
        if (!line) return false;
        // 주석 제거 (#, ;, ])
        const firstChar = line.charAt(0);
        return !['#', ';', ']'].includes(firstChar);
      });

    return urls;
  } catch (error: any) {
    logger.error('Batch File Read Error:', { error: error.message });
    throw new Error('Failed to read batch file');
  }
});

// 5. Open Folder Handler
ipcMain.handle('open-downloads-folder', async () => {
  await shell.openPath(config.paths.downloads);
});
