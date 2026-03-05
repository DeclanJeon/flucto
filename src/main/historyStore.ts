import Store from 'electron-store';
import type { DownloadHistoryEntry } from '../shared/types.js';

type HistoryStoreSchema = {
  entries: DownloadHistoryEntry[];
};

export const historyStore = new Store<HistoryStoreSchema>({
  name: 'flucto-history',
  defaults: {
    entries: [],
  },
});

export const appendHistoryEntry = (entry: DownloadHistoryEntry): void => {
  const entries = historyStore.get('entries');
  entries.unshift(entry);
  historyStore.set('entries', entries);
};

export const getHistoryEntries = (): DownloadHistoryEntry[] => {
  const entries = historyStore.get('entries');
  return entries.sort((a, b) => b.timestamp - a.timestamp);
};

export const clearHistory = (): void => {
  historyStore.set('entries', []);
};
