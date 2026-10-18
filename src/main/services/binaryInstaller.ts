import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { execa } from '../spawn.js';
import { resolveCliBinaries, type BinaryResolver } from './binaryResolver.js';

export type UtilityName = 'yt-dlp' | 'ffmpeg' | 'ffprobe';
export type UtilityStatus = 'present' | 'downloaded' | 'missing' | 'failed';

export interface UtilitySetupOptions {
  binDir?: string;
  ytDlpPath?: string;
  ffmpegPath?: string;
  force?: boolean;
  checkOnly?: boolean;
  /** Restrict provisioning to a subset of utilities (e.g. yt-dlp only for transcript workflows). */
  only?: UtilityName[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  onStatus?: (message: string) => void;
  /** Test seam for offline provisioning tests. */
  fetchImpl?: typeof fetch;
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
  archiveSha256?: string;
}
interface ZipEntry {
  entryName: string;
  header?: { attr?: number; size?: number; compressedSize?: number };
  getData(): Buffer;
}

interface ZipArchive {
  getEntries(): ZipEntry[];
}

interface ZipArchiveConstructor {
  new(archivePath: string): ZipArchive;
}
interface TarApi {
  x(options: { file: string; cwd: string; strict: boolean; filter: (entryPath: string, entry: { type?: string; size?: number }) => boolean }): Promise<void>;
}

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip') as ZipArchiveConstructor;
const tar = require('tar') as TarApi;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_DECOMPRESSED_TAR_BYTES = 1024 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;

// These FFmpeg builds include GPL components (and may trigger redistribution obligations); legal review is not represented here.
export interface PinnedAvSource { url: string; sha256: string; }
const GYAN_WIN_X64: PinnedAvSource = {
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip',
  sha256: 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec',
};
const BTBN_LINUX: Record<string, PinnedAvSource> = {
  x64: { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-18-13-01/ffmpeg-N-127651-gb60ab6c9a4-linux64-gpl.tar.xz', sha256: 'a5f2aed198efa8ef4c12d9112f42e7cefbdf11dced1b59a87503ca689bc52277' },
  arm64: { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-18-13-01/ffmpeg-N-127651-gb60ab6c9a4-linuxarm64-gpl.tar.xz', sha256: '3d1ccdb45b01635e8404da39869f3a0c7a535b9e63470439bc3e677cf12fe266' },
};
const MARTIN_MAC: Record<string, { ffmpeg: PinnedAvSource; ffprobe: PinnedAvSource }> = {
  x64: {
    ffmpeg: { url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip', sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4' },
    ffprobe: { url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffprobe.zip', sha256: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd' },
  },
  arm64: {
    ffmpeg: { url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip', sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924' },
    ffprobe: { url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffprobe.zip', sha256: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6' },
  },
};

export const pinnedAvSourceFor = (name: 'ffmpeg' | 'ffprobe', platform: NodeJS.Platform, arch: string): PinnedAvSource => {
  if (platform === 'win32' && arch === 'x64') return GYAN_WIN_X64;
  if (platform === 'linux' && BTBN_LINUX[arch]) return BTBN_LINUX[arch];
  if (platform === 'darwin' && MARTIN_MAC[arch]) return MARTIN_MAC[arch][name];
  throw new Error(`No pinned ${name} source for ${platform}/${arch}`);
};

export const verifySha256 = (bytes: Buffer, expected: string): boolean => {
  const actual = (awaitlessCreateHash(bytes));
  return actual === expected.toLowerCase();
};
const awaitlessCreateHash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const YT_DLP_VERSION = 'latest';
const FFMPEG_RELEASE = '7.0.2';

const executableExtension = process.platform === 'win32' ? '.exe' : '';

const currentPlatform = (): NodeJS.Platform => process.platform;

export const executableName = (name: UtilityName): string => `${name}${executableExtension}`;

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

// Download sources per OS/CPU. Fallback ordering only lists builds that are
// architecturally compatible: evermeet.cx ships x86_64-only, so arm64 Macs
// never see it; Linux entries cover amd64, arm64, armhf and i686.
export const ytDlpUrlFor = (platform: NodeJS.Platform = currentPlatform(), arch: string = process.arch): string => {
  if (platform === 'win32') {
    return 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe';
  }
  if (platform === 'darwin') {
    // yt-dlp_macos is a universal2 (x86_64+arm64) Mach-O binary.
    return 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos';
  }
  if (platform === 'linux') {
    return arch === 'arm64'
      ? 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux_aarch64'
      : 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux';
  }
  throw new Error(`No yt-dlp download source for platform ${platform}`);
};

export const ffmpegDownloadUrlsFor = (platform: NodeJS.Platform = currentPlatform(), arch: string = process.arch): string[] => [pinnedAvSourceFor('ffmpeg', platform, arch).url];

export const ffprobeDownloadUrlsFor = (platform: NodeJS.Platform = currentPlatform(), arch: string = process.arch): string[] => [pinnedAvSourceFor('ffprobe', platform, arch).url];

export const utilitySpecs = (): UtilitySpec[] => {
  return [
    {
      name: 'yt-dlp',
      executableName: executableName('yt-dlp'),
      versionArgs: ['--version'],
      downloadUrls: [ytDlpUrlFor()],
    },
    {
      name: 'ffmpeg',
      executableName: executableName('ffmpeg'),
      versionArgs: ['-version'],
      downloadUrls: ffmpegDownloadUrlsFor(),
      archiveMember: executableName('ffmpeg'),
      archiveSha256: pinnedAvSourceFor('ffmpeg', currentPlatform(), process.arch).sha256,
    },
    {
      name: 'ffprobe',
      executableName: executableName('ffprobe'),
      versionArgs: ['-version'],
      downloadUrls: ffprobeDownloadUrlsFor(),
      archiveMember: executableName('ffprobe'),
      archiveSha256: pinnedAvSourceFor('ffprobe', currentPlatform(), process.arch).sha256,
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

const normalizeYtDlpVersion = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value.trim().replace(/^yt-dlp\s+/i, '').replace(/^v/i, '') || null;
};

export const fetchLatestYtDlpVersion = async (): Promise<string | null> => {
  try {
    const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest', {
      headers: {
        'user-agent': `Flucto/${YT_DLP_VERSION}`,
        accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { tag_name?: unknown };
    return normalizeYtDlpVersion(typeof payload.tag_name === 'string' ? payload.tag_name : null);
  } catch {
    return null;
  }
};

export const versionFor = async (filePath: string, args: string[]): Promise<string | null> => {
  if (!isExecutable(filePath)) return null;
  const result = await execa(filePath, args, { reject: false });
  if (result.failed) return null;
  return (result.stdout || result.stderr).split(/\r?\n/).find((line) => line.trim())?.trim() ?? null;
};

const downloadFile = async (url: string, destination: string, fetchImpl: typeof fetch = fetch): Promise<void> => {
  const response = await fetchImpl(url, { headers: { 'user-agent': `Flucto/${YT_DLP_VERSION} (${FFMPEG_RELEASE})` }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) throw new Error('Downloaded archive exceeds size limit');
  if (!response.body) throw new Error('Download response has no body');
  let total = 0;
  const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    total += chunk.length;
    callback(total > MAX_ARCHIVE_BYTES ? new Error('Downloaded archive exceeds size limit') : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), limiter, fs.createWriteStream(destination, { flags: 'wx' }));
};

const normalizeArchivePath = (name: string): string => {
  const value = name.replace(/\\/g, '/');
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').some((part) => part === '..')) {
    throw new Error(`Unsafe archive member path: ${name}`);
  }
  return value.replace(/^\.\//, '');
};

export const extractZipMember = async (archivePath: string, memberName: string, destination: string): Promise<void> => {
  const archiveStat = await fs.promises.stat(archivePath);
  if (archiveStat.size > MAX_ARCHIVE_BYTES) throw new Error('ZIP archive exceeds size limit');
  const archive = new AdmZip(archivePath);
  const entries = archive.getEntries();
  for (const entry of entries) {
    normalizeArchivePath(entry.entryName);
    const mode = (entry as ZipEntry & { header?: { attr?: number } }).header?.attr ?? 0;
    if (((mode >>> 16) & 0xf000) === 0xa000) throw new Error(`Archive contains a symbolic link: ${entry.entryName}`);
  }
  const candidates = entries.filter((entry) => {
    const normalized = normalizeArchivePath(entry.entryName);
    return normalized === memberName || normalized.endsWith(`/${memberName}`);
  });
  if (candidates.length !== 1) throw new Error(candidates.length ? `Ambiguous archive member: ${memberName}` : `Archive member not found: ${memberName}`);
  const declared = candidates[0].header;
  const compressedSize = declared?.compressedSize;
  const size = declared?.size;
  if (typeof size !== 'number' || size < 0 || size > MAX_EXECUTABLE_BYTES) throw new Error('ZIP member exceeds size limit or has invalid size');
  if (typeof compressedSize !== 'number' || compressedSize < 0 || size / Math.max(1, compressedSize) > 1000) throw new Error('ZIP member compression ratio exceeds limit');
  const data = candidates[0].getData();
  if (data.length !== size || data.length > MAX_EXECUTABLE_BYTES) throw new Error('ZIP member actual size does not match declared size');
  await fs.promises.writeFile(destination, data);
};

export const extractTarMember = async (archivePath: string, memberName: string, destination: string): Promise<void> => {
  const stat = await fs.promises.stat(archivePath);
  if (stat.size > MAX_DECOMPRESSED_TAR_BYTES) throw new Error('TAR archive exceeds size limit');
  const extractDir = await fs.promises.mkdtemp(path.join(path.dirname(destination), '.flucto-tar-'));
  let expectedCount = 0;
  let validationError: Error | null = null;
  const expectedMembers = new Set<string>();
  const filter = (rawPath: string, entry: { type?: string; size?: number }): boolean => {
    let normalized: string;
    try { normalized = normalizeArchivePath(rawPath); } catch (error) {
      validationError = error instanceof Error ? error : new Error(String(error));
      return false;
    }
    if (entry.type && !['File', 'Directory'].includes(entry.type)) {
      validationError = new Error(`TAR links/special entries are rejected: ${rawPath}`);
      return false;
    }
    const isCandidate = normalized === memberName || normalized.endsWith(`/${memberName}`);
    if (isCandidate) {
      expectedCount += 1;
      if (expectedCount > 1) throw new Error(`Ambiguous TAR member: ${memberName}`);
      if (entry.type !== 'File') { validationError = new Error(`Expected regular TAR file: ${rawPath}`); return false; }
      if (typeof entry.size !== 'number' || entry.size > MAX_EXECUTABLE_BYTES) { validationError = new Error('TAR executable exceeds size limit'); return false; }
      expectedMembers.add(normalized);
      return true;
    }
    if (entry.type === 'Directory') return true;
    return false;
  };
  try {
    await tar.x({ file: archivePath, cwd: extractDir, strict: true, filter });
    if (validationError) throw validationError;
    if (expectedCount !== 1 || expectedMembers.size !== 1) throw new Error(`TAR member not found: ${memberName}`);
    const found = path.join(extractDir, ...[...expectedMembers][0].split('/'));
    if (!fs.existsSync(found)) throw new Error(`TAR member not extracted: ${memberName}`);
    const extracted = await fs.promises.stat(found);
    if (!extracted.isFile() || extracted.size > MAX_EXECUTABLE_BYTES) throw new Error('Extracted TAR member exceeds size limit');
    await fs.promises.copyFile(found, destination);
  } finally {
    await fs.promises.rm(extractDir, { recursive: true, force: true });
  }
};

const decompressXz = async (source: string, destination: string): Promise<void> => {
  const child = spawn('xz', ['-dc', '--', source], { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
  let stderr = '';
  let spawnError: Error | null = null;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8192); });
  const exited = new Promise<number | null>((resolve) => {
    child.once('error', (error) => { spawnError = error; });
    child.once('close', resolve);
  });
  let total = 0;
  const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    total += chunk.length;
    callback(total > MAX_DECOMPRESSED_TAR_BYTES ? new Error('Decompressed TAR exceeds size limit') : null, chunk);
  } });
  let timedOut = false;
  let forceKillTimer: NodeJS.Timeout | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
  }, 120000);
  const stopChild = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const closed = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (!closed) await exited;
  };
  try {
    await Promise.all([
      pipeline(child.stdout, limiter, fs.createWriteStream(destination, { flags: 'wx' })),
      exited.then((code) => {
        if (spawnError) throw spawnError;
        if (timedOut) throw new Error('xz decompression timed out');
        if (code !== 0) throw new Error(`xz decompression failed (${code}): ${stderr}`);
      }),
    ]);
  } catch (error) {
    await stopChild();
    await fs.promises.rm(destination, { force: true });
    throw error;
  } finally {
    clearTimeout(timeout);
    if (forceKillTimer) clearTimeout(forceKillTimer);
  }
};

