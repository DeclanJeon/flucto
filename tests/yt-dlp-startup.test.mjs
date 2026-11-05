import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from '../dist-electron/main/spawn.js';
import { versionFor, provisionUtility } from '../dist-electron/main/services/binaryInstaller.js';
import { ytDlpRuntimeSources } from '../dist-electron/main/services/ytDlpRuntimeSources.js';
import { parseCliArgs } from '../dist-electron/cli/args.js';

const delayedVersion = ['-e', 'setTimeout(() => console.log("late version"), 1500)'];

test('setup accepts the documented yt-dlp-only update flag', () => {
  const options = parseCliArgs(['setup', '--force', '--yt-dlp-only']);
  assert.equal(options.command, 'setup');
  assert.equal(options.force, true);
  assert.equal(options.ytDlpOnly, true);
});

test('a stalled version subprocess fails within its explicit deadline', async () => {
  const result = await execa(process.execPath, delayedVersion, { reject: false, timeoutMs: 100 });
  assert.equal(result.failed, true);
  assert.equal(result.timedOut, true);
  assert.match(result.stderr, /timed out.*100/i);
});

test('deadline failures reject by default rather than becoming success', async () => {
  await assert.rejects(execa(process.execPath, delayedVersion, { timeoutMs: 100 }), /timed out.*100/i);
});

test('a probe that ignores SIGTERM is force-killed rather than hanging the caller', async () => {
  const result = await execa(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setTimeout(() => process.exit(0), 1500)'], { reject: false, timeoutMs: 100 });
  assert.equal(result.failed, true);
  assert.equal(result.timedOut, true);
});

test('a completed subprocess keeps the original result contract', async () => {
  const result = await execa(process.execPath, ['-e', 'console.log("ready")'], { timeoutMs: 10000 });
  assert.equal(result.failed, false);
  assert.equal(result.stdout.trim(), 'ready');
  assert.equal(result.timedOut, undefined);
});

test('utility version validation returns null for a hung executable', async () => {
  assert.equal(await versionFor(process.execPath, delayedVersion, 100), null);
});

const assetRoot = 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/';
const native = `${assetRoot}yt-dlp_linux`;
const portable = `${assetRoot}yt-dlp`;

test('Linux with compatible Python prefers zipapp but retains the native fallback', async () => {
  assert.deepEqual(await ytDlpRuntimeSources([native], { platform: 'linux', probePython: async () => true }), [portable, native]);
  assert.deepEqual(await ytDlpRuntimeSources([`${native}_aarch64`], { platform: 'linux', probePython: async () => true }), [portable, `${native}_aarch64`]);
});

test('missing or unsupported Python does not create a new runtime requirement', async () => {
  assert.deepEqual(await ytDlpRuntimeSources([native], { platform: 'linux', probePython: async () => false }), [native]);
});

test('other platforms and explicit custom sources do not probe or change sources', async () => {
  const probePython = async () => assert.fail('must not probe Python');
  for (const platform of ['win32', 'darwin']) {
    assert.deepEqual(await ytDlpRuntimeSources([native], { platform, probePython }), [native]);
  }
  assert.deepEqual(await ytDlpRuntimeSources(['https://offline.invalid/custom'], { platform: 'linux', probePython }), ['https://offline.invalid/custom']);
});

test('a failing portable candidate falls back atomically without losing the old engine', { skip: process.platform !== 'linux' }, async (t) => {
  const python = await execa('python3', ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], { reject: false, timeoutMs: 5000 });
  if (python.failed) { t.skip('Python3.10+ unavailable'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-ytdlp-startup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'yt-dlp');
  fs.writeFileSync(target, 'old engine');
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    assert.equal(fs.readFileSync(target, 'utf8'), 'old engine');
    const body = String(url) === portable ? '#!/bin/sh\nexit 1\n' : '#!/bin/sh\nprintf "native-version\\n"\n';
    return new Response(body, { status: 200 });
  };
  await provisionUtility({ name: 'yt-dlp', executableName: 'yt-dlp', versionArgs: ['--version'], downloadUrls: [native] }, target, undefined, fetchImpl);
  assert.deepEqual(calls, [portable, native]);
  assert.equal(await versionFor(target, ['--version']), 'native-version');
  assert.deepEqual(fs.readdirSync(dir), ['yt-dlp']);
});
