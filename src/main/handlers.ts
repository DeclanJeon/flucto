import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { execa } from './spawn.js';
import { logger } from './logger.js';
import {
  checkForAppUpdates,
  downloadAppUpdate,
  getCurrentAppUpdateEvent,
  installDownloadedAppUpdate,
  onAppUpdateEvent,
} from './updater.js';
import { getBinaryPath } from './utils.js';
import { listFreeVisionModels, startOpenCodeRuntime } from './services/openCodeRuntime.js';
import { runCraftAnalysis } from './services/cinematicAnalysis.js';
import type { AnalysisProgress, AnalysisRequest } from '../shared/analysisTypes.js';
import { getStoredDownloadSettings, getStoredUpdateSettings, isUpdateSettings, settingsStore } from './store.js';
import { runMediaDownload } from './services/mediaDownload.js';
import { createPlatformRegistry } from './platforms/createRegistry.js';
import { fetchRepoStarCount, isRepoStarred, starRepo } from './services/githubStar.js';
import type { AppUpdateEvent, GitHubStarResult, GitHubStarState, NetworkStatusEvent } from '../shared/types.js';

const NETWORK_STATUS_CHANNEL = 'network-status-change';
const APP_UPDATE_CHANNEL = 'app-update-event';
const FLUCTO_REPO = { owner: 'DeclanJeon', repo: 'flucto' } as const;
const PLAIN_TOKEN_PREFIX = 'plain:';

// Token storage: safeStorage (OS keychain) when available, otherwise a
// `plain:`-prefixed plaintext fallback in the local settings file.
const decodeGitHubToken = (): string | null => {
  const stored = settingsStore.get('githubTokenCipher');
  if (!stored) return null;
  if (stored.startsWith(PLAIN_TOKEN_PREFIX)) return stored.slice(PLAIN_TOKEN_PREFIX.length);
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    return null;
  }
};

const encodeGitHubToken = (token: string): string => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(token).toString('base64');
    }
  } catch {
    // Fall through to the plaintext marker.
  }
  return `${PLAIN_TOKEN_PREFIX}${token}`;
};

const encodeSecret = (secret: string): string => {
  if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('OS keychain-backed secure storage is unavailable; API keys are not saved in plaintext.');
  }
  return safeStorage.encryptString(secret).toString('base64');
};

const decodeSecret = (cipher: string): string => {
  if (!cipher || !safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend() === 'basic_text') return '';
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
  } catch {
    return '';
  }
};

ipcMain.handle('get-opencode-vision-settings', (event) => {
  assertTrustedRenderer(event);
  const settings = settingsStore.get('openCodeVision');
  const value = settings && typeof settings === 'object' ? settings : { providerID: '', modelID: '', variant: 'low' as const };
  return {
    providerID: typeof value.providerID === 'string' ? value.providerID : '',
    modelID: typeof value.modelID === 'string' ? value.modelID : '',
    variant: value.variant === 'medium' || value.variant === 'high' ? value.variant : 'low',
    hasApiKey: Boolean(decodeSecret(settingsStore.get('openCodeApiKeyCipher')))
      && settingsStore.get('openCodeApiKeyProvider') === value.providerID,
  };
});

ipcMain.handle('save-opencode-vision-settings', (event, raw: unknown): void => {
  assertTrustedRenderer(event);
  if (!raw || typeof raw !== 'object') throw new Error('Invalid OpenCode vision settings');
  const value = raw as Record<string, unknown>;
  const validId = (candidate: unknown): candidate is string => typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate);
  const validModelId = (candidate: unknown): candidate is string => typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(candidate);
  if (!validId(value.providerID) || !validModelId(value.modelID)) throw new Error('Choose a valid OpenCode provider and model.');
  if (value.variant !== 'low' && value.variant !== 'medium' && value.variant !== 'high') throw new Error('Invalid model reasoning variant.');
  if (value.apiKey !== undefined && (typeof value.apiKey !== 'string' || value.apiKey.length > 4096)) throw new Error('API key is invalid or too long.');
  if (value.clearApiKey !== undefined && typeof value.clearApiKey !== 'boolean') throw new Error('Invalid API key action.');
  if (value.clearApiKey === true) {
    settingsStore.set('openCodeApiKeyCipher', '');
    settingsStore.set('openCodeApiKeyProvider', '');
  } else if (typeof value.apiKey === 'string' && value.apiKey.trim()) {
    settingsStore.set('openCodeApiKeyCipher', encodeSecret(value.apiKey.trim()));
    settingsStore.set('openCodeApiKeyProvider', value.providerID);
  } else if (settingsStore.get('openCodeApiKeyProvider') !== value.providerID
    || !decodeSecret(settingsStore.get('openCodeApiKeyCipher'))) {
    throw new Error('Enter an API key for the selected provider.');
  }
  settingsStore.set('openCodeVision', { providerID: value.providerID, modelID: value.modelID, variant: value.variant });
});

