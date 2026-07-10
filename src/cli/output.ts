import type { DownloadProgress, TranscriptProgress } from '../shared/types.js';

export const helpText = `Flucto CLI

Usage:
  flucto download <url> [--format mp4|mp3] [--output-dir DIR] [--json]
  flucto batch <file> [--format mp4|mp3|md] [--concurrency N] [--output-dir DIR] [--json]
  flucto transcript <url> [--language en|ko|ja|zh|auto] [--stdout] [--json]
  flucto channel to-md <channel-url|@handle> [--limit N] [--out DIR] [--language en|ko|auto] [--json]
  flucto channel-to-md <channel-url|@handle> [--limit N] [--out DIR] [--json]
      (multi-file jobs create a dedicated subfolder under --out / cwd)
  flucto info <url> [--json]
  flucto formats <url> [--json]
  flucto languages <url> [--json]
  flucto doctor [--json]
  flucto setup [--force] [--check-only] [--bin-dir DIR] [--json]
  flucto update check [--json]
  flucto update download [--output-dir DIR] [--json]
  flucto update apply --asset PATH [--json]
  flucto --version

Short form:
  fl d <url> [-f mp4|mp3] [-o DIR] [-j]
  fl t <url> [-l en|ko|ja|zh|auto] [-s] [-j]
  fl channel to-md <@handle|url> [--limit N] [-o DIR] [-j]
  fl i <url> [-j]
  fl f <url> [-j]
  fl l <url> [-j]
  fl b <file> [-f mp4|mp3|md] [-c N] [-o DIR] [-j]
  fl doc [-j]
  fl s [-j]
  fl u check|download|apply [-j]

Command aliases:
  d=download, b=batch, t=transcript, i=info, f=formats, l=languages
  doc=doctor, s=setup, u=update, h=help, v=version

Examples:
  flucto channel to-md "@LIFECODEofficial" --limit 100 --out ./notes
  flucto channel to-md "https://youtube.com/@learn-ai-lab" --limit 20 -o ./notes -l ko

Global options:
  --json, -j             Emit final result as JSON to stdout
  --progress-json, -p    Emit progress events as NDJSON to stderr
  --format, -f VALUE     Output format: mp4, mp3, or md where supported
  --quality, -q VALUE    Video quality preset
  --audio-quality, -a VALUE
  --language, -l VALUE   Transcript language code or auto
  --stdout, -s           Write transcript Markdown to stdout
  --output-dir, -o, --out DIR   Base output directory (default: FLUCTO_OUTPUT_DIR or cwd).
                         batch / channel to-md always write into a new subfolder under this base.
  --limit N              Max videos for channel to-md (default: 100, max: 5000)
  --bin-dir DIR          Directory containing yt-dlp and ffmpeg
  --yt-dlp PATH          Explicit yt-dlp binary path
  --ffmpeg PATH          Explicit ffmpeg binary path
  --force                Re-download managed setup binaries
  --check-only           Check setup state without downloading
  --asset PATH           Update asset path for update apply
`;

export const progressBar = (done: number, total: number, width = 28): string => {
  if (total <= 0) return '░'.repeat(width);
  const filled = Math.min(width, Math.max(0, Math.round((width * done) / total)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
};

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
