# Flucto Extensible Platform Architecture — Design Document

## 1. Problem Statement

Adding a new platform to flucto today requires touching **6+ files**:

| File | What to add |
|------|-------------|
| `media/ytDlp.ts` | `url.includes()` in `getCommonYtDlpArgs()` + `getRefererForUrl()` |
| `services/mediaInfo.ts` | `isThreadsUrl()` bypass at top of `getMediaInfo()` |
| `services/mediaDownload.ts` | `isThreadsUrl()` bypass in `runMediaDownload()` |
| `main/index.ts` | Threads bypass in 3 IPC handlers (info, download, batch) |
| `media/<platform>.ts` | New extraction module |
| `shared/types.ts` | (sometimes) New types |

This is error-prone, duplicated, and doesn't scale. We want **one file = one platform**.

---

## 2. Proposed Architecture: Platform Adapter Pattern

### Core Concept

```
┌─────────────────────────────────────────────────┐
│                  Entry Points                    │
│         CLI (cli/index.ts)  │  Electron IPC      │
└─────────────┬───────────────┴────────┬───────────┘
              │                        │
              ▼                        ▼
┌─────────────────────────────────────────────────┐
│              PlatformRegistry                    │
│  resolve(url) → PlatformAdapter                  │
└─────────────────────┬───────────────────────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ YtDlp    │ │ Threads  │ │ TikTok   │  ... (plugins)
   │ Adapter  │ │ Adapter  │ │ Adapter  │
   └──────────┘ └──────────┘ └──────────┘
```

### 2.1 PlatformAdapter Interface

```typescript
// src/main/platforms/types.ts

import type { VideoInfo, DownloadProgress, DownloadResponse } from '../../shared/types.js';

/**
 * Extraction strategy enum — tells the orchestrator HOW to get media.
 */
export type ExtractionStrategy =
  | 'yt-dlp'        // Use yt-dlp with custom args
  | 'custom-api'    // Use platform-specific HTTP API
  | 'browser'       // Use headless browser extraction
  | 'hybrid';       // Try yt-dlp first, fallback to custom

/**
 * A PlatformAdapter encapsulates ALL platform-specific logic.
 * One file = one platform. Adding a platform = adding one adapter.
 */
export interface PlatformAdapter {
  /** Unique platform identifier (e.g., 'youtube', 'threads', 'tiktok') */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Priority for URL matching (higher = checked first). Default: 0 */
  readonly priority: number;

  /** Check if this adapter handles the given URL */
  matchUrl(url: string): boolean;

  /** Which extraction strategy to use */
  getStrategy(url: string): ExtractionStrategy;

  /**
   * Get yt-dlp args for this platform.
   * Only called when strategy is 'yt-dlp' or 'hybrid'.
   */
  getYtDlpArgs?(url: string): string[];

  /**
   * Get referer header for this platform.
   * Only called when strategy is 'yt-dlp' or 'hybrid'.
   */
  getReferer?(url: string): string | null;

  /**
   * Get format selector for yt-dlp.
   * Default: best[ext=mp4]/best
   */
  getFormatSelector?(url: string, quality?: string): string;

  /**
   * Extract video info WITHOUT yt-dlp.
   * Called when strategy is 'custom-api' or 'browser',
   * or when yt-dlp fails in 'hybrid' mode.
   */
  extractInfo?(url: string): Promise<VideoInfo>;

  /**
   * Download media WITHOUT yt-dlp.
   * Called when strategy is 'custom-api' or 'browser',
   * or when yt-dlp fails in 'hybrid' mode.
   */
  download?(options: DownloadOptions, onProgress?: (p: DownloadProgress) => void): Promise<DownloadResponse>;

  /**
   * Extract transcript/captions for markdown conversion.
   * Return null if platform doesn't support transcripts.
   */
  extractTranscript?(url: string): Promise<TranscriptResult | null>;

  /**
   * Whether this platform supports batch/channel downloads.
   * Default: false
   */
  supportsBatch?: boolean;

  /**
   * Extract list of video URLs from a channel/playlist/profile page.
   */
  extractBatch?(url: string): Promise<string[]>;
}

export interface DownloadOptions {
  url: string;
  outputDir: string;
  format: 'mp4' | 'mp3';
  requestId?: string;
  title?: string;
  quality?: string;
}

export interface TranscriptResult {
  segments: Array<{ start: number; end: number; text: string }>;
  language?: string;
  source: 'captions' | 'whisper' | 'api';
}
```

