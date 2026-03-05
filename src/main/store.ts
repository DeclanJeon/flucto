import Store from 'electron-store';
import type { UpdateSettings } from '../shared/types.js';

const defaultUpdateSettings: UpdateSettings = {
  autoUpdate: true,
  checkInterval: 86400000,
  notifyOnStart: true,
};

type FluctoSettingsStore = {
  updateSettings: UpdateSettings;
  lastAppUpdateCheckAt: number;
};

export const settingsStore = new Store<FluctoSettingsStore>({
  name: 'flucto-settings',
  defaults: {
    updateSettings: defaultUpdateSettings,
    lastAppUpdateCheckAt: 0,
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
