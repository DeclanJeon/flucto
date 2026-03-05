import { BrowserWindow, ipcMain } from 'electron';
import { execa } from './spawn.js';
import { logger } from './logger.js';
import { checkForAppUpdates } from './updater.js';
import { getBinaryPath } from './utils.js';
import { getStoredUpdateSettings, isUpdateSettings, settingsStore } from './store.js';
import type { NetworkStatusEvent } from '../shared/types.js';

const NETWORK_STATUS_CHANNEL = 'network-status-change';

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

ipcMain.handle('get-update-settings', () => {
  return getStoredUpdateSettings();
});

ipcMain.handle('save-update-settings', (_event, settings: unknown): void => {
  if (!isUpdateSettings(settings)) {
    throw new Error('Invalid update settings payload');
  }

  settingsStore.set('updateSettings', settings);
});

ipcMain.handle('check-binary-updates', async () => {
  const settings = getStoredUpdateSettings();
  try {
    const ytDlpPath = getBinaryPath('yt-dlp');
    const ffmpegPath = getBinaryPath('ffmpeg');

    const binaryChecks = await Promise.allSettled([
      execa(ytDlpPath, ['--version']),
      execa(ffmpegPath, ['-version']),
    ]);

    try {
      await checkForAppUpdates(true);
    } catch (updateError: unknown) {
      const updateErrorMessage = updateError instanceof Error ? updateError.message : String(updateError);
      logger.warn('App update check failed during manual binary check', { error: updateErrorMessage });
    }

    const binaryFailures = binaryChecks.filter((result) => result.status === 'rejected');
    if (binaryFailures.length > 0) {
      const messages = binaryFailures
        .map((result) => (result.status === 'rejected' ? String(result.reason) : ''))
        .filter((value) => value.length > 0);
      throw new Error(messages.join(' | ') || 'Binary update check failed');
    }

    emitNetworkStatus({
      ...networkStatus,
      online: settings.autoUpdate ? networkStatus.online : true,
      message: settings.autoUpdate ? networkStatus.message : '',
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
});
