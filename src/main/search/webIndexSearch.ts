import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { VideoInfo, VideoSearchPlatform, VideoSearchProviderResult } from '../../shared/types.js';
import { VIDEO_SEARCH_SITES } from '../../shared/videoSearchPlatforms.js';

// Public video index (Google video vertical: tbm=vid, Google itself serves
// udm=vids). Used by platforms whose native keyword search needs a login
// (X, Instagram, TikTok, and intermittently Threads) and as the fallback for
// native providers. Queries run anonymously in a shared temporary headless
// Chrome; every query gets an isolated context and the browser closes when
// no query is active.

const NAV_TIMEOUT_MS = 20_000;
const WAIT_TIMEOUT_MS = 15_000;
const LAUNCH_TIMEOUT_MS = 15_000;
const MAX_LIMIT = 50;
const MAX_PARALLEL_PAGES = 2;

export interface IndexPageCandidate {
  href: string;
  title: string;
  cardText: string;
  thumb: string;
  hasVideo?: boolean;
  duration?: number;
}

export interface IndexPageRun {
  pageUrl: string;
  /** 'results' | 'none' | 'challenge' | 'timeout' (scraper verdict). */
  state: string;
  /** The index page itself rendered, even if nothing matched the site. */
  servedPage?: boolean;
  candidates: IndexPageCandidate[];
}

export interface IndexEngine {
  name: string;
  url: string;
  kind: 'google' | 'bing' | 'ddg';
}

export interface WebIndexDeps {
  runPage?: (url: string) => Promise<IndexPageRun>;
}

export class WebIndexSearchError extends Error {
  nativeError?: string;

  constructor(message: string, readonly searchUrl: string) {
    super(message);
    this.name = 'WebIndexSearchError';
  }
}

let browserPromise: Promise<Browser> | null = null;
let activePages = 0;
const waiters: Array<() => void> = [];

function acquirePageSlot(): Promise<void> | void {
  if (activePages < MAX_PARALLEL_PAGES) {
    activePages += 1;
    return;
  }
  return new Promise<void>(resolve => {
    waiters.push(resolve);
  });
}

function releasePageSlot(): void {
  const waiting = waiters.shift();
  if (waiting) waiting();
  else activePages -= 1;
}

/** Runs `fn` with one isolated anonymous page on the shared temp browser. */
export async function withAnonymousPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  await acquirePageSlot();
  let context: BrowserContext | null = null;
  try {
    if (!browserPromise) {
      browserPromise = chromium.launch({
        ...(process.env.FLUCTO_CHROME_PATH ? { executablePath: process.env.FLUCTO_CHROME_PATH } : { channel: 'chrome' }),
        headless: true,
        timeout: LAUNCH_TIMEOUT_MS,
      }).catch(() => {
        throw new Error('Indexed video search needs locally installed Google Chrome, or FLUCTO_CHROME_PATH pointing to Chromium.');
      });
    }
    const browser = await browserPromise;
    context = await browser.newContext();
    // Thumbnails resolve via the img src attribute; the bytes are never needed.
    await context.route('**/*', route => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'media') route.abort().catch(() => {});
      else route.continue().catch(() => {});
    });
    const page = await context.newPage();
    return await fn(page);
  } finally {
    if (context) await context.close().catch(() => {});
    releasePageSlot();
    if (activePages === 0 && waiters.length === 0 && browserPromise) {
      const closing = browserPromise;
      browserPromise = null;
      await closing.then(b => b.close(), () => {});
    }
  }
}

export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^(?:www|m)\./, '');
}

export function hostMatches(hostname: string, hosts: string[]): boolean {
  const normalized = normalizeHost(hostname);
  return hosts.some(host => normalized === host || normalized.endsWith(`.${host}`));
}