### 2.2 PlatformRegistry

```typescript
// src/main/platforms/registry.ts

import type { PlatformAdapter } from './types.js';

class PlatformRegistry {
  private adapters: PlatformAdapter[] = [];

  register(adapter: PlatformAdapter): void {
    this.adapters.push(adapter);
    // Sort by priority (highest first)
    this.adapters.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Find the adapter that handles this URL.
   * Returns null if no adapter matches (yt-dlp generic fallback).
   */
  resolve(url: string): PlatformAdapter | null {
    return this.adapters.find(a => a.matchUrl(url)) ?? null;
  }

  /** Get all registered adapters (for diagnostics) */
  list(): ReadonlyArray<PlatformAdapter> {
    return this.adapters;
  }

  /** Check if any adapter handles this URL */
  supports(url: string): boolean {
    return this.resolve(url) !== null;
  }
}

/** Singleton registry — all adapters register here */
export const registry = new PlatformRegistry();
```

### 2.3 Built-in Adapters

```
src/main/platforms/
├── types.ts              # PlatformAdapter interface + types
├── registry.ts           # PlatformRegistry singleton
├── index.ts              # Auto-imports all adapters (registration)
├── yt-dlp-adapter.ts     # Base class for yt-dlp-based platforms
├── youtube.ts            # YouTube adapter
├── twitter.ts            # Twitter/X adapter
├── instagram.ts          # Instagram adapter
├── reddit.ts             # Reddit adapter
├── bilibili.ts           # Bilibili adapter
├── threads.ts            # Threads adapter (custom-api)
├── tiktok.ts             # TikAdapter (NEW)
├── vimeo.ts              # Vimeo adapter (NEW)
├── twitch.ts             # Twitch adapter (NEW)
├── soundcloud.ts         # SoundCloud adapter (NEW)
└── generic.ts            # Fallback: plain yt-dlp with no overrides
```

### 2.4 Example: Threads Adapter

```typescript
// src/main/platforms/threads.ts

import type { PlatformAdapter, DownloadOptions, TranscriptResult } from './types.js';
import type { VideoInfo, DownloadProgress, DownloadResponse } from '../../shared/types.js';
import { registry } from './registry.js';

const THREADS_API = 'https://www.threadsdl.app/api/threads';
const THREADS_PROXY = 'https://www.threadsdl.app/api/proxy';

const threadsAdapter: PlatformAdapter = {
  id: 'threads',
  name: 'Threads',
  priority: 10,

  matchUrl: (url) => url.includes('threads.com') || url.includes('threads.net'),

  getStrategy: () => 'custom-api',

  async extractInfo(url: string): Promise<VideoInfo> {
    const data = await fetchThreadsApi(url);
    const video = data.medias.find(m => m.mediaType === 2);
    if (!video) throw new Error('No video found in Threads post');
    const shortcode = url.match(/\/(?:post|tv)\/([A-Za-z0-9_-]+)/)?.[1] ?? 'unknown';
    return {
      id: shortcode,
      title: data.text?.slice(0, 100) || `Threads post by @${data.username}`,
      thumbnail: video.images?.[0]?.url ?? '',
      duration: 0,
      uploader: data.username,
    };
  },

  async download(options, onProgress) {
    // ... (existing threads.ts downloadThreadsVideo logic)
  },

  extractTranscript: undefined, // Threads doesn't have captions

  supportsBatch: false,
};

registry.register(threadsAdapter);
```

### 2.5 Example: YtDlp Base Adapter

```typescript
// src/main/platforms/yt-dlp-adapter.ts

import type { PlatformAdapter, ExtractionStrategy } from './types.js';

/**
 * Base config for yt-dlp-based platforms.
 * Most platforms just need these few overrides.
 */
export interface YtDlpPlatformConfig {
  id: string;
  name: string;
  priority?: number;
  urlPatterns: string[];
  referer?: string;
  extraArgs?: string[];
  formatSelector?: string;
}

/**
 * Creates a PlatformAdapter that delegates everything to yt-dlp.
 * Adding a new yt-dlp-supported platform = one config object.
 */
export function createYtDlpAdapter(config: YtDlpPlatformConfig): PlatformAdapter {
  return {
    id: config.id,
    name: config.name,
    priority: config.priority ?? 0,

    matchUrl: (url) => config.urlPatterns.some(p => url.includes(p)),

    getStrategy: (): ExtractionStrategy => 'yt-dlp',

    getYtDlpArgs: () => config.extraArgs ?? [],

    getReferer: () => config.referer ?? null,

    getFormatSelector: () => config.formatSelector ?? 'best[ext=mp4]/best',
  };
}
```

