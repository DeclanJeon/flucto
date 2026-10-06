import type { VideoInfo, VideoSearchProviderResult } from '../../shared/types.js';
import { VIDEO_SEARCH_SITES } from '../../shared/videoSearchPlatforms.js';
import {
  canonicalMediaLink,
  cleanIndexTitle,
  searchWebIndex,
  withAnonymousPage,
  WebIndexSearchError,
} from './webIndexSearch.js';
import type { IndexPageCandidate, IndexPageRun, WebIndexDeps } from './webIndexSearch.js';

// Anonymous native-search boundaries, verified with live probes (headless
// Chrome + plain HTTP): X redirects to the login onboarding flow, Instagram to
// /accounts/login/, and TikTok renders a server-error page demanding login.
// Threads anonymous search is inconsistent — it served real results in some
// sessions and a login-only wall in others — so it tries native first and
// falls back to the public video index.

export type SocialSearchPlatform = 'twitter' | 'instagram' | 'threads' | 'tiktok';

const NAV_TIMEOUT_MS = 20_000;
const WAIT_TIMEOUT_MS = 15_000;
const MAX_LIMIT = 50;

const NATIVE_SEARCH_BOUNDARY: Record<Exclude<SocialSearchPlatform, 'threads'>, string> = {
  twitter: 'X keyword search redirects anonymous sessions to the login onboarding page',
  instagram: 'Instagram keyword search redirects anonymous sessions to /accounts/login/',
  tiktok: 'TikTok video search answers anonymous sessions with a server-error page that requires login',
};

// Serialized into page.evaluate; keep it free of Node-side references.
function readThreadsSearchPage({ hosts, mediaPath }: { hosts: string[]; mediaPath: string }): IndexPageCandidate[] | 'none' | false {
  const pattern = new RegExp(mediaPath);
  const candidates: IndexPageCandidate[] = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    let url: URL;
    try { url = new URL(anchor.getAttribute('href') ?? '', location.href); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
    if (!hosts.some(h => host === h || host.endsWith(`.${h}`)) || !pattern.test(url.pathname) || /\/media\/?$/.test(url.pathname)) continue;
    const card = anchor.closest('[data-pressable-container="true"]');
    const video = card?.querySelector('video');
    if (!card || !video || seen.has(url.href)) continue;
    seen.add(url.href);
    const title = Array.from(card.querySelectorAll('[dir="auto"]'))
      .filter(element => !element.contains(anchor) && !element.closest('a, button, [role="button"]') && !element.querySelector('[dir="auto"]'))
      .map(element => element.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    candidates.push({
      href: url.href, title, cardText: title, thumb: video.poster, hasVideo: true,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
    });
  }
  if (candidates.length) return candidates;
  if (/no results|결과 없음|검색 결과가 없습니다|일치하는 결과가 없습니다/i.test(document.body?.innerText ?? '')) return 'none';
  return false;
}

async function scrapeSearchPage(url: string, site: { hosts: string[]; mediaPath: string }): Promise<IndexPageRun> {
  return withAnonymousPage(async page => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const result = await page.waitForFunction(
      readThreadsSearchPage,
      { hosts: site.hosts, mediaPath: site.mediaPath },
      { timeout: WAIT_TIMEOUT_MS, polling: 500 },
    )
      .then(handle => handle.jsonValue())
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
        throw error;
      });
    return {
      pageUrl: page.url(),
      state: Array.isArray(result) ? 'results' : String(result),
      candidates: Array.isArray(result) ? result : [],
    };
  });
}

function threadsVideoPosts(candidates: IndexPageCandidate[], limit: number): VideoInfo[] {
  const videos = new Map<string, VideoInfo>();
  for (const candidate of candidates) {
    if (/\/media\/?$/.test(candidate.href)) continue;
    const link = canonicalMediaLink('threads', candidate.href);
    if (!link || videos.has(link.id)) continue;
    if (!candidate.hasVideo) continue;
    const uploader = link.canonicalUrl.match(/^https?:\/\/[^/]+\/(@[^/]+)/)?.[1] ?? '';
    videos.set(link.id, {
      id: link.id,
      title: cleanIndexTitle(candidate.title) || (uploader ? `Post by ${uploader}` : 'Threads video'),
      thumbnail: candidate.thumb.startsWith('http') ? candidate.thumb : '',
      duration: candidate.duration ?? 0,
      uploader,
      originalUrl: link.canonicalUrl,
    });
    if (videos.size >= limit) break;
  }
  return Array.from(videos.values());
}

async function searchThreadsNative(query: string, limit: number, deps: WebIndexDeps): Promise<VideoInfo[]> {
  const site = VIDEO_SEARCH_SITES.threads;
  const run = deps.runPage
    ? await deps.runPage(site.searchUrl(query))
    : await scrapeSearchPage(site.searchUrl(query), site);
  if (run.state !== 'results') {
    throw new Error(run.state === 'none'
      ? 'Threads anonymous search reported no results'
      : 'Threads anonymous search did not render results (login wall or session-dependent block)');
  }
  const videos = threadsVideoPosts(run.candidates, limit);
  if (videos.length === 0) {
    throw new Error('Threads anonymous search returned no video-bearing posts');
  }
  return videos;
}

export async function searchSocialVideos(platform: SocialSearchPlatform, query: string, limit: number, deps: WebIndexDeps = {}): Promise<VideoSearchProviderResult> {
  const site = VIDEO_SEARCH_SITES[platform];
  const trimmed = query.trim();
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_LIMIT));

  let nativeError: string | undefined;
  if (platform === 'threads') {
    if (trimmed) {
      try {
        const videos = await searchThreadsNative(trimmed, boundedLimit, deps);
        return { videos, method: 'native', searchUrl: site.searchUrl(trimmed) };
      } catch (error: unknown) {
        nativeError = error instanceof Error ? error.message : String(error);
      }
    }
  } else if (trimmed) {
    nativeError = NATIVE_SEARCH_BOUNDARY[platform];
  }

  try {
    const result = await searchWebIndex(platform, trimmed, boundedLimit, deps);
    return { ...result, nativeError };
  } catch (error: unknown) {
    if (error instanceof WebIndexSearchError) error.nativeError = nativeError;
    throw error;
  }
}
