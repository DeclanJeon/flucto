import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mapThreadsProfilePosts } from '../dist-electron/main/platforms/threads.js';
import { runMediaDownload } from '../dist-electron/main/services/mediaDownload.js';

test('Threads profile batches keep distinct video posts and exclude non-video entries', () => {
  const result = mapThreadsProfilePosts([
    { url: 'https://www.threads.com/@creator/post/abc', hasVideo: true, title: ' First video ', thumbnail: 'https://cdn.test/a.jpg', duration: 12 },
    { url: 'https://www.threads.com/@creator/post/abc', hasVideo: true, title: 'Duplicate', thumbnail: '', duration: 0 },
    { url: 'https://www.threads.com/@creator/post/photo', hasVideo: false, title: 'Photo', thumbnail: '', duration: 0 },
    { url: 'https://www.threads.com/@creator/post/def', hasVideo: true, title: '', thumbnail: '', duration: 0 },
  ]);

  assert.deepEqual(result.map(({ id, title, originalUrl, duration }) => [id, title, originalUrl, duration]), [
    ['abc', 'First video', 'https://www.threads.com/@creator/post/abc', 12],
    ['def', 'Threads video', 'https://www.threads.com/@creator/post/def', 0],
  ]);
});

test('one unavailable Threads post becomes an item failure without aborting its caller', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'post unavailable' }, { status: 404 });
  try {
    const result = await runMediaDownload(
      { url: 'https://www.threads.com/@creator/post/missing', format: 'mp4', outputDir: 'unused' },
      { binaries: { ytDlpPath: 'unused', ffmpegPath: 'unused' } },
    );
    assert.equal(result.success, false);
    assert.match(result.message, /404|Failed to extract media/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('same-title Threads posts save to different files instead of overwriting', async () => {
  const originalFetch = globalThis.fetch;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-profile-batch-'));
  let activePostId = '';
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/api/threads')) {
      activePostId = new URL(JSON.parse(String(init?.body)).url).pathname.split('/').pop() ?? '';
      return Response.json({
        username: 'creator',
        text: '',
        medias: [{ mediaType: 2, height: 480, width: 640, cover: `https://cdn.test/${activePostId}.mp4` }],
      });
    }
    return new Response(new Uint8Array([activePostId === 'abc' ? 1 : 2]), { headers: { 'content-length': '1' } });
  };

  try {
    const download = (id) => runMediaDownload(
      { url: `https://www.threads.com/@creator/post/${id}`, format: 'mp4', outputDir },
      { binaries: { ytDlpPath: 'unused', ffmpegPath: 'unused' } },
    );
    const first = await download('abc');
    const second = await download('def');

    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.notEqual(first.filePath, second.filePath);
    assert.deepEqual([...fs.readFileSync(first.filePath)], [1]);
    assert.deepEqual([...fs.readFileSync(second.filePath)], [2]);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
