import { randomUUID } from 'crypto';
import type { TranscriptBatchSummary, TranscriptMarkdownResponse, TranscriptProgress, TranscriptRequest, TranscriptSettings } from '../../shared/types.js';
import { extractTranscript, listCaptionLanguages } from '../transcript/captionExtractor.js';
import { formatTranscriptMarkdown } from '../transcript/markdownFormatter.js';
import { toTranscriptError } from '../transcript/transcriptError.js';
import type { CaptionNetworkOptions } from '../net/captionNetwork.js';
import type { BinaryResolver } from './binaryResolver.js';
import { getTranscriptSettingsDefaults } from './settingsDefaults.js';
import { saveMarkdownFile } from './markdownFile.js';
import { runWithConcurrency } from './batch.js';

export { saveMarkdownFile };

export interface TranscriptMarkdownDeps {
  binaries?: Partial<BinaryResolver>;
  defaults?: TranscriptSettings;
  outputDir: string;
  network?: CaptionNetworkOptions;
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
  const network = settings?.network === undefined ? defaults.network : settings.network;
  return {
    language,
    includeTimestamps: typeof settings?.includeTimestamps === 'boolean' ? settings.includeTimestamps : defaults.includeTimestamps,
    includeMetadata: typeof settings?.includeMetadata === 'boolean' ? settings.includeMetadata : defaults.includeMetadata,
    paragraphGapSeconds: Math.max(0, paragraphGapSeconds),
    saveMarkdownFile: typeof settings?.saveMarkdownFile === 'boolean' ? settings.saveMarkdownFile : defaults.saveMarkdownFile,
    copyMarkdownToClipboard: typeof settings?.copyMarkdownToClipboard === 'boolean'
      ? settings.copyMarkdownToClipboard
      : defaults.copyMarkdownToClipboard,
    network: network && typeof network === 'object'
      ? {
        cookiesPath: network.cookiesPath?.trim() || null,
        cookiesFromBrowser: network.cookiesFromBrowser?.trim() || null,
        proxy: network.proxy?.trim() || null,
        impersonate: network.impersonate?.trim() || null,
      }
      : null,
  };
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

    // Label the long yt-dlp caption phase explicitly; without this the UI sits
    // at 10% until formatting starts.
    deps.onProgress?.({
      requestId,
      url: request.url,
      title: fallbackTitle,
      status: 'extracting',
      progress: 40,
    });

    const extraction = await extractTranscript(request.url, {
      language: settings.language,
      binaries: deps.binaries,
      network: deps.network,
    });

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
): Promise<TranscriptBatchSummary> => {
  // Mark queued items up front so the UI can distinguish waiting from running.
  for (const request of requests) {
    request.requestId = ensureRequestId(request);
    deps.onProgress?.({
      requestId: request.requestId,
      url: request.url,
      title: request.title || request.url,
      status: 'pending',
      progress: 5,
    });
  }

  const responses = await runWithConcurrency(requests, concurrency, (request) => convertTranscriptToMarkdown(request, deps));
  const succeeded = responses.filter((response) => response.success).length;
  return { total: responses.length, succeeded, failed: responses.length - succeeded };
};

export const listTranscriptLanguages = async (
  url: string,
  binaries?: Partial<BinaryResolver>,
  network?: CaptionNetworkOptions,
) => {
  return listCaptionLanguages(url, binaries, network);
};
