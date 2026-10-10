import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCliArgs, CliUsageError } from '../dist-electron/cli/args.js';


test('search rejects unknown platforms and over-cap limits', () => {
  assert.throws(() => parseCliArgs(['search', 'q', '--platform', 'myspace']), CliUsageError);
  assert.throws(() => parseCliArgs(['search', 'q', '--limit', '51']), /1 to 50/);
  assert.equal(parseCliArgs(['search', 'q', '--limit', '50']).limit, 50);
});

test('search still requires exactly one quoted keyword', () => {
  assert.throws(() => parseCliArgs(['search']), /exactly one/);
  assert.throws(() => parseCliArgs(['search', 'one', 'two']), /exactly one/);
});

test('discover parser accepts an optional arbitrary query and discovery filters', () => {
  assert.deepEqual(parseCliArgs(['discover']).positional, []);
  assert.deepEqual(parseCliArgs(['discover', 'cats in space']).positional, ['cats in space']);
  assert.throws(() => parseCliArgs(['discover', 'one', 'two']), /at most one/);
  const options = parseCliArgs([
    'discover', 'fitness cats', '--platform', 'youtube', '--limit', '5',
    '--status', 'uncertain', '--sort', 'popularity', '--json',
  ]);
  assert.equal(options.command, 'discover');
  assert.equal(options.platform, 'youtube');
  assert.equal(options.limit, 5);
  assert.equal(options.status, 'uncertain');
  assert.equal(options.sort, 'popularity');
  assert.equal(options.json, true);
  assert.throws(() => parseCliArgs(['discover', '--limit', '51']), /1 to 50/);
  assert.throws(() => parseCliArgs(['discover', 'cats', '--status', 'maybe']), /status/);
});
