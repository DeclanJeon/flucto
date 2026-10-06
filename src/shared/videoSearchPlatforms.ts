import type { VideoSearchPlatform } from './types.js';

export const VIDEO_SEARCH_SITES: Record<VideoSearchPlatform, {
  name: string;
  hosts: string[];
  mediaPath: string;
  searchUrl: (query: string) => string;
}> = {
  youtube: { name: 'YouTube', hosts: ['youtube.com', 'youtu.be'], mediaPath: '^/(?:watch$|(?:shorts|live)/([A-Za-z0-9_-]+))', searchUrl: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  twitter: { name: 'X / Twitter', hosts: ['x.com', 'twitter.com'], mediaPath: '^/[^/]+/status/([0-9]+)', searchUrl: q => `https://x.com/search?q=${encodeURIComponent(q)}&f=video` },
  instagram: { name: 'Instagram', hosts: ['instagram.com'], mediaPath: '^/(?:reel|reels|p)/([A-Za-z0-9_-]+)', searchUrl: q => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}` },
  reddit: { name: 'Reddit', hosts: ['reddit.com'], mediaPath: '^/r/[^/]+/comments/([A-Za-z0-9]+)', searchUrl: q => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}&type=media` },
  bilibili: { name: 'Bilibili', hosts: ['bilibili.com'], mediaPath: '^/video/(BV[0-9A-Za-z]+|av[0-9]+)', searchUrl: q => `https://search.bilibili.com/video?keyword=${encodeURIComponent(q)}` },
  dailymotion: { name: 'Dailymotion', hosts: ['dailymotion.com'], mediaPath: '^/video/([0-9A-Za-z]+)', searchUrl: q => `https://www.dailymotion.com/search/${encodeURIComponent(q)}/videos` },
  nicovideo: { name: 'Niconico', hosts: ['nicovideo.jp'], mediaPath: '^/watch/((?:sm|so|nm)?[0-9]+)', searchUrl: q => `https://www.nicovideo.jp/search/${encodeURIComponent(q)}` },
  ok: { name: 'OK.ru', hosts: ['ok.ru'], mediaPath: '^/video/([0-9]+)', searchUrl: q => `https://ok.ru/video/search?st.cmd=anonymVideo&st.ft=search&st.gsq=${encodeURIComponent(q)}&st.m=SEARCH` },
  vkvideo: { name: 'VK Video', hosts: ['vkvideo.ru', 'vk.com'], mediaPath: '^/video(-?[0-9]+_[0-9]+)', searchUrl: q => `https://vkvideo.ru/?q=${encodeURIComponent(q)}` },
  threads: { name: 'Threads', hosts: ['threads.com', 'threads.net'], mediaPath: '^/@[^/]+/(?:post|tv)/([A-Za-z0-9_-]+)', searchUrl: q => `https://www.threads.com/search?q=${encodeURIComponent(q)}&serp_type=default` },
  tiktok: { name: 'TikTok', hosts: ['tiktok.com'], mediaPath: '^/@[^/]+/video/([0-9]+)', searchUrl: q => `https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}` },
  vimeo: { name: 'Vimeo', hosts: ['vimeo.com'], mediaPath: '^(?:/(?:channels/[^/]+|groups/[^/]+/videos|album/[0-9]+/video))?/([0-9]+)', searchUrl: q => `https://vimeo.com/search?q=${encodeURIComponent(q)}` },
};

export const VIDEO_SEARCH_PLATFORM_IDS = Object.keys(VIDEO_SEARCH_SITES) as VideoSearchPlatform[];