ipcMain.handle('list-opencode-free-vision-models', async (event) => {
  assertTrustedRenderer(event);
  return listFreeVisionModels();
});

const CRAFT_ANALYSIS_PROGRESS_CHANNEL = 'craft-analysis-progress';
let pickedVideoPath: string | null = null;
let pickedCraftDir: string | null = null;
let pickedOutputBaseDir: string | null = null;
const assertTrustedRenderer = (event: { senderFrame?: { url?: string } | null }): void => {
  const rawUrl = event.senderFrame?.url;
  if (!rawUrl) throw new Error('Untrusted IPC sender.');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('Untrusted IPC sender.'); }
  const trusted = url.protocol === 'file:' || (
    url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '5173'
  );
  if (!trusted) throw new Error('Untrusted IPC sender.');
};
ipcMain.handle('pick-analysis-video', async (event) => {
  assertTrustedRenderer(event);
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'] }] });
  pickedVideoPath = result.canceled ? null : result.filePaths[0] ?? null;
  return pickedVideoPath;
});
ipcMain.handle('pick-analysis-craft-directory', async (event) => {
  assertTrustedRenderer(event);
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  pickedCraftDir = result.canceled ? null : result.filePaths[0] ?? null;
  return pickedCraftDir;
});
const defaultAnalysisOutputDirectory = (): string => path.join(app.getPath('documents'), 'flucto');
ipcMain.handle('get-default-analysis-output-directory', (event) => {
  assertTrustedRenderer(event);
  const outputDir = defaultAnalysisOutputDirectory();
  fs.mkdirSync(outputDir, { recursive: true });
  pickedOutputBaseDir = outputDir;
  return outputDir;
});
ipcMain.handle('pick-analysis-output-directory', async (event) => {
  assertTrustedRenderer(event);
  const defaultPath = pickedOutputBaseDir ?? defaultAnalysisOutputDirectory();
  fs.mkdirSync(defaultPath, { recursive: true });
  const result = await dialog.showOpenDialog({ defaultPath, properties: ['openDirectory', 'createDirectory'] });
  if (!result.canceled) pickedOutputBaseDir = result.filePaths[0] ?? pickedOutputBaseDir;
  return result.canceled ? null : pickedOutputBaseDir;
});
ipcMain.handle('start-craft-analysis', async (event, raw: unknown) => {
  assertTrustedRenderer(event);
  if (!raw || typeof raw !== 'object') throw new Error('Invalid analysis request.');
  const value = raw as Record<string, unknown>;
  if ((typeof value.videoPath !== 'string' && typeof value.videoUrl !== 'string') || typeof value.craftDir !== 'string' || typeof value.outputBaseDir !== 'string') throw new Error('Select a video or enter a supported URL, craft taxonomy folder, and output folder.');
  if (typeof value.allowVision !== 'boolean' || typeof value.maxApiCalls !== 'number' || !Number.isInteger(value.maxApiCalls) || value.maxApiCalls < 0 || value.maxApiCalls > 1000) throw new Error('Invalid analysis budget or consent.');
  const videoUrl = typeof value.videoUrl === 'string' ? value.videoUrl.trim() : '';
  const videoPath = typeof value.videoPath === 'string' && value.videoPath.trim() ? path.resolve(value.videoPath) : '';
  const craftDir = path.resolve(value.craftDir);
  const outputBaseDir = path.resolve(value.outputBaseDir);
  if (videoUrl ? (value.confirmDownload !== true || videoPath !== '') : (videoPath !== pickedVideoPath)) {
    throw new Error('Choose a video with Flucto or confirm downloading the supplied URL.');
  }
  if (craftDir !== pickedCraftDir || outputBaseDir !== pickedOutputBaseDir) throw new Error('Choose taxonomy and output folders using the Flucto file pickers.');
  if (!videoUrl) {
    const videoStat = fs.statSync(videoPath);
    if (!videoStat.isFile()) throw new Error('Analysis input must be a video file.');
  }
  if (!fs.statSync(craftDir).isDirectory()) throw new Error('Craft taxonomy path must be a directory.');
  if (!fs.statSync(outputBaseDir).isDirectory()) throw new Error('Output path must be a directory.');

  let runtime: Awaited<ReturnType<typeof startOpenCodeRuntime>> | null = null;
  let visionProvider: AnalysisRequest['vision']['provider'] = null;
  if (value.allowVision) {
    const selection = settingsStore.get('openCodeVision');
    const apiKey = settingsStore.get('openCodeApiKeyProvider') === selection?.providerID
      ? decodeSecret(settingsStore.get('openCodeApiKeyCipher'))
      : '';
    if (!selection?.providerID || !selection.modelID || !apiKey) throw new Error('Configure a free vision model and API key in OpenCode Vision settings first.');
    const allowedModels = await listFreeVisionModels();
    const model = allowedModels.find((candidate) => candidate.providerID === selection.providerID && candidate.modelID === selection.modelID);
    if (!model) throw new Error('Selected model is no longer listed as a free image-input model. Refresh the catalog and choose another model.');
    runtime = await startOpenCodeRuntime({ providerID: selection.providerID, apiKey });
    visionProvider = {
      provider: 'opencode-local',
      providerID: selection.providerID,
      baseURL: runtime.baseURL,
      model: selection.modelID,
      apiKey: '',
      variant: selection.variant,
      serverUsername: runtime.username,
      serverPassword: runtime.password,
    };
  }

  const sourceName = videoPath ? path.basename(videoPath, path.extname(videoPath)) : (() => {
    try { return new URL(videoUrl).hostname; } catch { return 'video'; }
  })();
  const baseName = sourceName.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'video';
  const outputDir = path.join(outputBaseDir, `flucto-analysis-${baseName}-${Date.now()}`);
  let analyzedVideoPath = videoPath;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    if (videoUrl) {
      let parsedUrl: URL;
      try { parsedUrl = new URL(videoUrl); } catch { throw new Error('Enter a valid video URL.'); }
      if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) throw new Error('Video URL must be a public HTTPS URL without embedded credentials.');
      const adapter = createPlatformRegistry().resolve(videoUrl);
      if (!adapter || adapter.id === 'generic') throw new Error('This video platform is not supported for direct analyze-and-download.');
      const downloaded = await runMediaDownload({
        url: videoUrl,
        format: 'mp4',
        outputDir: path.join(outputDir, 'source'),
        quality: getStoredDownloadSettings().qualityPreferences,
      }, {
        binaries: { ytDlpPath: getBinaryPath('yt-dlp'), ffmpegPath: getBinaryPath('ffmpeg') },
        onProgress: (downloadProgress) => {
          if (!event.sender.isDestroyed()) event.sender.send(CRAFT_ANALYSIS_PROGRESS_CHANNEL, {
            stage: 'download', shotsTotal: 0, shotsDone: 0, status: 'running',
            message: downloadProgress.error ?? `${downloadProgress.status} ${Math.round(downloadProgress.progress)}%`,
          } satisfies AnalysisProgress);
        },
      });
      if (!downloaded.success || !downloaded.filePath) throw new Error(`Video download failed: ${downloaded.message}`);
      analyzedVideoPath = downloaded.filePath;
    }
    return await runCraftAnalysis({
      videoPath: analyzedVideoPath,
      ...(videoUrl ? { sourceUrl: videoUrl } : {}),
      craftDir,
      outputDir,
      budget: { maxFramesPerShot: 3, maxApiCalls: value.allowVision ? value.maxApiCalls : 0 },
      vision: { enabled: value.allowVision, provider: visionProvider },
      sceneThreshold: 0.3,
    }, {
      ffmpegPath: getBinaryPath('ffmpeg'),
      onProgress: (progress: AnalysisProgress) => {
        if (!event.sender.isDestroyed()) event.sender.send(CRAFT_ANALYSIS_PROGRESS_CHANNEL, progress);
      },
    });
  } finally {
    runtime?.close();
  }
});

