import Store from 'electron-store';
import type { UpdateSettings } from '../shared/types.js';

const defaultUpdateSettings: UpdateSettings = {
  autoUpdate: false,
  checkInterval: 86400000,
  notifyOnStart: true,
};

export const settingsStore = new Store<{ updateSettings: UpdateSettings }>({
  name: 'flucto-settings',
  defaults: {
    updateSettings: defaultUpdateSettings,
  },
});

export const getUpdateSettingsDefaults = (): UpdateSettings => ({
  ...defaultUpdateSettings,
});
