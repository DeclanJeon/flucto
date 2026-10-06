import type { VideoInfo, VideoSearchProviderResult } from '../../shared/types.js';
import { VIDEO_SEARCH_SITES } from '../../shared/videoSearchPlatforms.js';
import { searchWebIndex } from './webIndexSearch.js';

// Anonymous YouTube keyword search. The public results page embeds
// `ytInitialData` plus the Innertube key/context needed to page further, so no
// API key provisioning or yt-dlp install is required. When the page is gated
// (consent wall, verification, markup change) the shared Google video index
// fallback keeps the search usable.

const RESULTS_BASE = 'https://www.youtube.com/results';
const WATCH_BASE = 'https://www.youtube.com/watch?v=';
const INNERTUBE_SEARCH = 'https://www.youtube.com/youtubei/v1/search';
const THUMBNAIL_BASE = 'https://i.ytimg.com/vi/';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PAGES = 3;
const MAX_LIMIT = 50;
const VIEW_COUNT_MULTIPLIERS: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type JsonObject = Record<string, unknown>;

interface YoutubeContinuation {
  apiKey: string;
  context: JsonObject;
  token: string;
}

const getYoutubeSearchUrl = VIDEO_SEARCH_SITES.youtube.searchUrl;

/** Extracts the first balanced JSON object appearing after `marker`. */
function extractJsonObject(source: string, marker: string): JsonObject | null {
  const markerAt = source.indexOf(marker);
  if (markerAt === -1) return null;
  const openAt = source.indexOf('{', markerAt);
  if (openAt === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openAt; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(openAt, i + 1)) as JsonObject;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Reads YouTube's `{ runs: [{text}] }` or `{ simpleText }` text nodes. */
function readText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const obj = node as JsonObject;
  if (typeof obj.simpleText === 'string') return obj.simpleText;
  if (Array.isArray(obj.runs)) {
    return (obj.runs as JsonObject[])
      .map(run => (typeof run?.text === 'string' ? run.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/** Parses `M:SS` or `H:MM:SS` duration labels into seconds. */
function parseDuration(label: string): number {
  const parts = label.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+$/.test(part))) return 0;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function parseViewCount(label: string): number | undefined {
  const match = label.match(/^\s*([\d,]+(?:\.\d+)?)\s*([KMB])?\s+views?\s*$/i);
  if (!match) return undefined;
  return Math.round(Number(match[1].replace(/,/g, '')) * (VIEW_COUNT_MULTIPLIERS[match[2]?.toUpperCase()] ?? 1));
}

function mapVideoRenderer(renderer: JsonObject): VideoInfo | null {
  const id = typeof renderer.videoId === 'string' ? renderer.videoId.trim() : '';
  if (!id) return null;
  const thumbnails = renderer.thumbnail as JsonObject | undefined;
  const thumbList = thumbnails && Array.isArray(thumbnails.thumbnails)
    ? (thumbnails.thumbnails as JsonObject[])
    : undefined;
  const lastThumb = thumbList?.at(-1);
  const title = readText(renderer.title);
  return {
    id,
    title: title || id,
    thumbnail: typeof lastThumb?.url === 'string' && lastThumb.url
      ? lastThumb.url
      : `${THUMBNAIL_BASE}${id}/hqdefault.jpg`,
    duration: parseDuration(readText(renderer.lengthText)),
    uploader: readText(renderer.ownerText) || readText(renderer.shortBylineText) || 'unknown',
    view_count: parseViewCount(readText(renderer.viewCountText)),
    originalUrl: `${WATCH_BASE}${id}`,
  };
}

interface WalkedPage {
  renderers: JsonObject[];
  continuationToken: string | null;
}

/** Collects videoRenderer objects and the next-page token anywhere in the response tree. */
function walkYoutubePayload(node: unknown, walked: WalkedPage): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkYoutubePayload(item, walked);
    return;
  }
  const obj = node as JsonObject;
  if (obj.videoRenderer && typeof obj.videoRenderer === 'object') {
    walked.renderers.push(obj.videoRenderer as JsonObject);
  }
  const continuationItem = obj.continuationItemRenderer as JsonObject | undefined;
  const token = (continuationItem?.continuationEndpoint as JsonObject | undefined)
    ?.continuationCommand as JsonObject | undefined;
  if (!walked.continuationToken && typeof token?.token === 'string' && token.token) {
    walked.continuationToken = token.token;
  }
  for (const key in obj) walkYoutubePayload(obj[key], walked);
}

async function fetchResultsPage(query: string): Promise<string> {
  const params = new URLSearchParams({ search_query: query, hl: 'en' });
  let response: Response;
  try {
    response = await fetch(`${RESULTS_BASE}?${params.toString()}`, {
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`youtube search request failed (${reason}). Original search: ${getYoutubeSearchUrl(query)}`);
  }
  if (!response.ok) {
    throw new Error(`youtube search page rejected the request (HTTP ${response.status}). Original search: ${getYoutubeSearchUrl(query)}`);
  }
  const html = await response.text();
  if (response.url.includes('consent.youtube') || /Before you continue/i.test(html.slice(0, 50_000))) {
    throw new Error(`youtube search requires a consent check on this network. Original search: ${getYoutubeSearchUrl(query)}`);
  }
  return html;
}

async function fetchContinuationPage(query: string, continuation: YoutubeContinuation): Promise<WalkedPage> {
  let response: Response;
  try {
    response = await fetch(`${INNERTUBE_SEARCH}?prettyPrint=false&key=${encodeURIComponent(continuation.apiKey)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        origin: 'https://www.youtube.com',
      },
      body: JSON.stringify({ context: continuation.context, continuation: continuation.token }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`youtube search continuation failed (${reason}). Original search: ${getYoutubeSearchUrl(query)}`);
  }
  if (!response.ok) {
    throw new Error(`youtube search continuation rejected the request (HTTP ${response.status}). Original search: ${getYoutubeSearchUrl(query)}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`youtube search continuation returned a non-JSON response. Original search: ${getYoutubeSearchUrl(query)}`);
  }
  const walked: WalkedPage = { renderers: [], continuationToken: null };
  walkYoutubePayload(body, walked);
  return walked;
}

async function searchYouTubeNative(query: string, limit: number): Promise<VideoInfo[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const effectiveLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_LIMIT));

  const html = await fetchResultsPage(trimmed);
  const initialData =
    extractJsonObject(html, 'ytInitialData = ') ?? extractJsonObject(html, '"ytInitialData"');
  if (!initialData) {
    throw new Error(`youtube search did not return embedded result data; the page may require verification or changed its markup. Original search: ${getYoutubeSearchUrl(trimmed)}`);
  }

  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? null;
  const context = extractJsonObject(html, '"INNERTUBE_CONTEXT"');

  const videos: VideoInfo[] = [];
  const seen = new Set<string>();
  const collect = (walked: WalkedPage) => {
    for (const renderer of walked.renderers) {
      const video = mapVideoRenderer(renderer);
      if (video && !seen.has(video.id)) {
        seen.add(video.id);
        videos.push(video);
      }
    }
  };

  const firstPage: WalkedPage = { renderers: [], continuationToken: null };
  walkYoutubePayload(initialData, firstPage);
  collect(firstPage);

  let continuationToken = firstPage.continuationToken;
  for (let page = 2; page <= MAX_PAGES && videos.length < effectiveLimit && continuationToken && apiKey && context; page += 1) {
    const walked = await fetchContinuationPage(trimmed, { apiKey, context, token: continuationToken });
    collect(walked);
    if (!walked.continuationToken || walked.continuationToken === continuationToken) break;
    continuationToken = walked.continuationToken;
  }
  return videos.slice(0, effectiveLimit);
}

export async function searchYouTube(query: string, limit: number): Promise<VideoSearchProviderResult> {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  const searchUrl = getYoutubeSearchUrl(trimmed);
  if (!trimmed) return { videos: [], method: 'native', searchUrl };
  const effectiveLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_LIMIT));
  try {
    const videos = await searchYouTubeNative(trimmed, effectiveLimit);
    return { videos, method: 'native', searchUrl };
  } catch (error: unknown) {
    const nativeError = error instanceof Error ? error.message : String(error);
    try {
      const fallback = await searchWebIndex('youtube', trimmed, effectiveLimit);
      return { ...fallback, nativeError };
    } catch (fallbackError: unknown) {
      const reason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`${nativeError} Web-index fallback also failed: ${reason}`);
    }
  }
}
