import { app, dialog, shell } from 'electron';
import path from 'path';
import { createRequire } from 'module';
import type { AppUpdater, UpdateCheckResult } from 'electron-updater';
import type { AppUpdateEvent } from '../shared/types.js';
import { compareVersions, fetchLatestRelease, type GitHubReleaseAsset, type GitHubReleaseInfo } from './services/githubRelease.js';
import { selectMacInstallerAsset } from './services/platformAssets.js';
import { downloadReleaseAsset } from './services/releaseDownload.js';
import { logger } from './logger.js';
import { getStoredUpdateSettings, markAutoUpdateCheckNow, shouldRunAutoUpdateCheck } from './store.js';

type UpdateListener = (event: AppUpdateEvent) => void;

const require = createRequire(import.meta.url);

// electron-updater is a CJS module that requires 'electron' internally. It is
// loaded lazily via createRequire (repo convention, see binaryInstaller.ts)
// because unsigned macOS builds never use its Squirrel.Mac path — macOS
// updates take the manual DMG flow below — so keeping it out of the module
// graph also keeps that flow testable without a real Electron runtime.
let autoUpdater: AppUpdater | null = null;

const loadAutoUpdater = (): AppUpdater => {
  if (!autoUpdater) {
    const mod = require('electron-updater') as { autoUpdater: AppUpdater };
    autoUpdater = mod.autoUpdater;
  }
  return autoUpdater;
};

let initialized = false;
let checking = false;
let downloading = false;
let updateDownloaded = false;
let currentUpdateVersion: string | undefined;
let currentAppUpdateEvent: AppUpdateEvent = { type: 'idle' };

// macOS (unsigned) manual-install state.
let macInstallerPath: string | null = null;
let macRelease: GitHubReleaseInfo | null = null;
let macAsset: GitHubReleaseAsset | null = null;

const listeners = new Set<UpdateListener>();

// Test seam: the unsigned-macOS update flow does not depend on
// electron-updater, so these hooks let tests exercise check/download/install.
export const macUpdateHooks = {
  isMacPlatform: () => process.platform === 'darwin',
  fetchRelease: (): Promise<GitHubReleaseInfo> => fetchLatestRelease('DeclanJeon/flucto'),
  downloadAsset: downloadReleaseAsset,
};

// Unsigned macOS builds cannot use electron-updater's Squirrel.Mac install, so
// macOS always takes the manual DMG flow.
const isMacManualUpdate = (): boolean => macUpdateHooks.isMacPlatform();

const installationMode = (): 'restart' | 'installer' => (isMacManualUpdate() ? 'installer' : 'restart');

const emitAppUpdateEvent = (event: AppUpdateEvent): void => {
  currentAppUpdateEvent = event;
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to emit app update event', { message });
    }
  });
};

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

// ── macOS manual installer flow (unsigned builds) ────────────────────────────


const macInstallInstructions = (): string =>
  'The DMG is open. Drag Flucto into the Applications folder, then relaunch Flucto from Applications.';

const openMacInstaller = async (): Promise<void> => {
  if (!macInstallerPath) {
    throw new Error('No downloaded macOS installer is available to open');
  }
  const failure = await shell.openPath(macInstallerPath);
  if (failure) {
    throw new Error(`Could not open the downloaded installer (${failure}). Open it manually: ${macInstallerPath}`);
  }
  await dialog.showMessageBox({
    type: 'info',
    title: 'Install Flucto Update',
    message: 'Finish installing the update manually.',
    detail: macInstallInstructions(),
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0,
  });
};

const showMacInstallPrompt = async (): Promise<void> => {
  const isDmg = macInstallerPath?.toLowerCase().endsWith('.dmg') ?? true;
  const detail = macInstallerPath
    ? (isDmg
      ? 'Open the downloaded DMG, then drag Flucto into Applications to finish the update. Restarting the app alone does not install it.'
      : 'Open the downloaded archive, extract Flucto.app into Applications to finish the update. Restarting the app alone does not install it.')
    : 'Open the latest DMG from the Flucto GitHub releases page, then drag Flucto into Applications to finish the update.';
  const buttons = macInstallerPath ? ['Open Installer', 'Later'] : ['Later'];
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Flucto Update Downloaded',
    message: `Flucto ${macRelease?.version ?? 'update'} is ready to install.`,
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });

  if (macInstallerPath && result.response === 0) {
    await openMacInstaller();
  }
};

