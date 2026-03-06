import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppUpdateEvent,
  DownloadProgress,
  DownloadRequest,
  IElectronAPI,
  NetworkStatusEvent,
  UpdateSettings,
} from '../shared/types.js';

type NetworkStatusListener = (status: NetworkStatusEvent) => void;
type AppUpdateListener = (event: AppUpdateEvent) => void;

const NETWORK_STATUS_CHANNEL = 'network-status-change';
const APP_UPDATE_CHANNEL = 'app-update-event';
const networkStatusCallbacks = new Map<NetworkStatusListener, (event: IpcRendererEvent, status: NetworkStatusEvent) => void>();
const appUpdateCallbacks = new Map<AppUpdateListener, (event: IpcRendererEvent, updateEvent: AppUpdateEvent) => void>();

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
  getAppUpdateState: () => ipcRenderer.invoke('get-app-update-state'),
  checkAppUpdates: (force = false) => ipcRenderer.invoke('check-app-updates', force),
  downloadAppUpdate: () => ipcRenderer.invoke('download-app-update'),
  installAppUpdate: () => ipcRenderer.invoke('install-app-update'),
  onAppUpdateEvent: (callback: AppUpdateListener) => {
    const wrapped = (_event: IpcRendererEvent, updateEvent: AppUpdateEvent) => callback(updateEvent);
    appUpdateCallbacks.set(callback, wrapped);
    ipcRenderer.on(APP_UPDATE_CHANNEL, wrapped);
  },
  offAppUpdateEvent: (callback: AppUpdateListener) => {
    const wrapped = appUpdateCallbacks.get(callback);
    if (wrapped) {
      ipcRenderer.off(APP_UPDATE_CHANNEL, wrapped);
      appUpdateCallbacks.delete(callback);
    }
  },
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
