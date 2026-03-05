/**
 * Video quality presets for download
 */
export type VideoQualityPreset = '4k' | '1440p' | '1080p' | '720p' | '480p' | '360p' | 'worst';

/**
 * Audio quality presets for download
 */
export type AudioQualityPreset = '320kbps' | '256kbps' | '192kbps' | '128kbps' | '64kbps' | 'worst';

/**
 * Quality preferences for downloads
 */
export interface DownloadQualityPreferences {
  video: VideoQualityPreset;
  audio: AudioQualityPreset;
}

/**
 * Request payload for initiating a download.
 */
export interface DownloadRequest {
  url: string;
  format: 'mp4' | 'mp3';
  cookiesPath?: string; // YouTube 쿠키 파일 경로 (옵션)
  quality?: DownloadQualityPreferences;
  formatOverrides?: {
    videoFormatId: string | null;
    audioFormatId: string | null;
  };
  requestId?: string; // Unique ID for tracking individual downloads
  title?: string;
}

/**
 * Single download request with all options
 */
export interface SingleDownloadRequest extends DownloadRequest {
  requestId: string;
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
  requestId: string;
  url: string;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  progress: number;
  speed?: string;
  eta?: string;
  error?: string;
  title?: string;
  filePath?: string;
}



export interface UpdateSettings {
  autoUpdate: boolean;
  checkInterval: number;
  notifyOnStart: boolean;
}

export interface NetworkStatusEvent {
  online: boolean;
  message: string;
}

/**
 * Download settings stored in electron-store
 */
export interface DownloadSettings {
  downloadsDirectory: string | null;
  qualityPreferences: DownloadQualityPreferences;
  formatOverrides: {
    videoFormatId: string | null;
    audioFormatId: string | null;
  };
  notifyPerItemInBatch: boolean;
}

/**
 * Download history entry
 */
export interface DownloadHistoryEntry {
  id: string;
  url: string;
  title: string;
  timestamp: number;
  status: 'success' | 'error';
  filePath: string | null;
  errorMessage?: string;
  format: 'mp4' | 'mp3';
}

/**
 * Available format option from yt-dlp -F
 */
export interface FormatOption {
  formatId: string;
  ext?: string;
  resolution?: string;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  abrKbps?: number;
  tbrKbps?: number;
  filesizeBytes?: number;
  filesizeApproxBytes?: number;
  note?: string;
}

/**
 * Available formats response
 */
export interface AvailableFormats {
  video: FormatOption[];
  audio: FormatOption[];
}

/**
 * Type definition for window.api object exposed via preload script.
 */
export interface IElectronAPI {
  setCookiesPath?: (path: string) => Promise<void>;
  downloadVideo: (data: DownloadRequest) => Promise<DownloadResponse>;
  downloadMultiple: (
    urls: string[],
    format: 'mp4' | 'mp3',
    quality?: DownloadQualityPreferences,
    titles?: string[],
    formatOverrides?: { videoFormatId: string | null; audioFormatId: string | null },
    notifyPerItemInBatch?: boolean,
  ) => Promise<void>;
  downloadSingle: (data: SingleDownloadRequest) => Promise<void>;
  getVideoInfo: (url: string) => Promise<VideoInfo>;
  getPlaylistInfo: (url: string) => Promise<VideoInfo[]>;
  getAvailableFormats: (url: string) => Promise<FormatOption[]>;
  openDownloadsFolder: () => Promise<void>;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => void;
  readBatchFile: () => Promise<string[] | null>;
  getUpdateSettings: () => Promise<UpdateSettings>;
  saveUpdateSettings: (settings: UpdateSettings) => Promise<void>;
  checkBinaryUpdates: () => Promise<void>;
  onNetworkStatusChange: (callback: (status: NetworkStatusEvent) => void) => void;
  offNetworkStatusChange?: (callback: (status: NetworkStatusEvent) => void) => void;
  getDownloadSettings: () => Promise<DownloadSettings>;
  setDownloadSettings: (settings: DownloadSettings) => Promise<void>;
  setDownloadDirectory: (path: string | null) => Promise<void>;
  selectDownloadDirectory: () => Promise<string | null>;
  getDownloadHistory: () => Promise<DownloadHistoryEntry[]>;
  clearDownloadHistory: () => Promise<void>;
}

// Global window extension
declare global {
  interface Window {
    api: IElectronAPI;
  }
}