### 2.6 Example: Simple Platform Registration

```typescript
// src/main/platforms/twitter.ts
import { createYtDlpAdapter } from './yt-dlp-adapter.js';
import { registry } from './registry.js';

registry.register(createYtDlpAdapter({
  id: 'twitter',
  name: 'Twitter/X',
  urlPatterns: ['x.com', 'twitter.com'],
  referer: 'https://x.com/',
  extraArgs: [
    '--user-agent', 'Mozilla/5.0 ...',
    '--extractor-args', 'twitter:api=legacy',
    '--extractor-args', 'twitter:video=true',
  ],
}));

// src/main/platforms/tiktok.ts
registry.register(createYtDlpAdapter({
  id: 'tiktok',
  name: 'TikTok',
  urlPatterns: ['tiktok.com', 'vm.tiktok.com'],
  extraArgs: [
    '--user-agent', 'Mozilla/5.0 ...',
    '--extractor-args', 'tiktok:api_hostname=api-h2.tiktokv.com',
  ],
}));
```

---

## 3. Unified Download + Transcript + Markdown Pipeline

### Current Flow (scattered)

```
CLI/Electron → mediaDownload.ts → yt-dlp (branching per platform)
           → mediaInfo.ts → yt-dlp (branching per platform)
           → transcriptMarkdown.ts → captionExtractor → yt-dlp subtitles
```

### Proposed Flow (unified)

```
CLI/Electron → orchestrator.resolve(url)
           → adapter.getStrategy()
           → strategy: yt-dlp? → ytDlpEngine.download(adapter.getYtDlpArgs())
           → strategy: custom? → adapter.download()
           → strategy: browser? → browserEngine.extract(adapter)
           → strategy: hybrid? → try yt-dlp, fallback to custom

           → orchestrator.transcript(url, adapter)
           → adapter.extractTranscript() ?? ytDlpEngine.extractCaptions()

           → orchestrator.toMarkdown(info, transcript)
           → markdownFormatter.format()
```

### 3.1 MediaOrchestrator

```typescript
// src/main/services/orchestrator.ts

import { registry } from '../platforms/registry.js';
import type { PlatformAdapter, DownloadOptions } from '../platforms/types.js';

export class MediaOrchestrator {
  /**
   * Resolve URL to adapter. Throws if no adapter found and yt-dlp can't handle it.
   */
  resolve(url: string): PlatformAdapter {
    return registry.resolve(url) ?? this.genericAdapter;
  }

  /**
   * Get video info — uses adapter.extractInfo() for custom platforms,
   * falls back to yt-dlp for yt-dlp-based platforms.
   */
  async getInfo(url: string): Promise<VideoInfo> {
    const adapter = this.resolve(url);
    const strategy = adapter.getStrategy(url);

    if (strategy === 'custom-api' || strategy === 'browser') {
      return adapter.extractInfo!(url);
    }

    // yt-dlp or hybrid: use yt-dlp with adapter's args
    return this.ytDlpEngine.getInfo(url, adapter);
  }

  /**
   * Download media — unified path.
   */
  async download(url: string, options: DownloadOptions, onProgress?: ProgressCallback): Promise<DownloadResponse> {
    const adapter = this.resolve(url);
    const strategy = adapter.getStrategy(url);

    if ((strategy === 'custom-api' || strategy === 'browser') && adapter.download) {
      return adapter.download(options, onProgress);
    }

    // yt-dlp path with adapter-specific args
    return this.ytDlpEngine.download(url, {
      ...options,
      extraArgs: adapter.getYtDlpArgs?.(url) ?? [],
      referer: adapter.getReferer?.(url),
      formatSelector: adapter.getFormatSelector?.(url, options.quality),
    }, onProgress);
  }

  /**
   * Extract transcript → convert to markdown.
   * Unified pipeline: adapter.transcript ?? yt-dlp captions ?? whisper fallback
   */
  async toMarkdown(url: string, options: MarkdownOptions): Promise<MarkdownResult> {
    const adapter = this.resolve(url);
    const info = await this.getInfo(url);

    // Try adapter-specific transcript extraction
    let transcript = adapter.extractTranscript
      ? await adapter.extractTranscript(url)
      : null;

    // Fallback to yt-dlp captions
    if (!transcript) {
      transcript = await this.ytDlpEngine.extractCaptions(url, options.language);
    }

    // Format to markdown
    return this.markdownFormatter.format({
      info,
      transcript,
      includeMetadata: options.includeMetadata,
      includeTimestamps: options.includeTimestamps,
    });
  }
}
```

