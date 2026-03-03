import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  DownloadProgress,
  DownloadRequest,
  IElectronAPI,
  NetworkStatusEvent,
  Review,
  UpdateSettings,
} from '../shared/types.js';

type NetworkStatusListener = (status: NetworkStatusEvent) => void;

const NETWORK_STATUS_CHANNEL = 'network-status-change';
const networkStatusCallbacks = new Map<NetworkStatusListener, (event: IpcRendererEvent, status: NetworkStatusEvent) => void>();

const api: IElectronAPI = {
  downloadVideo: (data: DownloadRequest) => ipcRenderer.invoke('download-video', data),
  downloadMultiple: (urls, format) => ipcRenderer.invoke('download-multiple', { urls, format }),
  getVideoInfo: (url: string) => ipcRenderer.invoke('get-video-info', url),
  getPlaylistInfo: (url: string) => ipcRenderer.invoke('get-playlist-info', url),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  readBatchFile: () => ipcRenderer.invoke('read-batch-file'),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    ipcRenderer.on('download-progress', (_event: IpcRendererEvent, progress: DownloadProgress) => callback(progress));
  },
    reviewsAPI: {
      list: () => ipcRenderer.invoke('reviews-list'),
      create: (review: Omit<Review, 'id' | 'createdAt' | 'updatedAt'>) =>
        ipcRenderer.invoke('reviews-create', review),
      get: (id: string) => ipcRenderer.invoke('reviews-get', id),
      delete: (id: string) => ipcRenderer.invoke('reviews-delete', id),
      getCurrentAuthor: () => ipcRenderer.invoke('reviews-current-author'),
    },
  getUpdateSettings: () => ipcRenderer.invoke('get-update-settings'),
  saveUpdateSettings: (settings: UpdateSettings) => ipcRenderer.invoke('save-update-settings', settings),
  checkBinaryUpdates: () => ipcRenderer.invoke('check-binary-updates'),
  onNetworkStatusChange: (callback: NetworkStatusListener) => {
    const wrapped = (_event: IpcRendererEvent, status: NetworkStatusEvent) => callback(status);
    networkStatusCallbacks.set(callback, wrapped);
    ipcRenderer.on(NETWORK_STATUS_CHANNEL, wrapped);
  },
  offNetworkStatusChange: (callback: NetworkStatusListener) => {
    const wrapped = networkStatusCallbacks.get(callback);
    if (wrapped) {
      ipcRenderer.off(NETWORK_STATUS_CHANNEL, wrapped);
      networkStatusCallbacks.delete(callback);
    }
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api);
} else {
  (window as typeof window & { api: IElectronAPI }).api = api;
}

ipcRenderer.send('render-ready');
