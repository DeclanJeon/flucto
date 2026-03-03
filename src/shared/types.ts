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
 * Post data structure
 */
export interface Post {
  id?: string;
  title: string;
  content: string; // HTML content from WYSIWYG editor
  tags: string[];
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
    avatar: string;
  };
}

/**
 * Review data structure
 */
export interface Review {
  id?: string;
  postId: string;
  rating: number; // 1-5
  content: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
    avatar: string;
  };
}

/**
 * Posts API response
 */
export interface PostsListResponse {
  posts: Post[];
}

/**
 * Reviews API response
 */
export interface ReviewsListResponse {
  reviews: Review[];
}

/**
 * Type definition for window.api object exposed via preload script.
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
  // Posts & Reviews APIs
  postsAPI: {
    list: () => Promise<PostsListResponse>;
    create: (post: Omit<Post, 'id'>) => Promise<void>;
    get: (id: string) => Promise<Post | null>;
    update: (id: string, post: Partial<Post>) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
  reviewsAPI: {
    list: (postId: string) => Promise<ReviewsListResponse>;
    create: (review: Omit<Review, 'id'>) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
}

// Global window extension
declare global {
  interface Window {
    api: IElectronAPI;
  }
}
