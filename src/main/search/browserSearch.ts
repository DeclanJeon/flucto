import { chromium } from 'playwright-core';
import type { VideoInfo } from '../../shared/types.js';
import { VIDEO_SEARCH_SITES } from '../../shared/videoSearchPlatforms.js';

export async function searchBrowserVideos(platform: 'bilibili' | 'dailymotion' | 'nicovideo' | 'ok' | 'vkvideo', query: string, limit: number): Promise<VideoInfo[]> {
  const browser = await chromium.launch({
    ...(process.env.FLUCTO_CHROME_PATH ? { executablePath: process.env.FLUCTO_CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    timeout: 15_000,
  }).catch(() => {
    throw new Error('Browser search needs locally installed Google Chrome, or FLUCTO_CHROME_PATH pointing to Chromium.');
  });
  try {
    const page = await browser.newPage();
    const site = VIDEO_SEARCH_SITES[platform];
    await page.goto(site.searchUrl(query), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const rule = { host: site.hosts[0], path: site.mediaPath };
    await page.waitForFunction(({ host, path }) => {
      const pattern = new RegExp(path);
      return Array.from(document.querySelectorAll('a')).some(anchor => {
        try { const url = new URL(anchor.href); return (url.hostname === host || url.hostname.endsWith(`.${host}`)) && pattern.test(url.pathname); }
        catch { return false; }
      }) || /no results|no videos found|nothing found|没有找到|暂无结果|検索結果がありません|ничего не найдено|видео не найдены/i.test(document.body.innerText);
    }, rule, { timeout: 15_000 }).catch(() => {
      throw new Error(`${platform} browser search did not expose results. The site may require login, human verification, or access from a supported region. Open the original search to check.`);
    });
    return await page.evaluate(({ rule, limit }) => {
      const pattern = new RegExp(rule.path);
      const videos = new Map<string, VideoInfo>();
      for (const anchor of document.querySelectorAll('a')) {
        let url: URL;
        try { url = new URL(anchor.href); } catch { continue; }
        if (url.hostname !== rule.host && !url.hostname.endsWith(`.${rule.host}`)) continue;
        const match = url.pathname.match(pattern);
        if (!match) continue;
        const title = (anchor.getAttribute('title') || anchor.textContent || anchor.querySelector('img')?.getAttribute('alt') || anchor.getAttribute('aria-label') || '').trim();
        if (!title || /^View$/i.test(title) || /^(?:[248]K)?\s*\d{1,2}:\d{2}(?::\d{2})?$/.test(title)) continue;
        const originalUrl = `${url.origin}${url.pathname}`;
        const existing = videos.get(originalUrl);
        if (existing && existing.title.length >= title.length) continue;
        const card = anchor.closest('article, [data-testid="video_card"], .video-card, .ok-video-card, .video-card-common, .video-card--small') ?? anchor.parentElement?.parentElement;
        const image = card?.querySelector('img');
        const time = card?.textContent?.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?:\s|$)/)?.[1];
        const duration = time ? time.split(':').reduce((total, part) => total * 60 + Number(part), 0) : 0;
        videos.set(originalUrl, {
          id: match[1], title, originalUrl, duration, uploader: '',
          thumbnail: image?.getAttribute('src') || image?.getAttribute('data-src') || existing?.thumbnail || '',
        });
      }
      return Array.from(videos.values()).slice(0, limit);
    }, { rule, limit });
  } finally {
    await browser.close();
  }
}
