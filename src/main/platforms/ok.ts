import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

/**
 * OK.ru (Odnoklassniki) adapter — yt-dlp's OdnoklassnikiIE handles
 * ok.ru/video/<id>, ok.ru/videoembed/<id>, ok.ru/live/<id> and
 * odnoklassniki.ru aliases.
 */
export function createOkAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'ok',
    name: 'Odnoklassniki (OK.ru)',
    priority: 10,
    urlPatterns: ['ok.ru', 'odnoklassniki.ru'],
    referer: 'https://ok.ru/',
    extraArgs: [
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: en-US,en;q=0.9,ru;q=0.8',
    ],
  });
}