ipcMain.handle('get-github-star-state', async (): Promise<GitHubStarState> => {
  const token = decodeGitHubToken();
  const starCount = await fetchRepoStarCount(FLUCTO_REPO);
  const starred = token ? await isRepoStarred(FLUCTO_REPO, token) : null;
  return { hasToken: Boolean(token), starred, starCount };
});

ipcMain.handle('save-github-token', (_event, token: unknown): void => {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) {
    settingsStore.set('githubTokenCipher', '');
    return;
  }
  settingsStore.set('githubTokenCipher', encodeGitHubToken(trimmed));
  logger.info('GitHub token saved for repo starring.');
});

ipcMain.handle('star-flucto-repo', async (): Promise<GitHubStarResult> => {
  const token = decodeGitHubToken();
  if (!token) {
    return { starred: false, message: 'No GitHub token is configured. Add one for one-click starring.' };
  }
  try {
    await starRepo(FLUCTO_REPO, token);
    const starCount = await fetchRepoStarCount(FLUCTO_REPO);
    return { starred: true, message: 'Starred Flucto on GitHub. Thank you!', starCount };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('GitHub starring failed:', { error: message });
    return { starred: false, message };
  }
});

let networkStatus: NetworkStatusEvent = {
  online: true,
  message: '',
};

