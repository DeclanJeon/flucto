import path from 'path';
import { randomUUID } from 'crypto';
import type { DownloadProgress, DownloadQualityPreferences, DownloadResponse, MediaDownloadFormat, SingleDownloadRequest } from '../../shared/types.js';
import { execa } from '../spawn.js';
import { getCommonYtDlpArgs, getRefererForUrl, isThreadsUrl } from '../media/ytDlp.js';
import { downloadThreadsVideo } from '../media/threads.js';
import type { BinaryResolver } from './binaryResolver.js';
import { defaultQualityPreferences } from './settingsDefaults.js';

export interface MediaDownloadOptions {
  url: string;
  format: MediaDownloadFormat;
  outputDir: string;
  quality?: DownloadQualityPreferences;
  formatOverrides?: { videoFormatId: string | null; audioFormatId: string | null };
  requestId?: string;
  title?: string;
  forceOverwrite?: boolean;
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
    return `bestvideo[ext=mp4][height<=${height}]+bestaudio[ext=m4a]/best[ext=mp4][height<=${height}][acodec!=none]/best[ext=mp4][acodec!=none]/worst[ext=mp4][acodec!=none]/mp4/best`;
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
      return 'worst[ext=mp4]/mp4/worst';
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
  if (isInstagramUrl(url) || isThreadsUrl(url)) {
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
  const mergerMatch = output.match(/\[Merger\].*?-> (.+\.mp4)|Merging formats into\s+"(.+?)"/);
  if (mergerMatch) return mergerMatch[1] || mergerMatch[2] || null;
  const destinationMatch = output.match(/\[download\]\s+Destination:\s+(.+)/);
  if (destinationMatch) return destinationMatch[1].trim();
  const alreadyDownloadedMatch = output.match(/\[download\]\s+(.+)\s+has already been downloaded/);
  if (alreadyDownloadedMatch) return alreadyDownloadedMatch[1].trim();
  return null;
};

export const buildDownloadArgs = (options: MediaDownloadOptions, binaries: BinaryResolver): string[] => {
  const quality = options.quality ?? defaultQualityPreferences;
  const outputTemplate = path.join(options.outputDir, '%(title)s.%(ext)s');
  const referer = getRefererForUrl(options.url) ?? '';
  const args = [
    options.url,
    '--output', outputTemplate,
    '--encoding', 'utf-8',
    '--no-check-certificates',
    '--no-warnings',
    '--newline',
    '--no-playlist',
    options.forceOverwrite === false ? '--no-overwrites' : '--force-overwrites',
    ...(referer ? ['--add-header', `referer:${referer}`] : []),
    '--ffmpeg-location', path.dirname(binaries.ffmpegPath),
    ...getCommonYtDlpArgs(options.url),
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
  const outputTemplate = path.join(options.outputDir, '%(title)s.%(ext)s');
  let finalFilePath: string | undefined;

  // Threads: use dedicated downloader (yt-dlp has no Threads extractor)
  if (isThreadsUrl(options.url)) {
    const result = await downloadThreadsVideo(
      { url: options.url, outputDir: options.outputDir, requestId, title: options.title },
      deps.onProgress,
    );
    return { ...result, format: options.format };
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
        const parsedFilePath = parseFinalFilePath(output);
        if (parsedFilePath) finalFilePath = parsedFilePath;
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
      subprocess.stderr?.on('data', (data) => {
        const parsedFilePath = parseFinalFilePath(data.toString());
        if (parsedFilePath) finalFilePath = parsedFilePath;
      });
      const result = await subprocess;
      const parsedFilePath = parseFinalFilePath(`${result.stdout}\n${result.stderr}`);
      if (parsedFilePath) finalFilePath = parsedFilePath;
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
    const filePath = finalFilePath || outputTemplate;
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
