import type { PlatformAdapter, ExtractionStrategy } from './types.js';

export function createGenericAdapter(): PlatformAdapter {
  return {
    id: 'generic',
    name: 'Generic',
    priority: -999,

    matchUrl: () => true,

    getStrategy: (): ExtractionStrategy => 'yt-dlp',

    getYtDlpArgs: () => [],

    getReferer: () => null,
  };
}
