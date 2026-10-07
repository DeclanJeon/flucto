import type { GitHubReleaseAsset, GitHubReleaseInfo } from './githubRelease.js';

export type InstallMode = 'npm' | 'source' | 'unknown';

export const cliSetupAssetName = (version: string): string => `Flucto-${version.replace(/^v/i, '')}-cli-setup.zip`;

export const selectCliSetupAsset = (release: GitHubReleaseInfo): GitHubReleaseAsset | null => {
  const expected = cliSetupAssetName(release.version);
  return release.assets.find((asset) => asset.name === expected) ?? null;
};

/** Only the universal DMG is a macOS installer; the ZIP is an internal payload. */
export const selectMacInstallerAsset = (release: GitHubReleaseInfo): GitHubReleaseAsset | null => {
  const expected = `Flucto-${release.version}-universal.dmg`;
  return release.assets.find((asset) => asset.name === expected) ?? null;
};

export const detectInstallMode = (modulePath: string): InstallMode => {
  const file = modulePath.toLowerCase();
  if (file.includes('/node_modules/') || file.includes('\\node_modules\\')) return 'npm';
  if (file.includes('/dist-electron/') || file.includes('\\dist-electron\\')) return 'source';
  return 'unknown';
};
