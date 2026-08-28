import fs from 'fs';
import os from 'os';
import path from 'path';
import { execa } from '../spawn.js';
import {
  backoffDelayMs,
  getCaptionNetworkArgs,
  globalCaptionScheduler,
  parseRetryAfterMs,
  resolveCaptionNetworkOptions,
  sleepMs,
  type CaptionNetworkOptions,
} from '../net/captionNetwork.js';
import { getCommonYtDlpArgs, getRefererForUrl, runYtDlpJson, type YtDlpMetadata } from '../media/ytDlp.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { TranscriptCache } from './transcriptCache.js';
import { TranscriptError, toTranscriptError } from './transcriptError.js';
import type { CaptionLanguage, TranscriptExtractionResult, TranscriptMetadata, TranscriptSegment } from './transcriptTypes.js';

const transcriptCache = new TranscriptCache<TranscriptExtractionResult>();
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Fallback fan-out cap: probing every manual + automatic track (YouTube auto-translations
 * alone can number in the dozens) multiplies yt-dlp invocations and deepens rate limiting.
 */
export const MAX_LANGUAGE_CANDIDATES = 3;

export const limitCaptionLanguageCandidates = (candidates: string[]): string[] =>
  candidates.slice(0, MAX_LANGUAGE_CANDIDATES);

const objectRecord = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
};

const stringValue = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null;
};

const numberValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const durationLabel = (seconds: number): string => {
  if (!seconds) return 'N/A';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

const platformKey = (url: string): string => {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('x.com') || url.includes('twitter.com')) return 'twitter';
  if (url.includes('bilibili.com')) return 'bilibili';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('reddit.com')) return 'reddit';
  return 'generic';
};

const breakerForUrl = (url: string): CircuitBreaker => {
  const key = `caption:${platformKey(url)}`;
  const existing = circuitBreakers.get(key);
  if (existing) return existing;
  const breaker = new CircuitBreaker();
  circuitBreakers.set(key, breaker);
  return breaker;
};

const captionMap = (info: YtDlpMetadata, key: 'subtitles' | 'automatic_captions'): Record<string, unknown[]> => {
  const raw = objectRecord(info[key]);
  if (!raw) return {};
  const entries: Record<string, unknown[]> = {};
  for (const [language, value] of Object.entries(raw)) {
    if (Array.isArray(value) && value.length > 0) {
      entries[language] = value;
    }
  }
  return entries;
};

const languageName = (code: string, entries: unknown[]): string => {
  for (const entry of entries) {
    const record = objectRecord(entry);
    const name = stringValue(record?.name) ?? stringValue(record?.language);
    if (name) return name;
  }
  return code;
};

export const listCaptionLanguagesFromInfo = (info: YtDlpMetadata): CaptionLanguage[] => {
  const manual = captionMap(info, 'subtitles');
  const automatic = captionMap(info, 'automatic_captions');
  const languages: CaptionLanguage[] = [];

  for (const [code, entries] of Object.entries(manual)) {
    languages.push({ code, name: languageName(code, entries), isAuto: false });
  }
  for (const [code, entries] of Object.entries(automatic)) {
    if (!languages.some((language) => language.code === code)) {
      languages.push({ code, name: languageName(code, entries), isAuto: true });
    }
  }

  return languages.sort((a, b) => a.code.localeCompare(b.code));
};

export const resolveCaptionLanguage = (info: YtDlpMetadata, requestedLanguage?: string | null): string | null => {
  const candidates = resolveCaptionLanguageCandidates(info, requestedLanguage);
  return candidates[0] ?? null;
};

export const resolveCaptionLanguageCandidates = (
  info: YtDlpMetadata,
  requestedLanguage?: string | null,
): string[] => {
  const manual = captionMap(info, 'subtitles');
  const automatic = captionMap(info, 'automatic_captions');
  const requested = requestedLanguage?.trim() === 'auto' ? null : requestedLanguage?.trim() || null;
  const base = requested?.split('-')[0] ?? null;
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (code: string | null | undefined) => {
    if (!code || seen.has(code)) return;
    if (!manual[code] && !automatic[code]) return;
    seen.add(code);
    ordered.push(code);
  };

  push(requested);
  push(base);
  if (requested) {
    push(`${base}-orig`);
    push(`${requested}-orig`);
  }

  for (const code of Object.keys(manual)) push(code);
  // Prefer original ASR track before translated auto captions when possible.
  for (const code of Object.keys(automatic)) {
    if (code.endsWith('-orig')) push(code);
  }
  for (const code of Object.keys(automatic)) push(code);

  return ordered;
};

