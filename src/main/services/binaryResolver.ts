import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface BinaryResolver {
  ytDlpPath: string;
  ffmpegPath: string;
}

export interface BinaryResolverOptions {
  binDir?: string;
  ytDlpPath?: string;
  ffmpegPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface BinaryHealth {
  valid: boolean;
  missing: string[];
  paths: BinaryResolver;
}

const executableExtension = process.platform === 'win32' ? '.exe' : '';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const isExecutable = (candidate: string): boolean => {
  const accessMode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.F_OK | fs.constants.X_OK;
  try {
    fs.accessSync(candidate, accessMode);
    return true;
  } catch {
    return false;
  }
};

const pathCandidates = (binaryName: string, env: NodeJS.ProcessEnv): string[] => {
  const pathValue = env.PATH || '';
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, `${binaryName}${executableExtension}`));
};

const localBinCandidates = (binaryName: string, cwd: string, binDir?: string): string[] => {
  const binary = `${binaryName}${executableExtension}`;
  const candidates = [
    ...(binDir ? [path.join(binDir, binary)] : []),
    path.join(cwd, 'bin', binary),
    path.resolve(moduleDir, '../../../bin', binary),
    path.resolve(moduleDir, '../../../../bin', binary),
  ];
  return [...new Set(candidates)];
};

const resolveBinary = (
  binaryName: 'yt-dlp' | 'ffmpeg',
  explicitPath: string | undefined,
  envPath: string | undefined,
  options: Required<Pick<BinaryResolverOptions, 'env' | 'cwd'>> & Pick<BinaryResolverOptions, 'binDir'>,
): string => {
  const candidates = [
    explicitPath,
    envPath,
    ...localBinCandidates(binaryName, options.cwd, options.binDir),
    ...pathCandidates(binaryName, options.env),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(isExecutable) ?? candidates[0] ?? `${binaryName}${executableExtension}`;
};

export const resolveCliBinaries = (options: BinaryResolverOptions = {}): BinaryResolver => {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  return {
    ytDlpPath: resolveBinary('yt-dlp', options.ytDlpPath, env.FLUCTO_YT_DLP_PATH, { env, cwd, binDir: options.binDir }),
    ffmpegPath: resolveBinary('ffmpeg', options.ffmpegPath, env.FLUCTO_FFMPEG_PATH, { env, cwd, binDir: options.binDir }),
  };
};

export const checkBinaryHealth = (binaries: BinaryResolver): BinaryHealth => {
  const missing: string[] = [];
  if (!isExecutable(binaries.ytDlpPath)) missing.push('yt-dlp');
  if (!isExecutable(binaries.ffmpegPath)) missing.push('ffmpeg');
  return {
    valid: missing.length === 0,
    missing,
    paths: binaries,
  };
};
