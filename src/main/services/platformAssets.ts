import type { GitHubReleaseAsset } from './githubRelease.js';

export type PlatformAssetPreference = 'portable' | 'installer' | 'deb' | 'appimage';
export type InstallMode = 'portable' | 'appimage' | 'deb' | 'npm' | 'source' | 'unknown';

export interface PlatformAssetOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  preferPackage?: PlatformAssetPreference;
}

const includesAll = (value: string, parts: string[]): boolean => parts.every((part) => value.includes(part));

export const selectReleaseAsset = (
  assets: GitHubReleaseAsset[],
  options: PlatformAssetOptions = {},
): GitHubReleaseAsset | null => {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const candidates = assets.filter((asset) => !asset.name.toLowerCase().includes('checksum'));
  const lower = (asset: GitHubReleaseAsset): string => asset.name.toLowerCase();

  if (platform === 'win32') {
    const archToken = arch === 'arm64' ? 'arm64' : 'x64';
    const portable = candidates.find((asset) => includesAll(lower(asset), [archToken, 'portable', '.exe']));
    const installer = candidates.find((asset) => includesAll(lower(asset), [archToken, 'setup', '.exe']))
      ?? candidates.find((asset) => includesAll(lower(asset), ['setup', '.exe']));
    return options.preferPackage === 'installer' ? installer ?? portable ?? null : portable ?? installer ?? null;
  }

  if (platform === 'darwin') {
    const archToken = arch === 'arm64' ? 'arm64' : 'x64';
    const zip = candidates.find((asset) => includesAll(lower(asset), [archToken, '.zip']))
      ?? candidates.find((asset) => lower(asset).endsWith('.zip'));
    const dmg = candidates.find((asset) => includesAll(lower(asset), [archToken, '.dmg']))
      ?? candidates.find((asset) => lower(asset).endsWith('.dmg'));
    return options.preferPackage === 'installer' ? dmg ?? zip ?? null : zip ?? dmg ?? null;
  }

  if (platform === 'linux') {
    const appImage = candidates.find((asset) => lower(asset).endsWith('.appimage'));
    const deb = candidates.find((asset) => lower(asset).endsWith('.deb'));
    return options.preferPackage === 'deb' ? deb ?? appImage ?? null : appImage ?? deb ?? null;
  }

  return null;
};

export const detectInstallMode = (argv0 = process.argv[1] ?? ''): InstallMode => {
  const executable = argv0.toLowerCase();
  if (process.env.APPIMAGE) return 'appimage';
  if (executable.includes('/node_modules/') || executable.includes('\\node_modules\\')) return 'npm';
  if (executable.includes('/dist-electron/') || executable.includes('\\dist-electron\\')) return 'source';
  if (executable.endsWith('.appimage')) return 'appimage';
  if (executable.includes('/opt/') || executable.includes('/usr/')) return 'deb';
  if (executable.includes('flucto')) return 'portable';
  return 'unknown';
};