export const parseJson3Captions = (payload: string): TranscriptSegment[] => {
  const root = JSON.parse(payload) as Record<string, unknown>;
  const events = Array.isArray(root.events) ? root.events : [];
  const segments: TranscriptSegment[] = [];

  for (const event of events) {
    const record = objectRecord(event);
    if (!record) continue;
    const parts = Array.isArray(record.segs) ? record.segs : [];
    const text = parts
      .map((part) => stringValue(objectRecord(part)?.utf8) ?? '')
      .join('')
      .trim();
    if (!text) continue;
    segments.push({
      text,
      start: numberValue(record.tStartMs) / 1000,
      duration: numberValue(record.dDurationMs) / 1000,
    });
  }

  return segments;
};

export const parseXmlCaptions = (payload: string): TranscriptSegment[] => {
  const segments: TranscriptSegment[] = [];
  const srv3NodePattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  const srv3AttrPattern = /\b(t|d)="([^"]*)"/g;
  let srv3Match: RegExpExecArray | null;

  while ((srv3Match = srv3NodePattern.exec(payload)) !== null) {
    const attrs = srv3Match[1];
    const text = srv3Match[2].replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    const values: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = srv3AttrPattern.exec(attrs)) !== null) {
      values[attrMatch[1]] = attrMatch[2];
    }
    if (values.t !== undefined) {
      segments.push({
        text,
        start: (Number.parseFloat(values.t) || 0) / 1000,
        duration: (Number.parseFloat(values.d ?? '0') || 0) / 1000,
      });
    }
  }

  if (segments.length > 0) {
    return segments;
  }

  const textNodePattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  const attrPattern = /(start|dur|duration)="([^"]*)"/g;
  let nodeMatch: RegExpExecArray | null;

  while ((nodeMatch = textNodePattern.exec(payload)) !== null) {
    const attrs = nodeMatch[1];
    const text = nodeMatch[2].replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    const values: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrPattern.exec(attrs)) !== null) {
      values[attrMatch[1]] = attrMatch[2];
    }
    segments.push({
      text,
      start: Number.parseFloat(values.start ?? '0') || 0,
      duration: Number.parseFloat(values.dur ?? values.duration ?? '0') || 0,
    });
  }

  return segments;
};

const secondsFromTimestamp = (timestamp: string): number => {
  const parts = timestamp.trim().split(':');
  const secondPart = parts.pop() ?? '0';
  const seconds = Number.parseFloat(secondPart.replace(',', '.')) || 0;
  const minutes = Number.parseInt(parts.pop() ?? '0', 10) || 0;
  const hours = Number.parseInt(parts.pop() ?? '0', 10) || 0;
  return hours * 3600 + minutes * 60 + seconds;
};

export const parseVttCaptions = (payload: string): TranscriptSegment[] => {
  const blocks = payload.replace(/\r/g, '').split(/\n\n+/);
  const segments: TranscriptSegment[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0 || lines[0] === 'WEBVTT' || lines[0].startsWith('NOTE')) continue;
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [startRaw, endRaw] = lines[timingIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!startRaw || !endRaw || !text) continue;
    const start = secondsFromTimestamp(startRaw);
    const end = secondsFromTimestamp(endRaw);
    segments.push({ text, start, duration: Math.max(0, end - start) });
  }

  return segments;
};

