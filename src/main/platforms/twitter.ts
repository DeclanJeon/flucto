import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

export function createTwitterAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'twitter',
    name: 'Twitter/X',
    priority: 10,
    urlPatterns: ['x.com', 'twitter.com'],
    referer: 'https://x.com/',
    extraArgs: [
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: en-US,en;q=0.9',
      '--add-header',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      '--add-header',
      'Accept-Encoding: gzip, deflate, br',
      '--add-header',
      'DNT: 1',
      '--add-header',
      'Connection: keep-alive',
      '--add-header',
      'Upgrade-Insecure-Requests: 1',
      '--add-header',
      'Sec-Fetch-Dest: document',
      '--add-header',
      'Sec-Fetch-Mode: navigate',
      '--add-header',
      'Sec-Fetch-Site: none',
      '--add-header',
      'Sec-Fetch-User: ?1',
      '--add-header',
      'Cache-Control: max-age=0',
      '--extractor-args',
      'twitter:api=legacy',
      '--extractor-args',
      'twitter:video=true',
    ],
  });
}
