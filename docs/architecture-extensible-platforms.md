# Flucto Extensible Platform Architecture — Design Document

> **v2** — Updated after architecture review. Critical fixes: PlatformError, AbortSignal, cookiesPath, typed quality, explicit registration.


---

## 2. Review Fixes Applied

### Fix 1: PlatformError with typed codes

```typescript
// src/main/platforms/errors.ts
export type PlatformErrorCode =
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'CONTENT_UNAVAILABLE'
  | 'GEO_BLOCKED'
  | 'EXTRACTION_FAILED'
  | 'NETWORK_ERROR'
  | 'UNSUPPORTED_URL';

export class PlatformError extends Error {
  constructor(
    public readonly code: PlatformErrorCode,
    message: string,
    public readonly platformId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}
```

### Fix 2: AbortSignal on all async methods

```typescript
extractInfo(url: string, signal?: AbortSignal): Promise<VideoInfo>;
download(options: DownloadOptions, onProgress?: ProgressCallback): Promise<DownloadResponse>;
extractTranscript(url: string, signal?: AbortSignal): Promise<TranscriptResult | null>;
```

### Fix 3: cookiesPath in DownloadOptions

```typescript
export interface DownloadOptions {
  url: string;
  outputDir: string;
  format: 'mp4' | 'mp3';
  requestId?: string;
  title?: string;
  quality?: QualityLevel;
  cookiesPath?: string;   // YouTube/Bilibili auth
  signal?: AbortSignal;   // Cancellation
}
```

### Fix 4: Typed quality, decoupled from yt-dlp

```typescript
export type QualityLevel = 'best' | '1080p' | '720p' | '480p' | 'worst';

export interface PlatformAdapter {
  // yt-dlp adapters: return full args including format selector
  getYtDlpArgs?(url: string, quality?: QualityLevel): string[];
  // Custom adapters: quality is passed via DownloadOptions
}
```

### Fix 5: Explicit registration (no side-effect imports)

```typescript
// src/main/platforms/createRegistry.ts
export function createPlatformRegistry(): PlatformRegistry {
  const registry = new PlatformRegistry();
  registry.register(createYouTubeAdapter());
  registry.register(createTwitterAdapter());
  registry.register(createThreadsAdapter());
  registry.register(createTikTokAdapter());
  // ... explicit, testable, tree-shakeable
  return registry;
}

// src/main/platforms/index.ts
export const registry = createPlatformRegistry();
```

### Fix 6: Hybrid fallback semantics

```typescript
export interface PlatformAdapter {
  getStrategy(url: string): ExtractionStrategy;
  /** Only called for 'hybrid' strategy. Return true to trigger fallback. */
  shouldFallback?(error: unknown): boolean;
}
```

### Fix 7: Rich batch results

```typescript
export interface BatchResult {
  channelTitle?: string;
  entries: Array<string | VideoInfo>;
}
extractBatch?(url: string, signal?: AbortSignal): Promise<BatchResult>;
```

### Fix 8: Remove redundant supportsBatch

Use `adapter.extractBatch !== undefined` instead.

### Fix 9: MarkdownPipeline delegates to orchestrator

`MarkdownPipeline` only handles file I/O and clipboard. Transcript extraction is in `MediaOrchestrator.toMarkdown()`.

### Fix 10: dispose() lifecycle

```typescript
export interface PlatformAdapter {
  dispose?(): Promise<void>;
}
```


## Keyword Video Search

`src/main/services/videoSearch.ts` is shared by `flucto search` and Electron's `search-videos` IPC handler. `VideoSearchRequest` selects `all` (the default) or one of 12 providers, a keyword, and a total result limit of 1–50. The shared `videoSearchPlatforms.ts` catalog defines site labels, host scopes, media paths, and native search links. The wildcard generic-download adapter is not a keyword-search provider.

The service runs at most four providers concurrently, retains catalog order, interleaves per-site ranks, and deduplicates original URLs until the total cap is reached. `VideoSearchResponse` includes annotated videos and a source report with method, fetched count, actual search URL, and failure/native restriction details. Counts precede the global merge cap. A top-level error means every source failed; a healthy empty source or partial failure is not a fatal search error. The renderer adds selected original URLs to the existing queue and keeps verbose source details collapsible.

Providers live in `src/main/search/`. Bilibili and Dailymotion use public APIs, Niconico uses the official Snapshot API, and VK Video uses its anonymous visitor-token/catalog flow. OK.ru uses `browserSearch.ts` with `st.gsq`; Bilibili and VK also fall back to that browser path. YouTube reads public result renderers and Innertube continuations. Reddit reads public search JSON and excludes non-video posts. Threads waits for video elements inside their actual post containers before collecting native results, excluding image/text-only posts.

`webIndexSearch.ts` supplies scoped anonymous Google video, DuckDuckGo video, and Bing video search for X, Instagram, TikTok, Vimeo, and native providers that encounter blocks. Links must resolve to a registered site's media path; internal Bing viewer URLs use original media metadata. Legitimate empty pages differ from human-verification, HTTP failures, and off-site-only responses. `WebIndexSearchError` retains the attempted index URL for source attribution. Index coverage is not full native-site coverage.

Public-index/Threads work shares a temporary Chrome browser with two admitted pages, isolated anonymous contexts, bounded navigation/result waits, and cleanup after all active/waiting work releases its slots. Other browser fallbacks retain their existing temporary-browser lifecycle. Queries go to the named public indexes, not an AI provider; no logged-in browser profile, CAPTCHA solving, or access-control bypass is used.

Downloads remain independent of search transport: explicit adapters in `createRegistry.ts` select `yt-dlp` options, and `mediaDownload.ts` reuses those options plus authorized cookie/proxy overrides. A search result is not a guarantee that the upstream video remains downloadable.

