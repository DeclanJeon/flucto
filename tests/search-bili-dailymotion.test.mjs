import assert from 'node:assert/strict';
import test from 'node:test';
import { searchBilibili } from '../dist-electron/main/search/bilibili.js';
import { searchDailymotion } from '../dist-electron/main/search/dailymotion.js';

async function withResponse(body, status, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
  try { await run(); } finally { globalThis.fetch = originalFetch; }
}

test('Bilibili strips highlighted titles, parses long durations and removes duplicate videos', async () => {
  const item = { type: 'video', bvid: 'BV1zpHJ6yEW9', title: '<em>nature</em> &amp; rain &quot;HD&quot;', duration: '1:02:03', pic: '//i0.hdslb.com/a.jpg' };
  await withResponse({ code: 0, data: { result: [item, { ...item }, { type: 'video', title: 'Missing ID' }, { type: 'user', bvid: 'BVOther' }] } }, 200, async () => {
    const videos = await searchBilibili('nature', 20);
    assert.deepEqual(videos.map(v => [v.title, v.duration, v.thumbnail, v.originalUrl]), [
      ['nature & rain "HD"', 3723, 'https://i0.hdslb.com/a.jpg', 'https://www.bilibili.com/video/BV1zpHJ6yEW9'],
    ]);
  });
});

test('Dailymotion rejects error envelopes even when upstream sends HTTP 200', async () => {
  await withResponse({ error: { code: 403, message: 'Access restricted' } }, 200,
    () => assert.rejects(searchDailymotion('nature', 5), /Access restricted/));
});

test('Dailymotion does not confuse malformed data with a legitimate zero-result search', async () => {
  await withResponse({}, 200, () => assert.rejects(searchDailymotion('nature', 5), /unexpected response/));
  await withResponse({ list: [], total: 0 }, 200, async () => {
    assert.deepEqual(await searchDailymotion('no-match', 5), []);
  });
});

test('Dailymotion public descriptions are retained as creator-disclosure evidence', async () => {
  const description = 'The animation in this video was generated with AI.';
  const originalFetch = globalThis.fetch;
  let fetchedUrl = '';
  globalThis.fetch = async (input) => {
    fetchedUrl = String(input);
    return Response.json({
      list: [{ id: 'ai1', title: 'Animated routine', description, views_total: 23 }],
      has_more: false,
    });
  };
  try {
    const [video] = await searchDailymotion('routine', 5);
    assert.ok(new URL(fetchedUrl).searchParams.get('fields').split(',').includes('description'));
    assert.deepEqual(video.aiDisclosures, [{
      source: 'creator_description',
      text: description,
      url: 'https://www.dailymotion.com/video/ai1',
    }]);
    assert.equal(video.aiDisclosureMetadataAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Dailymotion missing description metadata remains distinguishable from an empty description', async () => {
  await withResponse({ list: [{ id: 'no-description', title: 'Routine' }], has_more: false }, 200, async () => {
    const [video] = await searchDailymotion('routine', 5);
    assert.equal(video.aiDisclosureMetadataAvailable, false);
    assert.equal(video.aiDisclosures, undefined);
  });
});
