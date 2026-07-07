import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { execa } from '../spawn.js';
import { resolveCliBinaries, type BinaryResolver } from './binaryResolver.js';

export type UtilityName = 'yt-dlp' | 'ffmpeg';
export type UtilityStatus = 'present' | 'downloaded' | 'missing' | 'failed';

export interface UtilitySetupOptions {
  binDir?: string;
  ytDlpPath?: string;
  ffmpegPath?: string;
  force?: boolean;
  checkOnly?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  onStatus?: (message: string) => void;
}

export interface UtilitySetupItem {
  name: UtilityName;
  path: string;
  status: UtilityStatus;
  version: string | null;
  error?: string;
}

export interface UtilitySetupResult {
  valid: boolean;
  binDir: string;
  missing: UtilityName[];
  paths: BinaryResolver;
  utilities: UtilitySetupItem[];
  fix?: string;
}

interface UtilitySpec {
  name: UtilityName;
  executableName: string;
  versionArgs: string[];
  downloadUrls: string[];
  archiveMember?: string;
}
interface ZipEntry {
  entryName: string;
  getData(): Buffer;
}

interface ZipArchive {
  getEntries(): ZipEntry[];
}

interface ZipArchiveConstructor {
  new(archivePath: string): ZipArchive;
}

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip') as ZipArchiveConstructor;

const YT_DLP_VERSION = 'latest';
const FFMPEG_RELEASE = '7.0.2';

const executableExtension = process.platform === 'win32' ? '.exe' : '';

const currentPlatform = (): NodeJS.Platform => process.platform;

const executableName = (name: UtilityName): string => `${name}${executableExtension}`;

export const getManagedBinDir = (env: NodeJS.ProcessEnv = process.env): string => {
  if (env.FLUCTO_BIN_DIR?.trim()) return path.resolve(env.FLUCTO_BIN_DIR.trim());
  if (currentPlatform() === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Flucto', 'bin');
  }
  if (currentPlatform() === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Flucto', 'bin');
  }
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'flucto', 'bin');
};

const utilitySpecs = (): UtilitySpec[] => {
  const platform = currentPlatform();
  const ytDlpUrl = platform === 'win32'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : platform === 'darwin'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  const ffmpegUrls = platform === 'win32'
    ? ['https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip']
    : platform === 'darwin'
      ? ['https://evermeet.cx/ffmpeg/getrelease/zip']
      : [
        'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
      ];

  return [
    {
      name: 'yt-dlp',
      executableName: executableName('yt-dlp'),
      versionArgs: ['--version'],
      downloadUrls: [ytDlpUrl],
    },
    {
      name: 'ffmpeg',
      executableName: executableName('ffmpeg'),
      versionArgs: ['-version'],
      downloadUrls: ffmpegUrls,
      archiveMember: platform === 'win32' || platform === 'darwin' ? executableName('ffmpeg') : 'ffmpeg',
    },
  ];
};

const isExecutable = (candidate: string): boolean => {
  const accessMode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.F_OK | fs.constants.X_OK;
  try {
    fs.accessSync(candidate, accessMode);
    return true;
  } catch {
    return false;
  }
};

const chmodExecutable = async (filePath: string): Promise<void> => {
  if (process.platform !== 'win32') await fs.promises.chmod(filePath, 0o755);
};

const versionFor = async (filePath: string, args: string[]): Promise<string | null> => {
  if (!isExecutable(filePath)) return null;
  const result = await execa(filePath, args, { reject: false });
  if (result.failed) return null;
  return (result.stdout || result.stderr).split(/\r?\n/).find((line) => line.trim())?.trim() ?? null;
};

const downloadFile = async (url: string, destination: string): Promise<void> => {
  const response = await fetch(url, { headers: { 'user-agent': `Flucto/${YT_DLP_VERSION} (${FFMPEG_RELEASE})` } });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, Buffer.from(await response.arrayBuffer()));
};

const extractZipMember = async (archivePath: string, memberName: string, destination: string): Promise<void> => {
  const archive = new AdmZip(archivePath);
  const normalizedMember = memberName.replace(/\\/g, '/');
  const entry = archive.getEntries().find((candidate) => candidate.entryName.replace(/\\/g, '/').endsWith(`/${normalizedMember}`) || candidate.entryName === normalizedMember);
  if (!entry) throw new Error(`Archive member not found: ${memberName}`);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, entry.getData());
};

