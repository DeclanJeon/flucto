import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseCliArgs, CliUsageError } from '../dist-electron/cli/args.js';
import { parseBatchFileContent, runWithConcurrency } from '../dist-electron/main/services/batch.js';
import { checkBinaryHealth, resolveCliBinaries } from '../dist-electron/main/services/binaryResolver.js';
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

test('CLI parser rejects unknown commands and invalid download formats', () => {
  assert.throws(() => parseCliArgs(['wat']), CliUsageError);
  assert.throws(() => parseCliArgs(['download', 'https://example.test/video', '--format', 'md']), /download supports only mp4 or mp3/);
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
