import type { VideoInfo } from '../../shared/types.js';
import { randomUUID } from 'node:crypto';
import { searchBrowserVideos } from './browserSearch.js';

// Public endpoint also used by yt-dlp's BiliBiliSearchIE; render the
// anonymous search page only if the API fails.

const SEARCH_API = 'https://api.bilibili.com/x/web-interface/search/type';
const VIDEO_BASE = 'https://www.bilibili.com/video/';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 20; // fixed by the upstream API
const MAX_PAGES = 3;  // bound network time: at most 60 candidates per search
const MAX_LIMIT = 50;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface BilibiliSearchItem {
  type?: string;
  aid?: number;
  bvid?: string;
  arcurl?: string;
  title?: string;
  pic?: string;
  duration?: string;
  author?: string;
  play?: number | string;
}

interface BilibiliSearchResponse {
  code?: number;
  message?: string;
  data?: {
    result?: BilibiliSearchItem[] | null;
    numPages?: number;
  } | null;
}

export function getBilibiliSearchUrl(query: string): string {
  return `https://search.bilibili.com/video?keyword=${encodeURIComponent(query)}`;
}

/** Parses "M:SS" or "H:MM:SS" duration strings into seconds. */
function parseBilibiliDuration(raw: string | undefined): number {
  if (typeof raw !== 'string' || !raw.trim()) return 0;
  const parts = raw.trim().split(':');
  if (parts.some(p => !/^\d+$/.test(p))) return 0;
  return parts.reduce((seconds, part) => seconds * 60 + Number(part), 0);
}

const HTML_TAG_RE = /<[^>]*>/g;

/** Removes search-highlight <em class="keyword"> markup and common entities. */
function stripBilibiliTitle(title: string | undefined, fallback: string): string {
  if (typeof title !== 'string' || !title.trim()) return fallback;
  return title
    .replace(HTML_TAG_RE, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

const BVID_RE = /BV[0-9A-Za-z]+/;

function mapBilibiliSearchItem(item: BilibiliSearchItem): VideoInfo | null {
  if (!item || typeof item !== 'object') return null;
  const bvid = typeof item.bvid === 'string' && BVID_RE.test(item.bvid)
    ? item.bvid
    : (typeof item.arcurl === 'string' ? item.arcurl.match(BVID_RE)?.[0] : undefined);
  if (!bvid) return null;

  const url = `${VIDEO_BASE}${bvid}`;
  const play = typeof item.play === 'number'
    ? item.play
    : Number.parseInt(String(item.play ?? ''), 10);

  const pic = typeof item.pic === 'string' ? item.pic.trim() : '';
  const thumbnail = pic.startsWith('//') ? `https:${pic}` : pic;

  return {
    id: bvid,
    title: stripBilibiliTitle(item.title, bvid),
    thumbnail,
    duration: parseBilibiliDuration(item.duration),
    uploader: typeof item.author === 'string' && item.author ? item.author : 'unknown',
    view_count: Number.isFinite(play) ? play : undefined,
    originalUrl: url,
  };
}

async function fetchSearchPage(query: string, page: number): Promise<BilibiliSearchItem[]> {
  const params = new URLSearchParams({
    search_type: 'video',
    keyword: query,
    page: String(page),
  });
  const apiUrl = `${SEARCH_API}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json',
        referer: 'https://search.bilibili.com/',
        // Random buvid3 visitor cookie, matching yt-dlp's BiliBiliSearchIE behaviour.
        cookie: `buvid3=${randomUUID().toUpperCase()}infoc`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`bilibili search request failed (${reason}). Original search: ${getBilibiliSearchUrl(query)}`);
  }

  if (!response.ok) {
    throw new Error(`bilibili search API rejected the request (HTTP ${response.status}). Retry later. Original search: ${getBilibiliSearchUrl(query)}`);
  }

  let body: BilibiliSearchResponse;
  try {
    body = (await response.json()) as BilibiliSearchResponse;
  } catch {
    throw new Error(`bilibili search returned a non-JSON response (HTTP ${response.status}). Original search: ${getBilibiliSearchUrl(query)}`);
  }

  if (body?.code !== 0) {
    const detail = body.message ? `code ${body.code}: ${body.message}` : `code ${body.code}`;
    throw new Error(`bilibili search API rejected the request (${detail}). Retry later or try a different keyword. Original search: ${getBilibiliSearchUrl(query)}`);
  }

  if (!Array.isArray(body.data?.result)) throw new Error('bilibili search returned an unexpected response.');
  return body.data.result;
}

async function searchBilibiliApi(query: string, limit: number): Promise<VideoInfo[]> {
  const videos: VideoInfo[] = [];
  const seen = new Set<string>();
  const pagesNeeded = Math.min(MAX_PAGES, Math.ceil(limit / PAGE_SIZE));
  for (let page = 1; page <= pagesNeeded && videos.length < limit; page += 1) {
    const items = await fetchSearchPage(query, page);
    if (items.length === 0) break;
    for (const item of items) {
      if (item?.type !== 'video') continue;
      const video = mapBilibiliSearchItem(item);
      if (video && !seen.has(video.id)) {
        seen.add(video.id);
        videos.push(video);
      }
    }
  }
  return videos;
}

export async function searchBilibili(query: string, limit: number): Promise<VideoInfo[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const effectiveLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_LIMIT));

  try {
    return (await searchBilibiliApi(trimmed, effectiveLimit)).slice(0, effectiveLimit);
  } catch (error: unknown) {
    // API path failed: fall back to rendering the real search page in
    // headless Chrome. An empty API result never reaches this branch.
    const apiReason = error instanceof Error ? error.message : String(error);
    try {
      return (await searchBrowserVideos('bilibili', trimmed, effectiveLimit)).slice(0, effectiveLimit);
    } catch (browserError: unknown) {
      const browserReason = browserError instanceof Error ? browserError.message : String(browserError);
      throw new Error(`${apiReason} Browser fallback also failed: ${browserReason}`);
    }
  }
}