const parseCaptionFile = (filePath: string): TranscriptSegment[] => {
  const payload = fs.readFileSync(filePath, 'utf8');
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json3' || payload.trimStart().startsWith('{')) return parseJson3Captions(payload);
  if (extension === '.vtt') return parseVttCaptions(payload);
  return parseXmlCaptions(payload);
};

const buildMetadata = (info: YtDlpMetadata, url: string, language: string): TranscriptMetadata => {
  const webpageUrl = stringValue(info.webpage_url) ?? url;
  const title = stringValue(info.title) ?? stringValue(info.description)?.slice(0, 50) ?? 'Untitled Media';
  const channel = stringValue(info.uploader) ?? stringValue(info.channel) ?? stringValue(info.uploader_id) ?? 'Unknown';
  return {
    id: stringValue(info.id) ?? '',
    title,
    channel,
    duration: durationLabel(numberValue(info.duration)),
    url: webpageUrl,
    platform: stringValue(info.extractor_key) ?? platformKey(url),
    language,
  };
};

const fetchCaptionInfo = async (
  url: string,
  binaries?: { ytDlpPath?: string },
  network: CaptionNetworkOptions = {},
): Promise<YtDlpMetadata> => {
  const networkArgs = getCaptionNetworkArgs(network);
  return runYtDlpJson(url, ['--skip-download', '--no-playlist', ...networkArgs], binaries?.ytDlpPath ?? 'yt-dlp');
};

export const listCaptionLanguages = async (
  url: string,
  binaries?: { ytDlpPath?: string },
  network: CaptionNetworkOptions = {},
): Promise<CaptionLanguage[]> => {
  const info = await fetchCaptionInfo(url, binaries, network);
  return listCaptionLanguagesFromInfo(info);
};

const listCaptionFiles = (tmpDir: string): string[] => {
  return fs.readdirSync(tmpDir)
    .map((file) => path.join(tmpDir, file))
    .filter((file) => ['.json3', '.srv3', '.xml', '.vtt'].includes(path.extname(file).toLowerCase()))
    .sort((a, b) => {
      const score = (file: string): number => {
        const ext = path.extname(file).toLowerCase();
        if (ext === '.json3') return 0;
        if (ext === '.srv3' || ext === '.xml') return 1;
        return 2;
      };
      return score(a) - score(b);
    });
};

const clearDirectory = (dir: string): void => {
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
};

const downloadCaptionLanguage = async (
  url: string,
  language: string,
  tmpDir: string,
  ytDlpPath: string,
  network: CaptionNetworkOptions,
): Promise<{ segments: TranscriptSegment[]; output: string; failed: boolean }> => {
  clearDirectory(tmpDir);
  const referer = getRefererForUrl(url);
  const downloadResult = await execa(
    ytDlpPath,
    [
      url,
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      language,
      '--sub-format',
      'json3/srv3/vtt/best',
      '--output',
      path.join(tmpDir, '%(id)s.%(ext)s'),
      '--no-warnings',
      '--no-playlist',
      ...(referer ? ['--add-header', `referer:${referer}`] : []),
      ...getCommonYtDlpArgs(url),
      ...getCaptionNetworkArgs(network),
    ],
    { reject: false },
  );

  const files = listCaptionFiles(tmpDir);
  for (const file of files) {
    const segments = parseCaptionFile(file);
    if (segments.length > 0) {
      return { segments, output: '', failed: false };
    }
  }

  const output = [downloadResult.stderr, downloadResult.stdout]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');

  return {
    segments: [],
    output,
    failed: downloadResult.failed || files.length === 0,
  };
};

export interface ExtractTranscriptOptions {
  language?: string | null;
  binaries?: { ytDlpPath?: string };
  network?: CaptionNetworkOptions;
}

export const extractTranscript = async (
  url: string,
  requestedLanguage?: string | null | ExtractTranscriptOptions,
  binaries?: { ytDlpPath?: string },
): Promise<TranscriptExtractionResult> => {
  const options: ExtractTranscriptOptions = requestedLanguage && typeof requestedLanguage === 'object'
    ? requestedLanguage
    : {
      language: typeof requestedLanguage === 'string' || requestedLanguage === null ? requestedLanguage : undefined,
      binaries,
    };

  const language = options.language ?? null;
  const ytBinaries = options.binaries ?? binaries;
  const network = resolveCaptionNetworkOptions(options.network ?? {});

  return globalCaptionScheduler.run(
    () => extractTranscriptNow(url, language, ytBinaries, network),
    network.minIntervalMs,
  );
};

const extractTranscriptNow = async (
  url: string,
  requestedLanguage: string | null,
  binaries: { ytDlpPath?: string } | undefined,
  network: CaptionNetworkOptions,
): Promise<TranscriptExtractionResult> => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TranscriptError('INVALID_URL', 'Invalid media URL.', url);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new TranscriptError('INVALID_URL', 'Only HTTP(S) media URLs are supported.', url);
  }

  const breaker = breakerForUrl(url);
  if (breaker.isOpen()) {
    throw new TranscriptError('SERVICE_UNAVAILABLE', 'Caption extraction is temporarily unavailable.');
  }

  const networkKey = [
    network.cookiesPath ?? '',
    network.cookiesFromBrowser ?? '',
    network.proxy ?? '',
    network.impersonate ?? '',
  ].join('|');
  const cacheKey = `${url}|${requestedLanguage ?? 'auto'}|${networkKey}`;
  const cached = transcriptCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let tmpDir: string | null = null;
  try {
    const maxRetries = Math.max(0, network.maxRetries ?? 3);
    let info: YtDlpMetadata | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        info = await fetchCaptionInfo(url, binaries, network);
        lastError = null;
        break;
      } catch (error: unknown) {
        lastError = error;
        const transcriptError = toTranscriptError(error);
        if (transcriptError.code !== 'RATE_LIMITED' || attempt >= maxRetries) {
          throw transcriptError;
        }
        await sleepMs(backoffDelayMs(attempt, parseRetryAfterMs(transcriptError.detail ?? transcriptError.message)));
      }
    }

    if (!info) {
      throw toTranscriptError(lastError ?? new Error('Caption metadata fetch failed.'));
    }

    const availableLanguages = listCaptionLanguagesFromInfo(info);
    const languageCandidates = resolveCaptionLanguageCandidates(info, requestedLanguage);
    if (languageCandidates.length === 0) {
      throw new TranscriptError('TRANSCRIPT_UNAVAILABLE', 'No captions are available for this media.');
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-transcript-'));
    const ytDlpPath = binaries?.ytDlpPath ?? 'yt-dlp';
    let lastDownloadError: TranscriptError | null = null;
    const attemptedLanguages: string[] = [];
    let rateLimited = false;

    for (const candidateLanguage of limitCaptionLanguageCandidates(languageCandidates)) {
      attemptedLanguages.push(candidateLanguage);
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const download = await downloadCaptionLanguage(url, candidateLanguage, tmpDir, ytDlpPath, network);
        if (download.segments.length > 0) {
          const extraction = {
            segments: download.segments,
            metadata: buildMetadata(info, url, candidateLanguage),
            availableLanguages,
          };
          transcriptCache.set(cacheKey, extraction);
          breaker.recordSuccess();
          return extraction;
        }

        if (download.output) {
          const transcriptError = toTranscriptError(new Error(download.output));
          lastDownloadError = transcriptError;
          if (transcriptError.code === 'RATE_LIMITED' && attempt < maxRetries) {
            await sleepMs(backoffDelayMs(attempt, parseRetryAfterMs(download.output)));
            continue;
          }
          if (transcriptError.code === 'RATE_LIMITED') {
            // Retrying other languages under rate limiting only invites more 429s.
            rateLimited = true;
            break;
          }
          // Try next language on rate-limit / empty caption download.
          break;
        }

        if (download.failed) {
          lastDownloadError = new TranscriptError('UPSTREAM_ERROR', 'Caption download failed.');
          break;
        }

        lastDownloadError = new TranscriptError(
          'TRANSCRIPT_UNAVAILABLE',
          'Caption files were empty after download.',
        );
        break;
      }
      if (rateLimited) break;
    }

    if (lastDownloadError) {
      if (lastDownloadError.code === 'TRANSCRIPT_UNAVAILABLE' && attemptedLanguages.length > 0) {
        throw new TranscriptError(
          lastDownloadError.code,
          `${lastDownloadError.message} (attempted caption languages: ${attemptedLanguages.join(', ')})`,
        );
      }
      throw lastDownloadError;
    }
    throw new TranscriptError('TRANSCRIPT_UNAVAILABLE', 'Caption files were not generated or were empty.');
  } catch (error: unknown) {
    const transcriptError = toTranscriptError(error);
    if (!['TRANSCRIPT_UNAVAILABLE', 'INVALID_URL', 'TRANSCRIPT_DISABLED', 'VIDEO_UNAVAILABLE'].includes(transcriptError.code)) {
      breaker.recordFailure();
    }
    throw transcriptError;
  } finally {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
};
