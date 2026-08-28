import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkAndRefreshBinaries,
  isManagedBinaryPreferred,
  MANAGED_MARKER_FILE,
} from '../dist-electron/main/services/binaryRefresh.js';

const YT_DLP_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

const makeBinDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const writeExecutable = (dir, version) => {
  const ytDlpPath = path.join(dir, YT_DLP_NAME);
  // Mimics `yt-dlp --version` for the version probe used by the refresh logic.
  fs.writeFileSync(ytDlpPath, process.platform === 'win32' ? '' : `#!/bin/sh\necho ${version}\n`);
  if (process.platform !== 'win32') fs.chmodSync(ytDlpPath, 0o755);
  return ytDlpPath;
};

const writeMarker = (dir, marker) => {
  fs.writeFileSync(path.join(dir, MANAGED_MARKER_FILE), JSON.stringify(marker), 'utf8');
};

const readMarker = (dir) => JSON.parse(fs.readFileSync(path.join(dir, MANAGED_MARKER_FILE), 'utf8'));

/** Simulates a successful fresh download: the file then reports the new version. */
const fakeProvision = (version) => async (targetPath) => {
  fs.writeFileSync(targetPath, process.platform === 'win32' ? '' : `#!/bin/sh\necho ${version}\n`);
  if (process.platform !== 'win32') fs.chmodSync(targetPath, 0o755);
};

const refresh = (options) => checkAndRefreshBinaries(options);

test('refresh is throttled within the check interval and skips the version probe', async (t) => {
  const binDir = makeBinDir(t);
  const now = 1_700_000_000_000;
  writeMarker(binDir, {
    managed: ['yt-dlp'],
    ytDlpVersion: '2026.08.01',
    lastCheckedAt: new Date(now - 3600_000).toISOString(),
    updatedAt: new Date(now - 3600_000).toISOString(),
  });
  writeExecutable(binDir, '2026.08.01');

  let fetchCalls = 0;
  const result = await refresh({
    binDir,
    checkIntervalMs: 24 * 60 * 60 * 1000,
    now: () => now,
    fetchLatestVersion: async () => {
      fetchCalls += 1;
      return '2026.08.20';
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.refreshed, false);
  assert.equal(result.version, '2026.08.01');
  assert.equal(fetchCalls, 0);
});

test('a stale managed copy is re-downloaded and the marker records the new version', async (t) => {
  const binDir = makeBinDir(t);
  const now = 1_700_000_000_000;
  writeMarker(binDir, {
    managed: ['yt-dlp'],
    ytDlpVersion: '2026.07.01',
    lastCheckedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
  });
  writeExecutable(binDir, '2026.07.01');

  const statuses = [];
  const result = await refresh({
    binDir,
    now: () => now,
    onStatus: (message) => statuses.push(message),
    fetchLatestVersion: async () => '2026.08.20',
    provisionYtDlp: fakeProvision('2026.08.20'),
  });

  assert.equal(result.refreshed, true);
  assert.equal(result.version, '2026.08.20');
  assert.equal(readMarker(binDir).ytDlpVersion, '2026.08.20');
  assert.equal(isManagedBinaryPreferred('yt-dlp', binDir), true);
  assert.ok(statuses.some((message) => message.includes('2026.07.01 → 2026.08.20')));
});

test('a current packaged copy does not create a managed duplicate or marker', async (t) => {
  const binDir = makeBinDir(t);

  const result = await refresh({
    binDir,
    currentVersion: '2026.08.20',
    now: () => 1_700_000_000_000,
    fetchLatestVersion: async () => '2026.08.20',
  });

  assert.equal(result.skipped, true);
  assert.equal(result.version, '2026.08.20');
  assert.equal(fs.existsSync(path.join(binDir, MANAGED_MARKER_FILE)), false);
  assert.equal(isManagedBinaryPreferred('yt-dlp', binDir), false);
});

test('a stale packaged copy downloads the managed replacement and marks preference', async (t) => {
  const binDir = makeBinDir(t);
  const now = 1_700_000_000_000;

  const result = await refresh({
    binDir,
    currentVersion: '2026.07.01',
    now: () => now,
    fetchLatestVersion: async () => '2026.08.20',
    provisionYtDlp: fakeProvision('2026.08.20'),
  });

  assert.equal(result.refreshed, true);
  assert.equal(result.version, '2026.08.20');
  assert.equal(fs.existsSync(path.join(binDir, YT_DLP_NAME)), true);
  assert.equal(readMarker(binDir).managed.includes('yt-dlp'), true);
  assert.equal(isManagedBinaryPreferred('yt-dlp', binDir), true);
});

test('download failures are swallowed and reported without throwing or writing a marker', async (t) => {
  const binDir = makeBinDir(t);

  const result = await refresh({
    binDir,
    currentVersion: '2026.07.01',
    now: () => 1_700_000_000_000,
    fetchLatestVersion: async () => '2026.08.20',
    provisionYtDlp: async () => {
      throw new Error('network unreachable');
    },
  });

  assert.equal(result.refreshed, false);
  assert.equal(result.version, null);
  assert.match(result.error, /network unreachable/);
  assert.equal(fs.existsSync(path.join(binDir, MANAGED_MARKER_FILE)), false);
  assert.equal(isManagedBinaryPreferred('yt-dlp', binDir), false);
});

test('an unresolvable latest version skips the refresh without erroring the caller', async (t) => {
  const binDir = makeBinDir(t);

  const result = await refresh({
    binDir,
    now: () => 1_700_000_000_000,
    fetchLatestVersion: async () => null,
  });

  assert.equal(result.skipped, true);
  assert.equal(result.version, null);
  assert.match(result.error, /latest yt-dlp version/);
});

test('marker preference is false when the marker is missing or malformed', async (t) => {
  const binDir = makeBinDir(t);
  fs.writeFileSync(path.join(binDir, MANAGED_MARKER_FILE), 'not json', 'utf8');
  assert.equal(isManagedBinaryPreferred('yt-dlp', binDir), false);

  const emptyDir = makeBinDir(t);
  assert.equal(isManagedBinaryPreferred('yt-dlp', emptyDir), false);
  assert.equal(isManagedBinaryPreferred('ffmpeg', emptyDir), false);
});
