import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  ffmpegSourcesFor,
  ytDlpUrlFor,
  machOArchitectures,
  assertUniversalMachO,
} from '../scripts/setup-binaries.mjs';
import {
  ffmpegDownloadUrlsFor,
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

test('packaging ffmpeg sources cover both macOS slices with compatible fallbacks', () => {
  const x64 = ffmpegSourcesFor('darwin', 'x64');
  const arm64 = ffmpegSourcesFor('darwin', 'arm64');

  assert.ok(x64.includes('https://evermeet.cx/ffmpeg/getrelease/zip'));
  assert.ok(!arm64.some((url) => url.includes('evermeet')), 'evermeet is x86_64-only and must not serve arm64');
  assert.ok(arm64.some((url) => url.includes('macos/arm64')), 'arm64 needs an arm64 build');
  assert.ok(arm64.some((url) => url.includes('darwin-arm64')), 'arm64 keeps an ffmpeg-static fallback');
});

test('linux ffmpeg sources pick per-architecture static builds', () => {
  assert.ok(ffmpegSourcesFor('linux', 'x64').some((url) => url.includes('amd64')));
  const arm64 = ffmpegSourcesFor('linux', 'arm64');
  assert.ok(arm64.some((url) => url.includes('arm64-static')));
  assert.ok(arm64.some((url) => url.includes('linuxarm64')));
  assert.ok(ffmpegSourcesFor('linux', 'arm').some((url) => url.includes('armhf')));
  assert.ok(ffmpegSourcesFor('linux', 'ia32').some((url) => url.includes('i686')));
});

test('runtime binary installer exposes the same per-arch sources', () => {
  assert.match(installerYtDlpUrlFor('linux', 'arm64'), /yt-dlp_linux_aarch64$/);
  assert.match(installerYtDlpUrlFor('linux', 'x64'), /yt-dlp_linux$/);
  assert.match(installerYtDlpUrlFor('darwin', 'arm64'), /yt-dlp_macos$/);

  const macArm64 = ffmpegDownloadUrlsFor('darwin', 'arm64');
  assert.ok(!macArm64.some((url) => url.includes('evermeet')));
  const linuxArm64 = ffmpegDownloadUrlsFor('linux', 'arm64');
  assert.ok(linuxArm64.some((url) => url.includes('arm64-static')));
  assert.ok(linuxArm64.every((url) => !url.includes('amd64')));
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
