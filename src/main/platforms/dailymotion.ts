import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

/**
 * Dailymotion (dailymotion.com and dai.ly shortlinks).
 *
 * Verified with yt-dlp 2026.08.19 (+ curl_cffi):
 * - The `dailymotion` extractor matches www.dailymotion.com/video/<id> and
 *   dai.ly/<id> and resolves both for public videos.
 * - Newer DailymotionIE performs HTTP impersonation: it requires an
 *   impersonation-capable yt-dlp binary (the standalone build bundles
 *   curl_cffi). Without one, extraction fails with
 *   "none of these impersonate targets are available: firefox" — an
 *   environment/dependency error, not a URL problem.
 */
export function createDailymotionAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'dailymotion',
    name: 'Dailymotion',
    priority: 10,
    urlPatterns: ['dailymotion.com', 'dai.ly'],
    referer: 'https://www.dailymotion.com/',
  });
}
