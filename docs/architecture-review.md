# Flucto Extensible Platform Architecture — Review

**Reviewer:** Architecture Review  
**Date:** 2026-07-12  
**Document:** `docs/architecture-extensible-platforms.md`  
**Verdict:** **REQUEST_CHANGES**

---

## Overall Assessment

The design correctly identifies the core problem — platform logic scattered across 6+ files — and the Platform Adapter pattern is the right abstraction. The proposed file structure, migration phases, and `createYtDlpAdapter()` factory are well-conceived. However, the current draft has several gaps that would cause friction during implementation: underspecified error contracts, missing lifecycle/abort support, a quality abstraction too coupled to yt-dlp internals, and a singleton registry pattern that conflicts with testability. None of these are fatal, but all should be resolved before cutting code.

---

## Critical Issues (Must Fix Before Implementation)

### 1. No Unified Error Contract for Adapters

**File:** `docs/architecture-extensible-platforms.md` §2.1  
**Impact:** The codebase already has `TranscriptError` with typed error codes (`RATE_LIMITED`, `VIDEO_UNAVAILABLE`, etc.) and a `CircuitBreaker` for per-platform failure tracking. The proposed `PlatformAdapter` interface has no error convention — `extractInfo()` and `download()` can throw anything. The orchestrator has no way to distinguish a transient rate-limit (retry later) from a permanent failure (give up), breaking the existing circuit breaker and user-facing error messages.

**Suggestion:** Define a `PlatformError` class mirroring `TranscriptError`:

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

### 2. Missing `AbortSignal` Support

**File:** `docs/architecture-extensible-platforms.md` §2.1  
**Impact:** The existing Threads downloader uses `AbortController` with a 60-second timeout. The `DownloadOptions` and all async adapter methods lack an `AbortSignal` parameter. Users can't cancel in-flight downloads, and the orchestrator can't enforce per-platform timeouts.

**Suggestion:**

```typescript
export interface DownloadOptions {
  url: string;
  outputDir: string;
  format: 'mp4' | 'mp3';
  requestId?: string;
  title?: string;
  quality?: string;
  signal?: AbortSignal;  // ADD
}

// Also on extractInfo, extractTranscript, extractBatch:
extractInfo(url: string, signal?: AbortSignal): Promise<VideoInfo>;
```

### 3. `cookiesPath` Missing from `DownloadOptions`

**File:** `docs/architecture-extensible-platforms.md` §2.1  
**Impact:** The existing `DownloadRequest` in `shared/types.ts` includes `cookiesPath?: string` for YouTube cookie-based authentication. The proposed `DownloadOptions` drops this. YouTube, Bilibili, and Instagram downloads requiring login would break.

**Suggestion:**

```typescript
export interface DownloadOptions {
  // ... existing fields
  cookiesPath?: string;
}
```

### 4. Quality Abstraction Leaks yt-dlp Internals

**File:** `docs/architecture-extensible-platforms.md` §2.1  
**Impact:** `getFormatSelector?(url: string, quality?: string): string` returns an yt-dlp format selector string. Custom-api adapters (Threads, future TikTok no-watermark) don't use yt-dlp format selectors. The `quality?: string` parameter is also untyped, losing the existing `DownloadQualityPreferences` type safety.

**Suggestion:** Type the quality parameter and decouple from yt-dlp:

```typescript
export type QualityLevel = 'best' | '1080p' | '720p' | '480p' | 'worst';

export interface DownloadOptions {
  // ...
  quality?: QualityLevel;
}

export interface PlatformAdapter {
  // yt-dlp-specific: returns args including format selector
  getYtDlpArgs?(url: string, quality?: QualityLevel): string[];
  // Custom adapters accept QualityLevel via DownloadOptions and map internally
}
```

### 5. Singleton Registry with Side-Effect Imports Is Untestable

**File:** `docs/architecture-extensible-platforms.md` §2.2, §2.3  
**Impact:** Adapters self-register via `registry.register(...)` at module load time. This means:
- Tests can't isolate individual adapters without importing the entire registry
- Module evaluation order is implicit and fragile
- Tree-shaking can't remove unused adapters
- No way to swap registries for testing

**Suggestion:** Use explicit registration:

```typescript
// src/main/platforms/createRegistry.ts
export function createPlatformRegistry(): PlatformRegistry {
  const registry = new PlatformRegistry();
  registry.register(createYouTubeAdapter());
  registry.register(createTwitterAdapter());
  registry.register(createThreadsAdapter());
  return registry;
}

// src/main/platforms/index.ts
export const registry = createPlatformRegistry();
```

---

## High-Priority Issues (Should Fix)

### 6. `ExtractionStrategy` Underspecifies Hybrid Semantics

**File:** `docs/architecture-extensible-platforms.md` §2.1  
**Impact:** The orchestrator shows: for `'hybrid'`, try yt-dlp first, fallback to custom. But the interface doesn't specify what error triggers the fallback, whether it's configurable per-adapter, or if fallback results get cached.

**Suggestion:** Add an optional `shouldFallback(error: unknown): boolean` method, or document the convention explicitly.

### 7. `extractBatch()` Returns `string[]` — Lossy Downgrade

**File:** `docs/architecture-extensible-platforms.md` §2.1  
**Impact:** The existing `listChannelVideos()` returns `ChannelListResult { channelTitle, channelUrl, videos: VideoInfo[] }`. The proposed `extractBatch()` returns `string[]` — losing titles, thumbnails, durations. The orchestrator would need N additional `getInfo()` calls.

