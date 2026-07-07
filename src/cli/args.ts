import { parseArgs } from 'util';
import type { AudioQualityPreset, MediaOutputMode, VideoQualityPreset } from '../shared/types.js';

export type CliCommand =
  | 'download'
  | 'batch'
  | 'transcript'
  | 'info'
  | 'formats'
  | 'languages'
  | 'doctor'
  | 'setup'
  | 'update'
  | 'help'
  | 'version';

export type CliUpdateAction = 'check' | 'download' | 'apply';

export interface CliOptions {
  command: CliCommand;
  positional: string[];
  json: boolean;
  progressJson: boolean;
  format: MediaOutputMode;
  quality: VideoQualityPreset;
  audioQuality: AudioQualityPreset;
  outputDir?: string;
  binDir?: string;
  ytDlpPath?: string;
  ffmpegPath?: string;
  language: string | null;
  timestamps?: boolean;
  metadata?: boolean;
  stdout: boolean;
  concurrency: number;
  force: boolean;
  checkOnly: boolean;
  updateAction: CliUpdateAction;
  assetPath?: string;
}

const videoQualities = new Set(['4k', '1440p', '1080p', '720p', '480p', '360p', 'worst']);
const audioQualities = new Set(['320kbps', '256kbps', '192kbps', '128kbps', '64kbps', 'worst']);
const mediaFormats = new Set(['mp4', 'mp3', 'md']);
const commandAliases: Record<string, CliCommand> = {
  download: 'download',
  d: 'download',
  batch: 'batch',
  b: 'batch',
  transcript: 'transcript',
  t: 'transcript',
  info: 'info',
  i: 'info',
  formats: 'formats',
  f: 'formats',
  languages: 'languages',
  l: 'languages',
  doctor: 'doctor',
  doc: 'doctor',
  setup: 'setup',
  s: 'setup',
  update: 'update',
  u: 'update',
  help: 'help',
  h: 'help',
  version: 'version',
  v: 'version',
};
const commands = new Set(Object.keys(commandAliases));

export class CliUsageError extends Error {
  readonly exitCode = 1;
}

const stringOption = (value: string | boolean | undefined): string | undefined => {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const booleanOption = (value: string | boolean | undefined): boolean => {
  return value === true;
};

const parseConcurrency = (value: string | boolean | undefined): number => {
  const raw = stringOption(value);
  if (!raw) return 2;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new CliUsageError('--concurrency must be an integer from 1 to 16.');
  }
  return parsed;
};

const parseFormat = (value: string | boolean | undefined, fallback: MediaOutputMode): MediaOutputMode => {
  const raw = stringOption(value) ?? fallback;
  if (!mediaFormats.has(raw)) {
    throw new CliUsageError('--format must be one of mp4, mp3, md.');
  }
  return raw as MediaOutputMode;
};

const parseVideoQuality = (value: string | boolean | undefined): VideoQualityPreset => {
  const raw = stringOption(value) ?? '1080p';
  if (!videoQualities.has(raw)) {
    throw new CliUsageError('--quality must be one of 4k, 1440p, 1080p, 720p, 480p, 360p, worst.');
  }
  return raw as VideoQualityPreset;
};

const parseAudioQuality = (value: string | boolean | undefined): AudioQualityPreset => {
  const raw = stringOption(value) ?? '320kbps';
  if (!audioQualities.has(raw)) {
    throw new CliUsageError('--audio-quality must be one of 320kbps, 256kbps, 192kbps, 128kbps, 64kbps, worst.');
  }
  return raw as AudioQualityPreset;
};

export const parseCliArgs = (argv: string[]): CliOptions => {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      json: { type: 'boolean', short: 'j' },
      'progress-json': { type: 'boolean', short: 'p' },
      format: { type: 'string', short: 'f' },
      quality: { type: 'string', short: 'q' },
      'audio-quality': { type: 'string', short: 'a' },
      'output-dir': { type: 'string', short: 'o' },
      'bin-dir': { type: 'string' },
      'yt-dlp': { type: 'string' },
      ffmpeg: { type: 'string' },
      language: { type: 'string', short: 'l' },
      timestamps: { type: 'boolean' },
      'no-timestamps': { type: 'boolean' },
      metadata: { type: 'boolean' },
      'no-metadata': { type: 'boolean' },
      stdout: { type: 'boolean', short: 's' },
      concurrency: { type: 'string', short: 'c' },
      force: { type: 'boolean' },
      'check-only': { type: 'boolean' },
      asset: { type: 'string' },
    },
  });

  if (booleanOption(parsed.values.version)) {
    return baseOptions('version', [], parsed.values);
  }

  if (booleanOption(parsed.values.help) || parsed.positionals.length === 0) {
    return baseOptions('help', parsed.positionals, parsed.values);
  }

  const [rawCommand, ...positional] = parsed.positionals;
  const command = commandAliases[rawCommand];
  if (!command || !commands.has(rawCommand)) {
    throw new CliUsageError(`Unknown command: ${rawCommand}`);
  }

  const options = baseOptions(command, positional, parsed.values);
  validateCommand(options);
  return options;
};

const baseOptions = (
  command: CliCommand,
  positional: string[],
  values: Record<string, string | boolean | undefined>,
): CliOptions => ({
  command,
  positional,
  json: booleanOption(values.json),
  progressJson: booleanOption(values['progress-json']),
  format: parseFormat(values.format, command === 'batch' ? 'mp4' : 'mp4'),
  quality: parseVideoQuality(values.quality),
  audioQuality: parseAudioQuality(values['audio-quality']),
  outputDir: stringOption(values['output-dir']) ?? process.env.FLUCTO_OUTPUT_DIR,
  binDir: stringOption(values['bin-dir']),
  ytDlpPath: stringOption(values['yt-dlp']),
  ffmpegPath: stringOption(values.ffmpeg),
  language: stringOption(values.language) ?? 'en',
  timestamps: booleanOption(values.timestamps) ? true : booleanOption(values['no-timestamps']) ? false : undefined,
  metadata: booleanOption(values.metadata) ? true : booleanOption(values['no-metadata']) ? false : undefined,
  stdout: booleanOption(values.stdout),
  concurrency: parseConcurrency(values.concurrency),
  force: booleanOption(values.force),
  checkOnly: booleanOption(values['check-only']),
  updateAction: parseUpdateAction(command, positional),
  assetPath: stringOption(values.asset),
});

const parseUpdateAction = (command: CliCommand, positional: string[]): CliUpdateAction => {
  if (command !== 'update') return 'check';
  const action = positional[0] ?? 'check';
  if (action === 'check' || action === 'download' || action === 'apply') return action;
  throw new CliUsageError('update action must be one of check, download, apply.');
};

const validateCommand = (options: CliOptions): void => {
  if (['download', 'transcript', 'info', 'formats', 'languages'].includes(options.command) && options.positional.length !== 1) {
    throw new CliUsageError(`${options.command} requires exactly one URL.`);
  }

  if (options.command === 'batch' && options.positional.length !== 1) {
    throw new CliUsageError('batch requires exactly one file path.');
  }

  if (options.command === 'update') {
    const expected = options.updateAction === 'check' ? [0, 1] : [1];
    if (!expected.includes(options.positional.length)) {
      throw new CliUsageError(`update ${options.updateAction} received unexpected arguments.`);
    }
  }

  if (options.command === 'download' && options.format === 'md') {
    throw new CliUsageError('download supports only mp4 or mp3. Use transcript or batch --format md for Markdown.');
  }

  if (options.command === 'transcript' && options.format !== 'mp4') {
    throw new CliUsageError('transcript does not accept --format.');
  }
};
