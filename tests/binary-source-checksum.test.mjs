import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { extractZipMember, downloadUniquePinnedAvArchives, pinnedAvSourceFor, provisionUtility, replaceManagedAvPair, setupUtilities, verifySha256 } from '../dist-electron/main/services/binaryInstaller.js';
import { createExecutableFixtures } from './executable-fixtures.mjs';

const archiveBytes = (member, bytes) => {
  const zip = new AdmZip();
  zip.addFile(`release/${member}`, bytes);
  return zip.toBuffer();
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const specFor = (name, bytes, sha256) => ({
  name: 'ffmpeg', executableName: name, versionArgs: ['-e', 'process.stdout.write("version-ok")'],
  downloadUrls: ['https://offline.invalid/fixture.zip'], archiveMember: name, archiveSha256: sha256,
});
const mockFetch = async (bytes, callback) => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes, { status: 200 });
  try { await callback(); } finally { globalThis.fetch = old; }
};

test('unique archive downloader fetches shared URLs once and distinct macOS-style URLs once each', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-av-unique-'));
  const bytes = Buffer.from('offline pinned fixture'); const sha = digest(bytes); const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return new Response(bytes, { status: 200 }); };
  const makeSpec = (name, url) => ({ name, executableName: name, versionArgs: ['-version'], downloadUrls: [url], archiveSha256: sha });
  try {
    const same = await downloadUniquePinnedAvArchives([makeSpec('ffmpeg', 'https://offline.invalid/pair.zip'), makeSpec('ffprobe', 'https://offline.invalid/pair.zip')], root, fetchImpl);
    assert.equal(calls.length, 1); assert.equal(same.size, 1);
    calls.length = 0;
    const separate = await downloadUniquePinnedAvArchives([makeSpec('ffmpeg', 'https://offline.invalid/ffmpeg.zip'), makeSpec('ffprobe', 'https://offline.invalid/ffprobe.zip')], root, fetchImpl);
    assert.equal(calls.length, 2); assert.equal(separate.size, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('checkOnly rejects mismatched managed AV pair and explicit custom FFmpeg never gets a pinned adjacent probe', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-av-checkonly-'));
  const register = createExecutableFixtures();
  try {
    const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
    const ffmpeg = path.join(bin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const ffprobe = path.join(bin, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    register(ffmpeg, 'ffmpeg version 8.1.2'); register(ffprobe, 'ffprobe version 9.0.2');
    const checked = await setupUtilities({ checkOnly: true, only: ['ffmpeg', 'ffprobe'], binDir: bin, env: {}, cwd: root });
    assert.equal(checked.valid, false);
    assert.ok(checked.utilities.filter((u) => u.name === 'ffmpeg' || u.name === 'ffprobe').every((u) => u.status === 'failed' && /pair|pinned/.test(u.error)));
    const customDir = path.join(root, 'custom'); fs.mkdirSync(customDir);
    const custom = path.join(customDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    register(custom, 'ffmpeg version 8.1.2');
    let requests = 0;
    const result = await setupUtilities({ only: ['ffmpeg', 'ffprobe'], binDir: path.join(root, 'managed'), ffmpegPath: custom, env: {}, cwd: root, fetchImpl: async () => { requests += 1; throw new Error('unexpected download'); } });
    assert.equal(result.valid, false);
    assert.match(result.utilities.find((u) => u.name === 'ffprobe').error, /adjacent FFprobe/);
    const adjacentProbe = path.join(customDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    assert.equal(fs.existsSync(adjacentProbe), false);
    assert.equal(requests, 0);
    register(custom, 'ffmpeg version custom-1'); register(adjacentProbe, 'ffprobe version custom-1');
    const validCustomPair = await setupUtilities({ checkOnly: true, only: ['ffmpeg', 'ffprobe'], binDir: path.join(root, 'managed'), ffmpegPath: custom, env: {}, cwd: root });
    assert.equal(validCustomPair.valid, true);
    assert.deepEqual(validCustomPair.utilities.map((u) => u.status), ['present', 'present']);
    const unparseableDir = path.join(root, 'unparseable'); fs.mkdirSync(unparseableDir);
    const unparseableFfmpeg = path.join(unparseableDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const unparseableFfprobe = path.join(unparseableDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    register(unparseableFfmpeg, 'no parseable identifier'); register(unparseableFfprobe, 'no parseable identifier');
    const unparseable = await setupUtilities({ checkOnly: true, only: ['ffmpeg', 'ffprobe'], binDir: path.join(root, 'other-managed'), ffmpegPath: unparseableFfmpeg, env: {}, cwd: root });
    assert.equal(unparseable.valid, false);
    assert.equal(unparseable.utilities.find((u) => u.name === 'ffprobe').status, 'failed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pinned source manifest exposes expected immutable archive digests', () => {
  assert.equal(pinnedAvSourceFor('ffmpeg', 'win32', 'x64').sha256, 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec');
  assert.equal(pinnedAvSourceFor('ffprobe', 'linux', 'arm64').sha256, '3d1ccdb45b01635e8404da39869f3a0c7a535b9e63470439bc3e677cf12fe266');
  assert.equal(pinnedAvSourceFor('ffprobe', 'darwin', 'x64').sha256, '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd');
  assert.equal(pinnedAvSourceFor('ffmpeg', 'linux', 'x64').sha256, 'a5f2aed198efa8ef4c12d9112f42e7cefbdf11dced1b59a87503ca689bc52277');
  assert.equal(pinnedAvSourceFor('ffmpeg', 'linux', 'arm64').sha256, '3d1ccdb45b01635e8404da39869f3a0c7a535b9e63470439bc3e677cf12fe266');
  assert.equal(pinnedAvSourceFor('ffmpeg', 'darwin', 'x64').sha256, '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4');
  assert.equal(pinnedAvSourceFor('ffmpeg', 'darwin', 'arm64').sha256, 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924');
  assert.equal(pinnedAvSourceFor('ffprobe', 'darwin', 'arm64').sha256, 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6');
});

test('oversized declared download and high-ratio ZIP member are rejected offline', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-av-size-'));
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const target = path.join(root, name);
  fs.writeFileSync(target, 'old');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 200, headers: { 'content-length': String(600 * 1024 * 1024) } });
    await assert.rejects(provisionUtility(specFor(name, Buffer.alloc(0), '0'.repeat(64)), target), /size limit/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    assert.deepEqual(fs.readdirSync(root), [name]);
    const zip = new AdmZip();
    zip.addFile(`bin/${name}`, Buffer.alloc(2 * 1024 * 1024));
    const zipPath = path.join(root, 'bomb.zip'); fs.writeFileSync(zipPath, zip.toBuffer());
    await assert.rejects(extractZipMember(zipPath, name, path.join(root, 'staged')), /compression ratio|size limit/);
  } finally { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }); }
});

test('managed FFmpeg/FFprobe pair restores both originals after second rename failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-av-pair-'));
  const oldF = path.join(root, 'ffmpeg'); const oldP = path.join(root, 'ffprobe');
  const newF = path.join(root, 'new-ffmpeg'); const newP = path.join(root, 'new-ffprobe');
  fs.writeFileSync(oldF, 'old-f'); fs.writeFileSync(oldP, 'old-p'); fs.writeFileSync(newF, 'new-f'); fs.writeFileSync(newP, 'new-p');
  let fail = true;
  try {
    await assert.rejects(replaceManagedAvPair([{ staged: newF, target: oldF }, { staged: newP, target: oldP }], root, {
      rename: async (from, to) => {
        if (fail && from === newP) { fail = false; throw new Error('injected second replacement failure'); }
        return fs.promises.rename(from, to);
      },
    }), /injected second replacement failure/);
    assert.equal(fs.readFileSync(oldF, 'utf8'), 'old-f');
    assert.equal(fs.readFileSync(oldP, 'utf8'), 'old-p');
    assert.equal(fs.readdirSync(root).sort().join(','), 'ffmpeg,ffprobe,new-ffprobe');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('archive digest mismatch refuses replacement; exact fixture digest provisions successfully', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-av-checksum-'));
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const binary = fs.readFileSync(process.execPath);
  const archive = archiveBytes(name, binary);
  const target = path.join(root, name);
  fs.writeFileSync(target, 'working old target');
  try {
    await mockFetch(archive, () => assert.rejects(provisionUtility(specFor(name, archive, '0'.repeat(64)), target), /SHA-256 mismatch/));
    assert.equal(fs.readFileSync(target, 'utf8'), 'working old target');
    assert.deepEqual(fs.readdirSync(root), [name]);
    assert.equal(verifySha256(archive, digest(archive)), true);
    await mockFetch(archive, () => provisionUtility(specFor(name, archive, digest(archive)), target));
    assert.deepEqual(fs.readFileSync(target), binary);
    assert.deepEqual(fs.readdirSync(root), [name]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
