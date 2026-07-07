import type { DownloadProgress, TranscriptProgress } from '../shared/types.js';

export const helpText = `Flucto CLI

Usage:
  flucto download <url> [--format mp4|mp3] [--output-dir DIR] [--json]
  flucto batch <file> [--format mp4|mp3|md] [--concurrency N] [--output-dir DIR] [--json]
  flucto transcript <url> [--language en|ko|ja|zh|auto] [--stdout] [--json]
  flucto info <url> [--json]
  flucto formats <url> [--json]
  flucto languages <url> [--json]
  flucto doctor [--json]
  flucto --version

Global options:
  --json                 Emit final result as JSON to stdout
  --progress-json        Emit progress events as NDJSON to stderr
  --output-dir, -o DIR   Output directory (default: FLUCTO_OUTPUT_DIR or cwd)
  --bin-dir DIR          Directory containing yt-dlp and ffmpeg
  --yt-dlp PATH          Explicit yt-dlp binary path
  --ffmpeg PATH          Explicit ffmpeg binary path
`;

export const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export const writeHuman = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

export const writeStatus = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

export const writeError = (message: string): void => {
  process.stderr.write(`[FAIL] ${message}\n`);
};

export const renderDownloadProgress = (progress: DownloadProgress, progressJson: boolean): void => {
  if (progressJson) {
    process.stderr.write(`${JSON.stringify(progress)}\n`);
    return;
  }
  if (progress.status === 'downloading') {
    const suffix = progress.speed && progress.eta ? ` ${progress.speed} ETA ${progress.eta}` : '';
    writeStatus(`[${progress.requestId}] ${progress.progress.toFixed(1)}%${suffix}`);
  } else if (progress.status === 'completed') {
    writeStatus(`[${progress.requestId}] completed${progress.filePath ? `: ${progress.filePath}` : ''}`);
  } else if (progress.status === 'error') {
    writeStatus(`[${progress.requestId}] error: ${progress.error ?? 'unknown error'}`);
  }
};

export const renderTranscriptProgress = (progress: TranscriptProgress, progressJson: boolean): void => {
  if (progressJson) {
    process.stderr.write(`${JSON.stringify(progress)}\n`);
    return;
  }
  writeStatus(`[${progress.requestId}] ${progress.status} ${progress.progress}%${progress.filePath ? `: ${progress.filePath}` : ''}${progress.error ? `: ${progress.error}` : ''}`);
};
