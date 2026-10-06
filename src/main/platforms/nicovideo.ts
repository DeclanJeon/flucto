import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

/**
 * Niconico (nicovideo.jp / nico.ms shortlinks).
 *
 * Verified with yt-dlp 2026.08.19:
 * - `niconico` extractor resolves both www.nicovideo.jp/watch/<id> and
 *   nico.ms/<id> URLs without credentials for public videos.
 * - Full metadata + HLS (delivery.domand.nicovideo.jp) download confirmed
 *   anonymously; member-only / premium / channel videos still require
 *   cookies (--cookies or --cookies-from-browser) and will surface the
 *   upstream auth error.
 */
export function createNicovideoAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'nicovideo',
    name: 'Niconico',
    priority: 10,
    urlPatterns: ['nicovideo.jp', 'nico.ms'],
    referer: 'https://www.nicovideo.jp/',
  });
}
