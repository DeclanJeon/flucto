import { randomUUID } from 'crypto';
import type { VideoInfo, DownloadResponse, DownloadProgress, TranscriptMarkdownResponse, TranscriptRequest, TranscriptSettings, MediaDownloadFormat } from '../../shared/types.js';
import type { PlatformRegistry } from '../platforms/registry.js';
import type { PlatformAdapter, DownloadOptions } from '../platforms/types.js';
import { PlatformError } from '../platforms/errors.js';
import { execa } from '../spawn.js';
import { getCommonYtDlpArgs, getRefererForUrl, runYtDlpJson } from '../media/ytDlp.js';
import type { BinaryResolver } from './binaryResolver.js';
import { convertTranscriptToMarkdown } from './transcriptMarkdown.js';
import { defaultQualityPreferences, getTranscriptSettingsDefaults } from './settingsDefaults.js';

// ---------------------------------------------------------------------------
// Orchestrator deps (injected, following mediaDownload pattern)
// ---------------------------------------------------------------------------

export interface OrchestratorDeps {
  binaries: BinaryResolver;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface OrchestratorDownloadOptions {
  url: string;
  format: MediaDownloadFormat;
  outputDir: string;
  quality?: typeof defaultQualityPreferences;
  formatOverrides?: { videoFormatId: string | null; audioFormatId: string | null };
  requestId?: string;
  title?: string;
  cookiesPath?: string;
  signal?: AbortSignal;
}

export interface OrchestratorTranscriptOptions {
  url: string;
  requestId?: string;
  title?: string;
  outputDir: string;
  settings: TranscriptSettings;
  onProgress?: (progress: { requestId: string; url: string; title?: string; status: string; progress: number; filePath?: string; error?: string }) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resolveAdapter = (registry: PlatformRegistry, url: string): PlatformAdapter => {
  const adapter = registry.resolve(url);
  if (!adapter) {
    throw new PlatformError('UNSUPPORTED_URL', `No platform adapter found for URL: ${url}`, 'unknown');
  }
  return adapter;
};

const buildYtDlpDownloadArgs = (
  adapter: PlatformAdapter | null,
  options: OrchestratorDownloadOptions,
  binaries: BinaryResolver,
): string[] => {
  const quality = options.quality ?? defaultQualityPreferences;
  const referer = adapter?.getReferer?.(options.url) ?? getRefererForUrl(options.url) ?? '';
  const adapterArgs = adapter?.getYtDlpArgs?.(options.url) ?? getCommonYtDlpArgs(options.url);

  const args: string[] = [
    options.url,
    '--output', `${options.outputDir}/%(title)s.%(ext)s`,
    '--encoding', 'utf-8',
    '--no-check-certificates',
    '--no-warnings',
    '--newline',
    '--no-playlist',
    '--force-overwrites',
    ...(referer ? ['--add-header', `referer:${referer}`] : []),
    '--ffmpeg-location', binaries.ffmpegPath.replace(/[\\/][^\\/]+$/, ''),
    ...adapterArgs,
  ];

  if (options.format === 'mp3') {
    args.push(
      '--format', 'bestaudio/best',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', quality.audio,
    );
  } else {
    const formatOverride = options.formatOverrides?.videoFormatId;
    const formatSelector = formatOverride
      ? `${formatOverride}+bestaudio[ext=m4a]/${formatOverride}+bestaudio/${formatOverride}/best[ext=mp4][acodec!=none]/best`
      : `bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4][acodec!=none]/best`;
    args.push(
      '--format', formatSelector,
      '--merge-output-format', 'mp4',
    );
  }

  if (options.cookiesPath) {
    args.push('--cookies', options.cookiesPath);
  }

  return args;
};

// ---------------------------------------------------------------------------
// MediaOrchestrator
// ---------------------------------------------------------------------------

export class MediaOrchestrator {
  constructor(private readonly registry: PlatformRegistry) {}

  // ----- getInfo: resolve adapter → dispatch -----

  async getInfo(url: string, signal?: AbortSignal): Promise<VideoInfo> {
    const adapter = resolveAdapter(this.registry, url);
    const strategy = adapter.getStrategy(url);

    if (strategy === 'custom-api' || strategy === 'browser') {
      if (!adapter.extractInfo) {
        throw new PlatformError(
          'EXTRACTION_FAILED',
          `Adapter "${adapter.id}" does not implement extractInfo()`,
          adapter.id,
        );
      }
      return adapter.extractInfo(url, signal);
    }

    // yt-dlp / hybrid — callers should use getInfoWithDeps() when deps are needed
    throw new PlatformError(
      'EXTRACTION_FAILED',
      `getInfo() requires adapter-level extractInfo() for strategy "${strategy}". Use getInfoWithDeps() for yt-dlp strategies.`,
      adapter.id,
    );
  }

  // ----- getInfoWithDeps: full deps version for yt-dlp strategies -----

