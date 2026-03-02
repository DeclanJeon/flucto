/**
 * Request payload for initiating a download.
 */
export interface DownloadRequest {
  url: string;
  format: 'mp4' | 'mp3';
  cookiesPath?: string; // YouTube 쿠키 파일 경로 (옵션)
}
/**
 * Response payload after download attempt.
 */
export interface DownloadResponse {
  success: boolean;
  message: string;
  filePath?: string;
}

/**
 * Video information from yt-dlp
 */
export interface VideoInfo {
  id: string;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  view_count?: number;
  originalUrl?: string; // Store original URL with parameters
}

/**
 * Download progress update
 */
export interface DownloadProgress {
  url: string;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  progress: number;
  speed?: string;
  eta?: string;
  error?: string;
}

/**
 * Type definition for the window.api object exposed via preload script.
 */
export interface IElectronAPI {
  setCookiesPath: (path: string) => Promise<void>; // 쿠키 경로 설정
  downloadVideo: (data: DownloadRequest) => Promise<DownloadResponse>;
  downloadMultiple: (urls: string[], format: 'mp4' | 'mp3') => Promise<void>;
  getVideoInfo: (url: string) => Promise<VideoInfo>;
  getPlaylistInfo: (url: string) => Promise<VideoInfo[]>;
  openDownloadsFolder: () => Promise<void>;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => void;
  // [추가] 배치 파일 읽기 API
  readBatchFile: () => Promise<string[] | null>;
}

// Global window extension
declare global {
  interface Window {
    api: IElectronAPI;
  }
}
