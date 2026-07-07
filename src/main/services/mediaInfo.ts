import type { FormatOption, VideoInfo } from '../../shared/types.js';
import { execa } from '../spawn.js';
import { getCommonYtDlpArgs, getRefererForUrl, parseJsonLines, parseLastJsonObjectFromStdout, type YtDlpMetadata } from '../media/ytDlp.js';
import type { BinaryResolver } from './binaryResolver.js';

const toStringValue = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null;
};

const toNumberValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const toMetadata = (value: unknown): YtDlpMetadata | null => {
  return typeof value === 'object' && value !== null ? (value as YtDlpMetadata) : null;
};

export const extractBestThumbnail = (info: YtDlpMetadata): string | null => {
  if (typeof info.thumbnail === 'string' && info.thumbnail.startsWith('http')) {
    return info.thumbnail;
  }

  if (!Array.isArray(info.thumbnails) || info.thumbnails.length === 0) {
    return null;
  }

  const validItems = info.thumbnails.filter((thumbnail): thumbnail is { url: string } => {
    if (typeof thumbnail !== 'object' || thumbnail === null || !('url' in thumbnail)) {
      return false;
    }
    return typeof thumbnail.url === 'string';
  });

  const candidate = validItems[validItems.length - 1];
  return candidate?.url ?? null;
};

export const getMediaInfo = async (url: string, binaries: BinaryResolver): Promise<VideoInfo> => {
  const referer = getRefererForUrl(url) ?? '';

  const tryFetch = async (retryCount = 0): Promise<YtDlpMetadata> => {
    const args = [
      url,
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '--ignore-errors',
      '--compat-options',
      'no-youtube-unavailable-videos',
      '--compat-options',
      'no-youtube-unavailable-videos',
      ...(referer ? ['--add-header', `referer:${referer}`] : []),
      ...getCommonYtDlpArgs(url),
    ];

    if ((url.includes('x.com') || url.includes('twitter.com')) && retryCount > 0) {
      args.push('--extractor-args', 'twitter:api=graph');
    }

    const result = await execa(binaries.ytDlpPath, args, { reject: false });

    if (result.failed && !result.stdout.trim()) {
      if ((url.includes('x.com') || url.includes('twitter.com')) && retryCount < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
        return tryFetch(retryCount + 1);
      }
      throw new Error(result.stderr || 'No output from yt-dlp');
    }

    try {
      return parseLastJsonObjectFromStdout(result.stdout);
    } catch {
      if ((url.includes('x.com') || url.includes('twitter.com')) && retryCount < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
        return tryFetch(retryCount + 1);
      }
      throw new Error('Could not parse video metadata from yt-dlp output');
    }
  };

  const info = await tryFetch();
  return {
    id: toStringValue(info.id) ?? '',
    title: toStringValue(info.title) || toStringValue(info.description)?.slice(0, 50) || 'Untitled Media',
    thumbnail: extractBestThumbnail(info) ?? '',
    duration: toNumberValue(info.duration),
    uploader: toStringValue(info.uploader) ?? toStringValue(info.uploader_id) ?? 'Unknown',
    view_count: toNumberValue(info.view_count) || toNumberValue(info.like_count),
  };
};

export const getPlaylistInfo = async (url: string, binaries: BinaryResolver): Promise<VideoInfo[]> => {
  const result = await execa(
    binaries.ytDlpPath,
    [
      url,
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings',
      ...getCommonYtDlpArgs(url),
    ],
    { reject: false },
  );

  if (result.failed && !result.stdout.trim()) {
    throw new Error(result.stderr || 'Failed to fetch playlist info');
  }

  const root = parseLastJsonObjectFromStdout(result.stdout);
  const entries = Array.isArray(root.entries) ? root.entries : parseJsonLines(result.stdout);
  const playlistItems = entries.filter((item): item is YtDlpMetadata => {
    const metadata = toMetadata(item);
    return metadata !== null && typeof metadata.id === 'string' && metadata._type !== 'playlist';
  });

  return playlistItems.map((item) => ({
    id: toStringValue(item.id) ?? 'Unknown',
    title: toStringValue(item.title) ?? 'Untitled Video',
    thumbnail: extractBestThumbnail(item) ?? '',
    duration: toNumberValue(item.duration),
    uploader: toStringValue(item.uploader) ?? toStringValue(item.channel) ?? 'Unknown',
    view_count: toNumberValue(item.view_count),
    originalUrl: toStringValue(item.url) ?? `https://www.youtube.com/watch?v=${toStringValue(item.id) ?? ''}`,
  }));
};

export const getAvailableFormats = async (url: string, binaries: BinaryResolver): Promise<FormatOption[]> => {
  const referer = getRefererForUrl(url);
  const result = await execa(
    binaries.ytDlpPath,
    [
      url,
      '-J',
      '--no-warnings',
      '--no-playlist',
      ...(referer ? ['--add-header', `referer:${referer}`] : []),
      ...getCommonYtDlpArgs(url),
    ],
    { reject: false },
  );

  if (result.failed && !result.stdout.trim()) {
    throw new Error(result.stderr || 'Failed to fetch available formats');
  }

  const parsed = parseLastJsonObjectFromStdout(result.stdout);
  if (!Array.isArray(parsed.formats)) {
    return [];
  }

  const formats: FormatOption[] = [];
  for (const raw of parsed.formats) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const format = raw as Record<string, unknown>;
    const formatId = typeof format.format_id === 'string' ? format.format_id : null;
    if (!formatId) {
      continue;
    }

    formats.push({
      formatId,
      ext: typeof format.ext === 'string' ? format.ext : undefined,
      resolution: typeof format.resolution === 'string' ? format.resolution : undefined,
      width: typeof format.width === 'number' ? format.width : undefined,
      height: typeof format.height === 'number' ? format.height : undefined,
      fps: typeof format.fps === 'number' ? format.fps : undefined,
      vcodec: typeof format.vcodec === 'string' ? format.vcodec : undefined,
      acodec: typeof format.acodec === 'string' ? format.acodec : undefined,
      abrKbps: typeof format.abr === 'number' ? format.abr : undefined,
      tbrKbps: typeof format.tbr === 'number' ? format.tbr : undefined,
      filesizeBytes: typeof format.filesize === 'number' ? format.filesize : undefined,
      filesizeApproxBytes: typeof format.filesize_approx === 'number' ? format.filesize_approx : undefined,
      note: typeof format.format_note === 'string'
        ? format.format_note
        : typeof format.format === 'string'
          ? format.format
          : undefined,
    });
  }

  return formats;
};
