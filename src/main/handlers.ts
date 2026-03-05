import { BrowserWindow, ipcMain } from 'electron';
import { execa } from './spawn.js';
import { logger } from './logger.js';
import { getBinaryPath } from './utils.js';
import { getUpdateSettingsDefaults, settingsStore } from './store.js';
import type { NetworkStatusEvent, UpdateSettings } from '../shared/types.js';

const NETWORK_STATUS_CHANNEL = 'network-status-change';

const isUpdateSettings = (value: unknown): value is UpdateSettings => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.autoUpdate === 'boolean' &&
    typeof candidate.checkInterval === 'number' &&
    Number.isInteger(candidate.checkInterval) &&
    candidate.checkInterval > 0 &&
    typeof candidate.notifyOnStart === 'boolean'
  );
};

const getStoredUpdateSettings = (): UpdateSettings => {
  const stored = settingsStore.get('updateSettings');
  if (isUpdateSettings(stored)) {
    return {
      ...stored,
    };
  }

  const defaults = getUpdateSettingsDefaults();
  settingsStore.set('updateSettings', defaults);
  return defaults;
};

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
  try {
    const ytDlpPath = getBinaryPath('yt-dlp');
    const ffmpegPath = getBinaryPath('ffmpeg');

    await Promise.all([
      execa(ytDlpPath, ['--version']),
      execa(ffmpegPath, ['-version']),
    ]);

    const settings = getStoredUpdateSettings();
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
