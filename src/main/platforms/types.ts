import type { VideoInfo, DownloadProgress, DownloadResponse } from '../../shared/types.js';

export type ExtractionStrategy = 'yt-dlp' | 'custom-api' | 'browser' | 'hybrid';

export type QualityLevel = 'best' | '1080p' | '720p' | '480p' | 'worst';

export type PlatformErrorCode =
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'CONTENT_UNAVAILABLE'
  | 'GEO_BLOCKED'
  | 'EXTRACTION_FAILED'
  | 'NETWORK_ERROR'
  | 'UNSUPPORTED_URL';

export interface DownloadOptions {
  url: string;
  outputDir: string;
  format: 'mp4' | 'mp3';
  requestId?: string;
  title?: string;
  quality?: QualityLevel;
  cookiesPath?: string;
  signal?: AbortSignal;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  language?: string;
  source: 'captions' | 'whisper' | 'api';
}

export interface BatchResult {
  channelTitle?: string;
  entries: Array<string | VideoInfo>;
}

export interface PlatformAdapter {
  readonly id: string;
  readonly name: string;
  readonly priority: number;

  matchUrl(url: string): boolean;
  getStrategy(url: string): ExtractionStrategy;
  shouldFallback?(error: unknown): boolean;

  getYtDlpArgs?(url: string, quality?: QualityLevel): string[];
  getReferer?(url: string): string | null;

  extractInfo?(url: string, signal?: AbortSignal): Promise<VideoInfo>;
  download?(options: DownloadOptions, onProgress?: ProgressCallback): Promise<DownloadResponse>;
  extractTranscript?(url: string, signal?: AbortSignal): Promise<TranscriptResult | null>;
  extractBatch?(url: string, signal?: AbortSignal): Promise<BatchResult>;

  dispose?(): Promise<void>;
}

export interface YtDlpPlatformConfig {
  id: string;
  name: string;
  priority?: number;
  urlPatterns: string[];
  referer?: string;
  extraArgs?: string[] | ((url: string, context: { retryCount: number }) => string[]);
  formatSelector?: string;
}