**Suggestion:**

```typescript
export interface BatchResult {
  channelTitle?: string;
  entries: Array<string | VideoInfo>;
}

extractBatch?(url: string): Promise<BatchResult>;
```

### 8. `supportsBatch` Is Redundant

**File:** `docs/architecture-extensible-platforms.md` §2.1  
**Impact:** `supportsBatch?: boolean` and `extractBatch?(url: string)` are redundant. Having both creates consistency risk.

**Suggestion:** Remove `supportsBatch`. Use `adapter.extractBatch !== undefined`.

### 9. `MarkdownPipeline` Duplicates Orchestrator Logic

**File:** `docs/architecture-extensible-platforms.md` §5.3  
**Impact:** `MarkdownPipeline.convert()` independently resolves the adapter and checks strategy — the same logic the orchestrator's `toMarkdown()` does. Bug fixes must be applied in two places.

**Suggestion:** `MarkdownPipeline` should delegate to `MediaOrchestrator.toMarkdown()` and only add file I/O and clipboard logic.

### 10. No Adapter Lifecycle / `dispose()`

**File:** `docs/architecture-extensible-platforms.md` §2.1  
**Impact:** Future `browser` strategy adapters will hold headless browser instances. Without `dispose()`, there's no clean shutdown path.

**Suggestion:**

```typescript
export interface PlatformAdapter {
  // ...
  dispose?(): Promise<void>;
}
```

---

## Suggestions (Nice to Have)

### S1. Per-Platform Rate Limit Configuration

The codebase already has a `CircuitBreaker` per platform. Adapters should declare rate-limit preferences:

```typescript
export interface PlatformAdapter {
  readonly rateLimit?: {
    maxConcurrent: number;
    cooldownMs: number;
  };
}
```

### S2. URL Normalization

Add `normalizeUrl?(url: string): string` to deduplicate identical content at different URLs (YouTube mobile/desktop, Threads variants).

### S3. `createYtDlpAdapter` Should Accept Dynamic Args

The existing Twitter adapter adds `--extractor-args twitter:api=graph` only on retry. Consider:

```typescript
export interface YtDlpPlatformConfig {
  extraArgs?: string[] | ((url: string, context: { retryCount: number }) => string[]);
}
```

---

## Interface-by-Interface Verdict

### `PlatformAdapter` — **Needs Revision**

- ❌ No error contract
- ❌ No `AbortSignal`
- ❌ No `dispose()`
- ❌ `quality` parameter untyped
- ❌ `supportsBatch` redundant
- ⚠️ `getStrategy()` hybrid semantics unclear
- ⚠️ `getFormatSelector()` leaks yt-dlp internals
- ✅ `matchUrl()` + `priority` is clean
- ✅ Optional methods correctly separate yt-dlp vs custom
- ✅ `ExtractionStrategy` enum is the right abstraction

### `PlatformRegistry` — **Acceptable with Changes**

- ❌ Side-effect imports fragile and untestable
- ✅ Priority-based sorting correct
- ✅ `resolve()` returning `null` for generic fallback clean
- ⚠️ No duplicate URL-pattern detection

### `MediaOrchestrator` — **Needs Revision**

- ❌ No `AbortSignal` propagation
- ❌ `toMarkdown()` duplicates `MarkdownPipeline`
- ⚠️ `this.genericAdapter` referenced but undefined
- ✅ Strategy-based dispatch clean
- ✅ Fallback chain well-structured

### `MarkdownPipeline` — **Needs Revision**

- ❌ Duplicates orchestrator's adapter resolution
- ❌ Direct `fs.writeFileSync` mixed with business logic
- ✅ Whisper fallback chain well-thought-out
- ✅ Template format matches existing patterns

---

## Existing Patterns to Preserve

| Pattern | Location | Preserve? |
|---------|----------|-----------|
| `TranscriptError` with typed codes | `transcript/transcriptError.ts` | Generalize to `PlatformError` |
| `CircuitBreaker` per platform | `transcript/captionExtractor.ts` | Move to orchestrator level |
| `TranscriptCache` with TTL + size | `transcript/transcriptCache.ts` | Generalize for all adapter results |
| `runWithConcurrency()` | `services/batch.ts` | Use in orchestrator batch ops |
| Deps-injection pattern | `services/mediaDownload.ts` | Use for orchestrator deps |

---

## Summary of Required Changes

| # | Issue | Priority | Effort |
|---|-------|----------|--------|
| 1 | Add `PlatformError` with typed codes | Critical | Small |
| 2 | Add `AbortSignal` to async methods | Critical | Small |
| 3 | Add `cookiesPath` to `DownloadOptions` | Critical | Trivial |
| 4 | Type quality parameter, decouple from yt-dlp | Critical | Medium |
| 5 | Explicit registration instead of side-effects | Critical | Medium |
| 6 | Specify hybrid fallback semantics | High | Small |
| 7 | Rich data from `extractBatch()` | High | Small |
| 8 | Remove redundant `supportsBatch` | High | Trivial |
| 9 | Deduplicate `MarkdownPipeline` / orchestrator | High | Medium |
| 10 | Add `dispose()` lifecycle method | High | Trivial |

The design is **80% there**. Fix the five critical issues, and this is ready for implementation.