const extractGzipMember = async (archivePath: string, destination: string): Promise<void> => {
  let total = 0;
  const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    total += chunk.length;
    callback(total > MAX_EXECUTABLE_BYTES ? new Error('Gzip executable exceeds size limit') : null, chunk);
  } });
  await pipeline(fs.createReadStream(archivePath), zlib.createGunzip(), limiter, fs.createWriteStream(destination, { flags: 'wx' }));
};

const replacePreservingOld = async (staged: string, target: string): Promise<void> => {
  // Same-filesystem rename is atomic on POSIX. On platforms that reject
  // replacement (notably Windows with a target in use), fail without moving it.
  await fs.promises.rename(staged, target);
};

const isZipArchive = async (filePath: string): Promise<boolean> => {
  if (filePath.toLowerCase().endsWith('.zip')) return true;
  const file = await fs.promises.open(filePath, 'r');
  try {
    const signature = Buffer.allocUnsafe(4);
    const { bytesRead } = await file.read(signature, 0, 4, 0);
    return bytesRead === 4 && signature.readUInt32LE(0) === 0x04034b50;
  } finally {
    await file.close();
  }
};


const extractValidateUtility = async (spec: UtilitySpec, archivePath: string, stagedPath: string, tempDir: string, decompressedTarCache = new Map<string, string>()): Promise<void> => {
  if (spec.name === 'yt-dlp') await fs.promises.copyFile(archivePath, stagedPath);
  else {
    const lower = archivePath.toLowerCase();
    const member = spec.archiveMember ?? spec.executableName;
    if (await isZipArchive(archivePath)) await extractZipMember(archivePath, member, stagedPath);
    else if (lower.endsWith('.gz') && !lower.endsWith('.tar.gz')) await extractGzipMember(archivePath, stagedPath);
    else if (lower.endsWith('.tar.xz')) {
      let tarPath = decompressedTarCache.get(archivePath);
      if (!tarPath) {
        tarPath = path.join(tempDir, `archive-${decompressedTarCache.size}.decompressed.tar`);
        await decompressXz(archivePath, tarPath);
        decompressedTarCache.set(archivePath, tarPath);
      }
      await extractTarMember(tarPath, member, stagedPath);
    } else await extractTarMember(archivePath, member, stagedPath);
  }
  if (process.platform !== 'win32') await fs.promises.chmod(stagedPath, 0o755);
  if (!await versionFor(stagedPath, spec.versionArgs)) throw new Error(`${spec.name} staged executable failed version validation`);
};