---

## 4. Platform Priority List

### Tier 1 — High demand, easy to add (yt-dlp native)

| Platform | Difficulty | Notes |
|----------|-----------|-------|
| **TikTok** | Easy | yt-dlp has extractor. Just needs args. |
| **Vimeo** | Easy | yt-dlp native. No custom args needed. |
| **Twitch** (clips/VODs) | Easy | yt-dlp native. |
| **SoundCloud** | Easy | yt-dlp native. Audio-only. |
| **Dailymotion** | Easy | yt-dlp native. |
| **Facebook** | Easy | Already partially supported (shares Instagram args). |

### Tier 2 — Medium effort, high value

| Platform | Difficulty | Notes |
|----------|-----------|-------|
| **TikTok** (no-watermark) | Medium | Needs custom API or third-party service. |
| **Naver TV** | Medium | Korean platform. yt-dlp has partial support. |
| **KakaoTV** | Medium | Korean platform. May need custom extraction. |
| **Spotify** | Medium | Audio only. Needs spotdl or similar. |
| **Apple Podcasts** | Medium | RSS-based extraction. |

### Tier 3 — Custom extraction needed

| Platform | Difficulty | Notes |
|----------|-----------|-------|
| **Weibo** | Hard | Chinese platform. Custom API needed. |
| **Douyin** (China TikTok) | Hard | Different from TikTok. Custom API. |
| **Bilibili** (enhanced) | Medium | Already supported, but could improve quality selection. |
| **Kick** | Medium | Newer platform. yt-dlp has basic support. |
| **Rumble** | Medium | yt-dlp has support. |

---

## 5. Markdown Conversion Feature

### Goal

Convert any downloaded media into a Markdown document containing:
- **Metadata**: title, uploader, duration, URL, thumbnail
- **Transcript**: timestamped text (from captions or Whisper)
- **Summary**: optional AI-generated summary

### 5.1 Transcript Sources (Priority Order)

1. **Platform captions** (YouTube, Vimeo, Twitch have built-in captions)
2. **Adapter API** (some platforms expose transcript via API)
3. **Whisper fallback** (local whisper.cpp or OpenAI Whisper API)

### 5.2 Markdown Template

```markdown
---
title: "Video Title"
uploader: "Channel Name"
url: "https://..."
duration: "10:23"
downloaded: "2026-07-11"
platform: "youtube"
---

# Video Title

**Channel:** Channel Name | **Duration:** 10:23

![Thumbnail](https://...)

## Transcript

[00:00] Hello and welcome to...
[00:15] Today we're going to discuss...
[00:45] The first thing to note is...

## Summary

> This video covers the basics of...
```

### 5.3 Unified Pipeline

```typescript
// src/main/services/markdownPipeline.ts

export interface MarkdownPipelineOptions {
  url: string;
  outputDir: string;
  includeMetadata: boolean;
  includeTimestamps: boolean;
  includeSummary: boolean;     // AI summary (future)
  language: string;            // Transcript language
  whisperFallback: boolean;    // Use Whisper if no captions
}

export class MarkdownPipeline {
  async convert(options: MarkdownPipelineOptions): Promise<MarkdownResult> {
    const adapter = registry.resolve(options.url);
    const strategy = adapter?.getStrategy(options.url) ?? 'yt-dlp';

    // 1. Get video info
    const info = await this.orchestrator.getInfo(options.url);

    // 2. Extract transcript
    let transcript = null;
    if (adapter?.extractTranscript) {
      transcript = await adapter.extractTranscript(options.url);
    }
    if (!transcript && strategy === 'yt-dlp') {
      transcript = await this.captionExtractor.extract(options.url, options.language);
    }
    if (!transcript && options.whisperFallback) {
      // Download audio first, then transcribe
      const audioPath = await this.orchestrator.download(options.url, {
        ...options,
        format: 'mp3',
      });
      transcript = await this.whisperTranscriber.transcribe(audioPath.filePath!);
    }

    // 3. Format to markdown
    const markdown = this.formatter.format({
      info,
      transcript,
      includeMetadata: options.includeMetadata,
      includeTimestamps: options.includeTimestamps,
    });

    // 4. Save to file
    const filePath = path.join(options.outputDir, `${safeFilename(info.title)}.md`);
    fs.writeFileSync(filePath, markdown);

    return { success: true, filePath, markdown, wordCount: transcript?.segments.length ?? 0 };
  }
}
```

