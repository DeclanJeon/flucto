import fs from 'fs';
import path from 'path';
import {
  executableName,
  fetchLatestYtDlpVersion,
  getManagedBinDir,
  provisionUtility,
  utilitySpecs,
  versionFor,
  type UtilityName,
} from './binaryInstaller.js';

export interface ManagedBinaryMarker {
  managed: UtilityName[];
  ytDlpVersion: string | null;
  lastCheckedAt: string;
  updatedAt: string;
}

export interface BinaryRefreshOptions {
  binDir?: string;
  /** Version of the currently-effective yt-dlp (e.g. the packaged copy), used when the managed copy is absent. */
  currentVersion?: string | null;
  checkIntervalMs?: number;
  now?: () => number;
  onStatus?: (message: string) => void;
  fetchLatestVersion?: () => Promise<string | null>;
  provisionYtDlp?: (targetPath: string, onStatus?: (message: string) => void) => Promise<void>;
}

export interface BinaryRefreshResult {
  refreshed: boolean;
  skipped: boolean;
  version: string | null;
  error?: string;
}

export const MANAGED_MARKER_FILE = 'managed.json';

const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const readManagedMarker = (binDir: string): ManagedBinaryMarker | null => {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(binDir, MANAGED_MARKER_FILE), 'utf8')) as unknown;
    if (!marker || typeof marker !== 'object') return null;
    const record = marker as Partial<ManagedBinaryMarker>;
    if (!Array.isArray(record.managed)) return null;
    return {
      managed: record.managed as UtilityName[],
      ytDlpVersion: typeof record.ytDlpVersion === 'string' ? record.ytDlpVersion : null,
      lastCheckedAt: typeof record.lastCheckedAt === 'string' ? record.lastCheckedAt : '',
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    };
  } catch {
    return null;
  }
};

const writeManagedMarker = (binDir: string, marker: ManagedBinaryMarker): void => {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, MANAGED_MARKER_FILE), JSON.stringify(marker, null, 2), 'utf8');
};

export const isManagedBinaryPreferred = (binaryName: UtilityName, binDir = getManagedBinDir()): boolean => {
  const marker = readManagedMarker(binDir);
  return Boolean(marker?.managed.includes(binaryName));
};

/**
 * Keeps yt-dlp fresh in the managed bin directory. Packaged app binaries are frozen at
 * release time, so a stale copy must be superseded by a managed one — never silently.
 * This function never throws: a failed refresh must not break app startup.
 */
export const checkAndRefreshBinaries = async (
  options: BinaryRefreshOptions = {},
): Promise<BinaryRefreshResult> => {
  const binDir = path.resolve(options.binDir ?? getManagedBinDir());
  const onStatus = options.onStatus;
  const now = options.now ?? Date.now;
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const fetchLatestVersion = options.fetchLatestVersion ?? fetchLatestYtDlpVersion;
  const ytDlpPath = path.join(binDir, executableName('yt-dlp'));

  try {
    const spec = utilitySpecs().find((candidate) => candidate.name === 'yt-dlp');
    if (!spec) {
      return { refreshed: false, skipped: true, version: null, error: 'yt-dlp spec not found.' };
    }

    const marker = readManagedMarker(binDir);
    const lastCheckedAt = marker?.lastCheckedAt ? Date.parse(marker.lastCheckedAt) : 0;
    if (Number.isFinite(lastCheckedAt) && lastCheckedAt > 0 && now() - lastCheckedAt < checkIntervalMs) {
      const version = marker?.ytDlpVersion ?? (await versionFor(ytDlpPath, spec.versionArgs));
      return { refreshed: false, skipped: true, version };
    }

    const latestVersion = await fetchLatestVersion();
    if (!latestVersion) {
      return { refreshed: false, skipped: true, version: null, error: 'Could not resolve the latest yt-dlp version.' };
    }

    const managedVersion = await versionFor(ytDlpPath, spec.versionArgs);
    const effectiveVersion = managedVersion ?? options.currentVersion ?? null;
    if (effectiveVersion === latestVersion && !managedVersion) {
      // The packaged copy is already current — no managed duplicate needed.
      return { refreshed: false, skipped: true, version: effectiveVersion };
    }

    if (effectiveVersion === latestVersion && managedVersion) {
      writeManagedMarker(binDir, {
        managed: marker?.managed.includes('yt-dlp') ? marker.managed : [...(marker?.managed ?? []), 'yt-dlp'],
        ytDlpVersion: latestVersion,
        lastCheckedAt: new Date(now()).toISOString(),
        updatedAt: marker?.updatedAt || new Date(now()).toISOString(),
      });
      return { refreshed: false, skipped: true, version: managedVersion };
    }

    onStatus?.(
      effectiveVersion
        ? `Updating yt-dlp (${effectiveVersion} → ${latestVersion})...`
        : `Downloading yt-dlp (${latestVersion})...`,
    );
    const provision = options.provisionYtDlp
      ?? ((targetPath: string, status?: (message: string) => void) => {
        const ytDlpSpec = utilitySpecs().find((candidate) => candidate.name === 'yt-dlp');
        if (!ytDlpSpec) return Promise.reject(new Error('yt-dlp spec not found.'));
        return provisionUtility(ytDlpSpec, targetPath, status);
      });
    await provision(ytDlpPath, onStatus);
    const installedVersion = await versionFor(ytDlpPath, spec.versionArgs);
    writeManagedMarker(binDir, {
      managed: marker?.managed.includes('yt-dlp') ? marker.managed : [...(marker?.managed ?? []), 'yt-dlp'],
      ytDlpVersion: installedVersion ?? latestVersion,
      lastCheckedAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
    });
    onStatus?.(`yt-dlp updated to ${installedVersion ?? latestVersion}.`);
    return { refreshed: true, skipped: false, version: installedVersion ?? latestVersion };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    onStatus?.(`Binary refresh failed: ${message}`);
    return { refreshed: false, skipped: false, version: null, error: message };
  }
};
