import type { VideoInfo } from '../../shared/types.js';
// Public Graph API; owner.screenname is a flat response key.

const SEARCH_API = 'https://api.dailymotion.com/videos';
const VIDEO_BASE = 'https://www.dailymotion.com/video/';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 25;
const MAX_PAGES = 2;
const MAX_LIMIT = 50;
const USER_AGENT = 'flucto-video-search/1.0 (https://www.dailymotion.com)';

const SEARCH_FIELDS = 'id,title,thumbnail_url,duration,owner.screenname,views_total,description';

interface DailymotionVideoItem {
  id?: string;
  title?: string;
  thumbnail_url?: string;
  duration?: number;
  'owner.screenname'?: string;
  views_total?: number;
  description?: string;
}

interface DailymotionListResponse {
  page?: number;
  limit?: number;
  total?: number;
  has_more?: boolean;
  list?: DailymotionVideoItem[] | null;
  error?: { code?: number | string; message?: string };
}

export function getDailymotionSearchUrl(query: string): string {
  return `https://www.dailymotion.com/search/${encodeURIComponent(query)}/videos`;
}

function mapDailymotionItem(item: DailymotionVideoItem): VideoInfo | null {
  if (!item || typeof item !== 'object') return null;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  if (!id) return null;
  const url = `${VIDEO_BASE}${id}`;
  return {
    id,
    title: typeof item.title === 'string' && item.title.trim() ? item.title : id,
    thumbnail: typeof item.thumbnail_url === 'string' ? item.thumbnail_url : '',
    duration: typeof item.duration === 'number' && Number.isFinite(item.duration) ? item.duration : 0,
    uploader: typeof item['owner.screenname'] === 'string' && item['owner.screenname']
      ? item['owner.screenname']
      : 'unknown',
    view_count: typeof item.views_total === 'number' ? item.views_total : undefined,
    originalUrl: url,
    aiDisclosures: typeof item.description === 'string' && item.description.trim()
      ? [{ source: 'creator_description', text: item.description, url }]
      : undefined,
    aiDisclosureMetadataAvailable: typeof item.description === 'string',
  };
}

async function fetchSearchPage(query: string, page: number): Promise<DailymotionListResponse> {
  const params = new URLSearchParams({
    search: query,
    fields: SEARCH_FIELDS,
    limit: String(PAGE_SIZE),
    page: String(page),
  });
  const apiUrl = `${SEARCH_API}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`dailymotion search request failed (${reason}). Original search: ${getDailymotionSearchUrl(query)}`);
  }

  let body: DailymotionListResponse;
  try {
    body = (await response.json()) as DailymotionListResponse;
  } catch {
    throw new Error(`dailymotion search returned a non-JSON response (HTTP ${response.status}). Original search: ${getDailymotionSearchUrl(query)}`);
  }

  if (!response.ok || body?.error) {
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`dailymotion search API rejected the request (${detail}). Original search: ${getDailymotionSearchUrl(query)}`);
  }

  if (!Array.isArray(body?.list)) throw new Error('dailymotion search returned an unexpected response.');
  return body;
}

export async function searchDailymotion(query: string, limit: number): Promise<VideoInfo[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const effectiveLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_LIMIT));
  const pagesNeeded = Math.min(MAX_PAGES, Math.ceil(effectiveLimit / PAGE_SIZE));

  const videos: VideoInfo[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= pagesNeeded && videos.length < effectiveLimit; page += 1) {
    const body = await fetchSearchPage(trimmed, page);
    const items = body.list ?? [];
    for (const item of items) {
      const video = mapDailymotionItem(item);
      if (video && !seen.has(video.id)) {
        seen.add(video.id);
        videos.push(video);
      }
    }
    if (!body?.has_more) break;
  }
  return videos.slice(0, effectiveLimit);
}
