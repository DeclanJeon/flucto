import { PlatformRegistry } from './registry.js';
import { createYouTubeAdapter } from './youtube.js';
import { createTwitterAdapter } from './twitter.js';
import { createInstagramAdapter } from './instagram.js';
import { createRedditAdapter } from './reddit.js';
import { createBilibiliAdapter } from './bilibili.js';
import { createThreadsAdapter } from './threads.js';
import { createTikTokAdapter } from './tiktok.js';
import { createVimeoAdapter } from './vimeo.js';
import { createGenericAdapter } from './generic.js';
import { createDailymotionAdapter } from './dailymotion.js';
import { createNicovideoAdapter } from './nicovideo.js';
import { createOkAdapter } from './ok.js';
import { createVkvideoAdapter } from './vkvideo.js';

export function createPlatformRegistry(): PlatformRegistry {
  const registry = new PlatformRegistry();
  registry.register(createYouTubeAdapter());
  registry.register(createTwitterAdapter());
  registry.register(createInstagramAdapter());
  registry.register(createRedditAdapter());
  registry.register(createBilibiliAdapter());
  registry.register(createDailymotionAdapter());
  registry.register(createNicovideoAdapter());
  registry.register(createOkAdapter());
  registry.register(createVkvideoAdapter());
  registry.register(createThreadsAdapter());
  registry.register(createTikTokAdapter());
  registry.register(createVimeoAdapter());
  registry.register(createGenericAdapter());
  return registry;
}