const extractTarMember = async (archivePath: string, memberName: string, destination: string): Promise<void> => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flucto-bin-'));
  try {
    const result = await execa('tar', ['-xJf', archivePath, '-C', tempDir], { reject: false });
    if (result.failed) throw new Error(result.stderr || 'tar extraction failed');
    const found = findFileNamed(tempDir, memberName);
    if (!found) throw new Error(`Archive member not found: ${memberName}`);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(found, destination);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
};

const findFileNamed = (directory: string, filename: string): string | null => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === filename) return candidate;
    if (entry.isDirectory()) {
      const nested = findFileNamed(candidate, filename);
      if (nested) return nested;
    }
  }
  return null;
};

const provisionUtilityFromUrl = async (spec: UtilitySpec, url: string, targetPath: string, onStatus?: (message: string) => void): Promise<void> => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flucto-download-'));
  const archivePath = path.join(tempDir, path.basename(new URL(url).pathname) || `${spec.name}.download`);
  try {
    onStatus?.(`Downloading ${spec.name}...`);
    await downloadFile(url, archivePath);
    if (spec.name === 'yt-dlp') {
      await fs.promises.copyFile(archivePath, targetPath);
    } else if (process.platform === 'linux') {
      await extractTarMember(archivePath, spec.archiveMember ?? spec.executableName, targetPath);
    } else {
      await extractZipMember(archivePath, spec.archiveMember ?? spec.executableName, targetPath);
    }
    await chmodExecutable(targetPath);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
};

const provisionUtility = async (spec: UtilitySpec, targetPath: string, onStatus?: (message: string) => void): Promise<void> => {
  const errors: string[] = [];
  for (const url of spec.downloadUrls) {
    try {
      await provisionUtilityFromUrl(spec, url, targetPath, onStatus);
      return;
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Failed to provision ${spec.name}: ${errors.join(' | ')}`);
};

const managedTargetPath = (binDir: string, name: UtilityName): string => path.join(binDir, executableName(name));

export const setupUtilities = async (options: UtilitySetupOptions = {}): Promise<UtilitySetupResult> => {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const binDir = path.resolve(options.binDir ?? getManagedBinDir(env));
  const utilities: UtilitySetupItem[] = [];

  if (!options.checkOnly) await fs.promises.mkdir(binDir, { recursive: true });

  for (const spec of utilitySpecs()) {
    const explicitPath = spec.name === 'yt-dlp' ? options.ytDlpPath ?? env.FLUCTO_YT_DLP_PATH : options.ffmpegPath ?? env.FLUCTO_FFMPEG_PATH;
    const targetPath = explicitPath ? path.resolve(explicitPath) : managedTargetPath(binDir, spec.name);
    const present = isExecutable(targetPath);

    if (options.checkOnly) {
      utilities.push({
        name: spec.name,
        path: targetPath,
        status: present ? 'present' : 'missing',
        version: present ? await versionFor(targetPath, spec.versionArgs) : null,
      });
      continue;
    }

    if (explicitPath) {
      utilities.push({
        name: spec.name,
        path: targetPath,
        status: present ? 'present' : 'failed',
        version: present ? await versionFor(targetPath, spec.versionArgs) : null,
        error: present ? undefined : 'Explicit binary path is not executable.',
      });
      continue;
    }

    if (present && !options.force) {
      utilities.push({ name: spec.name, path: targetPath, status: 'present', version: await versionFor(targetPath, spec.versionArgs) });
      continue;
    }

    try {
      await provisionUtility(spec, targetPath, options.onStatus);
      utilities.push({ name: spec.name, path: targetPath, status: 'downloaded', version: await versionFor(targetPath, spec.versionArgs) });
    } catch (error: unknown) {
      utilities.push({
        name: spec.name,
        path: targetPath,
        status: 'failed',
        version: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const paths = resolveCliBinaries({
    binDir,
    ytDlpPath: options.ytDlpPath,
    ffmpegPath: options.ffmpegPath,
    env,
    cwd,
  });
  const setupMissing = utilities
    .filter((utility) => utility.status === 'missing' || utility.status === 'failed')
    .map((utility) => utility.name);
  const uniqueMissing = [...new Set(setupMissing)];
  return {
    valid: uniqueMissing.length === 0,
    binDir,
    missing: uniqueMissing,
    paths,
    utilities,
    fix: uniqueMissing.length ? 'Run `flucto setup` or pass --yt-dlp/--ffmpeg paths.' : undefined,
  };
};