---

## 6. Migration Plan

### Phase 1: Foundation (no breaking changes)
1. Create `src/main/platforms/` directory with types, registry, index
2. Create `yt-dlp-adapter.ts` base factory
3. Create adapters for existing platforms (YouTube, Twitter, Instagram, Reddit, Bilibili, Threads)
4. Keep existing code working — adapters register but aren't used yet

### Phase 2: Wire up orchestrator
1. Create `MediaOrchestrator` that uses registry
2. Update `mediaInfo.ts` to delegate to orchestrator
3. Update `mediaDownload.ts` to delegate to orchestrator
4. Update `main/index.ts` IPC handlers to use orchestrator
5. Remove scattered `isThreadsUrl()` / `url.includes()` checks

### Phase 3: New platforms
1. Add TikTok, Vimeo, Twitch, SoundCloud adapters
2. Each is ONE file with `createYtDlpAdapter()` config
3. Test each platform

### Phase 4: Markdown pipeline
1. Create `MarkdownPipeline` service
2. Add Whisper fallback integration
3. Add `flucto md <url>` CLI command
4. Add markdown export to Electron UI

### Phase 5: Plugin loading (future)
1. Support external plugins from `~/.flucto/plugins/`
2. Plugin manifest: `{ id, name, matchUrl, strategy }`
3. Hot-reload on plugin file change

---

## 7. File Structure (Final)

```
src/
├── main/
│   ├── platforms/                    # NEW: Plugin architecture
│   │   ├── types.ts                  # PlatformAdapter interface
│   │   ├── registry.ts               # PlatformRegistry singleton
│   │   ├── index.ts                  # Auto-imports all adapters
│   │   ├── yt-dlp-adapter.ts         # Base factory for yt-dlp platforms
│   │   ├── youtube.ts                # YouTube adapter
│   │   ├── twitter.ts                # Twitter/X adapter
│   │   ├── instagram.ts              # Instagram adapter
│   │   ├── reddit.ts                 # Reddit adapter
│   │   ├── bilibili.ts               # Bilibili adapter
│   │   ├── threads.ts                # Threads adapter (custom-api)
│   │   ├── tiktok.ts                 # NEW: TikTok adapter
│   │   ├── vimeo.ts                  # NEW: Vimeo adapter
│   │   ├── twitch.ts                 # NEW: Twitch adapter
│   │   ├── soundcloud.ts             # NEW: SoundCloud adapter
│   │   └── generic.ts                # Fallback adapter
│   ├── services/
│   │   ├── orchestrator.ts           # NEW: Unified media orchestrator
│   │   ├── markdownPipeline.ts       # NEW: Markdown conversion pipeline
│   │   ├── mediaDownload.ts          # REFACTORED: delegates to orchestrator
│   │   ├── mediaInfo.ts              # REFACTORED: delegates to orchestrator
│   │   ├── transcriptMarkdown.ts     # EXISTING: transcript formatting
│   │   └── ...
│   ├── media/
│   │   ├── ytDlp.ts                  # KEPT: yt-dlp engine (low-level)
│   │   └── threads.ts                # REMOVED: moved to platforms/threads.ts
│   └── ...
├── cli/
│   └── index.ts                      # UPDATED: add 'md' command
└── shared/
    └── types.ts                      # UPDATED: new types
```

---

## 8. Benefits

| Before | After |
|--------|-------|
| Add platform = touch 6+ files | Add platform = 1 file |
| Platform logic scattered everywhere | Platform logic in one place |
| Hard-coded URL patterns | Registry-based resolution |
| Transcript only for yt-dlp | Unified transcript pipeline |
| No markdown export | Built-in markdown conversion |
| Can't load external plugins | Plugin directory ready |
