import fs from 'fs';
import path from 'path';
import type { VideoInfo, DownloadProgress } from '../../shared/types.js';

// ---------------------------------------------------------------------------
// Threads URL detection
// ---------------------------------------------------------------------------

export const isThreadsUrl = (url: string): boolean =>
  url.includes('threads.com') || url.includes('threads.net');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThreadsMedia {
  mediaType: number; // 2 = video, 1 = image
  height: number;
  width: number;
  cover: string; // video CDN URL
  images?: Array<{ url: string; width: number; height: number }>;
}

interface ThreadsApiResponse {
  username: string;
  avatar?: string;
  text: string;
  medias: ThreadsMedia[];
}

// ---------------------------------------------------------------------------
// threadsdl.app API extraction
// ---------------------------------------------------------------------------

const THREADS_API_URL = 'https://www.threadsdl.app/api/threads';
const THREADS_PROXY_URL = 'https://www.threadsdl.app/api/proxy';
const REQUEST_TIMEOUT_MS = 15_000;

const fetchThreadsApi = async (url: string): Promise<ThreadsApiResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(THREADS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Threads API returned ${res.status}`);
    }

    return (await res.json()) as ThreadsApiResponse;
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// Public: get video info (replaces yt-dlp --dump-json for Threads)
// ---------------------------------------------------------------------------

export const getThreadsVideoInfo = async (url: string): Promise<VideoInfo> => {
  const data = await fetchThreadsApi(url);

  const video = data.medias.find((m) => m.mediaType === 2);
  if (!video) {
    throw new Error('No video found in Threads post');
  }

  // Extract post shortcode from URL for ID
  const shortcodeMatch = url.match(/\/(?:post|tv)\/([A-Za-z0-9_-]+)/);
  const postId = shortcodeMatch?.[1] ?? 'unknown';

  return {
    id: postId,
    title: data.text?.slice(0, 100) || `Threads post by @${data.username}`,
    thumbnail: video.images?.[0]?.url ?? '',
    duration: 0, // Threads API doesn't expose duration
    uploader: data.username,
  };
};

// ---------------------------------------------------------------------------
// Public: download video (replaces yt-dlp download for Threads)
// ---------------------------------------------------------------------------

export interface ThreadsDownloadOptions {
  url: string;
  outputDir: string;
  requestId?: string;
  title?: string;
}

export interface ThreadsDownloadResult {
  success: boolean;
  message: string;
  filePath?: string;
  requestId: string;
  title: string;
  url: string;
}

export const downloadThreadsVideo = async (
  options: ThreadsDownloadOptions,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<ThreadsDownloadResult> => {
  const requestId = options.requestId ?? `threads-${Date.now()}`;

  onProgress?.({ requestId, url: options.url, status: 'downloading', progress: 0, title: options.title ?? 'Threads Video' });

  try {
    // 1. Fetch media info from threadsdl.app API
    const data = await fetchThreadsApi(options.url);

    const video = data.medias.find((m) => m.mediaType === 2);
    if (!video) {
      throw new Error('No video found in Threads post');
    }

    // Use API data for title if not provided
    const title = options.title || data.text?.slice(0, 80) || `Threads @${data.username}`;
    onProgress?.({ requestId, url: options.url, status: 'downloading', progress: 10, title });

    // 2. Download the video via the proxy to avoid CORS/referer issues
    const proxyUrl = `${THREADS_PROXY_URL}?${new URLSearchParams({ url: video.cover })}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch(proxyUrl, {
        headers: { Referer: 'https://www.threads.com/' },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Video download returned ${res.status}`);
      }

      const contentLength = Number(res.headers.get('content-length') ?? 0);
      const chunks: Uint8Array[] = [];
      let received = 0;

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Response body is not readable');

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;

        if (contentLength > 0) {
          const progress = Math.round(10 + (received / contentLength) * 85);
          onProgress?.({
            requestId,
            url: options.url,
            status: 'downloading',
            progress: Math.min(progress, 95),
            title,
            speed: `${(received / 1024 / 1024).toFixed(1)}MB`,
          });
        }
      }

      // 3. Write to file
      // Ensure output directory exists
      fs.mkdirSync(options.outputDir, { recursive: true });

      // Build safe filename (replace newlines, sanitize special chars)
      const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim();
      const safeTitle = cleanTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\s._-]/g, '').slice(0, 80) || 'threads_video';
      const filePath = path.join(options.outputDir, `${safeTitle}.mp4`);

      // Merge chunks
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(filePath, buffer);

      onProgress?.({
        requestId,
        url: options.url,
        status: 'completed',
        progress: 100,
        title,
        filePath,
      });

      return {
        success: true,
        message: 'Download Complete!',
        filePath,
        requestId,
        title,
        url: options.url,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error: unknown) {
    const fallbackTitle = options.title ?? 'Threads Video';
    const message = error instanceof Error ? error.message : String(error);
    onProgress?.({
      requestId,
      url: options.url,
      status: 'error',
      progress: 0,
      error: message,
      title: fallbackTitle,
    });
    return {
      success: false,
      message,
      requestId,
      title: fallbackTitle,
      url: options.url,
    };
  }
};
