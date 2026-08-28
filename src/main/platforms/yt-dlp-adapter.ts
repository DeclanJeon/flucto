import type { PlatformAdapter, ExtractionStrategy, YtDlpPlatformConfig } from './types.js';

export function createYtDlpAdapter(config: YtDlpPlatformConfig): PlatformAdapter {
  return {
    id: config.id,
    name: config.name,
    priority: config.priority ?? 0,

    matchUrl: (url: string) => config.urlPatterns.some(p => url.includes(p)),

    getStrategy: (): ExtractionStrategy => 'yt-dlp',

    getYtDlpArgs: (url: string) => {
      const baseArgs = typeof config.extraArgs === 'function'
        ? config.extraArgs(url, { retryCount: 0 })
        : (config.extraArgs ?? []);
      return baseArgs;
    },

    getReferer: () => config.referer ?? null,
  };
}