const provisionUtilityFromUrl = async (spec: UtilitySpec, url: string, targetPath: string, onStatus?: (message: string) => void, fetchImpl: typeof fetch = fetch): Promise<void> => {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const tempDir = await fs.promises.mkdtemp(path.join(path.dirname(targetPath), '.flucto-download-'));
  const archivePath = path.join(tempDir, path.basename(new URL(url).pathname) || `${spec.name}.download`);
  const stagedPath = path.join(tempDir, spec.executableName);
  try {
    onStatus?.(`Downloading ${spec.name}...`);
    await downloadFile(url, archivePath, fetchImpl);
    if (spec.archiveSha256 && !verifySha256(await fs.promises.readFile(archivePath), spec.archiveSha256)) throw new Error(`${spec.name} archive SHA-256 mismatch`);
    await extractValidateUtility(spec, archivePath, stagedPath, tempDir);
    await replacePreservingOld(stagedPath, targetPath);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
};

export const provisionUtility = async (spec: UtilitySpec, targetPath: string, onStatus?: (message: string) => void, fetchImpl: typeof fetch = fetch): Promise<void> => {
  const errors: string[] = [];
  for (const url of spec.downloadUrls) {
    try {
      await provisionUtilityFromUrl(spec, url, targetPath, onStatus, fetchImpl);
      return;
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Failed to provision ${spec.name}: ${errors.length ? errors.join(' | ') : 'no verified download source is configured'}`);
};

const managedTargetPath = (binDir: string, name: UtilityName): string => path.join(binDir, executableName(name));

const expectedAvVersionIdentity = (platform: NodeJS.Platform): string =>
  platform === 'win32' ? '8.1.2' : platform === 'darwin' ? '9.0.2' : 'N-127651-gb60ab6c9a4';
const versionIdentity = (value: string | null): string | null => value?.match(/version ([^ ]+)/)?.[1] ?? null;
const versionsMatch = (left: string | null, right: string | null): boolean => {
  const leftIdentity = versionIdentity(left);
  const rightIdentity = versionIdentity(right);
  return leftIdentity !== null && rightIdentity !== null && leftIdentity === rightIdentity;
};

export const replaceManagedAvPair = async (pairs: Array<{ staged: string; target: string }>, binDir: string, operations: { rename?: typeof fs.promises.rename; remove?: typeof fs.promises.rm } = {}): Promise<void> => {
  const rename = operations.rename ?? fs.promises.rename.bind(fs.promises);
  const remove = operations.remove ?? fs.promises.rm.bind(fs.promises);
  const backupDir = await fs.promises.mkdtemp(path.join(binDir, '.av-backup-'));
  const backups: Array<{ target: string; backup: string }> = [];
  const installed: string[] = [];
  try {
    for (const [i, pair] of pairs.entries()) {
      try {
        await fs.promises.access(pair.target);
        const backup = path.join(backupDir, `${i}-${path.basename(pair.target)}`);
        await rename(pair.target, backup);
        backups.push({ target: pair.target, backup });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    for (const pair of pairs) { await rename(pair.staged, pair.target); installed.push(pair.target); }
    await remove(backupDir, { recursive: true, force: true });
    backups.length = 0;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const target of installed.reverse()) {
      try { await remove(target, { force: true }); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    for (const item of backups.reverse()) {
      try { await rename(item.backup, item.target); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `FFmpeg/FFprobe replacement rollback incomplete; backups preserved in ${backupDir}`);
    throw error;
  } finally {
    if (!backups.some((item) => fs.existsSync(item.backup))) await remove(backupDir, { recursive: true, force: true });
  }
};

export const downloadUniquePinnedAvArchives = async (specs: UtilitySpec[], directory: string, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> => {
  const archives = new Map<string, string>();
  for (const spec of specs) {
    const url = spec.downloadUrls[0];
    if (!url) throw new Error(`No pinned source for ${spec.name}`);
    if (!archives.has(url)) {
      const archivePath = path.join(directory, `archive-${archives.size}-${path.basename(new URL(url).pathname)}`);
      await downloadFile(url, archivePath, fetchImpl);
      if (!spec.archiveSha256 || !verifySha256(await fs.promises.readFile(archivePath), spec.archiveSha256)) throw new Error(`${spec.name} archive SHA-256 mismatch`);
      archives.set(url, archivePath);
    } else {
      const shared = archives.get(url)!;
      if (!spec.archiveSha256 || !verifySha256(await fs.promises.readFile(shared), spec.archiveSha256)) throw new Error(`${spec.name} shared archive SHA-256 mismatch`);
    }
  }
  return archives;
};

const provisionManagedAvPair = async (ffmpegSpec: UtilitySpec, ffprobeSpec: UtilitySpec, binDir: string, force: boolean, onStatus?: (message: string) => void, fetchImpl: typeof fetch = fetch): Promise<boolean> => {
  const expected = expectedAvVersionIdentity(process.platform);
  const targets = [managedTargetPath(binDir, 'ffmpeg'), managedTargetPath(binDir, 'ffprobe')];
  const installedMatches = await Promise.all(targets.map(async (target) => (await versionFor(target, ['-version']))?.includes(expected) ?? false));
  if (!force && installedMatches.every(Boolean)) return false;
  const stageDir = await fs.promises.mkdtemp(path.join(binDir, '.av-stage-'));
  try {
    const specs = [ffmpegSpec, ffprobeSpec];
    const stagePaths = specs.map((spec) => path.join(stageDir, spec.executableName));
    onStatus?.('Downloading pinned FFmpeg/FFprobe archives...');
    const archives = await downloadUniquePinnedAvArchives(specs, stageDir, fetchImpl);
    const decompressedTarCache = new Map<string, string>();
    for (let index = 0; index < specs.length; index += 1) {
      await extractValidateUtility(specs[index], archives.get(specs[index].downloadUrls[0])!, stagePaths[index], stageDir, decompressedTarCache);
    }
    const versions = await Promise.all([versionFor(stagePaths[0], ffmpegSpec.versionArgs), versionFor(stagePaths[1], ffprobeSpec.versionArgs)]);
    if (!versions[0]?.includes(expected) || !versions[1]?.includes(expected)) throw new Error('Staged FFmpeg/FFprobe pair does not match the pinned build identity');
    await replaceManagedAvPair(stagePaths.map((staged, i) => ({ staged, target: targets[i] })), binDir);
    return true;
  } finally { await fs.promises.rm(stageDir, { recursive: true, force: true }); }
};

export const setupUtilities = async (options: UtilitySetupOptions = {}): Promise<UtilitySetupResult> => {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const binDir = path.resolve(options.binDir ?? getManagedBinDir(env));
  const utilities: UtilitySetupItem[] = [];

  if (!options.checkOnly) await fs.promises.mkdir(binDir, { recursive: true });

  const allSpecs = utilitySpecs();
  const specs = options.only?.length ? allSpecs.filter((spec) => options.only?.includes(spec.name)) : allSpecs;
  const selectedAvPair = specs.some((spec) => spec.name === 'ffmpeg' || spec.name === 'ffprobe');
  const customFfmpeg = options.ffmpegPath ?? env.FLUCTO_FFMPEG_PATH;
  let avPairProvisioned = false;
  let avPairError: string | undefined;
  if (options.checkOnly && selectedAvPair) {
    const ffmpegPath = customFfmpeg ? path.resolve(customFfmpeg) : managedTargetPath(binDir, 'ffmpeg');
    const ffprobePath = customFfmpeg ? path.join(path.dirname(ffmpegPath), executableName('ffprobe')) : managedTargetPath(binDir, 'ffprobe');
    const ffmpegVersion = await versionFor(ffmpegPath, ['-version']);
    const ffprobeVersion = await versionFor(ffprobePath, ['-version']);
    const identitiesMatch = versionsMatch(ffmpegVersion, ffprobeVersion);
    const expectedMatch = customFfmpeg || (versionIdentity(ffmpegVersion) === expectedAvVersionIdentity(process.platform) && versionIdentity(ffprobeVersion) === expectedAvVersionIdentity(process.platform));
    if (!identitiesMatch || !expectedMatch) avPairError = customFfmpeg
      ? `Explicit FFmpeg/adjacent FFprobe pair is missing or version-incompatible (${ffmpegPath}, ${ffprobePath}).`
      : 'Managed FFmpeg/FFprobe pair is missing, stale, or version-mismatched for the pinned build.';
  }
  if (!options.checkOnly && selectedAvPair && !customFfmpeg) {
    try {
      avPairProvisioned = await provisionManagedAvPair(allSpecs.find((spec) => spec.name === 'ffmpeg')!, allSpecs.find((spec) => spec.name === 'ffprobe')!, binDir, Boolean(options.force), options.onStatus, options.fetchImpl);
    } catch (error) { avPairError = error instanceof Error ? error.message : String(error); }
  }

  for (const spec of specs) {
    const explicitPath = spec.name === 'yt-dlp'
      ? options.ytDlpPath ?? env.FLUCTO_YT_DLP_PATH
      : spec.name === 'ffmpeg' ? options.ffmpegPath ?? env.FLUCTO_FFMPEG_PATH : undefined;
    const configuredFfmpegPath = options.ffmpegPath ?? env.FLUCTO_FFMPEG_PATH;
    if (selectedAvPair && !customFfmpeg && !options.checkOnly && (spec.name === 'ffmpeg' || spec.name === 'ffprobe')) {
      const target = managedTargetPath(binDir, spec.name);
      const version = avPairError ? null : await versionFor(target, spec.versionArgs);
      utilities.push({ name: spec.name, path: target, status: avPairError ? 'failed' : avPairProvisioned ? 'downloaded' : 'present', version, error: avPairError });
      continue;
    }
    const targetPath = explicitPath
      ? path.resolve(explicitPath)
      : spec.name === 'ffprobe' && configuredFfmpegPath
        ? path.join(path.dirname(path.resolve(configuredFfmpegPath)), executableName('ffprobe'))
        : managedTargetPath(binDir, spec.name);
    const present = isExecutable(targetPath);

    if (options.checkOnly) {
      const isAv = spec.name === 'ffmpeg' || spec.name === 'ffprobe';
      utilities.push({
        name: spec.name,
        path: targetPath,
        status: isAv && avPairError ? 'failed' : present ? 'present' : 'missing',
        version: present ? await versionFor(targetPath, spec.versionArgs) : null,
        error: isAv ? avPairError : undefined,
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

    const ffprobeBesideExplicitFfmpeg = spec.name === 'ffprobe' && Boolean(configuredFfmpegPath);
    if (ffprobeBesideExplicitFfmpeg) {
      const ffmpegVersion = await versionFor(path.resolve(configuredFfmpegPath!), ['-version']);
      const ffprobeVersion = await versionFor(targetPath, spec.versionArgs);
      const compatible = versionsMatch(ffmpegVersion, ffprobeVersion);
      utilities.push({ name: spec.name, path: targetPath, status: compatible ? 'present' : 'failed', version: ffprobeVersion, error: compatible ? undefined : `Explicit FFmpeg/adjacent FFprobe pair is missing or version-incompatible (${configuredFfmpegPath}, ${targetPath}).` });
      continue;
    }
    if (present && (!options.force || ffprobeBesideExplicitFfmpeg)) {
      const installedVersion = await versionFor(targetPath, spec.versionArgs);
      if (spec.name === 'yt-dlp') {
        const latestVersion = await fetchLatestYtDlpVersion();
        const localVersion = normalizeYtDlpVersion(installedVersion);
        if (latestVersion && localVersion && latestVersion !== localVersion) {
          options.onStatus?.(`Updating yt-dlp (${localVersion} → ${latestVersion})...`);
          try {
            await provisionUtility(spec, targetPath, options.onStatus);
            utilities.push({
              name: spec.name,
              path: targetPath,
              status: 'downloaded',
              version: await versionFor(targetPath, spec.versionArgs),
            });
            continue;
          } catch (error: unknown) {
            utilities.push({
              name: spec.name,
              path: targetPath,
              status: 'failed',
              version: installedVersion,
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
        }
      }

      utilities.push({ name: spec.name, path: targetPath, status: 'present', version: installedVersion });
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