function unwrapIndexLink(rawHref: string): URL | null {
  let url: URL;
  try { url = new URL(rawHref); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (hostMatches(url.hostname, ['google.com']) && url.pathname === '/url') {
    const target = url.searchParams.get('q') ?? url.searchParams.get('url');
    if (!target) return null;
    try { url = new URL(target); } catch { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  }
  return url;
}

/** Canonicalizes one candidate link; null when it is not media on the site. */
export function canonicalMediaLink(platform: VideoSearchPlatform, rawHref: string): { id: string; canonicalUrl: string } | null {
  const site = VIDEO_SEARCH_SITES[platform];
  let url = unwrapIndexLink(rawHref);
  if (!url || !hostMatches(url.hostname, site.hosts)) return null;

  // youtu.be/<id> is the same video as youtube.com/watch?v=<id>.
  if (platform === 'youtube' && normalizeHost(url.hostname) === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    if (!id) return null;
    url = new URL(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`);
  }

  const match = url.pathname.match(new RegExp(site.mediaPath));
  if (!match) return null;
  // First defined capture group is the media id; YouTube's /watch branch has
  // none, so its id comes from the v parameter instead.
  const id = match.slice(1).find(group => group !== undefined) ?? url.searchParams.get('v');
  if (!id) return null;

  // match[0] ends at the id, so trailing tracking segments (Threads
  // /video-<slug>, /media, analytics params) are dropped automatically.
  // YouTube /watch ids live in ?v= and must be reattached; /shorts and /live
  // ids are already inside match[0].
  const canonicalUrl = platform === 'youtube' && url.pathname === '/watch'
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
    : `${url.origin}${match[0]}`;
  return { id, canonicalUrl };
}

export function parseIndexDuration(cardText: string): number {
  const match = cardText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (!match) return 0;
  return match[1].split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

export function cleanIndexTitle(title: string): string {
  const cleaned = title.replace(/\s+/g, ' ').trim();
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return '';
  if (/^(?:[248]K\s*)?\d{1,2}:\d{2}(?::\d{2})?$/.test(cleaned)) return '';
  if (/^(?:view|play|watch)$/i.test(cleaned)) return '';
  return cleaned;
}

// Serialized into page.evaluate; keep it free of Node-side references.
export function collectPageLinks(rawHosts: string[]): IndexPageCandidate[] {
  const normalize = (hostname: string) => hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  const inScope = (hostname: string) => {
    const normalized = normalize(hostname);
    return rawHosts.some(host => normalized === host || normalized.endsWith(`.${host}`));
  };
  const candidates: IndexPageCandidate[] = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    let url: URL;
    try { url = new URL(anchor.getAttribute('href') ?? '', location.href); } catch { continue; }
    let host = url.hostname;
    if (inScope(host) === false && url.pathname === '/url') {
      const target = url.searchParams.get('q') ?? url.searchParams.get('url');
      if (target) {
        try { host = new URL(target).hostname; } catch { continue; }
      }
    }
    if (!inScope(host)) continue;
    const href = url.href;
    if (seen.has(href)) continue;
    seen.add(href);
    let card: Element = anchor;
    for (let depth = 0; depth < 4 && card.parentElement; depth += 1) {
      const parent = card.parentElement;
      if (parent.querySelector('img') || /\b\d{1,2}:\d{2}\b/.test(parent.textContent ?? '')) card = parent;
      else break;
    }
    const img = card.querySelector('img');
    const thumb = (img?.getAttribute('src') ?? img?.getAttribute('data-src') ?? '').trim();
    const title = (
      anchor.getAttribute('aria-label')
      ?? anchor.getAttribute('title')
      ?? anchor.querySelector('h3')?.textContent
      ?? anchor.textContent
      ?? ''
    ).replace(/\s+/g, ' ').trim();
    candidates.push({
      href, title, thumb,
      cardText: (card.textContent ?? '').replace(/\s+/g, ' ').trim(),
      hasVideo: card.querySelector('video') !== null,
    });
  }
  return candidates;
}

// Serialized into page.evaluate; keep it free of Node-side references. Bing
// links can open an internal viewer; mmeta retains the original media URL.
function collectBingLinks(): IndexPageCandidate[] {
  const candidates: IndexPageCandidate[] = [];
  const seen = new Set<string>();
  for (const card of Array.from(document.querySelectorAll('.mc_vtvc'))) {
    const anchor = card.querySelector('a.mc_vtvc_link');
    let href = anchor?.getAttribute('href') ?? '';
    let meta: { murl?: string; pgurl?: string; turl?: string } = {};
    try { meta = JSON.parse(card.getAttribute('mmeta') ?? '{}'); } catch { /* fall back to the anchor */ }
    if (!href || href.startsWith('/') || href.startsWith('https://www.bing.com/')) {
      href = meta.murl ?? meta.pgurl ?? href;
    }
    let url: URL;
    try { url = new URL(href, location.href); } catch { continue; }
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const img = card.querySelector('img');
    const thumb = (img?.getAttribute('src') ?? img?.getAttribute('data-src') ?? meta.turl ?? '').trim();
    const title = (
      card.querySelector('.mc_vtvc_title')?.getAttribute('title')
      ?? anchor?.getAttribute('aria-label')
      ?? anchor?.textContent
      ?? ''
    ).replace(/\s+/g, ' ').trim();
    candidates.push({
      href: url.href, title, thumb,
      cardText: (card.textContent ?? '').replace(/\s+/g, ' ').trim(),
      hasVideo: true,
    });
  }
  return candidates;
}

interface DdgVideoItem {
  content?: string;
  title?: string;
  duration?: string;
  images?: { medium?: string; large?: string };
  uploader?: string;
}

// Serialized into page.evaluate; keep it free of Node-side references. DDG's
// own frontend calls /v.js for the video tab after reading the vqd token off
// the search page; the same anonymous request works from page context.
async function fetchDdgVideos(query: string): Promise<DdgVideoItem[]> {
  const html = document.documentElement.innerHTML;
  const vqd = html.match(/vqd=['"]([\d-]+)['"]/)?.[1] ?? html.match(/vqd=([\d-]+)&/)?.[1];
  if (!vqd) throw new Error('ddg-no-vqd');
  const res = await fetch(
    `https://duckduckgo.com/v.js?l=wt-wt&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`ddg-http-${res.status}`);
  const data = await res.json() as { results?: DdgVideoItem[] };
  if (!Array.isArray(data.results)) throw new Error('DuckDuckGo video search returned an unexpected response.');
  return data.results;
}

async function scrapeIndexPage(engine: IndexEngine, site: { hosts: string[] }, scopedQuery: string): Promise<IndexPageRun> {
  return withAnonymousPage(async page => {
    await page.goto(engine.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    if (engine.kind === 'ddg') {
      // The DDG web page renders without a challenge; its video endpoint either
      // returns items or an empty list (sparse video index, not a failure).
      const settled = await page.waitForSelector('body', { timeout: NAV_TIMEOUT_MS }).then(() => true).catch(() => false);
      if (!settled) return { pageUrl: page.url(), state: 'timeout', servedPage: false, candidates: [] };
      const items = await page.evaluate(fetchDdgVideos, scopedQuery);
      const candidates: IndexPageCandidate[] = items.map(item => ({
        href: item.content ?? '',
        title: item.title ?? '',
        cardText: `${item.title ?? ''} ${item.duration ?? ''}`,
        thumb: item.images?.large ?? item.images?.medium ?? '',
        hasVideo: true,
      }));
      return { pageUrl: page.url(), state: candidates.length ? 'results' : 'none', servedPage: true, candidates };
    }
    const state = await page.waitForFunction(({ hosts, kind }) => {
      const normalize = (hostname: string) => hostname.toLowerCase().replace(/^(?:www|m)\./, '');
      const inScope = (hostname: string) => {
        const normalized = normalize(hostname);
        return hosts.some(host => normalized === host || normalized.endsWith(`.${host}`));
      };
      const bodyText = document.body?.innerText ?? '';
      if (/\/sorry\//.test(location.pathname) || /unusual traffic|not a robot|automated requests|verify you are human|자동화된 요청|비정상적인 트래픽/i.test(bodyText.slice(0, 3000))) return 'challenge';
      if (kind === 'bing') {
        if (document.querySelector('.mc_vtvc a.mc_vtvc_link[href]')) return 'results';
      } else {
        for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
          try {
            const link = new URL(anchor.getAttribute('href') ?? '', location.href);
            if (inScope(link.hostname)) return 'results';
            if (link.pathname === '/url') {
              const target = link.searchParams.get('q') ?? link.searchParams.get('url');
              if (target && inScope(new URL(target).hostname)) return 'results';
            }
          } catch { /* keep polling other anchors */ }
        }
      }
      if (/did not match any (?:videos|documents)|no results found|there are no results for|try different keywords|검색결과가 없습니다|결과가 없습니다/i.test(bodyText)) return 'none';
      return false;
    }, { hosts: site.hosts, kind: engine.kind }, { timeout: WAIT_TIMEOUT_MS, polling: 500 })
      .then(handle => handle.jsonValue())
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
        throw error;
      });
    const candidates = state === 'results'
      ? await (engine.kind === 'bing' ? page.evaluate(collectBingLinks) : page.evaluate(collectPageLinks, site.hosts))
      : [];
    return { pageUrl: page.url(), state: String(state), servedPage: state === 'results' || state === 'none', candidates };
  });
}

export function videosFromIndexCandidates(platform: VideoSearchPlatform, candidates: IndexPageCandidate[], limit: number): VideoInfo[] {
  const videos = new Map<string, VideoInfo>();
  const titleScore = new Map<string, number>();
  for (const candidate of candidates) {
    const link = canonicalMediaLink(platform, candidate.href);
    if (!link) continue;
    const title = cleanIndexTitle(candidate.title);
    const key = `${platform}:${link.id}`;
    const score = title.length + (candidate.thumb ? 1000 : 0);
    if (videos.has(key) && (titleScore.get(key) ?? -1) >= score) continue;
    titleScore.set(key, score);
    const firstSegment = link.canonicalUrl.replace(/^https?:\/\/[^/]+\//, '').split('/')[0];
    videos.set(key, {
      id: link.id,
      title,
      thumbnail: candidate.thumb.startsWith('http') ? candidate.thumb : '',
      duration: parseIndexDuration(candidate.cardText),
      uploader: firstSegment.startsWith('@') ? firstSegment : '',
      originalUrl: link.canonicalUrl,
    });
  }
  return Array.from(videos.values()).slice(0, Math.max(1, Math.min(limit, MAX_LIMIT)));
}

export async function searchWebIndex(platform: VideoSearchPlatform, query: string, limit: number, deps: WebIndexDeps = {}): Promise<VideoSearchProviderResult> {
  const site = VIDEO_SEARCH_SITES[platform];
  const trimmed = query.trim();
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_LIMIT));
  const scoped = site.hosts.map(host => `site:${host}`).join(' OR ');
  const scopedQuery = `${site.hosts.length > 1 ? `(${scoped})` : scoped} ${trimmed}`;
  // Google is the primary index; DuckDuckGo's video endpoint and Bing Videos
  // are legitimate fallbacks when Google challenges or is unreachable. All are
  // queried anonymously. Bing ignores `site:` OR-chains and DDG handles them
  // inconsistently, so non-Google engines search the primary host only.
  const engines: IndexEngine[] = [
    { name: 'Google', kind: 'google', url: `https://www.google.com/search?q=${encodeURIComponent(scopedQuery)}&tbm=vid` },
    { name: 'DuckDuckGo', kind: 'ddg', url: `https://duckduckgo.com/?q=${encodeURIComponent(`site:${site.hosts[0]} ${trimmed}`)}&ia=videos` },
    { name: 'Bing', kind: 'bing', url: `https://www.bing.com/videos/search?q=${encodeURIComponent(`site:${site.hosts[0]} ${trimmed}`)}` },
  ];
  if (!trimmed) return { videos: [], method: 'web-index', searchUrl: engines[0].url };

  const failures: string[] = [];
  let servedUrl: string | undefined;
  for (const engine of engines) {
    let run: IndexPageRun;
    try {
      run = deps.runPage ? await deps.runPage(engine.url) : await scrapeIndexPage(engine, site, `site:${site.hosts[0]} ${trimmed}`);
    } catch (error: unknown) {
      failures.push(`${engine.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (run.state === 'none' && run.servedPage) servedUrl = engine.url;
    if (run.state === 'results') {
      const videos = videosFromIndexCandidates(platform, run.candidates, boundedLimit);
      if (videos.length > 0) {
        return { videos, method: 'web-index', searchUrl: engine.url };
      }
      // The engine served cards but none resolved to this site's media URLs
      // (e.g. Bing ignoring the site: scope) — try the next index.
      failures.push(`${engine.name}: results served but none scoped to ${site.name}`);
      continue;
    }
    if (run.state === 'none') {
      failures.push(`${engine.name}: page served but no scoped results`);
      continue;
    }
    failures.push(run.state === 'challenge' || /\/sorry\//.test(run.pageUrl)
      ? `${engine.name}: human-verification page`
      : `${engine.name}: page state ${run.state} (${run.pageUrl || 'no url'})`);
  }
  if (servedUrl) {
    return { videos: [], method: 'web-index', searchUrl: servedUrl };
  }
  throw new WebIndexSearchError(`Public video indexes could not serve ${site.name} results (${failures.join(' | ')}).`, engines[0].url);
}
