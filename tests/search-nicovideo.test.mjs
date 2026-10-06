import assert from 'node:assert/strict';
import test from 'node:test';
import { searchNicovideo } from '../dist-electron/main/search/nicovideo.js';

async function withResponse(body, status, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
  try { await run(); } finally { globalThis.fetch = originalFetch; }
}

test('Niconico rejects an upstream API error instead of returning zero hits', async () => {
  await withResponse({ meta: { status: 400, errorCode: 'QUERY_PARSE_ERROR', errorMessage: 'q is required' } }, 400,
    () => assert.rejects(searchNicovideo('nature', 5), /q is required/));
});

test('Niconico rejects malformed success envelopes instead of hiding outages', async () => {
  await withResponse({ meta: { status: 200 } }, 200,
    () => assert.rejects(searchNicovideo('nature', 5), /unexpected response/));
});

test('Niconico omits results without playable IDs but retains valid watch URLs', async () => {
  await withResponse({ meta: { status: 200 }, data: [
    { title: 'Missing identifier' }, { contentId: '  ', title: 'Blank identifier' },
    { contentId: 'sm9', title: 'Playable', userId: null, channelId: 12 },
  ] }, 200, async () => {
    const videos = await searchNicovideo('nature', 5);
    assert.deepEqual(videos.map(video => [video.originalUrl, video.uploader]), [
      ['https://www.nicovideo.jp/watch/sm9', 'channel:12'],
    ]);
  });
});
