import Store from 'electron-store';
import type { DownloadQualityPreferences, TranscriptSettings, UpdateSettings } from '../shared/types.js';
import {
  defaultTranscriptSettings,
  getDownloadSettingsDefaults,
  getTranscriptSettingsDefaults,
  getUpdateSettingsDefaults,
  isQualityPreferences,
  isTranscriptSettings,
  isUpdateSettings,
} from './services/settingsDefaults.js';

export {
  getDownloadSettingsDefaults,
  getTranscriptSettingsDefaults,
  getUpdateSettingsDefaults,
  isTranscriptSettings,
  isUpdateSettings,
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
  transcriptSettings: TranscriptSettings;
}

export const settingsStore = new Store<FluctoSettingsStore>({
  name: 'flucto-settings',
  defaults: {
    updateSettings: getUpdateSettingsDefaults(),
    lastAppUpdateCheckAt: 0,
    downloadSettings: getDownloadSettingsDefaults(),
    transcriptSettings: getTranscriptSettingsDefaults(),
  },
});


const isLegacyUpdateSettings = (value: unknown): value is {
  autoUpdate: boolean;
  checkInterval: number;
  notifyOnStart: boolean;
} => {
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
  const stored: unknown = settingsStore.get('updateSettings');
  if (isUpdateSettings(stored)) {
    return {
      ...stored,
    };
  }

  if (isLegacyUpdateSettings(stored)) {
    const migrated: UpdateSettings = {
      autoUpdate: stored.autoUpdate,
      checkInterval: stored.checkInterval,
      notifyOnUpdateReady: stored.notifyOnStart,
    };
    settingsStore.set('updateSettings', migrated);
    return migrated;
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


export const getStoredTranscriptSettings = (): TranscriptSettings => {
  const stored: unknown = settingsStore.get('transcriptSettings');
  if (isTranscriptSettings(stored)) {
    const settings = { ...getTranscriptSettingsDefaults(), ...stored };
    if (settings.language === null) {
      settings.language = defaultTranscriptSettings.language;
      settingsStore.set('transcriptSettings', settings);
    }
    return settings;
  }
  const defaults = getTranscriptSettingsDefaults();
  settingsStore.set('transcriptSettings', defaults);
  return defaults;
};
