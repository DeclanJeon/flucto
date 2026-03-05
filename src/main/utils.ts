import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';

export const getBinaryPath = (binaryName: string): string => {
  const isProd = app.isPackaged;
  const platform = process.platform === 'win32' ? '.exe' : '';
  const binaryWithExt = `${binaryName}${platform}`;

  if (isProd) {
    const candidates = [
      path.join(process.resourcesPath, 'bin', binaryWithExt),
      path.join(process.resourcesPath, 'app', 'bin', binaryWithExt),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', binaryWithExt),
      path.join(app.getAppPath(), 'bin', binaryWithExt),
    ];

    const matched = candidates.find((candidate) => fs.existsSync(candidate));
    return matched ?? candidates[0];
  } else {
    return path.join(app.getAppPath(), 'bin', binaryWithExt);
  }
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
