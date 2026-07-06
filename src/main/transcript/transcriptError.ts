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
  if (lower.includes('429') || lower.includes('rate') || lower.includes('bot') || lower.includes('sign in')) {
    return new TranscriptError('RATE_LIMITED', 'Caption extraction was rate-limited.', message);
  }

  return new TranscriptError('UPSTREAM_ERROR', 'Caption extraction failed.', message);
};
