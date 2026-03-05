import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  DownloadProgress,
  DownloadRequest,
  IElectronAPI,
  NetworkStatusEvent,
  UpdateSettings,
} from '../shared/types.js';

type NetworkStatusListener = (status: NetworkStatusEvent) => void;

const NETWORK_STATUS_CHANNEL = 'network-status-change';
const networkStatusCallbacks = new Map<NetworkStatusListener, (event: IpcRendererEvent, status: NetworkStatusEvent) => void>();

const api: IElectronAPI = {
  downloadVideo: (data: DownloadRequest) => ipcRenderer.invoke('download-video', data),
  downloadMultiple: (urls, format, quality, titles, formatOverrides, notifyPerItemInBatch) => ipcRenderer.invoke('download-multiple', {
    urls,
    format,
    quality,
    titles,
    formatOverrides,
    notifyPerItemInBatch,
  }),
  downloadSingle: (data) => ipcRenderer.invoke('download-single', data),
  getVideoInfo: (url: string) => ipcRenderer.invoke('get-video-info', url),
  getPlaylistInfo: (url: string) => ipcRenderer.invoke('get-playlist-info', url),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  readBatchFile: () => ipcRenderer.invoke('read-batch-file'),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    ipcRenderer.on('download-progress', (_event: IpcRendererEvent, progress: DownloadProgress) => callback(progress));
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
  getDownloadSettings: () => ipcRenderer.invoke('get-download-settings'),
  setDownloadSettings: (settings) => ipcRenderer.invoke('set-download-settings', settings),
  setDownloadDirectory: (path: string | null) => ipcRenderer.invoke('set-download-directory', path),
  selectDownloadDirectory: () => ipcRenderer.invoke('select-download-directory'),
  getDownloadHistory: () => ipcRenderer.invoke('get-download-history'),
  clearDownloadHistory: () => ipcRenderer.invoke('clear-download-history'),
  getAvailableFormats: (url: string) => ipcRenderer.invoke('get-available-formats', url),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api);
} else {
  (window as typeof window & { api: IElectronAPI }).api = api;
}

ipcRenderer.send('render-ready');
