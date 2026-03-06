import { BrowserWindow, ipcMain } from 'electron';
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
import type { AppUpdateEvent, NetworkStatusEvent } from '../shared/types.js';

const NETWORK_STATUS_CHANNEL = 'network-status-change';
const APP_UPDATE_CHANNEL = 'app-update-event';

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