const checkForMacUpdate = async (currentVersion: string): Promise<void> => {
  const release = await macUpdateHooks.fetchRelease();
  macRelease = release;
  macAsset = selectMacInstallerAsset(release);
  const updateAvailable = compareVersions(release.version, currentVersion) > 0;

  if (!updateAvailable) {
    currentUpdateVersion = undefined;
    updateDownloaded = false;
    emitAppUpdateEvent({
      type: 'not-available',
      version: release.version,
      releaseDate: release.publishedAt || undefined,
      installationMode: 'installer',
    });
    return;
  }

  currentUpdateVersion = release.version;
  updateDownloaded = false;
  emitAppUpdateEvent({
    type: 'available',
    version: release.version,
    releaseDate: release.publishedAt || undefined,
    installationMode: 'installer',
    message: macAsset ? undefined : `Update ${release.version} is published but has no macOS installer asset. See ${release.url}`,
  });
};

const downloadMacUpdate = async (): Promise<void> => {
  const release = macRelease ?? await macUpdateHooks.fetchRelease();
  macRelease = release;
  const asset = macAsset ?? selectMacInstallerAsset(release);
  if (!asset) {
    throw new Error(`The latest release (${release.version}) does not include a macOS installer asset. Download it manually: ${release.url}`);
  }
  macAsset = asset;

  const outputDir = path.join(app.getPath('downloads'), 'Flucto-Updates');
  const result = await macUpdateHooks.downloadAsset({
    release,
    asset,
    outputDir,
    onProgress: (progress) => {
      downloading = true;
      emitAppUpdateEvent({
        type: 'download-progress',
        version: release.version,
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
        installationMode: 'installer',
      });
    },
  });

  macInstallerPath = result.path;
  downloading = false;
  updateDownloaded = true;
  currentUpdateVersion = release.version;
  emitAppUpdateEvent({
    type: 'downloaded',
    version: release.version,
    releaseDate: release.publishedAt || undefined,
    downloadedFile: result.path,
    installationMode: 'installer',
  });

  const settings = getStoredUpdateSettings();
  if (settings.notifyOnUpdateReady) {
    await showMacInstallPrompt();
  }
};

// ── electron-updater flow (Windows NSIS, Linux AppImage) ─────────────────────

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
    autoUpdater?.quitAndInstall();
  }
};

const setupUpdaterEvents = (updater: AppUpdater): void => {
  updater.on('checking-for-update', () => {
    logger.info('Auto-update: checking for updates');
    emitAppUpdateEvent({ type: 'checking', installationMode: 'restart' });
  });

  updater.on('update-available', (info: unknown) => {
    const updateInfo = toUpdateInfo(info);
    currentUpdateVersion = updateInfo.version;
    updateDownloaded = false;
    logger.info('Auto-update: update available', {
      version: updateInfo.version,
      releaseDate: updateInfo.releaseDate,
    });
    emitAppUpdateEvent({
      type: 'available',
      version: updateInfo.version,
      releaseDate: updateInfo.releaseDate,
      installationMode: 'restart',
    });
  });

  updater.on('update-not-available', (info: unknown) => {
    const updateInfo = toUpdateInfo(info);
    currentUpdateVersion = undefined;
    updateDownloaded = false;
    logger.info('Auto-update: no updates available', {
      version: updateInfo.version,
    });
    emitAppUpdateEvent({
      type: 'not-available',
      version: updateInfo.version,
      installationMode: 'restart',
    });
  });

  updater.on('error', (error: unknown) => {
    const errorInfo = toErrorInfo(error);
    downloading = false;
    logger.error('Auto-update error', {
      message: errorInfo.message,
      stack: errorInfo.stack,
    });
    emitAppUpdateEvent({
      type: 'error',
      version: currentUpdateVersion,
      message: errorInfo.message,
      stack: errorInfo.stack,
    });
  });

  updater.on('download-progress', (progress: unknown) => {
    const progressInfo = toProgressInfo(progress);
    downloading = true;
    logger.info('Auto-update download progress', {
      percent: progressInfo.percent,
      bytesPerSecond: progressInfo.bytesPerSecond,
      transferred: progressInfo.transferred,
      total: progressInfo.total,
    });
    emitAppUpdateEvent({
      type: 'download-progress',
      version: currentUpdateVersion,
      percent: progressInfo.percent,
      bytesPerSecond: progressInfo.bytesPerSecond,
      transferred: progressInfo.transferred,
      total: progressInfo.total,
      installationMode: 'restart',
    });
  });

  updater.on('update-downloaded', async (info: unknown) => {
    const updateInfo = toUpdateInfo(info);
    downloading = false;
    updateDownloaded = true;
    currentUpdateVersion = updateInfo.version ?? currentUpdateVersion;
    logger.info('Auto-update: update downloaded', {
      version: updateInfo.version,
      downloadedFile: updateInfo.downloadedFile,
    });
    emitAppUpdateEvent({
      type: 'downloaded',
      version: updateInfo.version,
      downloadedFile: updateInfo.downloadedFile,
      installationMode: 'restart',
    });
    const settings = getStoredUpdateSettings();
    if (settings.notifyOnUpdateReady) {
      await showRestartPrompt();
    }
  });
};

