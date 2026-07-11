import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

export function createYouTubeAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'youtube',
    name: 'YouTube',
    priority: 10,
    urlPatterns: ['youtube.com', 'youtu.be'],
    extraArgs: ['--force-ipv4', '--windows-filenames'],
  });
}