  async getInfoWithDeps(url: string, deps: OrchestratorDeps, signal?: AbortSignal): Promise<VideoInfo> {
    const adapter = resolveAdapter(this.registry, url);
    const strategy = adapter.getStrategy(url);

    if (strategy === 'custom-api' || strategy === 'browser') {
      if (!adapter.extractInfo) {
        throw new PlatformError(
          'EXTRACTION_FAILED',
          `Adapter "${adapter.id}" does not implement extractInfo()`,
          adapter.id,
        );
      }
      return adapter.extractInfo(url, signal);
    }

    // yt-dlp / hybrid
    const adapterArgs = adapter.getYtDlpArgs?.(url) ?? getCommonYtDlpArgs(url);
    const metadata = await runYtDlpJson(url, adapterArgs, deps.binaries.ytDlpPath);

    return {
      id: String(metadata.id ?? ''),
      title: String(metadata.title ?? ''),
      thumbnail: String(metadata.thumbnail ?? ''),
      duration: Number(metadata.duration ?? 0),
      uploader: String(metadata.uploader ?? ''),
      view_count: metadata.view_count != null ? Number(metadata.view_count) : undefined,
    };
  }

  // ----- download: resolve adapter → dispatch -----

  async download(
    options: OrchestratorDownloadOptions,
    deps: OrchestratorDeps,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<DownloadResponse> {
    const adapter = resolveAdapter(this.registry, options.url);
    const strategy = adapter.getStrategy(options.url);
    const progress = onProgress ?? deps.onProgress;
    const requestId = options.requestId ?? randomUUID();

    if ((strategy === 'custom-api' || strategy === 'browser') && adapter.download) {
      const downloadOpts: DownloadOptions = {
        url: options.url,
        outputDir: options.outputDir,
        format: options.format,
        requestId,
        title: options.title,
        quality: options.quality?.video as 'best' | '1080p' | '720p' | '480p' | 'worst' | undefined,
        cookiesPath: options.cookiesPath,
        signal: options.signal,
      };
      return adapter.download(downloadOpts, progress);
    }

    // yt-dlp / hybrid — spawn yt-dlp process
    const args = buildYtDlpDownloadArgs(adapter, options, deps.binaries);
    const title = options.title ?? 'Downloading...';

    progress?.({ requestId, url: options.url, status: 'downloading', progress: 0, title });

    let finalFilePath: string | undefined;

    try {
      const subprocess = execa(deps.binaries.ytDlpPath, args, { reject: false });

      subprocess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        const progressMatch = output.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+(\S+)/);
        if (progressMatch) {
          progress?.({
            requestId,
            url: options.url,
            status: 'downloading',
            progress: Math.round(parseFloat(progressMatch[1])),
            speed: progressMatch[3],
            eta: progressMatch[4],
            title,
          });
        }
        const mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergeMatch) finalFilePath = mergeMatch[1];
        const destMatch = output.match(/\[download\] Destination: (.+)/);
        if (destMatch) finalFilePath = destMatch[1];
        const alreadyMatch = output.match(/\[download\] (.+) has already been downloaded/);
        if (alreadyMatch) finalFilePath = alreadyMatch[1];
      });

      subprocess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        const mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergeMatch) finalFilePath = mergeMatch[1];
      });

      const result = await subprocess;

      if (result.failed) {
        throw new Error(result.stderr || 'yt-dlp process failed');
      }

      const mergedOutput = `${result.stdout}\n${result.stderr}`;
      const mergeMatch = mergedOutput.match(/\[Merger\] Merging formats into "(.+)"/);
      if (mergeMatch) finalFilePath = mergeMatch[1];
      const destMatch = mergedOutput.match(/\[download\] Destination: (.+)/);
      if (destMatch) finalFilePath = destMatch[1];
      const alreadyMatch = mergedOutput.match(/\[download\] (.+) has already been downloaded/);
      if (alreadyMatch) finalFilePath = alreadyMatch[1];

      const filePath = finalFilePath ?? `${options.outputDir}/${title}.mp4`;

      progress?.({
        requestId,
        url: options.url,
        status: 'completed',
        progress: 100,
        filePath,
        title,
      });

      return { success: true, message: 'Download Complete!', filePath };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      progress?.({
        requestId,
        url: options.url,
        status: 'error',
        progress: 0,
        error: message,
        title,
      });
      return { success: false, message };
    }
  }

  // ----- toMarkdown: transcript → markdown -----

  async toMarkdown(
    options: OrchestratorTranscriptOptions,
    deps: Pick<OrchestratorDeps, 'binaries'>,
  ): Promise<TranscriptMarkdownResponse> {
    const request: TranscriptRequest = {
      url: options.url,
      requestId: options.requestId,
      title: options.title,
      settings: options.settings,
    };

    return convertTranscriptToMarkdown(request, {
      binaries: deps.binaries,
      outputDir: options.outputDir,
      defaults: getTranscriptSettingsDefaults(),
      onProgress: options.onProgress
        ? (p) => options.onProgress!(p)
        : undefined,
    });
  }
}
