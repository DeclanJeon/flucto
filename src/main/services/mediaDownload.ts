import path from 'path';
import { randomUUID } from 'crypto';
import type { DownloadProgress, DownloadQualityPreferences, DownloadResponse, MediaDownloadFormat, SingleDownloadRequest } from '../../shared/types.js';
import { execa } from '../spawn.js';
import { getCommonYtDlpArgs, getRefererForUrl } from '../media/ytDlp.js';
import { createPlatformRegistry } from '../platforms/index.js';
import type { BinaryResolver } from './binaryResolver.js';
import { defaultQualityPreferences } from './settingsDefaults.js';
import { getCaptionNetworkArgs, type CaptionNetworkOptions } from '../net/captionNetwork.js';

const registry = createPlatformRegistry();

export interface MediaDownloadOptions {
  url: string;
  format: MediaDownloadFormat;
  outputDir: string;
  quality?: DownloadQualityPreferences;
  formatOverrides?: { videoFormatId: string | null; audioFormatId: string | null };
  requestId?: string;
  title?: string;
  forceOverwrite?: boolean;
  network?: CaptionNetworkOptions;
}

export interface MediaDownloadDeps {
  binaries: BinaryResolver;
  onProgress?: (progress: DownloadProgress) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface MediaDownloadResult extends DownloadResponse {
  requestId: string;
  title: string;
  url: string;
  format: MediaDownloadFormat;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const isInstagramUrl = (url: string): boolean => url.includes('instagram.com');

export const getVideoFormatSelector = (preset: DownloadQualityPreferences['video']): string => {
  const constrainedSelector = (height: number): string => {
    return `bestvideo[ext=mp4][height<=${height}]+bestaudio[ext=m4a]/bestvideo[ext=mp4][height<=${height}]+bestaudio/best[ext=mp4][height<=${height}][acodec!=none]/bestvideo[ext=mp4]+bestaudio/best[ext=mp4][acodec!=none]/bestvideo+bestaudio/best`;
  };

  switch (preset) {
    case '4k':
      return constrainedSelector(2160);
    case '1440p':
      return constrainedSelector(1440);
    case '1080p':
      return constrainedSelector(1080);
    case '720p':
      return constrainedSelector(720);
    case '480p':
      return constrainedSelector(480);
    case '360p':
      return constrainedSelector(360);
    case 'worst':
      return 'worstvideo[ext=mp4]+worstaudio[ext=m4a]/worstvideo[ext=mp4]+worstaudio/worst[ext=mp4][acodec!=none]/worstvideo+worstaudio/worst';
    default:
      return constrainedSelector(1080);
  }
};

export const getAudioQualityValue = (preset: DownloadQualityPreferences['audio']): string => {
  switch (preset) {
    case '320kbps':
      return '320K';
    case '256kbps':
      return '256K';
    case '192kbps':
      return '192K';
    case '128kbps':
      return '128K';
    case '64kbps':
    case 'worst':
      return '64K';
    default:
      return '320K';
  }
};

export const getOverrideVideoFormatSelector = (formatId: string): string => {
  return `${formatId}+bestaudio[ext=m4a]/${formatId}+bestaudio/${formatId}/best[ext=mp4][acodec!=none]/best`;
};

export const getResolvedVideoFormatSelector = (
  url: string,
  preset: DownloadQualityPreferences['video'],
  overrideFormatId?: string | null,
): string => {
  const adapter = registry.resolve(url);
  if (isInstagramUrl(url) || (adapter && (adapter.getStrategy(url) === 'custom-api' || adapter.getStrategy(url) === 'browser'))) {
    return 'best[ext=mp4]/best';
  }

  return overrideFormatId
    ? getOverrideVideoFormatSelector(overrideFormatId)
    : getVideoFormatSelector(preset);
};

export const parseDownloadProgress = (output: string): Pick<DownloadProgress, 'progress' | 'speed' | 'eta'> | null => {
  const progressMatch = output.match(/(\d+\.?\d*)%.*?(\d+\.?\d*\w+\/s).*?ETA\s+(\d+:\d+)/);
  if (!progressMatch) return null;
  return {
    progress: parseFloat(progressMatch[1]),
    speed: progressMatch[2],
    eta: progressMatch[3],
  };
};

export const parseFinalFilePath = (output: string): string | null => {
  let finalPath: string | null = null;
  for (const match of output.matchAll(/^__FLUCTO_FINAL__(".*")\r?$/gm)) {
    try {
      const value: unknown = JSON.parse(match[1]);
      if (typeof value === 'string' && value) finalPath = value;
    } catch {
      // A streaming chunk may end before the JSON path is complete.
    }
  }
  return finalPath;
};

export const buildDownloadArgs = (options: MediaDownloadOptions, binaries: BinaryResolver): string[] => {
  const quality = options.quality ?? defaultQualityPreferences;
  const outputTemplate = path.join(options.outputDir, '%(title)s.%(ext)s');
  const adapter = registry.resolve(options.url);
  const referer = adapter?.getReferer?.(options.url) ?? getRefererForUrl(options.url) ?? '';
  const args = [
    options.url,
    '--output', outputTemplate,
    '--encoding', 'utf-8',
    '--no-check-certificates',
    '--no-warnings',
    '--newline',
    '--print', 'after_move:__FLUCTO_FINAL__%(filepath)j',
    '--no-simulate',
    '--no-quiet',
    '--progress',
    '--no-playlist',
    options.forceOverwrite === false ? '--no-overwrites' : '--force-overwrites',
    ...(referer ? ['--add-header', `referer:${referer}`] : []),
    '--ffmpeg-location', path.dirname(binaries.ffmpegPath),
    ...(adapter?.getYtDlpArgs?.(options.url) ?? getCommonYtDlpArgs(options.url)),
    ...getCaptionNetworkArgs(options.network),
  ];

  if (options.format === 'mp3') {
    const resolvedAudioOverrideId = isInstagramUrl(options.url) ? null : options.formatOverrides?.audioFormatId;
    if (resolvedAudioOverrideId) {
      args.push('--format', resolvedAudioOverrideId);
    }
    args.push(
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', getAudioQualityValue(quality.audio),
    );
  } else {
    args.push(
      '--format',
      getResolvedVideoFormatSelector(options.url, quality.video, options.formatOverrides?.videoFormatId),
      '--merge-output-format',
      'mp4',
    );
  }

  return args;
};

export const runMediaDownload = async (
  options: MediaDownloadOptions,
  deps: MediaDownloadDeps,
): Promise<MediaDownloadResult> => {
  const requestId = options.requestId || randomUUID();
  const title = options.title || 'Downloading...';
  const sleep = deps.sleep ?? defaultSleep;
  let finalFilePath: string | undefined;

  // Check if a custom adapter handles this URL (e.g. Threads)
  const adapter = registry.resolve(options.url);
  if (adapter) {
    const strategy = adapter.getStrategy(options.url);
    if ((strategy === 'custom-api' || strategy === 'browser') && adapter.download) {
      const result = await adapter.download(
        { url: options.url, outputDir: options.outputDir, format: options.format, requestId, title: options.title },
        deps.onProgress,
      );
      return { ...result, requestId, title, url: options.url, format: options.format };
    }
  }

  const tryDownload = async (retryCount = 0): Promise<void> => {
    const args = buildDownloadArgs(options, deps.binaries);
    if ((options.url.includes('x.com') || options.url.includes('twitter.com')) && retryCount > 0) {
      args.push('--extractor-args', 'twitter:api=graph');
    }

    deps.onProgress?.({
      requestId,
      url: options.url,
      status: 'downloading',
      progress: 0,
      title,
    });

    try {
      const subprocess = execa(deps.binaries.ytDlpPath, args);
      subprocess.stdout?.on('data', (data) => {
        const output = data.toString();
        const progress = parseDownloadProgress(output);
        if (progress) {
          deps.onProgress?.({
            requestId,
            url: options.url,
            status: 'downloading',
            title,
            ...progress,
          });
        }
      });
      const result = await subprocess;
      finalFilePath = parseFinalFilePath(result.stdout) ?? undefined;
    } catch (error: unknown) {
      if ((options.url.includes('x.com') || options.url.includes('twitter.com')) && retryCount < 2) {
        await sleep(1000 * (retryCount + 1));
        return tryDownload(retryCount + 1);
      }
      throw error;
    }
  };

  try {
    await tryDownload();
    if (!finalFilePath) throw new Error('yt-dlp completed without reporting the final output file.');
    const filePath = finalFilePath;
    deps.onProgress?.({
      requestId,
      url: options.url,
      status: 'completed',
      progress: 100,
      filePath,
      title,
    });
    return {
      success: true,
      message: 'Download Complete!',
      filePath,
      requestId,
      title,
      url: options.url,
      format: options.format,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    deps.onProgress?.({
      requestId,
      url: options.url,
      status: 'error',
      progress: 0,
      error: message,
      title,
    });
    return {
      success: false,
      message,
      requestId,
      title,
      url: options.url,
      format: options.format,
    };
  }
};

export const singleDownloadRequestToOptions = (
  request: SingleDownloadRequest,
  outputDir: string,
): MediaDownloadOptions => ({
  url: request.url,
  format: request.format,
  outputDir,
  quality: request.quality,
  formatOverrides: request.formatOverrides,
  requestId: request.requestId,
  title: request.title,
});
