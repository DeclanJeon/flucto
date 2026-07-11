import type { PlatformErrorCode } from './types.js';

export class PlatformError extends Error {
  constructor(
    public readonly code: PlatformErrorCode,
    message: string,
    public readonly platformId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}
