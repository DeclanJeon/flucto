import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultAnalysisOutputDirectory, resolveDocumentsDirectory } from '../dist-electron/shared/analysisOutputPath.js';

test('default analysis output uses the platform Documents directory and Flucto subfolder', () => {
  assert.equal(resolveDocumentsDirectory('/Users/example', 'darwin'), path.join('/Users/example', 'Documents'));
  assert.equal(defaultAnalysisOutputDirectory('/Users/example/Documents'), path.join('/Users/example/Documents', 'flucto'));
});

test('Linux analysis output honors XDG_DOCUMENTS_DIR and falls back when missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-xdg-docs-'));
  try {
    const config = path.join(root, 'config');
    fs.mkdirSync(config);
    fs.writeFileSync(path.join(config, 'user-dirs.dirs'), 'XDG_DOCUMENTS_DIR="$HOME/Meine Dokumente"\n');
    assert.equal(resolveDocumentsDirectory('/home/tester', 'linux', config), '/home/tester/Meine Dokumente');
    assert.equal(resolveDocumentsDirectory('/home/tester', 'linux', path.join(root, 'missing')), path.join('/home/tester', 'Documents'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
