import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

export function createTikTokAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'tiktok',
    name: 'TikTok',
    priority: 10,
    urlPatterns: ['tiktok.com', 'vm.tiktok.com'],
    referer: 'https://www.tiktok.com/',
    extraArgs: [
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
  });
}
