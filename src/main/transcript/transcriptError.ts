import type { TranscriptErrorCode } from '../../shared/types.js';

export class TranscriptError extends Error {
  readonly code: TranscriptErrorCode;
  readonly detail?: string;

  constructor(code: TranscriptErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'TranscriptError';
    this.code = code;
    this.detail = detail;
  }
}

export const toTranscriptError = (error: unknown): TranscriptError => {
  if (error instanceof TranscriptError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('private video')
    || lower.includes('video unavailable')
    || lower.includes('has been removed')
    || lower.includes('account associated with this video has been terminated')
  ) {
    return new TranscriptError('VIDEO_UNAVAILABLE', 'This media is unavailable.', message);
  }

  if (
    lower.includes('subtitles are disabled')
    || lower.includes('subtitles disabled')
    || lower.includes('captions have been disabled')
  ) {
    return new TranscriptError('TRANSCRIPT_DISABLED', 'Captions are disabled for this media.', message);
  }

  if (
    lower.includes('429')
    || lower.includes('too many requests')
    || lower.includes('rate-limit')
    || lower.includes('rate limit')
    || lower.includes('ratelimited')
    || lower.includes('confirm you\'re not a bot')
    || lower.includes('sign in to confirm')
    || /\bbot\b/.test(lower)
  ) {
    return new TranscriptError('RATE_LIMITED', 'Caption extraction was rate-limited.', message);
  }

  if (
    lower.includes('unable to download video subtitles')
    || lower.includes('unable to download subtitles')
    || lower.includes('unable to download automatic captions')
  ) {
    return new TranscriptError('UPSTREAM_ERROR', 'Caption download failed.', message);
  }

  return new TranscriptError('UPSTREAM_ERROR', 'Caption extraction failed.', message);
};
