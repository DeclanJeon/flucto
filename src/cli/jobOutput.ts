import fs from 'fs';
import path from 'path';

/** Filesystem-safe slug for job folder names. */
export const slugifyJobLabel = (value: string, maxLen = 48): string => {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/https?:\/\/(www\.)?youtube\.com\/@/gi, '')
    .replace(/^@+/, '')
    .replace(/[^\w가-힣.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return (cleaned || 'job').slice(0, maxLen);
};

/** Compact local timestamp for folder names: 20260710-143012 */
export const jobTimestamp = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
};

/**
 * Create a dedicated subfolder under baseDir for multi-file CLI jobs.
 * Example: /cwd/LIFECODEofficial-md-20260710-143012
 */
export const createMultiJobOutputDir = (
  baseDir: string,
  kind: 'md' | 'mp4' | 'mp3' | 'batch-md' | 'batch-mp4' | 'batch-mp3' | 'channel-md',
  label?: string,
): string => {
  const base = path.resolve(baseDir);
  fs.mkdirSync(base, { recursive: true });
  const slug = slugifyJobLabel(label || kind);
  const dir = path.join(base, `${slug}-${kind}-${jobTimestamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