const emitNetworkStatus = (status: NetworkStatusEvent): void => {
  networkStatus = status;
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((window) => {
    window.webContents.send(NETWORK_STATUS_CHANNEL, status);
  });
};

const emitAppUpdate = (event: AppUpdateEvent): void => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((window) => {
    window.webContents.send(APP_UPDATE_CHANNEL, event);
  });
};

onAppUpdateEvent((event) => {
  emitAppUpdate(event);
});

ipcMain.handle('get-update-settings', () => {
  return getStoredUpdateSettings();
});

ipcMain.handle('save-update-settings', (_event, settings: unknown): void => {
  if (!isUpdateSettings(settings)) {
    throw new Error('Invalid update settings payload');
  }

  settingsStore.set('updateSettings', settings);
});

ipcMain.handle('get-app-update-state', () => {
  return getCurrentAppUpdateEvent();
});

ipcMain.handle('check-app-updates', async (_event, force?: boolean) => {
  await checkForAppUpdates(Boolean(force));
});

ipcMain.handle('download-app-update', async () => {
  await downloadAppUpdate();
});

ipcMain.handle('install-app-update', async () => {
  await installDownloadedAppUpdate();
});

ipcMain.handle('check-binary-updates', async () => {
  try {
    const ytDlpPath = getBinaryPath('yt-dlp');
    const ffmpegPath = getBinaryPath('ffmpeg');

    const binaryChecks = await Promise.allSettled([
      execa(ytDlpPath, ['--version']),
      execa(ffmpegPath, ['-version']),
    ]);

    const binaryFailures = binaryChecks.filter((result) => result.status === 'rejected');
    if (binaryFailures.length > 0) {
      const messages = binaryFailures
        .map((result) => (result.status === 'rejected' ? String(result.reason) : ''))
        .filter((value) => value.length > 0);
      throw new Error(messages.join(' | ') || 'Binary update check failed');
    }

    emitNetworkStatus({
      ...networkStatus,
      online: networkStatus.online,
      message: networkStatus.message,
    });
    logger.info('Binary update check passed', { ytDlpPath, ffmpegPath });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Check Binary Updates Error:', { error: errorMessage });
    emitNetworkStatus({
      online: false,
      message: '바이너리 업데이트를 확인할 수 없습니다.',
    });
    throw new Error(`Failed to check binary updates: ${errorMessage}`);
  }
});

ipcMain.on('render-ready', () => {
  emitNetworkStatus(networkStatus);
  emitAppUpdate(getCurrentAppUpdateEvent());
});
