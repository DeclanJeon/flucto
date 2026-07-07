import fs from 'fs';
import os from 'os';
import path from 'path';
import { execa } from '../spawn.js';
import { getCommonYtDlpArgs, getRefererForUrl, runYtDlpJson, type YtDlpMetadata } from '../media/ytDlp.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { TranscriptCache } from './transcriptCache.js';
import { TranscriptError, toTranscriptError } from './transcriptError.js';
import type { CaptionLanguage, TranscriptExtractionResult, TranscriptMetadata, TranscriptSegment } from './transcriptTypes.js';

const transcriptCache = new TranscriptCache<TranscriptExtractionResult>();
const circuitBreakers = new Map<string, CircuitBreaker>();

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
  const manual = captionMap(info, 'subtitles');
  const automatic = captionMap(info, 'automatic_captions');
  const requested = requestedLanguage?.trim() === 'auto' ? null : requestedLanguage?.trim() || null;
  const base = requested?.split('-')[0] ?? null;

  if (requested && manual[requested]) return requested;
  if (requested && automatic[requested]) return requested;
  if (base && manual[base]) return base;
  if (base && automatic[base]) return base;

  const manualLanguage = Object.keys(manual)[0];
  if (manualLanguage) return manualLanguage;
  const automaticLanguage = Object.keys(automatic)[0];
  return automaticLanguage || null;
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

const fetchCaptionInfo = async (url: string, binaries?: { ytDlpPath?: string }): Promise<YtDlpMetadata> => {
  return runYtDlpJson(url, ['--skip-download', '--no-playlist'], binaries?.ytDlpPath ?? 'yt-dlp');
};

export const listCaptionLanguages = async (url: string, binaries?: { ytDlpPath?: string }): Promise<CaptionLanguage[]> => {
  const info = await fetchCaptionInfo(url, binaries);
  return listCaptionLanguagesFromInfo(info);
};

export const extractTranscript = async (url: string, requestedLanguage?: string | null, binaries?: { ytDlpPath?: string }): Promise<TranscriptExtractionResult> => {
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

  const cacheKey = `${url}|${requestedLanguage ?? 'auto'}`;
  const cached = transcriptCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let tmpDir: string | null = null;
  try {
    const info = await fetchCaptionInfo(url, binaries);
    const availableLanguages = listCaptionLanguagesFromInfo(info);
    const resolvedLanguage = resolveCaptionLanguage(info, requestedLanguage);
    if (!resolvedLanguage) {
      throw new TranscriptError('TRANSCRIPT_UNAVAILABLE', 'No captions are available for this media.');
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-transcript-'));
    const ytDlpPath = binaries?.ytDlpPath ?? 'yt-dlp';
    const referer = getRefererForUrl(url);
    await execa(
      ytDlpPath,
      [
        url,
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        resolvedLanguage,
        '--sub-format',
        'json3/srv3/vtt/best',
        '--output',
        path.join(tmpDir, '%(id)s.%(ext)s'),
        '--no-warnings',
        '--no-playlist',
        ...(referer ? ['--add-header', `referer:${referer}`] : []),
        ...getCommonYtDlpArgs(url),
      ],
      { reject: false },
    );

    const files = fs.readdirSync(tmpDir)
      .map((file) => path.join(tmpDir as string, file))
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

    for (const file of files) {
      const segments = parseCaptionFile(file);
      if (segments.length > 0) {
        const extraction = {
          segments,
          metadata: buildMetadata(info, url, resolvedLanguage),
          availableLanguages,
        };
        transcriptCache.set(cacheKey, extraction);
        breaker.recordSuccess();
        return extraction;
      }
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
