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

