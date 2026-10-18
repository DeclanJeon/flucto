import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';
import { extractTarMember, extractZipMember, provisionUtility } from '../dist-electron/main/services/binaryInstaller.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-binary-security-'));
const require = createRequire(import.meta.url);
const tar = require('tar');
const archive = (entries) => {
  const zip = new AdmZip();
  for (const [name, data] of entries) zip.addFile(name, data);
  return zip.toBuffer();
};
const spec = (url = 'https://offline.invalid/test.zip', args = ['-e', 'process.stdout.write("VALID")']) => ({
  name: 'ffmpeg', executableName: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  versionArgs: args, downloadUrls: [url], archiveMember: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
});
const withFetch = async (bytes, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes, { status: 200 });
  try { await fn(); } finally { globalThis.fetch = original; }
};
const executableBytes = fs.readFileSync(process.execPath);
const testExecutableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

test('valid ZIP install replaces old target atomically and removes temporary data', async () => {
  const dir = temp(); const target = path.join(dir, testExecutableName);
  fs.writeFileSync(target, 'old working target');
  try {
    await withFetch(archive([[`pkg/${testExecutableName}`, executableBytes]]), () => provisionUtility(spec(), target));
    assert.equal(fs.readFileSync(target).equals(executableBytes), true);
    assert.deepEqual(fs.readdirSync(dir), [testExecutableName]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('missing, corrupt, unsafe ZIPs and failed validation preserve old target and clean staging', async () => {
  const dir = temp(); const target = path.join(dir, testExecutableName);
  for (const bytes of [archive([['other/file', executableBytes]]), Buffer.from('corrupt'), archive([[`C:/outside/${testExecutableName}`, executableBytes]])]) {
    fs.writeFileSync(target, 'old working target');
    try {
      await withFetch(bytes, () => assert.rejects(provisionUtility(spec(), target)));
      assert.equal(fs.readFileSync(target, 'utf8'), 'old working target');
      assert.deepEqual(fs.readdirSync(dir), [testExecutableName]);
    } finally { fs.rmSync(target, { force: true }); }
  }
  fs.writeFileSync(target, 'old working target');
  try {
    await withFetch(archive([[testExecutableName, Buffer.from('not executable')]]), () => assert.rejects(provisionUtility(spec(), target)));
    assert.equal(fs.readFileSync(target, 'utf8'), 'old working target');
    assert.deepEqual(fs.readdirSync(dir), [testExecutableName]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ZIP helper extracts one nested member and rejects ambiguous paths', async () => {
  const dir = temp();
  try {
    const zipPath = path.join(dir, 'fixture.zip');
    fs.writeFileSync(zipPath, archive([[`nested/${testExecutableName}`, Buffer.from([0, 255, 128])]]));
    const output = path.join(dir, 'out');
    await extractZipMember(zipPath, testExecutableName, output);
    assert.deepEqual(fs.readFileSync(output), Buffer.from([0, 255, 128]));
    fs.writeFileSync(zipPath, archive([[`a/${testExecutableName}`, Buffer.from('a')], [`b/${testExecutableName}`, Buffer.from('b')]]));
    await assert.rejects(extractZipMember(zipPath, testExecutableName, output), /Ambiguous/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('AdmZip Unix symlink attributes are rejected when the fixture API supports them', async (t) => {
  const dir = temp();
  try {
    const zip = new AdmZip();
    zip.addFile(`link/${testExecutableName}`, Buffer.from(testExecutableName));
    const entry = zip.getEntry(`link/${testExecutableName}`);
    if (!entry || !('attr' in entry)) { t.skip('AdmZip entry attributes unavailable'); return; }
    entry.attr = (0o120777 << 16) >>> 0;
    const archivePath = path.join(dir, 'symlink.zip');
    zip.writeZip(archivePath);
    await assert.rejects(extractZipMember(archivePath, testExecutableName, path.join(dir, 'out')), /symbolic link/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TAR extraction preserves non-UTF8 executable bytes from one nested regular member', async () => {
  const dir = temp();
  try {
    const sourceDir = path.join(dir, 'source'); fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'nested', testExecutableName), executableBytes);
    const archivePath = path.join(dir, 'fixture.tar');
    await tar.c({ cwd: sourceDir, file: archivePath }, ['nested']);
    const output = path.join(dir, 'out');
    await extractTarMember(archivePath, testExecutableName, output);
    assert.deepEqual(fs.readFileSync(output), executableBytes);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TAR rejects traversal and links; .tar.xz provisions when xz is installed', async (t) => {
  const dir = temp();
  try {
    const sourceDir = path.join(dir, 'source'); fs.mkdirSync(sourceDir);
    fs.writeFileSync(path.join(sourceDir, testExecutableName), executableBytes);

    const traversalTar = path.join(dir, 'traversal.tar');
    await tar.c({ cwd: sourceDir, file: traversalTar }, [testExecutableName]);
    const traversalBytes = fs.readFileSync(traversalTar);
    traversalBytes.fill(0, 0, 100);
    Buffer.from(`../${testExecutableName}`).copy(traversalBytes, 0);
    traversalBytes.fill(0x20, 148, 156);
    const checksum = traversalBytes.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
    Buffer.from(`${checksum.toString(8).padStart(6, '0')}\0 `).copy(traversalBytes, 148);
    fs.writeFileSync(traversalTar, traversalBytes);
    await assert.rejects(extractTarMember(traversalTar, testExecutableName, path.join(dir, 'traversal-out')), /Unsafe archive member path/);

    const hardlinkPath = path.join(sourceDir, 'hardlink');
    try {
      fs.linkSync(path.join(sourceDir, testExecutableName), hardlinkPath);
      const hardlinkTar = path.join(dir, 'hardlink.tar');
      await tar.c({ cwd: sourceDir, file: hardlinkTar }, [testExecutableName, 'hardlink']);
      await assert.rejects(extractTarMember(hardlinkTar, testExecutableName, path.join(dir, 'hardlink-out')), /links\/special/);
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) t.diagnostic('Hardlink fixture skipped: current Windows environment does not permit hardlinks');
      else throw error;
    }

    const linkPath = path.join(sourceDir, 'link');
    try {
      fs.symlinkSync(testExecutableName, linkPath);
      const linkTar = path.join(dir, 'link.tar');
      await tar.c({ cwd: sourceDir, file: linkTar }, ['link']);
      await assert.rejects(extractTarMember(linkTar, testExecutableName, path.join(dir, 'link-out')), /links\/special/);
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) t.diagnostic('Symlink fixture skipped: current Windows environment lacks symlink support');
      else throw error;
    }

    try { execFileSync('xz', ['--version'], { stdio: 'ignore' }); } catch { t.diagnostic('xz success/failure subtests skipped: xz utility unavailable on this platform'); return; }
    const plainTar = path.join(dir, 'valid.tar');
    await tar.c({ cwd: sourceDir, file: plainTar }, [testExecutableName]);
    const xzPath = path.join(dir, 'valid.tar.xz');
    const xzFd = fs.openSync(xzPath, 'w');
    try { execFileSync('xz', ['-c', plainTar], { stdio: ['ignore', xzFd, 'ignore'] }); }
    finally { fs.closeSync(xzFd); }
    const target = path.join(dir, 'installed', testExecutableName);
    await withFetch(fs.readFileSync(xzPath), () => provisionUtility(spec('https://offline.invalid/test.tar.xz', ['-e', 'process.stdout.write("VALID")']), target));
    assert.deepEqual(fs.readFileSync(target), executableBytes);
    assert.deepEqual(fs.readdirSync(path.dirname(target)), [testExecutableName]);
    const missingXzTarget = path.join(dir, 'missing-xz', testExecutableName);
    const previousPath = process.env.PATH;
    process.env.PATH = path.join(dir, 'empty-path');
    try {
      await withFetch(fs.readFileSync(xzPath), () => assert.rejects(provisionUtility(spec('https://offline.invalid/missing-xz.tar.xz'), missingXzTarget)));
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
    assert.deepEqual(fs.readdirSync(path.dirname(missingXzTarget)), []);
    const failedTarget = path.join(dir, 'failed', testExecutableName);
    await withFetch(Buffer.from('not xz'), () => assert.rejects(provisionUtility(spec('https://offline.invalid/bad.tar.xz'), failedTarget)));
    assert.deepEqual(fs.readdirSync(path.dirname(failedTarget)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
