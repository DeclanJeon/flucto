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
 * Review data structure - 프로그램에 대한 사용자 리뷰
 */
export interface Review {
  id?: string;
  postId: string;
  rating: number; // 1-5
  content: string;
  githubUrl?: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
    avatar: string;
  };
}

export interface AuthorIdentity {
  id: string;
  name: string;
  avatar: string;
}



/**
 * Reviews API response
 */
export interface ReviewsListResponse {
  reviews: Review[];
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
 * Type definition for window.api object exposed via preload script.
 */
export interface IElectronAPI {
  setCookiesPath?: (path: string) => Promise<void>; // 쿠키 경로 설정
  downloadVideo: (data: DownloadRequest) => Promise<DownloadResponse>;
  downloadMultiple: (urls: string[], format: 'mp4' | 'mp3') => Promise<void>;
  getVideoInfo: (url: string) => Promise<VideoInfo>;
  getPlaylistInfo: (url: string) => Promise<VideoInfo[]>;
  openDownloadsFolder: () => Promise<void>;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => void;
  // [추가] 배치 파일 읽기 API
  readBatchFile: () => Promise<string[] | null>;
  // Reviews API (독립적인 리뷰 시스템)
  reviewsAPI: {
    list: () => Promise<ReviewsListResponse>;
    create: (review: Omit<Review, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Review>;
    get: (id: string) => Promise<Review | null>;
    delete: (id: string) => Promise<void>;
    getCurrentAuthor: () => Promise<AuthorIdentity>;
  };
  getUpdateSettings: () => Promise<UpdateSettings>;
  saveUpdateSettings: (settings: UpdateSettings) => Promise<void>;
  checkBinaryUpdates: () => Promise<void>;
  onNetworkStatusChange: (callback: (status: NetworkStatusEvent) => void) => void;
  offNetworkStatusChange?: (callback: (status: NetworkStatusEvent) => void) => void;
}

// Global window extension
declare global {
  interface Window {
    api: IElectronAPI;
  }
}
