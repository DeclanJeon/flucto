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
