import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { TranscriptMarkdownResponse, TranscriptProgress, TranscriptRequest, TranscriptSettings } from '../../shared/types.js';
import { extractTranscript, listCaptionLanguages } from '../transcript/captionExtractor.js';
import { formatTranscriptMarkdown, sanitizeMarkdownFilename } from '../transcript/markdownFormatter.js';
import { toTranscriptError } from '../transcript/transcriptError.js';
import type { BinaryResolver } from './binaryResolver.js';
import { getTranscriptSettingsDefaults } from './settingsDefaults.js';
import { runWithConcurrency } from './batch.js';

export interface TranscriptMarkdownDeps {
  binaries?: Partial<BinaryResolver>;
  defaults?: TranscriptSettings;
  outputDir: string;
  onProgress?: (progress: TranscriptProgress) => void;
  writeClipboard?: (markdown: string) => void;
  appendHistory?: (entry: {
    id: string;
    url: string;
    title: string;
    timestamp: number;
    status: 'success' | 'error';
    filePath: string | null;
    errorMessage?: string;
    format: 'md';
  }) => void;
  now?: () => number;
}

const ensureRequestId = (request: TranscriptRequest): string => {
  return request.requestId || randomUUID();
};

export const transcriptWordCount = (markdown: string): number => {
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
};

export const normalizeTranscriptSettings = (
  settings?: Partial<TranscriptSettings>,
  defaults: TranscriptSettings = getTranscriptSettingsDefaults(),
): TranscriptSettings => {
  const hasLanguage = settings !== undefined && Object.prototype.hasOwnProperty.call(settings, 'language');
  const requestedLanguage = typeof settings?.language === 'string' ? settings.language.trim() : '';
  const language = hasLanguage
    ? (requestedLanguage === 'auto' ? null : requestedLanguage || defaults.language)
    : defaults.language;
  const paragraphGapSeconds = typeof settings?.paragraphGapSeconds === 'number'
    ? settings.paragraphGapSeconds
    : defaults.paragraphGapSeconds;
  return {
    language,
    includeTimestamps: typeof settings?.includeTimestamps === 'boolean' ? settings.includeTimestamps : defaults.includeTimestamps,
    includeMetadata: typeof settings?.includeMetadata === 'boolean' ? settings.includeMetadata : defaults.includeMetadata,
    paragraphGapSeconds: Math.max(0, paragraphGapSeconds),
    saveMarkdownFile: typeof settings?.saveMarkdownFile === 'boolean' ? settings.saveMarkdownFile : defaults.saveMarkdownFile,
    copyMarkdownToClipboard: typeof settings?.copyMarkdownToClipboard === 'boolean'
      ? settings.copyMarkdownToClipboard
      : defaults.copyMarkdownToClipboard,
  };
};

export const saveMarkdownFile = (outputDir: string, title: string, markdown: string): string => {
  fs.mkdirSync(outputDir, { recursive: true });
  const parsed = path.parse(sanitizeMarkdownFilename(title));
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const filePath = path.join(outputDir, `${parsed.name}${suffix}${parsed.ext}`);
    try {
      fs.writeFileSync(filePath, markdown, { encoding: 'utf8', flag: 'wx' });
      return filePath;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
  throw new Error('Could not allocate a unique Markdown filename.');
};

export const convertTranscriptToMarkdown = async (
  request: TranscriptRequest,
  deps: TranscriptMarkdownDeps,
): Promise<TranscriptMarkdownResponse> => {
  const requestId = ensureRequestId(request);
  const fallbackTitle = request.title || request.url;
  const settings = normalizeTranscriptSettings(request.settings, deps.defaults ?? getTranscriptSettingsDefaults());
  const now = deps.now ?? Date.now;

  try {
    deps.onProgress?.({
      requestId,
      url: request.url,
      title: fallbackTitle,
      status: 'analyzing',
      progress: 10,
    });

    const extraction = await extractTranscript(request.url, settings.language, deps.binaries);

    deps.onProgress?.({
      requestId,
      url: request.url,
      title: extraction.metadata.title,
      status: 'formatting',
      progress: 75,
    });

    const markdown = formatTranscriptMarkdown(extraction.segments, extraction.metadata, {
      includeTimestamps: settings.includeTimestamps,
      includeMetadata: settings.includeMetadata,
      paragraphGapSeconds: settings.paragraphGapSeconds,
    });

    let filePath: string | undefined;
    if (settings.saveMarkdownFile) {
      deps.onProgress?.({
        requestId,
        url: request.url,
        title: extraction.metadata.title,
        status: 'saving',
        progress: 90,
      });
      filePath = saveMarkdownFile(deps.outputDir, extraction.metadata.title, markdown);
    }

    if (settings.copyMarkdownToClipboard) {
      deps.writeClipboard?.(markdown);
    }

    deps.appendHistory?.({
      id: requestId,
      url: request.url,
      title: extraction.metadata.title,
      timestamp: now(),
      status: 'success',
      filePath: filePath ?? null,
      format: 'md',
    });

    deps.onProgress?.({
      requestId,
      url: request.url,
      title: extraction.metadata.title,
      status: 'completed',
      progress: 100,
      filePath,
    });

    return {
      success: true,
      message: 'Markdown conversion complete.',
      filePath,
      markdown,
      title: extraction.metadata.title,
      language: extraction.metadata.language,
      availableLanguages: extraction.availableLanguages,
      segmentCount: extraction.segments.length,
      wordCount: transcriptWordCount(markdown),
    };
  } catch (error: unknown) {
    const transcriptError = toTranscriptError(error);
    deps.appendHistory?.({
      id: requestId,
      url: request.url,
      title: fallbackTitle,
      timestamp: now(),
      status: 'error',
      filePath: null,
      errorMessage: transcriptError.message,
      format: 'md',
    });
    deps.onProgress?.({
      requestId,
      url: request.url,
      title: fallbackTitle,
      status: 'error',
      progress: 0,
      error: transcriptError.message,
    });
    return {
      success: false,
      message: transcriptError.message,
      errorCode: transcriptError.code,
    };
  }
};

export const convertMultipleTranscriptsToMarkdown = async (
  requests: TranscriptRequest[],
  deps: TranscriptMarkdownDeps,
  concurrency = 2,
): Promise<TranscriptMarkdownResponse[]> => {
  return runWithConcurrency(requests, concurrency, (request) => convertTranscriptToMarkdown(request, deps));
};

export const listTranscriptLanguages = async (url: string, binaries?: Partial<BinaryResolver>) => {
  return listCaptionLanguages(url, binaries);
};
