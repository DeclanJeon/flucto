import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compareVersions, fetchLatestRelease, type GitHubReleaseAsset, type GitHubReleaseInfo } from './githubRelease.js';
import { detectInstallMode, selectCliSetupAsset, type InstallMode } from './platformAssets.js';
import { downloadReleaseAsset, parseChecksumManifest, verifySha256, type ReleaseDownloadProgress } from './releaseDownload.js';
import { execa } from '../spawn.js';

export { parseChecksumManifest, verifySha256 };

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
  env?: NodeJS.ProcessEnv;
  release?: GitHubReleaseInfo;
  onProgress?: (progress: ReleaseDownloadProgress) => void;
  /** Overrides install-mode detection (tests, wrappers). */
  installMode?: InstallMode;
  /** Module path used to locate a private bootstrap install marker (tests). */
  modulePath?: string;
}

/**
 * A CLI installed by the Flucto-*-cli-setup.zip bootstrap. `root` is the user-scope
 * install prefix; Node and npm live inside it so updates never touch global npm.
 */
export interface PrivateInstall {
  root: string;
  nodePath: string;
  npmCliPath: string;
}


/** Marker the CLI bootstrap writes at the install root; also the updater's anchor for the private prefix. */
export const PRIVATE_INSTALL_MARKER = 'flucto-cli-install.json';

const releaseFor = async (options: CliUpdateOptions): Promise<GitHubReleaseInfo> => {
  return options.release ?? fetchLatestRelease('DeclanJeon/flucto', options.env);
};
const toCheckResult = (
  currentVersion: string,
  release: GitHubReleaseInfo,
  asset: GitHubReleaseAsset | null,
): CliUpdateCheckResult => ({
  currentVersion,
  latestVersion: release.version,
  updateAvailable: compareVersions(release.version, currentVersion) > 0,
  releaseUrl: release.url,
  publishedAt: release.publishedAt,
  recommendedAsset: asset?.name ?? null,
  assets: release.assets.map((entry) => entry.name),
});

export const checkForCliUpdate = async (options: CliUpdateOptions): Promise<CliUpdateCheckResult> => {
  const release = await releaseFor(options);
  return toCheckResult(options.currentVersion, release, selectCliSetupAsset(release));
};


