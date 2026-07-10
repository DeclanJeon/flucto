import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseCliArgs, CliUsageError } from '../dist-electron/cli/args.js';
import { createMultiJobOutputDir, slugifyJobLabel } from '../dist-electron/cli/jobOutput.js';
import { parseBatchFileContent, runWithConcurrency } from '../dist-electron/main/services/batch.js';
import { checkBinaryHealth, resolveCliBinaries } from '../dist-electron/main/services/binaryResolver.js';
import { setupUtilities } from '../dist-electron/main/services/binaryInstaller.js';
import { applyCliUpdate, checkForCliUpdate, downloadCliUpdate, parseChecksumManifest, verifySha256 } from '../dist-electron/main/services/cliUpdater.js';
import { compareVersions, parseGitHubRelease } from '../dist-electron/main/services/githubRelease.js';
import { selectReleaseAsset } from '../dist-electron/main/services/platformAssets.js';
import {
  buildDownloadArgs,
  getAudioQualityValue,
  getResolvedVideoFormatSelector,
  parseDownloadProgress,
  parseFinalFilePath,
} from '../dist-electron/main/services/mediaDownload.js';
import { normalizeTranscriptSettings, saveMarkdownFile, transcriptWordCount } from '../dist-electron/main/services/transcriptMarkdown.js';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-cli-test-'));

const writeExecutable = (filePath, content = '#!/usr/bin/env sh\necho ok\n') => {
  fs.writeFileSync(filePath, content, 'utf8');
  fs.chmodSync(filePath, 0o755);
};

test('CLI parser handles transcript stdout/json flags and defaults', () => {
  const options = parseCliArgs(['transcript', 'https://example.test/video', '--stdout', '--json', '--language', 'auto', '--no-timestamps']);
  assert.equal(options.command, 'transcript');
  assert.equal(options.positional[0], 'https://example.test/video');
  assert.equal(options.stdout, true);
  assert.equal(options.json, true);
  assert.equal(options.language, 'auto');
  assert.equal(options.timestamps, false);
});

test('CLI parser handles channel to-md nested command and limit/out flags', () => {
  const nested = parseCliArgs(['channel', 'to-md', '@learn-ai-lab', '--limit', '20', '--out', './notes', '--json']);
  assert.equal(nested.command, 'channel-to-md');
  assert.equal(nested.positional[0], '@learn-ai-lab');
  assert.equal(nested.limit, 20);
  assert.equal(nested.outputDir, './notes');
  assert.equal(nested.json, true);

  const flat = parseCliArgs(['channel-to-md', 'https://youtube.com/@x', '--limit', '5', '-o', '/tmp/md']);
  assert.equal(flat.command, 'channel-to-md');
  assert.equal(flat.limit, 5);
  assert.equal(flat.outputDir, '/tmp/md');

  assert.throws(() => parseCliArgs(['channel', 'wat', '@x']), /channel subcommand/);
  assert.throws(() => parseCliArgs(['channel', 'to-md']), /exactly one channel/);
});

test('multi-file job folders are created as dedicated subdirectories', () => {
  const temp = makeTempDir();
  assert.equal(slugifyJobLabel('@LIFECODEofficial'), 'LIFECODEofficial');
  const jobA = createMultiJobOutputDir(temp, 'channel-md', '라이프코드 LIFECODE');
  const jobB = createMultiJobOutputDir(temp, 'batch-md', 'urls');
  assert.ok(jobA.startsWith(temp));
  assert.ok(jobB.startsWith(temp));
  assert.notEqual(jobA, jobB);
  assert.ok(fs.existsSync(jobA));
  assert.ok(fs.existsSync(jobB));
  assert.match(path.basename(jobA), /channel-md-/);
  assert.match(path.basename(jobB), /batch-md-/);
});

