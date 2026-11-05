import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist-electron', 'cli', 'index.js');
const bundled = path.join(root, 'skills', 'searching-social-media');
const run = (home, ...args) => spawnSync(process.execPath, [cli, 'skill', 'install', ...args], {
  cwd: root,
  env: { ...process.env, HOME: home, USERPROFILE: home },
  encoding: 'utf8',
  timeout: 10_000,
});
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

test('bundled skill has the runnable adapter and linked references', () => {
  for (const file of ['SKILL.md', 'references/flucto-contract.md', 'references/search-workflow.md', 'scripts/social_search.py']) {
    assert.equal(fs.existsSync(path.join(bundled, file)), true, file);
  }
});

test('dry run prints targets and writes no files', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-skill-dry-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = run(home, '--agent', 'pi', '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout + result.stderr, /\.pi[\\/]agent[\\/]skills/);
  assert.equal(fs.existsSync(path.join(home, '.pi')), false);
});

test('installs only to the selected agent and refuses an existing destination', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-skill-pi-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dest = path.join(home, '.pi', 'agent', 'skills', 'searching-social-media');
  const installed = run(home, '--agent', 'pi');
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(bundled, 'SKILL.md'), 'utf8'));
  const sentinel = path.join(dest, 'user-note.txt');
  fs.writeFileSync(sentinel, 'keep');
  const refused = run(home, '--agent', 'pi');
  assert.equal(refused.status, 2);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});

test('force backs up only the skill target before replacing it', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-skill-force-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dest = path.join(home, '.agents', 'skills', 'searching-social-media');
  fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, 'old.txt'), 'old');
  const result = run(home, '--agent', 'codex', '--force');
  assert.equal(result.status, 0, result.stderr);
  const backup = fs.readdirSync(path.dirname(dest)).find((name) => name.startsWith('searching-social-media.backup-'));
  assert.ok(backup);
  assert.equal(fs.readFileSync(path.join(path.dirname(dest), backup, 'old.txt'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(dest, 'old.txt')), false);
  assert.equal(fs.existsSync(path.join(dest, 'SKILL.md')), true);
});

test('all installs each registered agent copy and rejects unsupported targets', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-skill-all-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = run(home, '--agent', 'all');
  assert.equal(result.status, 0, result.stderr);
  for (const rel of ['.agents/skills', '.claude/skills']) {
    assert.equal(fs.existsSync(path.join(home, rel, 'searching-social-media/SKILL.md')), true, rel);
  }
  assert.equal(fs.existsSync(path.join(home, '.pi')), false, 'Pi shares the .agents skill instead of a duplicate copy');
  const bad = run(home, '--agent', 'unknown');
  assert.notEqual(bad.status, 0);
});

test('installed tree contains the complete bundled source file set', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-skill-tree-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = run(home, '--agent', 'claude');
  assert.equal(result.status, 0, result.stderr);
  const installed = walk(path.join(home, '.claude', 'skills', 'searching-social-media'))
    .map((file) => path.relative(path.join(home, '.claude', 'skills', 'searching-social-media'), file)).sort();
  const source = ['SKILL.md', 'references/flucto-contract.md', 'references/search-workflow.md', 'scripts/social_search.py'].sort();
  assert.deepEqual(installed, source);
});
