import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { compareVersions, fetchLatestRelease, type GitHubReleaseAsset, type GitHubReleaseInfo } from './githubRelease.js';
import { detectInstallMode, selectReleaseAsset, type InstallMode } from './platformAssets.js';

export interface CliUpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  publishedAt: string;
  recommendedAsset: string | null;
  assets: string[];
}

export interface CliUpdateDownloadResult extends CliUpdateCheckResult {
  downloaded: boolean;
  path: string | null;
  checksumVerified: boolean | null;
  next: string;
}

export interface CliUpdateApplyResult {
  applied: boolean;
  installMode: InstallMode;
  reason?: string;
  next: string;
}

export interface CliUpdateOptions {
  currentVersion: string;
  outputDir?: string;
  assetPath?: string;
  env?: NodeJS.ProcessEnv;
  release?: GitHubReleaseInfo;
}

export interface ChecksumManifest {
  entries: Map<string, string>;
}

const CHECKSUM_ASSET_NAMES = new Set(['checksums-sha256.txt', 'sha256sums.txt', 'sha256sum.txt']);

const downloadToFile = async (url: string, destination: string): Promise<void> => {
  const response = await fetch(url, { headers: { 'user-agent': 'Flucto CLI updater' } });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, Buffer.from(await response.arrayBuffer()));
};

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

export const verifySha256 = async (filePath: string, expected: string): Promise<boolean> => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex') === expected.toLowerCase();
};

const findChecksumAsset = (release: GitHubReleaseInfo): GitHubReleaseAsset | null => {
  return release.assets.find((asset) => CHECKSUM_ASSET_NAMES.has(asset.name.toLowerCase()))
    ?? release.assets.find((asset) => asset.name.toLowerCase().includes('checksum'))
    ?? null;
};

const releaseFor = async (options: CliUpdateOptions): Promise<GitHubReleaseInfo> => {
  return options.release ?? fetchLatestRelease('DeclanJeon/flucto', options.env);
};

const toCheckResult = (currentVersion: string, release: GitHubReleaseInfo, asset: GitHubReleaseAsset | null): CliUpdateCheckResult => ({
  currentVersion,
  latestVersion: release.version,
  updateAvailable: compareVersions(release.version, currentVersion) > 0,
  releaseUrl: release.url,
  publishedAt: release.publishedAt,
  recommendedAsset: asset?.name ?? null,
  assets: release.assets.map((item) => item.name),
});

export const checkForCliUpdate = async (options: CliUpdateOptions): Promise<CliUpdateCheckResult> => {
  const release = await releaseFor(options);
  return toCheckResult(options.currentVersion, release, selectReleaseAsset(release.assets));
};

export const downloadCliUpdate = async (options: CliUpdateOptions): Promise<CliUpdateDownloadResult> => {
  const release = await releaseFor(options);
  const asset = selectReleaseAsset(release.assets);
  const base = toCheckResult(options.currentVersion, release, asset);
  if (!asset) {
    return { ...base, downloaded: false, path: null, checksumVerified: null, next: 'No compatible release asset was found for this platform.' };
  }

  const outputDir = path.resolve(options.outputDir ?? process.cwd());
  const destination = path.join(outputDir, asset.name);
  await downloadToFile(asset.url, destination);

  let checksumVerified: boolean | null = null;
  const checksumAsset = findChecksumAsset(release);
  if (checksumAsset) {
    const checksumResponse = await fetch(checksumAsset.url, { headers: { 'user-agent': 'Flucto CLI updater' } });
    if (!checksumResponse.ok) {
      throw new Error(`Checksum manifest download failed: HTTP ${checksumResponse.status}`);
    }
    const manifest = parseChecksumManifest(await checksumResponse.text());
    const expected = manifest.entries.get(asset.name);
    if (!expected) {
      throw new Error(`Checksum manifest does not include ${asset.name}`);
    }
    checksumVerified = await verifySha256(destination, expected);
    if (!checksumVerified) throw new Error(`Checksum verification failed for ${asset.name}`);
  }

  return {
    ...base,
    downloaded: true,
    path: destination,
    checksumVerified,
    next: 'Run `flucto update apply --asset PATH` if your install mode supports automatic apply; otherwise install the asset manually.',
  };
};

export const applyCliUpdate = async (options: CliUpdateOptions): Promise<CliUpdateApplyResult> => {
  const installMode = detectInstallMode();
  const assetPath = options.assetPath ? path.resolve(options.assetPath) : null;
  if (!assetPath) {
    return { applied: false, installMode, reason: 'No asset path was provided.', next: 'Run `flucto update download` first, then pass --asset PATH.' };
  }
  try {
    await fs.promises.access(assetPath, fs.constants.R_OK);
  } catch {
    return { applied: false, installMode, reason: `Asset is not readable: ${assetPath}`, next: 'Download the update asset again.' };
  }

  return {
    applied: false,
    installMode,
    reason: `Automatic apply is not supported for ${installMode} installs yet.`,
    next: `Install or run the downloaded asset manually: ${assetPath}`,
  };
};
