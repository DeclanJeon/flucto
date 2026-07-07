import { clipboard, ipcMain } from 'electron';
import { config } from '../config.js';
import { appendHistoryEntry } from '../historyStore.js';
import { logger } from '../logger.js';
import { getStoredDownloadSettings, getStoredTranscriptSettings, settingsStore } from '../store.js';
import { getBinaryPath } from '../utils.js';
import type { TranscriptProgress, TranscriptRequest, TranscriptSettings } from '../../shared/types.js';
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

ipcMain.handle('get-transcript-languages', async (_event, url: string) => {
  try {
    return await listTranscriptLanguages(url, getTranscriptBinaries());
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

ipcMain.handle('convert-transcript-to-markdown', async (event, request: TranscriptRequest) => {
  const response = await convertTranscriptToMarkdown(request, {
    defaults: getStoredTranscriptSettings(),
    binaries: getTranscriptBinaries(),
    outputDir: getTranscriptOutputDir(),
    onProgress: (progress) => emitTranscriptProgress(event.sender, progress),
    writeClipboard: (markdown) => clipboard.writeText(markdown),
    appendHistory: appendHistoryEntry,
  });

  if (!response.success) {
    logger.error('Transcript conversion failed', {
      url: request.url,
      code: response.errorCode,
      message: response.message,
    });
  }

  return response;
});

ipcMain.handle('convert-multiple-transcripts-to-markdown', async (event, requests: TranscriptRequest[]) => {
  await convertMultipleTranscriptsToMarkdown(
    requests,
    {
      defaults: getStoredTranscriptSettings(),
      binaries: getTranscriptBinaries(),
      outputDir: getTranscriptOutputDir(),
      onProgress: (progress) => emitTranscriptProgress(event.sender, progress),
      writeClipboard: (markdown) => clipboard.writeText(markdown),
      appendHistory: appendHistoryEntry,
    },
    TRANSCRIPT_BATCH_CONCURRENCY,
  );
});