// ── Public API ───────────────────────────────────────────────────────────────

export const onAppUpdateEvent = (listener: UpdateListener): (() => void) => {
  listeners.add(listener);
  listener(currentAppUpdateEvent);
  return () => {
    listeners.delete(listener);
  };
};

export const getCurrentAppUpdateEvent = (): AppUpdateEvent => {
  return { ...currentAppUpdateEvent };
};

export const checkForAppUpdates = async (force = false): Promise<void> => {
  if (!app.isPackaged) {
    logger.info('Auto-update skipped in development mode');
    emitAppUpdateEvent({ type: 'idle', message: 'development mode', installationMode: installationMode() });
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
  emitAppUpdateEvent({ type: 'checking', installationMode: installationMode() });
  try {
    if (isMacManualUpdate()) {
      await checkForMacUpdate(app.getVersion());
    } else {
      await loadAutoUpdater().checkForUpdates();
    }
    markAutoUpdateCheckNow();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to check app updates', { message });
    emitAppUpdateEvent({ type: 'error', message, version: currentUpdateVersion });
    throw error;
  } finally {
    checking = false;
  }
};

export const downloadAppUpdate = async (): Promise<void> => {
  if (!app.isPackaged) {
    logger.info('App update download skipped in development mode');
    return;
  }

  if (updateDownloaded || downloading) {
    return;
  }

  downloading = true;
  try {
    if (isMacManualUpdate()) {
      await downloadMacUpdate();
      return;
    }

    const updater = loadAutoUpdater();
    const result: UpdateCheckResult | null = await updater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      const version = result?.updateInfo?.version ?? currentUpdateVersion;
      const message = version
        ? `No app update is available (latest version: ${version})`
        : 'No app update is available';
      emitAppUpdateEvent({ type: 'not-available', version, installationMode: 'restart' });
      throw new Error(message);
    }

    if (result.downloadPromise) {
      await result.downloadPromise;
      return;
    }

    await updater.downloadUpdate(result.cancellationToken);
  } catch (error: unknown) {
    downloading = false;
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to download app update', { message });
    emitAppUpdateEvent({ type: 'error', message, version: currentUpdateVersion });
    throw error;
  }
};

export const installDownloadedAppUpdate = async (): Promise<void> => {
  if (!updateDownloaded) {
    throw new Error('No downloaded app update is ready to install');
  }

  if (isMacManualUpdate()) {
    // Unsigned macOS builds can never install in place: the only honest action
    // is opening the verified DMG so the user drags the app into Applications.
    await openMacInstaller();
    return;
  }

  if (!autoUpdater) {
    throw new Error('The native updater is not initialized');
  }
  autoUpdater.quitAndInstall();
};

export const initializeAutoUpdater = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  initialized = true;

  if (!isMacManualUpdate()) {
    const updater = loadAutoUpdater();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    setupUpdaterEvents(updater);
  } else {
    logger.info('Auto-update: macOS build uses the manual DMG installer flow (unsigned app)');
  }

  void checkForAppUpdates(false).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Initial auto-update check failed', { message });
  });
};
