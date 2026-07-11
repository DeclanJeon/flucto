import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

export function createVimeoAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'vimeo',
    name: 'Vimeo',
    priority: 10,
    urlPatterns: ['vimeo.com'],
  });
}
