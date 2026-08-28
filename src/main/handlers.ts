import { BrowserWindow, ipcMain, safeStorage } from 'electron';
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
import { getStoredUpdateSettings, isUpdateSettings, settingsStore } from './store.js';
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
