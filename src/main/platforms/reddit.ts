import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

export function createRedditAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'reddit',
    name: 'Reddit',
    priority: 10,
    urlPatterns: ['reddit.com'],
    referer: 'https://www.reddit.com/',
    extraArgs: [
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: en-US,en;q=0.9',
      '--add-header',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      '--extractor-args',
      'reddit:client_id=download_client',
      '--extractor-args',
      'reddit:client_secret=',
      '--ignore-errors',
      '--extractor-args',
      'reddit:username=',
    ],
  });
}
