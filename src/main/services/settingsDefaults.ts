import type { DownloadQualityPreferences, TranscriptSettings, UpdateSettings } from '../../shared/types.js';

export const defaultUpdateSettings: UpdateSettings = {
  autoUpdate: true,
  checkInterval: 86400000,
  notifyOnUpdateReady: true,
};

export const defaultQualityPreferences: DownloadQualityPreferences = {
  video: '1080p',
  audio: '320kbps',
};

export const defaultTranscriptSettings: TranscriptSettings = {
  language: 'en',
  includeTimestamps: true,
  includeMetadata: true,
  paragraphGapSeconds: 3,
  saveMarkdownFile: true,
  copyMarkdownToClipboard: false,
};

export const getUpdateSettingsDefaults = (): UpdateSettings => ({
  ...defaultUpdateSettings,
});

export const getDownloadSettingsDefaults = () => ({
  downloadsDirectory: null as string | null,
  qualityPreferences: { ...defaultQualityPreferences },
  formatOverrides: {
    videoFormatId: null as string | null,
    audioFormatId: null as string | null,
  },
  notifyPerItemInBatch: false,
});

export const getTranscriptSettingsDefaults = (): TranscriptSettings => ({
  ...defaultTranscriptSettings,
});

export const isQualityPreferences = (value: unknown): value is DownloadQualityPreferences => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.video === 'string' &&
    typeof candidate.audio === 'string'
  );
};

export const isUpdateSettings = (value: unknown): value is UpdateSettings => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.autoUpdate === 'boolean' &&
    typeof candidate.checkInterval === 'number' &&
    Number.isInteger(candidate.checkInterval) &&
    candidate.checkInterval > 0 &&
    typeof candidate.notifyOnUpdateReady === 'boolean'
  );
};

export const isTranscriptSettings = (value: unknown): value is TranscriptSettings => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.language === null || typeof candidate.language === 'string') &&
    typeof candidate.includeTimestamps === 'boolean' &&
    typeof candidate.includeMetadata === 'boolean' &&
    typeof candidate.paragraphGapSeconds === 'number' &&
    Number.isFinite(candidate.paragraphGapSeconds) &&
    candidate.paragraphGapSeconds >= 0 &&
    typeof candidate.saveMarkdownFile === 'boolean' &&
    typeof candidate.copyMarkdownToClipboard === 'boolean'
  );
};
