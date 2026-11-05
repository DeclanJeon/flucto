import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist-electron/cli/index.js');
const hook = path.join(root, 'scripts/install-agent-skills.mjs');
const name = 'flucto-media-research';
const source = path.join(root, 'skills', name);
const skillFiles = ['SKILL.md', 'references/commands.md', 'references/install.md'];
const sandbox = (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-research-skill-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
};
const env = (home, extra = {}) => ({ ...process.env, HOME: home, USERPROFILE: home, npm_config_global: 'false', FLUCTO_SKIP_AGENT_SKILLS: '0', ...extra });
const run = (home, ...args) => spawnSync(process.execPath, [cli, 'skill', 'install', '--skill', name, ...args], {
  cwd: root, env: env(home), encoding: 'utf8', timeout: 15_000,
});
const runHook = (home, extra) => spawnSync(process.execPath, [hook], {
  cwd: root, env: env(home, extra), encoding: 'utf8', timeout: 20_000,
});

test('named research install writes the complete bundle to shared agent locations', (t) => {
  // Given an isolated home with no installed skills.
  const home = sandbox(t);
  // When the named research skill is installed for all supported agents.
  const result = run(home, '--agent', 'all', '--if-missing', '--json');
  // Then each registered target contains the actual source files, with no duplicate Pi copy.
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.results.map(r => r.status), ['installed', 'installed']);
  for (const base of ['.agents/skills', '.claude/skills']) {
    for (const file of skillFiles) assert.equal(fs.readFileSync(path.join(home, base, name, file), 'utf8'), fs.readFileSync(path.join(source, file), 'utf8'));
  }
  assert.equal(fs.existsSync(path.join(home, '.pi')), false);
});

test('if-missing preserves a user-modified existing skill and unrelated siblings', (t) => {
  // Given user-owned files in an existing target and a different skill.
  const home = sandbox(t);
  const target = path.join(home, '.agents/skills', name);
  const sibling = path.join(home, '.agents/skills/private-skill');
  fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'SKILL.md'), 'user-owned');
  fs.mkdirSync(sibling); fs.writeFileSync(path.join(sibling, 'notes'), 'keep');
  // When idempotent installation is requested.
  const result = run(home, '--agent', 'all', '--if-missing', '--json');
  // Then the existing target is skipped while the missing target is installed.
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).results.map(r => r.status), ['skipped', 'installed']);
  assert.equal(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'user-owned');
  assert.equal(fs.readFileSync(path.join(sibling, 'notes'), 'utf8'), 'keep');
});

test('if-missing does not follow an existing skill symlink or junction', (t) => {
  // Given a target link to a separately owned directory.
  const home = sandbox(t), foreign = path.join(home, 'foreign');
  fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'note'), 'untouched');
  const parent = path.join(home, '.agents/skills'); fs.mkdirSync(parent, { recursive: true });
  fs.symlinkSync(foreign, path.join(parent, name), process.platform === 'win32' ? 'junction' : 'dir');
  // When automatic-style installation reaches that target.
  const result = run(home, '--agent', 'codex', '--if-missing', '--json');
  // Then the link and its contents remain unchanged.
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).results[0].status, 'skipped');
  assert.deepEqual(fs.readdirSync(foreign), ['note']);
  assert.equal(fs.lstatSync(path.join(parent, name)).isSymbolicLink(), true);
});

test('JSON dry-run reports the selected target without creating agent directories', (t) => {
  const home = sandbox(t);
  const result = run(home, '--agent', 'pi', '--dry-run', '--json');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.dryRun, true);
  assert.equal(report.results[0].target, path.join(home, '.pi/agent/skills', name));
  assert.equal(fs.existsSync(path.join(home, '.pi')), false);
});

for (const extra of [['--force', '--if-missing'], ['--skill', '../escape']]) {
  test(`invalid installation policy refuses writes: ${extra.join(' ')}`, (t) => {
    const home = sandbox(t);
    const result = run(home, '--agent', 'all', ...extra);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(home, '.agents')), false);
    assert.equal(fs.existsSync(path.join(home, '.claude')), false);
  });
}

test('global npm install hook registers the real bundled skill without network setup', (t) => {
  const home = sandbox(t);
  const result = runHook(home, { npm_config_global: 'true' });
  assert.equal(result.status, 0, result.stderr);
  for (const base of ['.agents/skills', '.claude/skills']) {
    assert.equal(fs.readFileSync(path.join(home, base, name, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8'));
  }
});

for (const extra of [{ npm_config_global: 'false' }, { npm_config_global: 'true', FLUCTO_SKIP_AGENT_SKILLS: '1' }]) {
  test(`install hook leaves agent homes alone for ${JSON.stringify(extra)}`, (t) => {
    const home = sandbox(t);
    const result = runHook(home, extra);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(home), []);
  });
}

test('a skill registration failure does not fail the CLI installation hook', (t) => {
  const parent = sandbox(t), home = path.join(parent, 'not-a-directory'); fs.writeFileSync(home, 'keep');
  const result = runHook(home, { npm_config_global: 'true' });
  assert.equal(result.status, 0);
  assert.notEqual(result.stderr.trim(), '');
  assert.equal(fs.readFileSync(home, 'utf8'), 'keep');
});
