import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

export function createBilibiliAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'bilibili',
    name: 'Bilibili',
    priority: 10,
    urlPatterns: ['bilibili.com'],
    referer: 'https://www.bilibili.com/',
    extraArgs: [
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
      '--add-header',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      '--add-header',
      'Referer: https://www.bilibili.com/',
      '--add-header',
      'Origin: https://www.bilibili.com',
      '--add-header',
      'Sec-Fetch-Dest: document',
      '--add-header',
      'Sec-Fetch-Mode: navigate',
      '--add-header',
      'Sec-Fetch-Site: same-origin',
      '--extractor-args',
      'bilibili:session_data=',
      '--extractor-args',
      'bilibili:quality=116',
    ],
  });
}
