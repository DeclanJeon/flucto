import { contextBridge, ipcRenderer } from 'electron';
import type { DownloadRequest } from '../shared/types.js';

// Main World에 노출할 API 정의
const api = {
  downloadVideo: (data: DownloadRequest) =>
    ipcRenderer.invoke('download-video', data),
  downloadMultiple: (urls: string[], format: 'mp4' | 'mp3') =>
    ipcRenderer.invoke('download-multiple', { urls, format }),
  getVideoInfo: (url: string) => ipcRenderer.invoke('get-video-info', url),
  getPlaylistInfo: (url: string) => ipcRenderer.invoke('get-playlist-info', url),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  // [추가] 배치 파일 읽기 노출
  readBatchFile: () => ipcRenderer.invoke('read-batch-file'),
  onDownloadProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('download-progress', (_event, progress) => callback(progress));
  },
};

// 보안을 위해 contextBridge를 통해서만 노출
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (Typescript check ignore for legacy mode)
  window.api = api;
}
