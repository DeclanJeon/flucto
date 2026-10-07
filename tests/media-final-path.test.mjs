import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFinalFilePath } from '../dist-electron/main/services/mediaDownload.js';

test('converted output path takes precedence over the deleted intermediate download', () => {
  const output = '[download] Destination: /tmp/sample.mp4\n[ExtractAudio] Destination: /tmp/sample.mp3\nDeleting original file /tmp/sample.mp4\n__FLUCTO_FINAL__"/tmp/sample.mp3"\n';
  assert.equal(parseFinalFilePath(output), '/tmp/sample.mp3');
});

test('final file path preserves Windows backslashes and Unicode filenames', () => {
  const output = '__FLUCTO_FINAL__"C:\\\\Users\\\\test\\\\노래 mix.mp3"\r\n';
  assert.equal(parseFinalFilePath(output), 'C:\\Users\\test\\노래 mix.mp3');
});
