import { clipboard, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { appendHistoryEntry } from '../historyStore.js';
import { logger } from '../logger.js';
import { getStoredDownloadSettings, getStoredTranscriptSettings, settingsStore } from '../store.js';
import type { TranscriptMarkdownResponse, TranscriptProgress, TranscriptRequest, TranscriptSettings } from '../../shared/types.js';
import { extractTranscript, listCaptionLanguages } from './captionExtractor.js';
import { formatTranscriptMarkdown, sanitizeMarkdownFilename } from './markdownFormatter.js';
import { TranscriptError, toTranscriptError } from './transcriptError.js';

const TRANSCRIPT_PROGRESS_CHANNEL = 'transcript-progress';
const TRANSCRIPT_BATCH_CONCURRENCY = 2;

const emitTranscriptProgress = (sender: Electron.WebContents, progress: TranscriptProgress): void => {
  sender.send(TRANSCRIPT_PROGRESS_CHANNEL, progress);
};

const ensureRequestId = (request: TranscriptRequest): string => {
  return request.requestId || randomUUID();
};

const wordCount = (markdown: string): number => {
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
};

const saveMarkdown = (title: string, markdown: string): string => {
  const settings = getStoredDownloadSettings();
  const downloadsPath = settings.downloadsDirectory || config.paths.downloads;
  fs.mkdirSync(downloadsPath, { recursive: true });
  const parsed = path.parse(sanitizeMarkdownFilename(title));
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const filePath = path.join(downloadsPath, `${parsed.name}${suffix}${parsed.ext}`);
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

const normalizeTranscriptSettings = (settings?: Partial<TranscriptSettings>): TranscriptSettings => {
  const defaults = getStoredTranscriptSettings();
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

const convertOne = async (
  sender: Electron.WebContents,
  request: TranscriptRequest,
): Promise<TranscriptMarkdownResponse> => {
  const requestId = ensureRequestId(request);
  const title = request.title || request.url;
  const settings = normalizeTranscriptSettings(request.settings);

  try {
    emitTranscriptProgress(sender, {
      requestId,
      url: request.url,
      title,
      status: 'analyzing',
      progress: 10,
    });

    const extraction = await extractTranscript(request.url, settings.language);

    emitTranscriptProgress(sender, {
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
      emitTranscriptProgress(sender, {
        requestId,
        url: request.url,
        title: extraction.metadata.title,
        status: 'saving',
        progress: 90,
      });
      filePath = saveMarkdown(extraction.metadata.title, markdown);
    }

    if (settings.copyMarkdownToClipboard) {
      clipboard.writeText(markdown);
    }

    appendHistoryEntry({
      id: requestId,
      url: request.url,
      title: extraction.metadata.title,
      timestamp: Date.now(),
      status: 'success',
      filePath: filePath ?? null,
      format: 'md',
    });

    emitTranscriptProgress(sender, {
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
      wordCount: wordCount(markdown),
    };
  } catch (error: unknown) {
    const transcriptError = toTranscriptError(error);
    logger.error('Transcript conversion failed', {
      url: request.url,
      code: transcriptError.code,
      detail: transcriptError.detail,
    });

    appendHistoryEntry({
      id: requestId,
      url: request.url,
      title,
      timestamp: Date.now(),
      status: 'error',
      filePath: null,
      errorMessage: transcriptError.message,
      format: 'md',
    });

    emitTranscriptProgress(sender, {
      requestId,
      url: request.url,
      title,
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

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  let nextIndex = 0;

  const runNext = async (): Promise<void> => {
    const currentIndex = nextIndex;
    nextIndex += 1;
    if (currentIndex >= items.length) return;
    results[currentIndex] = await worker(items[currentIndex]);
    await runNext();
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
  return results;
};

ipcMain.handle('get-transcript-languages', async (_event, url: string) => {
  try {
    return await listCaptionLanguages(url);
  } catch (error: unknown) {
    const transcriptError = error instanceof TranscriptError ? error : toTranscriptError(error);
    throw new Error(transcriptError.message);
  }
});

ipcMain.handle('get-transcript-settings', () => {
  return getStoredTranscriptSettings();
});

ipcMain.handle('set-transcript-settings', (_event, settings: TranscriptSettings) => {
  settingsStore.set('transcriptSettings', normalizeTranscriptSettings(settings));
});

ipcMain.handle('convert-transcript-to-markdown', async (event, request: TranscriptRequest) => {
  return convertOne(event.sender, request);
});

ipcMain.handle('convert-multiple-transcripts-to-markdown', async (event, requests: TranscriptRequest[]) => {
  await runWithConcurrency(requests, TRANSCRIPT_BATCH_CONCURRENCY, (request) => convertOne(event.sender, request));
});
