import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';
import { getManagedBinDir } from './services/binaryInstaller.js';
import { isManagedBinaryPreferred } from './services/binaryRefresh.js';

const isExecutable = (candidate: string): boolean => {
  const accessMode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.F_OK | fs.constants.X_OK;
  try {
    fs.accessSync(candidate, accessMode);
    return true;
  } catch {
    return false;
  }
};

/**
 * A refreshed yt-dlp lives in the managed bin dir and is preferred over the frozen
 * packaged copy. The marker file only exists once a managed refresh succeeded.
 */
const managedRefreshedPath = (binaryName: string): string | null => {
  if (binaryName !== 'yt-dlp') return null;
  if (!isManagedBinaryPreferred(binaryName)) return null;
  const candidate = path.join(getManagedBinDir(), `${binaryName}${process.platform === 'win32' ? '.exe' : ''}`);
  return isExecutable(candidate) ? candidate : null;
};

export const getOpenCodeBinaryPath = (): string => {
  const executableName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'bin', 'opencode', arch, executableName),
        path.join(getManagedBinDir(), 'opencode', arch, executableName),
      ]
    : [
        path.join(app.getAppPath(), 'bin', 'opencode', arch, executableName),
        path.join(getManagedBinDir(), 'opencode', arch, executableName),
      ];
  const found = candidates.find(isExecutable);
  if (found) return found;
  if (!app.isPackaged && process.env.NODE_ENV === 'development') {
    const pathExecutable = (process.env.PATH ?? '').split(path.delimiter).map((directory) => path.join(directory, executableName)).find(isExecutable);
    if (pathExecutable) return pathExecutable;
  }
  throw new Error(`Bundled OpenCode executable is missing for ${process.platform}/${arch}. Run the binary setup step or reinstall Flucto.`);
};

export const getBinaryPath = (binaryName: string): string => {
  const isProd = app.isPackaged;
  const platform = process.platform === 'win32' ? '.exe' : '';
  const binaryWithExt = `${binaryName}${platform}`;

  const refreshed = managedRefreshedPath(binaryName);
  if (refreshed) return refreshed;

  const candidates = isProd
    ? [
        path.join(process.resourcesPath, 'bin', binaryWithExt),
        path.join(process.resourcesPath, 'app', 'bin', binaryWithExt),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', binaryWithExt),
        path.join(app.getAppPath(), 'bin', binaryWithExt),
        path.join(getManagedBinDir(), binaryWithExt),
      ]
    : [
        path.join(app.getAppPath(), 'bin', binaryWithExt),
        path.join(getManagedBinDir(), binaryWithExt),
      ];

  const matched = candidates.find(isExecutable);
  return matched ?? candidates[0];
};

/**
 * 필수 바이너리 파일(yt-dlp, ffmpeg)이 존재하는지 확인합니다.
 * @returns {Promise<{ valid: boolean; missing: string[] }>}
 */
export const checkSystemHealth = async (): Promise<{ valid: boolean; missing: string[] }> => {
  const binaries = ['yt-dlp', 'ffmpeg'];
  const missing: string[] = [];
  const accessMode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.F_OK | fs.constants.X_OK;

  for (const bin of binaries) {
    const binPath = getBinaryPath(bin);
    // 파일 존재 여부 및 실행 권한 확인 (동기적 확인이 안전함)
    try {
      await fs.promises.access(binPath, accessMode);
      logger.debug(`Binary found: ${bin} at ${binPath}`);
    } catch {
      missing.push(bin);
      logger.error(`Binary missing: ${bin} at ${binPath}`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
};

/**
 * yt-dlp 실행 인자 생성
 * @param url YouTube URL
 * @param outputPath 다운로드 경로
 * @param format 포맷 (mp4/mp3)
 * @returns string[]
 */
export const createYtDlpArgs = (url: string, outputPath: string, format: 'mp4' | 'mp3'): string[] => {
  const baseArgs = [
    '--no-warnings',
    '--no-playlist',
    '--no-overwrites',
    '--continue',
  ];

  if (format === 'mp3') {
    return [
      ...baseArgs,
      '-x', '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', path.join(outputPath, '%(title)s.%(ext)s'),
      url,
    ];
  } else {
    return [
      ...baseArgs,
      '-f', 'best[height<=720]',
      '-o', path.join(outputPath, '%(title)s.%(ext)s'),
      url,
    ];
  }
};