/** Locate the private prefix that owns this module, independently of shell/global npm state. */
export const findPrivateInstallRoot = (modulePath: string): string | null => {
  let directory = path.dirname(path.resolve(modulePath));
  for (let depth = 0; depth < 12; depth += 1) {
    if (fs.existsSync(path.join(directory, PRIVATE_INSTALL_MARKER))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
};

// Official Node archives unpack to <root>/bin/node + <root>/lib/node_modules/npm on
// POSIX and <root>/node.exe + <root>/node_modules/npm on Windows.
const PRIVATE_LAYOUTS: { nodePath: string; npmCliPath: string }[] = [
  { nodePath: 'node.exe', npmCliPath: path.join('node_modules', 'npm', 'bin', 'npm-cli.js') },
  { nodePath: path.join('bin', 'node'), npmCliPath: path.join('lib', 'node_modules', 'npm', 'bin', 'npm-cli.js') },
];

const resolvePrivateInstall = (root: string): PrivateInstall | null => {
  for (const layout of PRIVATE_LAYOUTS) {
    const nodePath = path.join(root, layout.nodePath);
    const npmCliPath = path.join(root, layout.npmCliPath);
    if (fs.existsSync(nodePath) && fs.existsSync(npmCliPath)) return { root, nodePath, npmCliPath };
  }
  return null;
};

const applyNpmUpdate = async (installMode: InstallMode): Promise<CliUpdateApplyResult> => {
  const next = 'Update applied. Restart your shell and run `flucto version` to confirm.';
  try {
    const result = await execa('npm', ['install', '-g', 'flucto@latest'], { reject: false });
    if (result.failed) {
      const reason = result.stderr?.trim() || result.stdout?.trim() || 'npm exited with a failure status.';
      return {
        applied: false,
        installMode,
        reason,
        next: 'Run `npm install -g flucto@latest` manually.',
      };
    }
    return { applied: true, installMode, next };
  } catch (error: unknown) {
    return {
      applied: false,
      installMode,
      reason: error instanceof Error ? error.message : String(error),
      next: 'Run `npm install -g flucto@latest` manually.',
    };
  }
};

/**
 * Private bootstrap installs keep their own Node/npm under the install prefix, so the
 * update installs flucto@latest into the same prefix with the bundled npm CLI — the
 * system PATH, global npm config, and any other Node installs are untouched.
 */
const applyPrivateUpdate = async (install: PrivateInstall): Promise<CliUpdateApplyResult> => {
  try {
    const result = await execa(
      install.nodePath,
      [install.npmCliPath, 'install', '-g', '--prefix', install.root, 'flucto@latest'],
      { reject: false },
    );
    if (result.failed) {
      const reason = result.stderr?.trim() || result.stdout?.trim() || 'npm exited with a failure status.';
      return {
        applied: false,
        installMode: 'npm',
        reason,
        next: `Re-run the CLI setup archive or install into the same prefix manually: "${install.nodePath}" "${install.npmCliPath}" install -g --prefix "${install.root}" flucto@latest`,
      };
    }
    if (process.platform === 'win32') {
      await fs.promises.rm(path.join(install.root, 'flucto.ps1'), { force: true });
      await fs.promises.rm(path.join(install.root, 'fl.ps1'), { force: true });
    }
    return {
      applied: true,
      installMode: 'npm',
      next: 'Update applied in place. Run `flucto version` to confirm.',
    };
  } catch (error: unknown) {
    return {
      applied: false,
      installMode: 'npm',
      reason: error instanceof Error ? error.message : String(error),
      next: 'Re-download the CLI setup archive for the latest release and run its installer again.',
    };
  }
};

export const applyCliUpdate = async (options: CliUpdateOptions): Promise<CliUpdateApplyResult> => {
  const modulePath = options.modulePath ?? fileURLToPath(import.meta.url);
  const root = findPrivateInstallRoot(modulePath);
  if (root) {
    const privateInstall = resolvePrivateInstall(root);
    if (privateInstall) return applyPrivateUpdate(privateInstall);
    return {
      applied: false,
      installMode: 'npm',
      reason: `Private install at ${root} is missing its bundled Node/npm runtime.`,
      next: 'Re-run the installer from the CLI setup archive to repair this install.',
    };
  }
  const installMode = options.installMode ?? detectInstallMode(modulePath);
  if (installMode === 'npm') return applyNpmUpdate(installMode);

  if (installMode === 'source') {
    return {
      applied: false,
      installMode,
      reason: 'Source installs are updated with git, not release assets.',
      next: 'Run `git pull && npm install && npm run build:electron` to update.',
    };
  }

  return {
    applied: false,
    installMode,
    reason: 'This CLI installation has no identifiable npm or source prefix.',
    next: 'Download the latest CLI setup ZIP, extract it, and run its installer.',
  };
};

export const downloadCliUpdate = async (options: CliUpdateOptions): Promise<CliUpdateDownloadResult> => {
  const release = await releaseFor(options);
  const asset = selectCliSetupAsset(release);
  const base = toCheckResult(options.currentVersion, release, asset);
  if (!asset) {
    return { ...base, downloaded: false, path: null, checksumVerified: null, next: 'No CLI setup archive was found in this release.' };
  }

  const result = await downloadReleaseAsset({
    release,
    asset,
    outputDir: options.outputDir ?? process.cwd(),
    onProgress: options.onProgress,
  });

  return {
    ...base,
    downloaded: true,
    path: result.path,
    checksumVerified: result.checksumVerified,
    next: `Unpack ${asset.name} and run its installer (install.cmd / install.ps1 on Windows, install.sh on macOS/Linux).`,
  };
};
