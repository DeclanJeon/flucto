import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  ffmpegSourcesFor,
  pinnedAvSourceFor as setupPinnedAvSourceFor,
  replaceAvPairAtomically,
  ytDlpUrlFor,
  machOArchitectures,
  assertUniversalMachO,
} from '../scripts/setup-binaries.mjs';
import {
  ffmpegDownloadUrlsFor,
  ffprobeDownloadUrlsFor,
  pinnedAvSourceFor as installerPinnedAvSourceFor,
  ytDlpUrlFor as installerYtDlpUrlFor,
} from '../dist-electron/main/services/binaryInstaller.js';

const tempDirs = [];
const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-macho-'));
  tempDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Minimal Mach-O fixtures: fat header + thin 64-bit headers.
const thinMachO = (cputype) => {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(0xfeedfacf, 0); // MH_MAGIC_64
  buf.writeUInt32LE(cputype, 4);
  return buf;
};

const fatMachO = (cputypes) => {
  const buf = Buffer.alloc(8 + cputypes.length * 20 + 64);
  buf.writeUInt32BE(0xcafebabe, 0); // FAT_MAGIC
  buf.writeUInt32BE(cputypes.length, 4);
  cputypes.forEach((cputype, index) => {
    buf.writeUInt32BE(cputype, 8 + index * 20);
  });
  return buf;
};

const writeFixture = (name, content) => {
  const file = path.join(makeTempDir(), name);
  fs.writeFileSync(file, content);
  return file;
};

const CPU_X86_64 = 0x01000007;
const CPU_ARM64 = 0x0100000c;

test('packaging FFmpeg and FFprobe sources are pinned per supported target', () => {
  for (const [os, arch] of [['win32', 'x64'], ['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64']]) {
    const ffmpeg = setupPinnedAvSourceFor('ffmpeg', os, arch);
    const ffprobe = setupPinnedAvSourceFor('ffprobe', os, arch);
    assert.match(ffmpeg.sha256, /^[a-f0-9]{64}$/);
    assert.match(ffprobe.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!ffmpeg.url.includes('/latest/'));
    if (os !== 'darwin') assert.equal(ffmpeg.url, ffprobe.url, `${os}/${arch} pair must come from one archive`);
  }
  assert.throws(() => setupPinnedAvSourceFor('ffmpeg', 'linux', 'ia32'), /No pinned/);
  assert.equal(ffmpegSourcesFor('linux', 'arm64')[0], setupPinnedAvSourceFor('ffmpeg', 'linux', 'arm64').url);
});

test('paired AV replacement rolls both old files back when second install fails', () => {
  const dir = makeTempDir();
  const old1 = path.join(dir, 'ffmpeg'); const old2 = path.join(dir, 'ffprobe');
  const staged1 = path.join(dir, 'new-ffmpeg'); const staged2 = path.join(dir, 'new-ffprobe');
  fs.writeFileSync(old1, 'old ffmpeg'); fs.writeFileSync(old2, 'old ffprobe');
  fs.writeFileSync(staged1, 'new ffmpeg'); fs.writeFileSync(staged2, 'new ffprobe');
  let failed = false;
  assert.throws(() => replaceAvPairAtomically([{ staged: staged1, target: old1 }, { staged: staged2, target: old2 }], {
    rename(from, to) {
      if (!failed && from === staged2) { failed = true; throw new Error('injected second rename failure'); }
      fs.renameSync(from, to);
    },
  }), /injected second rename failure/);
  assert.equal(fs.readFileSync(old1, 'utf8'), 'old ffmpeg');
  assert.equal(fs.readFileSync(old2, 'utf8'), 'old ffprobe');
  assert.equal(fs.readdirSync(dir).sort().join(','), 'ffmpeg,ffprobe,new-ffprobe');
});

test('Linux source selection is pinned to BtbN GPL assets by architecture', () => {
  assert.match(ffmpegSourcesFor('linux', 'x64')[0], /linux64-gpl\.tar\.xz$/);
  assert.match(ffmpegSourcesFor('linux', 'arm64')[0], /linuxarm64-gpl\.tar\.xz$/);
});

test('runtime binary installer exposes the same per-arch sources', () => {
  assert.match(installerYtDlpUrlFor('linux', 'arm64'), /yt-dlp_linux_aarch64$/);
  assert.match(installerYtDlpUrlFor('linux', 'x64'), /yt-dlp_linux$/);
  assert.match(installerYtDlpUrlFor('darwin', 'arm64'), /yt-dlp_macos$/);

  for (const [platform, arch] of [['win32', 'x64'], ['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64']]) {
    const ffmpeg = installerPinnedAvSourceFor('ffmpeg', platform, arch);
    const ffprobe = installerPinnedAvSourceFor('ffprobe', platform, arch);
    assert.match(ffmpeg.sha256, /^[a-f0-9]{64}$/);
    assert.match(ffprobe.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(ffmpegDownloadUrlsFor(platform, arch), [ffmpeg.url]);
    assert.deepEqual(ffprobeDownloadUrlsFor(platform, arch), [ffprobe.url]);
  }
  assert.throws(() => ffprobeDownloadUrlsFor('darwin', 'ia32'), /No pinned/);
});

test('script yt-dlp source for linux follows the CPU', () => {
  assert.match(ytDlpUrlFor('linux', 'arm64'), /aarch64/);
  assert.match(ytDlpUrlFor('linux', 'x64'), /yt-dlp_linux$/);
});

test('machOArchitectures detects thin and fat binaries', () => {
  assert.deepEqual(machOArchitectures(writeFixture('thin-x64', thinMachO(CPU_X86_64))), ['x86_64']);
  assert.deepEqual(machOArchitectures(writeFixture('thin-arm', thinMachO(CPU_ARM64))), ['arm64']);
  assert.deepEqual(
    machOArchitectures(writeFixture('fat', fatMachO([CPU_X86_64, CPU_ARM64]))),
    ['x86_64', 'arm64'],
  );
  assert.equal(machOArchitectures(writeFixture('not-macho', Buffer.from('#!/bin/sh\n'))), null);
});

test('assertUniversalMachO requires both slices', () => {
  assert.doesNotThrow(() => assertUniversalMachO(writeFixture('fat', fatMachO([CPU_X86_64, CPU_ARM64])), 'ffmpeg'));
  assert.throws(
    () => assertUniversalMachO(writeFixture('thin', thinMachO(CPU_X86_64)), 'ffmpeg'),
    /missing universal slice.*arm64/i,
  );
  assert.throws(
    () => assertUniversalMachO(writeFixture('blob', Buffer.from('not a macho')), 'yt-dlp'),
    /not a Mach-O binary/i,
  );
});