test('normalizeChannelTarget expands handles and @ URLs', async () => {
  const { normalizeChannelTarget } = await import('../dist-electron/main/services/mediaInfo.js');
  assert.equal(normalizeChannelTarget('@learn-ai-lab'), 'https://www.youtube.com/@learn-ai-lab/videos');
  assert.equal(normalizeChannelTarget('learn-ai-lab'), 'https://www.youtube.com/@learn-ai-lab/videos');
  assert.equal(
    normalizeChannelTarget('https://www.youtube.com/@learn-ai-lab'),
    'https://www.youtube.com/@learn-ai-lab/videos',
  );
  assert.equal(
    normalizeChannelTarget('https://www.youtube.com/@learn-ai-lab/videos'),
    'https://www.youtube.com/@learn-ai-lab/videos',
  );
});

test('CLI parser rejects unknown commands and invalid download formats', () => {
  assert.throws(() => parseCliArgs(['wat']), CliUsageError);
  assert.throws(() => parseCliArgs(['download', 'https://example.test/video', '--format', 'md']), /download supports only mp4 or mp3/);
});

test('CLI parser handles setup and update commands', () => {
  const setup = parseCliArgs(['setup', '--check-only', '--force', '--bin-dir', '/tmp/flucto-bin', '--json']);
  assert.equal(setup.command, 'setup');
  assert.equal(setup.checkOnly, true);
  assert.equal(setup.force, true);
  assert.equal(setup.binDir, '/tmp/flucto-bin');

  const update = parseCliArgs(['update', 'download', '--output-dir', '/tmp/releases', '--json']);
  assert.equal(update.command, 'update');
  assert.equal(update.updateAction, 'download');
  assert.equal(update.outputDir, '/tmp/releases');

  const apply = parseCliArgs(['update', 'apply', '--asset', '/tmp/Flucto.AppImage', '--json']);
  assert.equal(apply.updateAction, 'apply');
  assert.equal(apply.assetPath, '/tmp/Flucto.AppImage');
});

test('CLI parser accepts short command and option aliases', () => {
  const download = parseCliArgs(['d', 'https://example.test/video', '-f', 'mp3', '-o', '/tmp/out', '-j']);
  assert.equal(download.command, 'download');
  assert.equal(download.format, 'mp3');
  assert.equal(download.outputDir, '/tmp/out');
  assert.equal(download.json, true);

  const transcript = parseCliArgs(['t', 'https://example.test/video', '-l', 'auto', '-s', '-j']);
  assert.equal(transcript.command, 'transcript');
  assert.equal(transcript.language, 'auto');
  assert.equal(transcript.stdout, true);
  assert.equal(transcript.json, true);

  const languages = parseCliArgs(['l', 'https://example.test/video']);
  assert.equal(languages.command, 'languages');

  const doctor = parseCliArgs(['doc']);
  assert.equal(doctor.command, 'doctor');

  const version = parseCliArgs(['v']);
  assert.equal(version.command, 'version');
});

test('batch parser matches desktop comment and blank-line rules', () => {
  assert.deepEqual(
    parseBatchFileContent('\n# comment\nhttps://one.example\n; skipped\n] skipped\n https://two.example \n'),
    ['https://one.example', 'https://two.example'],
  );
});

test('runWithConcurrency preserves input order', async () => {
  const results = await runWithConcurrency([3, 1, 2], 2, async (value) => value * 2);
  assert.deepEqual(results, [6, 2, 4]);
});

