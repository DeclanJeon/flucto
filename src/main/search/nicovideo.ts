import type { VideoInfo } from '../../shared/types.js';

/**
 * Niconico video search via the official Snapshot Search API v2.
 * Reference: https://site.nicovideo.jp/search-api-docs/snapshot
 * No authentication is required for public search results.
 */

const SEARCH_API = 'https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search';
const WATCH_BASE = 'https://www.nicovideo.jp/watch/';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_API_LIMIT = 100;
const USER_AGENT = 'flucto-video-search/1.0 (https://nicovideo.jp)';

const SEARCH_FIELDS = [
  'contentId',
  'title',
  'thumbnailUrl',
  'lengthSeconds',
  'userId',
  'channelId',
  'viewCounter',
] as const;

interface SnapshotItem {
  contentId?: string;
  title?: string;
  thumbnailUrl?: string;
  lengthSeconds?: number;
  userId?: number | null;
  channelId?: number | null;
  viewCounter?: number;
}

interface SnapshotResponse {
  meta?: {
    status?: number;
    errorCode?: string;
    errorMessage?: string;
    totalCount?: number;
  };
  data?: SnapshotItem[];
}

export function getNicovideoSearchUrl(query: string): string {
  return `https://www.nicovideo.jp/search/${encodeURIComponent(query)}`;
}

function mapSnapshotItem(item: SnapshotItem): VideoInfo | null {
  const id = typeof item.contentId === 'string' ? item.contentId.trim() : '';
  if (!id) return null;
  return {
    id,
    title: typeof item.title === 'string' ? item.title : id,
    thumbnail: typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : '',
    duration: typeof item.lengthSeconds === 'number' ? item.lengthSeconds : 0,
    uploader: typeof item.userId === 'number' ? `user:${item.userId}` : typeof item.channelId === 'number' ? `channel:${item.channelId}` : 'unknown',
    view_count: typeof item.viewCounter === 'number' ? item.viewCounter : undefined,
    originalUrl: WATCH_BASE + id,
  };
}

async function searchViaApi(trimmed: string, effectiveLimit: number): Promise<VideoInfo[]> {
  const params = new URLSearchParams({
    q: trimmed,
    targets: 'title,description,tags',
    fields: SEARCH_FIELDS.join(','),
    _sort: '-viewCounter',
    _offset: '0',
    _limit: String(effectiveLimit),
    _context: 'flucto',
  });

  let response: Response;
  try {
    response = await fetch(`${SEARCH_API}?${params.toString()}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`nicovideo search request failed (${reason}). Original search: ${getNicovideoSearchUrl(trimmed)}`);
  }

  const url = `${SEARCH_API}?${params.toString()}`;
  let body: SnapshotResponse;
  try {
    body = (await response.json()) as SnapshotResponse;
  } catch {
    throw new Error(`nicovideo search returned non-JSON response (HTTP ${response.status}). Original search: ${getNicovideoSearchUrl(trimmed)}`);
  }

  const metaStatus = body?.meta?.status;
  if (!response.ok || (typeof metaStatus === 'number' && metaStatus >= 400)) {
    const detail = body?.meta?.errorMessage || body?.meta?.errorCode || `HTTP ${response.status}`;
    throw new Error(`nicovideo search API rejected the request (${detail}). Try a simpler keyword. Search URL: ${url}`);
  }

  if (body?.meta?.status !== 200 || !Array.isArray(body.data)) {
    throw new Error('nicovideo search returned an unexpected response; open the original site search.');
  }
  const items = body.data;
  return items
    .map(mapSnapshotItem)
    .filter((v): v is VideoInfo => v !== null)
    .slice(0, effectiveLimit);
}

export async function searchNicovideo(query: string, limit: number): Promise<VideoInfo[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const effectiveLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_API_LIMIT));

  return searchViaApi(trimmed, effectiveLimit);
}
