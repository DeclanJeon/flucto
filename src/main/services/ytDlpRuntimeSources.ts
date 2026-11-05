import { execa } from '../spawn.js';

const NIGHTLY_ASSETS = 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/';

export interface YtDlpRuntimeOptions {
  readonly platform?: NodeJS.Platform;
  readonly probePython?: () => Promise<boolean>;
}

const hasSupportedPython = async (): Promise<boolean> => {
  const result = await execa('python3', [
    '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)',
  ], { reject: false, timeoutMs: 5000 });
  return !result.failed;
};

/**
 * Prefer the official zipapp for Linux runtime updates when its interpreter is
 * available. Unlike the standalone ELF it does not unpack a private Python on
 * every invocation. Desktop packaging still ships the self-contained build.
 * Custom/offline sources must never be replaced with an unsolicited upstream URL.
 */
export const ytDlpRuntimeSources = async (
  nativeSources: readonly string[],
  options: YtDlpRuntimeOptions = {},
): Promise<readonly string[]> => {
  const platform = options.platform ?? process.platform;
  const officialLinuxSource = nativeSources.some((url) =>
    url.startsWith(NIGHTLY_ASSETS) && /\/yt-dlp_linux(?:_aarch64)?$/.test(url));
  if (platform !== 'linux' || !officialLinuxSource) return nativeSources;
  if (!await (options.probePython ?? hasSupportedPython)()) return nativeSources;
  return [`${NIGHTLY_ASSETS}yt-dlp`, ...nativeSources];
};
