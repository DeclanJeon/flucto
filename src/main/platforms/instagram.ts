import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

export function createInstagramAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'instagram',
    name: 'Instagram',
    priority: 10,
    urlPatterns: ['instagram.com'],
    extraArgs: [
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: en-US,en;q=0.9',
    ],
  });
}
