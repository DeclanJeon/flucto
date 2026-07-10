import type { DownloadProgress, TranscriptProgress } from '../shared/types.js';
import { c, colorEnabled, symbols } from './theme.js';

export const helpText = `${c.bold(c.cyan(`${symbols.brand} Flucto CLI`))}

${c.dim('Capture media · convert captions to Markdown · agent-friendly automation')}

${c.bold('Usage')}
  flucto download <url> [--format mp4|mp3] [--output-dir DIR] [--json]
  flucto batch <file> [--format mp4|mp3|md] [--concurrency N] [--output-dir DIR] [--json]
  flucto transcript <url> [--language en|ko|ja|zh|auto] [--stdout] [--json]
  flucto channel to-md <channel-url|@handle> [--limit N] [--out DIR] [--language en|ko|auto] [--json]
  flucto channel-to-md <channel-url|@handle> [--limit N] [--out DIR] [--json]
      ${c.dim('(multi-file jobs create a dedicated subfolder under --out / cwd)')}
  flucto info <url> [--json]
  flucto formats <url> [--json]
  flucto languages <url> [--json]
  flucto doctor [--json]
  flucto setup [--force] [--check-only] [--bin-dir DIR] [--json]
  flucto update check [--json]
  flucto update download [--output-dir DIR] [--json]
  flucto update apply --asset PATH [--json]
  flucto --version

${c.bold('Short form')}
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

${c.bold('Command aliases')}
  d=download, b=batch, t=transcript, i=info, f=formats, l=languages
  doc=doctor, s=setup, u=update, h=help, v=version

${c.bold('Examples')}
  ${c.cyan('flucto channel to-md "@LIFECODEofficial" --limit 100 --out ./notes')}
  ${c.cyan('flucto channel to-md "https://youtube.com/@learn-ai-lab" --limit 20 -o ./notes -l ko')}

${c.bold('Global options')}
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

${c.dim('Tip: set NO_COLOR=1 to disable ANSI colors.')}
`;

const rule = (width = 52): string => c.dim('─'.repeat(width));

export const progressBar = (done: number, total: number, width = 24): string => {
  if (total <= 0) return c.dim('░'.repeat(width));
  const filled = Math.min(width, Math.max(0, Math.round((width * done) / total)));
  const empty = width - filled;
  const bar = `${c.green('█'.repeat(filled))}${c.dim('░'.repeat(empty))}`;
  return bar;
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
  process.stderr.write(`${c.red(`${symbolsSafe('✗')} ${message}`)}\n`);
};

const symbolsSafe = (fallback: string): string => fallback;

export const banner = (title: string, version?: string): void => {
  const ver = version ? c.dim(` v${version}`) : '';
  writeStatus('');
  writeStatus(`${c.bold(c.cyan(`  ${symbolsSafe('🌊')}  Flucto`))}${ver}`);
  writeStatus(`${c.dim('  ' + rule(40))}`);
  writeStatus(`${c.violet('  ' + title)}`);
  writeStatus(`${c.dim('  ' + rule(40))}`);
};

export const step = (message: string): void => {
  writeStatus(`${c.cyan('  →')}  ${message}`);
};

export const ok = (message: string): void => {
  writeStatus(`${c.green('  ✓')}  ${message}`);
};

export const failLine = (message: string): void => {
  writeStatus(`${c.red('  ✗')}  ${message}`);
};

export const info = (message: string): void => {
  writeStatus(`${c.dim('  •')}  ${message}`);
};

export const kv = (key: string, value: string): void => {
  writeStatus(`     ${c.dim(key.padEnd(10))} ${c.white(value)}`);
};

export const renderJobProgress = (opts: {
  done: number;
  total: number;
  title: string;
  filePath?: string;
  error?: string;
}): void => {
  const { done, total, title, filePath, error } = opts;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = progressBar(done, total);
  const count = `${String(done).padStart(String(total).length, ' ')}/${total}`;
  const short = title.length > 40 ? `${title.slice(0, 39)}…` : title;
  writeStatus(`  ${bar}  ${c.bold(count)}  ${c.dim(`${pct}%`)}  ${short}`);
  if (filePath) {
    writeStatus(`     ${c.dim('↳')} ${c.cyan(filePath)}`);
  }
  if (error) {
    writeStatus(`     ${c.red('↳ ' + error)}`);
  }
};

export const renderSummaryBox = (lines: string[]): void => {
  writeStatus('');
  writeStatus(`${c.dim('  ┌' + '─'.repeat(48) + '┐')}`);
  for (const line of lines) {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, 46 - plain.length);
    writeStatus(`${c.dim('  │')} ${line}${' '.repeat(pad)} ${c.dim('│')}`);
  }
  writeStatus(`${c.dim('  └' + '─'.repeat(48) + '┘')}`);
  writeStatus('');
};

export const renderDownloadProgress = (progress: DownloadProgress, progressJson: boolean): void => {
  if (progressJson) {
    process.stderr.write(`${JSON.stringify(progress)}\n`);
    return;
  }
  if (progress.status === 'downloading') {
    const suffix = progress.speed && progress.eta ? ` ${c.dim(progress.speed)} ${c.dim('ETA ' + progress.eta)}` : '';
    const bar = progressBar(Math.round(progress.progress), 100, 20);
    writeStatus(`  ${bar}  ${c.bold(progress.progress.toFixed(1) + '%')}${suffix}`);
  } else if (progress.status === 'completed') {
    ok(`download complete${progress.filePath ? `: ${progress.filePath}` : ''}`);
  } else if (progress.status === 'error') {
    failLine(progress.error ?? 'unknown error');
  }
};

export const renderTranscriptProgress = (progress: TranscriptProgress, progressJson: boolean): void => {
  if (progressJson) {
    process.stderr.write(`${JSON.stringify(progress)}\n`);
    return;
  }
  // Quiet per-item noise for multi jobs — channel/batch use renderJobProgress instead.
  // Keep single-transcript feedback concise.
  if (progress.status === 'completed') {
    ok(`${progress.title ?? 'transcript'} ${c.dim(progress.filePath ?? '')}`.trim());
  } else if (progress.status === 'error') {
    failLine(progress.error ?? 'transcript failed');
  } else if (progress.status === 'analyzing' || progress.status === 'extracting') {
    step(`${progress.status} ${c.dim(progress.title ?? progress.url)}`);
  }
};

// re-export color flag for tests/docs
export { colorEnabled };
