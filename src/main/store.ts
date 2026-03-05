import Store from 'electron-store';
import type { UpdateSettings, DownloadQualityPreferences } from '../shared/types.js';

const defaultUpdateSettings: UpdateSettings = {
  autoUpdate: true,
  checkInterval: 86400000,
  notifyOnStart: true,
};

const defaultQualityPreferences: DownloadQualityPreferences = {
  video: '1080p',
  audio: '320kbps',
};

type FluctoSettingsStore = {
  updateSettings: UpdateSettings;
  lastAppUpdateCheckAt: number;
  downloadSettings: {
    downloadsDirectory: string | null;
    qualityPreferences: DownloadQualityPreferences;
    formatOverrides: {
      videoFormatId: string | null;
      audioFormatId: string | null;
    };
    notifyPerItemInBatch: boolean;
  };
}

export const settingsStore = new Store<FluctoSettingsStore>({
  name: 'flucto-settings',
  defaults: {
    updateSettings: defaultUpdateSettings,
    lastAppUpdateCheckAt: 0,
    downloadSettings: {
      downloadsDirectory: null,
      qualityPreferences: { ...defaultQualityPreferences },
      formatOverrides: {
        videoFormatId: null,
        audioFormatId: null,
      },
      notifyPerItemInBatch: false,
    },
  },
});

export const getUpdateSettingsDefaults = (): UpdateSettings => ({
  ...defaultUpdateSettings,
});

export const isUpdateSettings = (value: unknown): value is UpdateSettings => {
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

export const getStoredUpdateSettings = (): UpdateSettings => {
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

export const shouldRunAutoUpdateCheck = (): boolean => {
  const settings = getStoredUpdateSettings();
  if (!settings.autoUpdate) {
    return false;
  }

  const lastCheckAt = settingsStore.get('lastAppUpdateCheckAt') || 0;
  const elapsed = Date.now() - lastCheckAt;
  return elapsed >= settings.checkInterval;
};

export const markAutoUpdateCheckNow = (): void => {
  settingsStore.set('lastAppUpdateCheckAt', Date.now());
};

const isQualityPreferences = (value: unknown): value is DownloadQualityPreferences => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.video === 'string' &&
    typeof candidate.audio === 'string'
  );
};

const getDownloadSettingsDefaults = () => ({
  downloadsDirectory: null,
  qualityPreferences: { ...defaultQualityPreferences },
  formatOverrides: {
    videoFormatId: null,
    audioFormatId: null,
  },
  notifyPerItemInBatch: false,
});

const isDownloadSettings = (value: unknown): value is { downloadsDirectory: string | null; qualityPreferences: DownloadQualityPreferences } => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.downloadsDirectory === null || typeof candidate.downloadsDirectory === 'string') &&
    typeof candidate.qualityPreferences === 'object' &&
    isQualityPreferences(candidate.qualityPreferences) &&
    typeof candidate.formatOverrides === 'object' &&
    candidate.formatOverrides !== null &&
    (candidate.formatOverrides as Record<string, unknown>).videoFormatId !== undefined &&
    (candidate.formatOverrides as Record<string, unknown>).audioFormatId !== undefined &&
    (((candidate.formatOverrides as Record<string, unknown>).videoFormatId === null) || typeof (candidate.formatOverrides as Record<string, unknown>).videoFormatId === 'string') &&
    (((candidate.formatOverrides as Record<string, unknown>).audioFormatId === null) || typeof (candidate.formatOverrides as Record<string, unknown>).audioFormatId === 'string') &&
    typeof candidate.notifyPerItemInBatch === 'boolean'
  );
};

export const getStoredDownloadSettings = (): {
  downloadsDirectory: string | null;
  qualityPreferences: DownloadQualityPreferences;
  formatOverrides: {
    videoFormatId: string | null;
    audioFormatId: string | null;
  };
  notifyPerItemInBatch: boolean;
} => {
  const stored = settingsStore.get('downloadSettings');
  if (isDownloadSettings(stored)) {
    return stored;
  }
  const defaults = getDownloadSettingsDefaults();
  settingsStore.set('downloadSettings', defaults);
  return defaults;
};
