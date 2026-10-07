import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import type { GitHubReleaseAsset, GitHubReleaseInfo } from './githubRelease.js';

export interface ReleaseDownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface ReleaseDownloadOptions {
  release: GitHubReleaseInfo;
  asset: GitHubReleaseAsset;
  outputDir: string;
  onProgress?: (progress: ReleaseDownloadProgress) => void;
}

export interface ReleaseDownloadResult {
  path: string;
  checksumVerified: true;
}

export interface ChecksumManifest {
  entries: Map<string, string>;
}

const CHECKSUM_ASSET_NAMES: Record<string, true> = {
  'checksums-sha256.txt': true,
  'sha256sums.txt': true,
  'sha256sum.txt': true,
};
const USER_AGENT = 'Flucto updater';

export const parseChecksumManifest = (content: string): ChecksumManifest => {
  const entries = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?<hash>[a-fA-F0-9]{64})\s+\*?(?<name>.+)$/.exec(trimmed);
    if (match?.groups?.hash && match.groups.name) {
      entries.set(path.basename(match.groups.name.trim()), match.groups.hash.toLowerCase());
    }
  }
  return { entries };
};

const sha256File = async (filePath: string): Promise<string> => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

export const verifySha256 = async (filePath: string, expected: string): Promise<boolean> => {
  return (await sha256File(filePath)) === expected.toLowerCase();
};

export const findChecksumAsset = (release: GitHubReleaseInfo): GitHubReleaseAsset | null => {
  return release.assets.find((asset) => CHECKSUM_ASSET_NAMES[asset.name.toLowerCase()] === true)
    ?? release.assets.find((asset) => asset.name.toLowerCase().includes('checksum'))
    ?? null;
};

/**
 * Stream a release asset to disk and verify it against the release checksum manifest
 * before publishing it at its final name. The final path only ever contains a
 * checksum-verified payload: bytes land in a same-directory `.flucto-dl-*` temp dir
 * and are renamed atomically after verification, and all partial state is removed on
 * failure so a bad download never leaves an executable update behind.
 */
export const downloadReleaseAsset = async (options: ReleaseDownloadOptions): Promise<ReleaseDownloadResult> => {
  const { release, asset } = options;
  const outputDir = path.resolve(options.outputDir);

  const checksumAsset = findChecksumAsset(release);
  if (!checksumAsset) {
    throw new Error(`Release ${release.tagName} has no checksum manifest; refusing to publish an unverified download.`);
  }
  const checksumResponse = await fetch(checksumAsset.url, { headers: { 'user-agent': USER_AGENT } });
  if (!checksumResponse.ok) {
    throw new Error(`Checksum manifest download failed: HTTP ${checksumResponse.status}`);
  }
  const manifest = parseChecksumManifest(await checksumResponse.text());
  const expected = manifest.entries.get(asset.name);
  if (!expected) {
    throw new Error(`Checksum manifest does not include ${asset.name}`);
  }

  await fs.promises.mkdir(outputDir, { recursive: true });
  const finalPath = path.join(outputDir, asset.name);
  // Temp dir sits inside outputDir so the publish rename stays on one volume.
  const tempDir = await fs.promises.mkdtemp(path.join(outputDir, '.flucto-dl-'));
  const tempPath = path.join(tempDir, asset.name);

  try {
    const response = await fetch(asset.url, { headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${asset.url}`);
    const total = Number(response.headers.get('content-length')) || asset.size || 0;
    const source = Readable.fromWeb(response.body as WebReadableStream);
    const writer = fs.createWriteStream(tempPath);

    const startedAt = Date.now();
    let transferred = 0;
    if (options.onProgress) {
      source.on('data', (chunk: Buffer | string) => {
        transferred += chunk.length;
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
        options.onProgress?.({
          percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
          bytesPerSecond: transferred / elapsedSeconds,
          transferred,
          total,
        });
      });
    }

    await pipeline(source, writer);

    const actual = await sha256File(tempPath);
    if (actual !== expected) {
      throw new Error(`Checksum verification failed for ${asset.name}: expected ${expected}, got ${actual}`);
    }

    await fs.promises.rename(tempPath, finalPath);
    options.onProgress?.({ percent: 100, bytesPerSecond: 0, transferred: transferred || total, total });
    return { path: finalPath, checksumVerified: true };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};
