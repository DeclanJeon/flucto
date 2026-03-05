import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import { logger } from './logger.js';
import { getStoredUpdateSettings, markAutoUpdateCheckNow, shouldRunAutoUpdateCheck } from './store.js';

const { autoUpdater } = electronUpdater;

let initialized = false;
let checking = false;

const toUpdateInfo = (value: unknown): { version?: string; releaseDate?: string; downloadedFile?: string } => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const info = value as Record<string, unknown>;
  return {
    version: typeof info.version === 'string' ? info.version : undefined,
    releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : undefined,
    downloadedFile: typeof info.downloadedFile === 'string' ? info.downloadedFile : undefined,
  };
};

const toErrorInfo = (value: unknown): { message: string; stack?: string } => {
  if (value instanceof Error) {
    return {
      message: value.message,
      stack: value.stack,
    };
  }

  return {
    message: String(value),
  };
};

const toProgressInfo = (value: unknown): { percent?: number; bytesPerSecond?: number; transferred?: number; total?: number } => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const progress = value as Record<string, unknown>;
  return {
    percent: typeof progress.percent === 'number' ? progress.percent : undefined,
    bytesPerSecond: typeof progress.bytesPerSecond === 'number' ? progress.bytesPerSecond : undefined,
    transferred: typeof progress.transferred === 'number' ? progress.transferred : undefined,
    total: typeof progress.total === 'number' ? progress.total : undefined,
  };
};

const showRestartPrompt = async (): Promise<void> => {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Flucto Update Ready',
    message: 'A new version has been downloaded.',
    detail: 'Restart now to finish the update.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response === 0) {
    autoUpdater.quitAndInstall();
  }
};

const setupUpdaterEvents = (): void => {
  autoUpdater.on('checking-for-update', () => {
    logger.info('Auto-update: checking for updates');
  });

  autoUpdater.on('update-available', (info: unknown) => {
    const updateInfo = toUpdateInfo(info);
    logger.info('Auto-update: update available', {
      version: updateInfo.version,
      releaseDate: updateInfo.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', (info: unknown) => {
    const updateInfo = toUpdateInfo(info);
    logger.info('Auto-update: no updates available', {
      version: updateInfo.version,
    });
  });

  autoUpdater.on('error', (error: unknown) => {
    const errorInfo = toErrorInfo(error);
    logger.error('Auto-update error', {
      message: errorInfo.message,
      stack: errorInfo.stack,
    });
  });

  autoUpdater.on('download-progress', (progress: unknown) => {
    const progressInfo = toProgressInfo(progress);
    logger.info('Auto-update download progress', {
      percent: progressInfo.percent,
      bytesPerSecond: progressInfo.bytesPerSecond,
      transferred: progressInfo.transferred,
      total: progressInfo.total,
    });
  });

  autoUpdater.on('update-downloaded', async (info: unknown) => {
    const updateInfo = toUpdateInfo(info);
    logger.info('Auto-update: update downloaded', {
      version: updateInfo.version,
      downloadedFile: updateInfo.downloadedFile,
    });

    const settings = getStoredUpdateSettings();
    if (settings.notifyOnStart) {
      await showRestartPrompt();
    }
  });
};

export const checkForAppUpdates = async (force = false): Promise<void> => {
  if (!app.isPackaged) {
    logger.info('Auto-update skipped in development mode');
    return;
  }

  if (checking) {
    logger.info('Auto-update check skipped because a check is already in progress');
    return;
  }

  const settings = getStoredUpdateSettings();
  if (!force && !settings.autoUpdate) {
    logger.info('Auto-update disabled by user settings');
    return;
  }

  if (!force && !shouldRunAutoUpdateCheck()) {
    logger.info('Auto-update check skipped due to check interval');
    return;
  }

  checking = true;
  try {
    await autoUpdater.checkForUpdates();
    markAutoUpdateCheckNow();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to check app updates', { message });
  } finally {
    checking = false;
  }
};

export const initializeAutoUpdater = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  setupUpdaterEvents();

  await checkForAppUpdates(false);
};
