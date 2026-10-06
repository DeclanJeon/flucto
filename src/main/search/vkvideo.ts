import type { VideoInfo } from '../../shared/types.js';
import { searchBrowserVideos } from './browserSearch.js';

// Same anonymous token exchange and catalog search used by VK Video's SPA.
// The client pair is public website configuration, not a user's credential.

const VK_CLIENT_ID = '52461373';
const VK_CLIENT_SECRET = 'o557NLIkAErNhakXrQ7A';
const VK_API_VERSION = '5.289';
const TOKEN_URL = 'https://login.vk.ru/?act=get_anonym_token';
const SEARCH_API = `https://api.vkvideo.ru/method/catalog.getVideoSearchWeb2?v=${VK_API_VERSION}&client_id=${VK_CLIENT_ID}`;
const ORIGIN = 'https://vkvideo.ru';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 20_000;
/** Refresh the anonymous token this long before its declared expiry. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

export function getVkvideoSearchUrl(query: string): string {
  return `https://vkvideo.ru/?q=${encodeURIComponent(query)}`;
}

let cachedToken: { token: string; refreshAt: number } | null = null;
let tokenPromise: Promise<string> | null = null;

async function requestAnonymToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      version: '1',
      app_id: VK_CLIENT_ID,
      client_id: VK_CLIENT_ID,
      client_secret: VK_CLIENT_SECRET,
      scopes: '',
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`vkvideo anonymous token request failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    type?: string;
    data?: { access_token?: string; expires?: number };
    error?: unknown;
  };
  const token = body?.data?.access_token;
  const expires = body?.data?.expires;
  if (body?.type !== 'okay' || !token || !expires) {
    throw new Error(
      'vkvideo anonymous token request returned no token (provider may require session cookies now)',
    );
  }
  cachedToken = { token, refreshAt: expires * 1000 - TOKEN_REFRESH_SKEW_MS };
  return token;
}

async function getAnonymToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.refreshAt) {
    return cachedToken.token;
  }
  tokenPromise ??= requestAnonymToken().finally(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}


interface VkVideoEntry {
  id: number;
  owner_id: number;
  ov_id?: string;
  title?: string;
  duration?: number;
  views?: number;
  image?: Array<{ url: string; width?: number }>;
  author?: { name?: string } | null;
  share_url?: string;
}

interface VkSearchResponse {
  response?: {
    catalog?: {
      default_section?: string;
      sections?: Array<{
        blocks?: Array<{ data_type?: string; videos_ids?: string[] }>;
      }>;
    };
    catalog_videos?: Array<{ video?: VkVideoEntry }>;
    videos?: VkVideoEntry[];
    profiles?: Array<{ id: number; first_name?: string; last_name?: string; name?: string }>;
    groups?: Array<{ id: number; name?: string }>;
  };
  error?: { error_code?: number; error_msg?: string };
}

function parseVkvideoSearchResponse(data: VkSearchResponse, limit: number): VideoInfo[] {
  const resp = data.response;
  if (!resp) return [];

  const uploaderById = new Map<number, string>();
  for (const g of resp.groups ?? []) {
    if (typeof g.id === 'number' && g.name) uploaderById.set(-g.id, g.name);
  }
  for (const p of resp.profiles ?? []) {
    const name = p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    if (typeof p.id === 'number' && name) uploaderById.set(p.id, name);
  }

  const compositeId = (v: VkVideoEntry): string =>
    v.ov_id && String(v.ov_id).includes('_') ? String(v.ov_id) : `${v.owner_id}_${v.id}`;

  const catalogVideos = (resp.catalog_videos ?? [])
    .map((entry) => entry.video)
    .filter((v): v is VkVideoEntry => !!v);

  const byCompositeId = new Map<string, VkVideoEntry>();
  const orderedIds: string[] = [];

  // "All videos" blocks list video ids in display order.
  for (const section of resp.catalog?.sections ?? []) {
    for (const block of section.blocks ?? []) {
      if (block.data_type !== 'catalog_videos' || !Array.isArray(block.videos_ids)) continue;
      for (const id of block.videos_ids) {
        if (!orderedIds.includes(id)) orderedIds.push(id);
      }
    }
  }
  for (const v of catalogVideos) {
    const key = compositeId(v);
    if (!byCompositeId.has(key)) byCompositeId.set(key, v);
  }

  const results: VideoInfo[] = [];
  const seen = new Set<string>();
  const push = (v: VkVideoEntry) => {
    if (typeof v.id !== 'number' || typeof v.owner_id !== 'number' || !v.title) return;
    const id = compositeId(v);
    if (seen.has(id)) return;
    seen.add(id);
    const images = Array.isArray(v.image) ? v.image : [];
    const thumbnail =
      images
        .filter((i) => typeof i.url === 'string' && i.url.startsWith('http'))
        .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? '';
    results.push({
      id,
      title: v.title,
      thumbnail,
      duration: typeof v.duration === 'number' ? v.duration : 0,
      uploader: v.author?.name ?? uploaderById.get(v.owner_id) ?? '',
      view_count: typeof v.views === 'number' ? v.views : undefined,
      originalUrl:
        v.share_url && /^https?:\/\//.test(v.share_url)
          ? v.share_url
          : `https://vkvideo.ru/video${id}`,
    });
  };

  for (const id of orderedIds) {
    const v = byCompositeId.get(id);
    if (v) push(v);
    if (results.length >= limit) return results.slice(0, limit);
  }
  for (const v of catalogVideos) {
    push(v);
    if (results.length >= limit) return results.slice(0, limit);
  }
  return results;
}

async function callSearchApi(query: string, token: string): Promise<VkSearchResponse> {
  const res = await fetch(SEARCH_API, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/search?q=${encodeURIComponent(query)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      q: query,
      screen_ref: 'search_video_service',
      input_method: 'keyboard_search_button',
      access_token: token,
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`vkvideo search API failed: HTTP ${res.status}`);
  }
  return (await res.json()) as VkSearchResponse;
}

export async function searchVkvideo(query: string, limit: number): Promise<VideoInfo[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let apiError: Error | null = null;
  try {
    const token = await getAnonymToken();
    const data = await callSearchApi(trimmed, token);
    if (data.error) {
      throw new Error(
        `vkvideo search API error ${data.error.error_code}: ${data.error.error_msg ?? 'unknown'}`,
      );
    }
    const videos = parseVkvideoSearchResponse(data, limit);
    if (videos.length > 0) return videos;
    // A well-formed empty response means genuinely no results, but only if the
    // response actually carried a catalog — otherwise fall through to browser.
    if (data.response?.catalog) return videos;
    apiError = new Error('vkvideo search API returned no catalog payload');
  } catch (err) {
    apiError = err instanceof Error ? err : new Error(String(err));
  }

  // Fallback: rendered search page via the shared headless-Chrome path.
  try {
    return await searchBrowserVideos('vkvideo', trimmed, limit);
  } catch (browserErr) {
    const browserMsg = browserErr instanceof Error ? browserErr.message : String(browserErr);
    throw new Error(
      `VK video search failed. API path: ${apiError?.message ?? 'no results'}; browser fallback: ${browserMsg}`,
    );
  }
}
