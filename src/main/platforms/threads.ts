import fs from 'fs';
import path from 'path';
import type { VideoInfo, DownloadResponse, PostImageInfo } from '../../shared/types.js';
import type { PlatformAdapter, DownloadOptions, ProgressCallback, BatchResult } from './types.js';
import { PlatformError } from './errors.js';
import { withAnonymousPage } from '../search/webIndexSearch.js';

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
// Constants
// ---------------------------------------------------------------------------

const THREADS_API_URL = 'https://www.threadsdl.app/api/threads';
const THREADS_PROXY_URL = 'https://www.threadsdl.app/api/proxy';
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const fetchThreadsApi = async (url: string, signal?: AbortSignal): Promise<ThreadsApiResponse> => {
  const { promise, resolve, reject } = Promise.withResolvers<ThreadsApiResponse>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Forward external abort signal
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  fetch(THREADS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Threads API returned ${res.status}`);
      }
      resolve((await res.json()) as ThreadsApiResponse);
    })
    .catch(reject)
    .finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    });

  return promise;
};

const extractVideoFromResponse = (data: ThreadsApiResponse): ThreadsMedia => {
  const video = data.medias.find((m) => m.mediaType === 2);
  if (!video) {
    throw new PlatformError('CONTENT_UNAVAILABLE', 'No video found in Threads post', 'threads');
  }
  return video;
};

const extractPostId = (url: string): string => {
  const shortcodeMatch = url.match(/\/(?:post|tv)\/([A-Za-z0-9_-]+)/);
  return shortcodeMatch?.[1] ?? 'unknown';
};

interface ThreadsProfileCandidate {
  url: string;
  hasVideo: boolean;
  title: string;
  thumbnail: string;
  duration: number;
}

export const mapThreadsProfilePosts = (candidates: ThreadsProfileCandidate[]): VideoInfo[] => {
  const posts = new Map<string, VideoInfo>();
  for (const candidate of candidates) {
    if (!candidate.hasVideo) continue;
    const id = extractPostId(candidate.url);
    if (id === 'unknown' || posts.has(id)) continue;
    posts.set(id, {
      id,
      title: candidate.title.trim() || 'Threads video',
      thumbnail: candidate.thumbnail,
      duration: candidate.duration,
      uploader: new URL(candidate.url).pathname.split('/')[1]?.replace(/^@/, '') ?? '',
      originalUrl: candidate.url,
    });
  }
  return [...posts.values()];
};

const extractProfileVideos = async (url: string, signal?: AbortSignal): Promise<BatchResult> => {
  const profile = new URL(url);
  const username = profile.pathname.split('/').filter(Boolean)[0];
  if (!username?.startsWith('@')) {
    throw new PlatformError('UNSUPPORTED_URL', 'Expected a Threads profile URL', 'threads');
  }

  const candidates = await withAnonymousPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const seen = new Map<string, ThreadsProfileCandidate>();
    let quietPasses = 0;
    let previousCount = 0;

    for (let pass = 0; pass < 500 && quietPasses < 10; pass += 1) {
      if (signal?.aborted) throw signal.reason ?? new Error('Threads profile extraction cancelled');
      const visible = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
        .map((anchor) => {
          const link = anchor as HTMLAnchorElement;
          const card = link.closest('[data-pressable-container="true"]');
          const video = card?.querySelector('video');
          const title = Array.from(card?.querySelectorAll('[dir="auto"]') ?? [])
            .filter((element) =>
              !element.contains(link)
              && !element.closest('a, button, [role="button"]')
              && !element.querySelector('[dir="auto"]'))
            .map((element) => element.textContent?.trim() ?? '')
            .find(Boolean) ?? '';
          return {
            url: link.href,
            hasVideo: Boolean(video),
            title,
            thumbnail: video?.getAttribute('poster') ?? '',
            duration: Number.isFinite(video?.duration) ? video!.duration : 0,
          };
        })
        .filter((item) => /^https?:\/\/(?:www\.)?threads\.(?:com|net)\/@[^/]+\/(?:post|tv)\//.test(item.url)));
      for (const post of visible) {
        const canonicalUrl = post.url.replace(/\/media\/?$/, '');
        if (!seen.has(canonicalUrl)) seen.set(canonicalUrl, { ...post, url: canonicalUrl });
        else if (post.hasVideo) seen.set(canonicalUrl, { ...post, url: canonicalUrl });
      }
      quietPasses = seen.size === previousCount ? quietPasses + 1 : 0;
      previousCount = seen.size;
      await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.8)));
      await page.waitForTimeout(400);
    }
    return [...seen.values()];
  });

  return {
    channelTitle: username,
    entries: mapThreadsProfilePosts(candidates),
  };
};

// ---------------------------------------------------------------------------
// Threads adapter
// ---------------------------------------------------------------------------

export function createThreadsAdapter(): PlatformAdapter {
  return {
    id: 'threads',
    name: 'Threads',
    priority: 10,

    matchUrl: (url: string) => url.includes('threads.com') || url.includes('threads.net'),

    getStrategy: () => 'custom-api',

    getReferer: () => 'https://www.threads.com/',
    extractBatch: async (url: string, signal?: AbortSignal): Promise<BatchResult> =>
      extractProfileVideos(url, signal),


    extractImages: async (url: string, signal?: AbortSignal): Promise<PostImageInfo[]> => {
      try {
        const data = await fetchThreadsApi(url, signal);
        const images = data.medias.filter((media) => media.mediaType === 1).flatMap((media) => media.images ?? []);
        return images.map((image, index) => ({
          id: String(index + 1),
          title: (data.text?.slice(0, 100) || "Threads post") + ' (' + (index + 1) + ')',
          imageUrl: image.url,
          thumbnail: image.url,
          originalUrl: image.url,
        }));
      } catch (error: unknown) {
        if (error instanceof PlatformError) throw error;
        throw new PlatformError('EXTRACTION_FAILED', "Failed to extract Threads images: " + (error instanceof Error ? error.message : String(error)), 'threads', error);
      }
    },

    extractInfo: async (url: string, signal?: AbortSignal): Promise<VideoInfo> => {
      try {
        const data = await fetchThreadsApi(url, signal);
        const video = extractVideoFromResponse(data);
        const postId = extractPostId(url);

        return {
          id: postId,
          title: data.text?.slice(0, 100) || `Threads post by @${data.username}`,
          thumbnail: video.images?.[0]?.url ?? '',
          duration: 0,
          uploader: data.username,
        };
      } catch (error: unknown) {
        if (error instanceof PlatformError) throw error;
        throw new PlatformError(
          'EXTRACTION_FAILED',
          `Failed to extract Threads info: ${error instanceof Error ? error.message : String(error)}`,
          'threads',
          error,
        );
      }
    },

    download: async (
      options: DownloadOptions,
      onProgress?: ProgressCallback,
    ): Promise<DownloadResponse> => {
      const requestId = options.requestId ?? `threads-${Date.now()}`;
      const title = options.title ?? 'Threads Video';

      onProgress?.({ requestId, url: options.url, status: 'downloading', progress: 0, title });

      try {
        // 1. Fetch media info
        const data = await fetchThreadsApi(options.url, options.signal);
        const video = extractVideoFromResponse(data);
        const resolvedTitle = options.title || data.text?.slice(0, 80) || `Threads @${data.username}`;

        onProgress?.({ requestId, url: options.url, status: 'downloading', progress: 10, title: resolvedTitle });

        // 2. Download via proxy to avoid CORS/referer issues
        const proxyUrl = `${THREADS_PROXY_URL}?${new URLSearchParams({ url: video.cover })}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);

        // Forward external abort signal
        const onExternalAbort = () => controller.abort();
        options.signal?.addEventListener('abort', onExternalAbort, { once: true });

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
                title: resolvedTitle,
                speed: `${(received / 1024 / 1024).toFixed(1)}MB`,
              });
            }
          }

          // 3. Write to file
          fs.mkdirSync(options.outputDir, { recursive: true });

          const cleanTitle = resolvedTitle.replace(/[\r\n]+/g, ' ').trim();
          const safeTitle = cleanTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\s._-]/g, '').slice(0, 80) || 'threads_video';
          const postId = extractPostId(options.url);
          const uniqueSuffix = postId === 'unknown' ? requestId : postId;
          const filePath = path.join(options.outputDir, `${safeTitle} [${uniqueSuffix}].mp4`);

          const buffer = Buffer.concat(chunks);
          fs.writeFileSync(filePath, buffer);

          onProgress?.({
            requestId,
            url: options.url,
            status: 'completed',
            progress: 100,
            title: resolvedTitle,
            filePath,
          });

          return { success: true, message: 'Download Complete!', filePath };
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onExternalAbort);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const failureMessage = error instanceof PlatformError
          ? error.message
          : `Threads download failed: ${message}`;
        onProgress?.({
          requestId,
          url: options.url,
          status: 'error',
          progress: 0,
          error: failureMessage,
          title,
        });

        return { success: false, message: failureMessage };
      }
    },
  };
}