test('binary resolver prefers explicit paths and health check verifies executables', () => {
  const temp = makeTempDir();
  const ytDlp = path.join(temp, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const ffmpeg = path.join(temp, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  writeExecutable(ytDlp);
  writeExecutable(ffmpeg);

  const binaries = resolveCliBinaries({ ytDlpPath: ytDlp, ffmpegPath: ffmpeg, env: { PATH: '' }, cwd: temp });
  assert.deepEqual(binaries, { ytDlpPath: ytDlp, ffmpegPath: ffmpeg });
  assert.deepEqual(checkBinaryHealth(binaries).missing, []);
});

test('setupUtilities check-only validates provided bin dir without downloading', async () => {
  const temp = makeTempDir();
  const ytDlp = path.join(temp, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const ffmpeg = path.join(temp, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  writeExecutable(ytDlp, '#!/usr/bin/env sh\necho 2026.01.01\n');
  writeExecutable(ffmpeg, '#!/usr/bin/env sh\necho ffmpeg version test\n');

  const result = await setupUtilities({ binDir: temp, checkOnly: true, env: { PATH: '' }, cwd: temp });
  assert.equal(result.valid, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.utilities.map((utility) => utility.status).join(','), 'present,present');
});

test('setupUtilities check-only reports missing target bin dir even when PATH has binaries', async () => {
  const pathBin = makeTempDir();
  const emptyTarget = makeTempDir();
  const ytDlp = path.join(pathBin, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const ffmpeg = path.join(pathBin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  writeExecutable(ytDlp);
  writeExecutable(ffmpeg);

  const result = await setupUtilities({ binDir: emptyTarget, checkOnly: true, env: { PATH: pathBin }, cwd: emptyTarget });
  assert.equal(result.valid, false);
  assert.deepEqual(result.missing, ['yt-dlp', 'ffmpeg']);
  assert.equal(result.utilities.map((utility) => utility.status).join(','), 'missing,missing');
});

test('setupUtilities force does not overwrite explicit binary paths', async () => {
  const temp = makeTempDir();
  const ytDlp = path.join(temp, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const ffmpeg = path.join(temp, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const originalYtDlp = '#!/usr/bin/env sh\necho original-yt-dlp\n';
  const originalFfmpeg = '#!/usr/bin/env sh\necho original-ffmpeg\n';
  writeExecutable(ytDlp, originalYtDlp);
  writeExecutable(ffmpeg, originalFfmpeg);

  const result = await setupUtilities({ ytDlpPath: ytDlp, ffmpegPath: ffmpeg, force: true, env: { PATH: '' }, cwd: temp });
  assert.equal(result.valid, true);
  assert.equal(fs.readFileSync(ytDlp, 'utf8'), originalYtDlp);
  assert.equal(fs.readFileSync(ffmpeg, 'utf8'), originalFfmpeg);
});

test('download arg builder preserves quality, ffmpeg, and platform options', () => {
  const binaries = { ytDlpPath: '/bin/yt-dlp', ffmpegPath: '/opt/flucto/bin/ffmpeg' };
  const args = buildDownloadArgs({
    url: 'https://www.youtube.com/watch?v=test',
    format: 'mp4',
    outputDir: '/tmp/out',
    quality: { video: '720p', audio: '192kbps' },
  }, binaries);

  assert.ok(args.includes('--ffmpeg-location'));
  assert.ok(args.includes('/opt/flucto/bin'));
  assert.ok(args.includes('--merge-output-format'));
  assert.ok(args.includes('bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720][acodec!=none]/best[ext=mp4][acodec!=none]/worst[ext=mp4][acodec!=none]/mp4/best'));
  assert.ok(args.includes('--force-ipv4'));
});

test('media selectors handle overrides, instagram suppression, and audio quality', () => {
  assert.equal(getAudioQualityValue('128kbps'), '128K');
  assert.equal(getResolvedVideoFormatSelector('https://example.test/video', '1080p', '137'), '137+bestaudio[ext=m4a]/137+bestaudio/137/best[ext=mp4][acodec!=none]/best');
  assert.equal(getResolvedVideoFormatSelector('https://instagram.com/reel/1', '1080p', '137'), 'best[ext=mp4]/best');
});

test('download output parsers extract progress and final file paths', () => {
  assert.deepEqual(parseDownloadProgress('[download] 42.5% of 10.00MiB at 1.25MiB/s ETA 00:12'), {
    progress: 42.5,
    speed: '1.25MiB/s',
    eta: '00:12',
  });
  assert.equal(parseFinalFilePath('[Merger] Merging formats into "Video Title.mp4"'), 'Video Title.mp4');
  assert.equal(parseFinalFilePath('[download] Destination: Song Title.webm'), 'Song Title.webm');
});

test('transcript settings normalize auto sentinel and default missing fields', () => {
  const settings = normalizeTranscriptSettings({ language: 'auto', includeTimestamps: false });
  assert.equal(settings.language, null);
  assert.equal(settings.includeTimestamps, false);
  assert.equal(settings.includeMetadata, true);
  assert.equal(settings.saveMarkdownFile, true);
});

test('markdown saver allocates unique filenames and word count ignores whitespace', () => {
  const temp = makeTempDir();
  const first = saveMarkdownFile(temp, 'Test/Video', 'hello world');
  const second = saveMarkdownFile(temp, 'Test/Video', 'hello again');
  assert.notEqual(first, second);
  assert.match(path.basename(first), /^TestVideo_\d{8}\.md$/);
  assert.match(path.basename(second), /^TestVideo_\d{8}-2\.md$/);
  assert.equal(transcriptWordCount('  hello   world\nagain  '), 3);
});

test('GitHub release helpers parse versions, choose assets, and report update checks', async () => {
  const release = parseGitHubRelease({
    tag_name: 'v1.10.0',
    html_url: 'https://github.com/DeclanJeon/flucto/releases/tag/v1.10.0',
    published_at: '2026-07-06T00:00:00Z',
    assets: [
      { name: 'Flucto-1.10.0-x64-setup.exe', browser_download_url: 'https://example.test/setup.exe', size: 10, content_type: 'application/octet-stream' },
      { name: 'Flucto-1.10.0-x86_64.AppImage', browser_download_url: 'https://example.test/flucto.AppImage', size: 11, content_type: 'application/octet-stream' },
      { name: 'checksums-sha256.txt', browser_download_url: 'https://example.test/checksums.txt', size: 12, content_type: 'text/plain' },
    ],
  });

  assert.equal(compareVersions('1.10.0', '1.9.1'), 1);
  assert.equal(release.version, '1.10.0');
  assert.equal(selectReleaseAsset(release.assets, { platform: 'linux', arch: 'x64' })?.name, 'Flucto-1.10.0-x86_64.AppImage');

  const check = await checkForCliUpdate({ currentVersion: '1.9.1', release });
  assert.equal(check.updateAvailable, true);
  assert.equal(check.recommendedAsset, 'Flucto-1.10.0-x86_64.AppImage');
});

test('downloadCliUpdate fails when checksum manifest omits selected asset', async () => {
  const release = parseGitHubRelease({
    tag_name: 'v1.10.0',
    html_url: 'https://github.com/DeclanJeon/flucto/releases/tag/v1.10.0',
    published_at: '2026-07-06T00:00:00Z',
    assets: [
      { name: 'Flucto-1.10.0-x86_64.AppImage', browser_download_url: 'https://example.test/flucto.AppImage', size: 11, content_type: 'application/octet-stream' },
      { name: 'checksums-sha256.txt', browser_download_url: 'https://example.test/checksums.txt', size: 12, content_type: 'text/plain' },
    ],
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('checksums.txt')) {
      return new Response('b3f33710e86e05e2d982a508900ac82501875a586be829837679c6efa381037b  Other.AppImage\n');
    }
    return new Response('release-asset');
  };
  try {
    await assert.rejects(
      () => downloadCliUpdate({ currentVersion: '1.9.1', outputDir: makeTempDir(), release }),
      /Checksum manifest does not include/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('checksum helpers verify files and update apply stays conservative', async () => {
  const temp = makeTempDir();
  const asset = path.join(temp, 'Flucto.AppImage');
  fs.writeFileSync(asset, 'release-asset', 'utf8');
  const hash = 'b3f33710e86e05e2d982a508900ac82501875a586be829837679c6efa381037b';
  const manifest = parseChecksumManifest(`${hash}  ${asset}\n`);
  assert.equal(manifest.entries.get('Flucto.AppImage'), hash);
  assert.equal(await verifySha256(asset, hash), true);

  const apply = await applyCliUpdate({ currentVersion: '1.9.1', assetPath: asset });
  assert.equal(apply.applied, false);
  assert.match(apply.next, /manually/);
});
