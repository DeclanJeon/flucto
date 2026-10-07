import type { VideoInfo, VideoSearchPlatform, VideoSearchProviderResult } from '../../shared/types.js';
import { VIDEO_SEARCH_SITES } from '../../shared/videoSearchPlatforms.js';
import { searchWebIndex } from './webIndexSearch.js';

// Reddit keyword search over the public listing endpoint, filtered down to
// posts that actually contain a playable video (hosted reddit video, embed
// video, or a link to another supported video site). Text/image posts and
// off-site articles are omitted even though the API returns them for
// type=link. When the endpoint rejects anonymous access (403 blocks are
// common from datacenter networks) the shared Google video index fallback
// keeps the search usable.

const SEARCH_API = 'https://www.reddit.com/search.json';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 25; // fixed by the upstream API
const MAX_PAGES = 4;
const MAX_LIMIT = 50;
const USER_AGENT = 'flucto-video-search/1.0 (https://www.reddit.com)';

interface RedditPost {
  id?: string;
  name?: string;
  title?: string;
  permalink?: string;
  url?: string;
  url_overridden_by_dest?: string;
  author?: string;
  is_self?: boolean;
  is_video?: boolean;
  post_hint?: string;
  score?: number;
  ups?: number;
  thumbnail?: string;
  media?: { reddit_video?: { duration?: number } } | null;
  secure_media?: { reddit_video?: { duration?: number } } | null;
  is_gallery?: boolean;
}

interface RedditListingResponse {
  kind?: string;
  data?: {
    children?: { kind?: string; data?: RedditPost }[];
    after?: string | null;
  };
}

const getRedditSearchUrl = VIDEO_SEARCH_SITES.reddit.searchUrl;

/**
 * True when the post links to another registered video site (YouTube, Vimeo,
 * TikTok, ...) or a direct reddit video host. Reddit itself is excluded here —
 * reddit-hosted posts are recognized by their native video flags instead, so
 * plain text/image links to reddit threads do not slip through.
 */
function linksToSupportedVideoSite(post: RedditPost): boolean {
  const external = typeof post.url_overridden_by_dest === 'string'
    ? post.url_overridden_by_dest
    : typeof post.url === 'string' ? post.url : '';
  if (!external) return false;
  let url: URL;
  try {
    url = new URL(external);
  } catch {
    return false;
  }
  if (url.hostname === 'v.redd.it') return true;
  for (const [platform, site] of Object.entries(VIDEO_SEARCH_SITES) as [VideoSearchPlatform, (typeof VIDEO_SEARCH_SITES)[VideoSearchPlatform]][]) {
    if (platform === 'reddit') continue;
    const onHost = site.hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    if (!onHost) continue;
    if (platform === 'youtube' && url.hostname === 'youtu.be') return /^\/[A-Za-z0-9_-]{6,}/.test(url.pathname);
    if (new RegExp(site.mediaPath).test(url.pathname)) return true;
  }
  return false;
}

/** Posts must carry actual video content; bare links, images and galleries are out. */
function isVideoPost(post: RedditPost): boolean {
  if (!post || typeof post !== 'object') return false;
  if (post.is_self || post.is_gallery) return false;
  if (post.is_video === true || post.post_hint === 'hosted:video' || post.post_hint === 'rich:video') return true;
  if (post.secure_media?.reddit_video || post.media?.reddit_video) return true;
  return linksToSupportedVideoSite(post);
}

function mapRedditPost(post: RedditPost): VideoInfo | null {
  if (!isVideoPost(post)) return null;
  const id = typeof post.id === 'string' && post.id.trim()
    ? post.id.trim()
    : typeof post.name === 'string' && post.name.startsWith('t3_') ? post.name.slice(3) : '';
  if (!id) return null;
  const permalink = typeof post.permalink === 'string' && post.permalink.startsWith('/r/')
    ? `https://www.reddit.com${post.permalink}`
    : '';
  if (!permalink) return null;
  const duration = post.secure_media?.reddit_video?.duration ?? post.media?.reddit_video?.duration;
  const thumbnail = typeof post.thumbnail === 'string' && /^https?:\/\//.test(post.thumbnail)
    ? post.thumbnail
    : '';
  return {
    id,
    title: typeof post.title === 'string' && post.title.trim() ? post.title.trim() : id,
    thumbnail,
    duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : 0,
    uploader: typeof post.author === 'string' && post.author ? post.author : 'unknown',
    view_count: typeof post.score === 'number' ? post.score : typeof post.ups === 'number' ? post.ups : undefined,
    originalUrl: permalink,
  };
}

async function fetchListingPage(query: string, after: string | null): Promise<RedditListingResponse> {
  const params = new URLSearchParams({
    q: query,
    type: 'link',
    sort: 'relevance',
    t: 'all',
    limit: String(PAGE_SIZE),
    raw_json: '1',
    include_over_18: 'off',
  });
  if (after) params.set('after', after);

  let response: Response;
  try {
    response = await fetch(`${SEARCH_API}?${params.toString()}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`reddit search request failed (${reason}). Original search: ${getRedditSearchUrl(query)}`);
  }

  if (!response.ok) {
    throw new Error(`reddit search API rejected the request (HTTP ${response.status}). Anonymous reddit search is blocked on this network or temporarily rate-limited. Original search: ${getRedditSearchUrl(query)}`);
  }

  let body: RedditListingResponse;
  try {
    body = (await response.json()) as RedditListingResponse;
  } catch {
    throw new Error(`reddit search returned a non-JSON response (HTTP ${response.status}). Original search: ${getRedditSearchUrl(query)}`);
  }

  if (body?.kind !== 'Listing' || !Array.isArray(body.data?.children)) {
    throw new Error('reddit search returned an unexpected response.');
  }
  return body;
}

async function searchRedditNative(query: string, limit: number): Promise<VideoInfo[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const effectiveLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_LIMIT));

  const videos: VideoInfo[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES && videos.length < effectiveLimit; page += 1) {
    const body = await fetchListingPage(trimmed, after);
    for (const child of body.data?.children ?? []) {
      const video = mapRedditPost(child?.data ?? {});
      if (video && !seen.has(video.id)) {
        seen.add(video.id);
        videos.push(video);
      }
    }
    after = body.data?.after ?? null;
    if (!after) break;
  }
  return videos.slice(0, effectiveLimit);
}

export async function searchReddit(query: string, limit: number): Promise<VideoSearchProviderResult> {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  const searchUrl = getRedditSearchUrl(trimmed);
  if (!trimmed) return { videos: [], method: 'native', searchUrl };
  const effectiveLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_LIMIT));
  try {
    const videos = await searchRedditNative(trimmed, effectiveLimit);
    return { videos, method: 'native', searchUrl };
  } catch (error: unknown) {
    const nativeError = error instanceof Error ? error.message : String(error);
    try {
      const fallback = await searchWebIndex('reddit', trimmed, effectiveLimit);
      return { ...fallback, nativeError };
    } catch (fallbackError: unknown) {
      const reason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`${nativeError} Web-index fallback also failed: ${reason}`);
    }
  }
}
