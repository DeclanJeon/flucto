import type { PlatformAdapter } from './types.js';
import { createYtDlpAdapter } from './yt-dlp-adapter.js';

/**
 * VK Video adapter — yt-dlp's VKIE handles vkvideo.ru/video<oid>_<id>,
 * vk.com/video<oid>_<id> (and ?z= links), clips, playlists and daxab
 * embeds. Referer matters: VK serves player metadata based on it.
 */
export function createVkvideoAdapter(): PlatformAdapter {
  return createYtDlpAdapter({
    id: 'vkvideo',
    name: 'VK Video',
    priority: 10,
    urlPatterns: [
      'vkvideo.ru',
      'vkvideo.com',
      'vk.com/video',
      'vk.com/clip',
      'vk.com/playlist',
      'vk.ru/video',
      'm.vkvideo.ru',
      'new.vkvideo.ru',
      'daxab.com',
    ],
    referer: 'https://vkvideo.ru/',
    extraArgs: [
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: en-US,en;q=0.9,ru;q=0.8',
    ],
  });
}
