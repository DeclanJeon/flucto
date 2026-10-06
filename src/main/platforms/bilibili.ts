import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

/**
 * Bilibili (bilibili.com and b23.tv shortlinks).
 *
 * Verified with yt-dlp 2026.08.19:
 * - b23.tv/<code> 302-redirects to www.bilibili.com/video/<bvid> and is
 *   resolved by the BiliBili extractor, so `urlPatterns` covers 'b23.tv'.
 * - The previous `--extractor-args bilibili:session_data=` and
 *   `bilibili:quality=116` were bogus: the only supported bilibili extractor
 *   arg is `prefer_multi_flv` (BiliBiliBaseIE), and unknown args are ignored
 *   silently — they are dropped here rather than left as dead config.
 * - Anonymous extraction works for public videos (verified -J on a live BV
 *   id); high-quality streams above ~360p/1080p, bangumi and premium
 *   content need logged-in cookies and surface the upstream auth error.
 */
export function createBilibiliAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'bilibili',
    name: 'Bilibili',
    priority: 10,
    urlPatterns: ['bilibili.com', 'b23.tv'],
    referer: 'https://www.bilibili.com/',
    extraArgs: [
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
      '--add-header',
      'Referer: https://www.bilibili.com/',
    ],
  });
}
