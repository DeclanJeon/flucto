import { clipboard, dialog, ipcMain } from 'electron';
import { config } from '../config.js';
import { appendHistoryEntry } from '../historyStore.js';
import { logger } from '../logger.js';
import { getStoredDownloadSettings, getStoredTranscriptSettings, settingsStore } from '../store.js';
import { getBinaryPath } from '../utils.js';
import type { TranscriptBatchSummary, TranscriptProgress, TranscriptRequest, TranscriptSettings } from '../../shared/types.js';
import { resolveCaptionNetworkOptions, type CaptionNetworkOptions } from '../net/captionNetwork.js';
import {
  convertMultipleTranscriptsToMarkdown,
  convertTranscriptToMarkdown,
  listTranscriptLanguages,
  normalizeTranscriptSettings,
} from '../services/transcriptMarkdown.js';
import { TranscriptError, toTranscriptError } from './transcriptError.js';

const TRANSCRIPT_PROGRESS_CHANNEL = 'transcript-progress';
const TRANSCRIPT_BATCH_CONCURRENCY = 2;

const emitTranscriptProgress = (sender: Electron.WebContents, progress: TranscriptProgress): void => {
  sender.send(TRANSCRIPT_PROGRESS_CHANNEL, progress);
};

const getTranscriptOutputDir = (): string => {
  const settings = getStoredDownloadSettings();
  return settings.downloadsDirectory || config.paths.downloads;
};

const getTranscriptBinaries = () => ({
  ytDlpPath: getBinaryPath('yt-dlp'),
  ffmpegPath: getBinaryPath('ffmpeg'),
});

// UI values take precedence; unset fields fall back to FLUCTO_* env vars
// via resolveCaptionNetworkOptions.
const getTranscriptNetwork = (): CaptionNetworkOptions =>
  resolveCaptionNetworkOptions(getStoredTranscriptSettings().network ?? {});

const transcriptConversionDeps = (sender: Electron.WebContents) => ({
  defaults: getStoredTranscriptSettings(),
  binaries: getTranscriptBinaries(),
  outputDir: getTranscriptOutputDir(),
  network: getTranscriptNetwork(),
  onProgress: (progress: TranscriptProgress) => emitTranscriptProgress(sender, progress),
  writeClipboard: (markdown: string) => clipboard.writeText(markdown),
  appendHistory: appendHistoryEntry,
});

ipcMain.handle('get-transcript-languages', async (_event, url: string) => {
  try {
    return await listTranscriptLanguages(url, getTranscriptBinaries(), getTranscriptNetwork());
  } catch (error: unknown) {
    const transcriptError = error instanceof TranscriptError ? error : toTranscriptError(error);
    throw new Error(transcriptError.message);
  }
});

ipcMain.handle('get-transcript-settings', () => {
  return getStoredTranscriptSettings();
});

ipcMain.handle('set-transcript-settings', (_event, settings: TranscriptSettings) => {
  settingsStore.set('transcriptSettings', normalizeTranscriptSettings(settings, getStoredTranscriptSettings()));
});

ipcMain.handle('pick-cookies-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select cookies.txt',
    properties: ['openFile'],
    filters: [{ name: 'Cookies file', extensions: ['txt'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('convert-transcript-to-markdown', async (event, request: TranscriptRequest) => {
  const response = await convertTranscriptToMarkdown(request, transcriptConversionDeps(event.sender));

  if (!response.success) {
    logger.error('Transcript conversion failed', {
      url: request.url,
      code: response.errorCode,
      message: response.message,
    });
  }

  return response;
});

ipcMain.handle('convert-multiple-transcripts-to-markdown', async (event, requests: TranscriptRequest[]): Promise<TranscriptBatchSummary> => {
  return convertMultipleTranscriptsToMarkdown(
    requests,
    transcriptConversionDeps(event.sender),
    TRANSCRIPT_BATCH_CONCURRENCY,
  );
});
