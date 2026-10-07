import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { incrementVersion, predictRelease } from '../scripts/version-tools.mjs';

const tempDirs = [];
const tmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

const commit = (dir, message, file = `file-${Math.random().toString(36).slice(2)}.txt`) => {
  fs.writeFileSync(path.join(dir, file), `${message}\n`);
  git(dir, 'add', file);
  git(dir, 'commit', '--allow-empty-message', '-m', message);
};

// A real git repo with a package.json at the given version.
const repo = (version = '1.17.0') => {
  const dir = tmp('version-tools-');
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'flucto', version }) + '\n');
  git(dir, 'add', 'package.json');
  git(dir, 'commit', '-m', 'chore: baseline package');
  return dir;
};
test('incrementVersion bumps each release type and rejects unknown types', () => {
  assert.equal(incrementVersion('1.17.0', 'major'), '2.0.0');
  assert.equal(incrementVersion('1.17.0', 'minor'), '1.18.0');
  assert.equal(incrementVersion('1.17.0', 'patch'), '1.17.1');
  assert.throws(() => incrementVersion('1.17.0', 'docs'), /unsupported release type/);
  assert.throws(() => incrementVersion('not-semver', 'patch'), /invalid semver/);
});

test('feat commits since the last v* tag predict a minor release', async () => {
  const dir = repo('1.17.0');
  commit(dir, 'chore(release): 1.17.0 [skip ci]');
  git(dir, 'tag', 'v1.17.0');
  commit(dir, 'feat(cli): add json output');
  const result = await predictRelease(dir);
  assert.deepEqual(result, { hasRelease: true, version: '1.18.0' });
});

test('fix and perf commits predict a patch release', async () => {
  const dir = repo('1.17.0');
  commit(dir, 'chore(release): 1.17.0 [skip ci]');
  git(dir, 'tag', 'v1.17.0');
  commit(dir, 'fix(desktop): installer checksum path');
  commit(dir, 'perf(search): avoid repeated stat calls');
  const result = await predictRelease(dir);
  assert.deepEqual(result, { hasRelease: true, version: '1.17.1' });
});

test('breaking changes outrank features and fixes', async () => {
  const dir = repo('1.17.0');
  git(dir, 'tag', 'v1.17.0');
  commit(dir, 'feat(api): new endpoint');
  commit(dir, 'fix(core)!: drop legacy flag\n\nBREAKING CHANGE: flag removed');
  const result = await predictRelease(dir);
  assert.deepEqual(result, { hasRelease: true, version: '2.0.0' });
});

test('chore/docs/ci commits alone produce no release', async () => {
  const dir = repo('1.17.0');
  git(dir, 'tag', 'v1.17.0');
  commit(dir, 'chore(deps): bump things');
  commit(dir, 'docs: update readme');
  commit(dir, 'ci: adjust workflow');
  const result = await predictRelease(dir);
  assert.deepEqual(result, { hasRelease: false, version: '' });
});

test('an empty commit range after the last tag produces no release', async () => {
  const dir = repo('1.17.0');
  git(dir, 'tag', 'v1.17.0');
  const result = await predictRelease(dir);
  assert.deepEqual(result, { hasRelease: false, version: '' });
});

test('only v-prefixed semver tags mark the release boundary', async () => {
  const dir = repo('2.0.0');
  git(dir, 'tag', 'legacy');
  commit(dir, 'feat(ui): dark mode');
  git(dir, 'tag', 'v2.0.0');
  commit(dir, 'fix(ui): contrast');
  const result = await predictRelease(dir);
  // commits before v2.0.0 (including under the non-v tag) are out of range
  assert.deepEqual(result, { hasRelease: true, version: '2.0.1' });
});

test('with no tags the full history is considered', async () => {
  const dir = repo('0.1.0');
  commit(dir, 'chore: initial setup');
  commit(dir, 'feat: first feature');
  const result = await predictRelease(dir);
  assert.deepEqual(result, { hasRelease: true, version: '0.2.0' });
});

test('predictRelease is read-only: no refs, index, or worktree changes', async () => {
  const dir = repo('1.17.0');
  git(dir, 'tag', 'v1.17.0');
  commit(dir, 'fix: a fix');
  const before = git(dir, 'status', '--porcelain') + git(dir, 'rev-parse', 'HEAD') + git(dir, 'tag', '-l');
  const result = await predictRelease(dir);
  const afterState = git(dir, 'status', '--porcelain') + git(dir, 'rev-parse', 'HEAD') + git(dir, 'tag', '-l');
  assert.equal(afterState, before);
  assert.deepEqual(result, { hasRelease: true, version: '1.17.1' });
});

test('predictRelease rejects a directory without package.json or git metadata', async () => {
  const dir = tmp('version-tools-empty-');
  await assert.rejects(() => predictRelease(dir));
  const noGit = tmp('version-tools-nogit-');
  fs.writeFileSync(path.join(noGit, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  await assert.rejects(() => predictRelease(noGit));
});
