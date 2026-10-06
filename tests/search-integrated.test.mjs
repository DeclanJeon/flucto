import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { searchVideos } from '../dist-electron/main/services/videoSearch.js';

async function withUpstreams(responses, run) {
  const fetch = globalThis.fetch;
  const launch = chromium.launch;
  globalThis.fetch = async input => {
    const host = new URL(String(input)).hostname;
    const body = responses[host];
    return body ? Response.json(body) : Response.json({ error: 'Upstream offline' }, { status: 503 });
  };
  chromium.launch = async () => { throw new Error('Browser unavailable'); };
  try { await run(); } finally { globalThis.fetch = fetch; chromium.launch = launch; }
}

const responses = {
  'api.bilibili.com': { code: 0, data: { result: [1, 2, 3].map(n => ({ type: 'video', bvid: `BVsearch${n}`, title: `Bili ${n}`, duration: '0:30', pic: '//images.example/bili.jpg' })) } },
  'api.dailymotion.com': { list: [1, 2, 3].map(n => ({ id: `dm${n}`, title: `Daily ${n}`, thumbnail_url: 'https://images.example/dm.jpg', duration: 30, 'owner.screenname': 'Daily creator', views_total: 10 })), has_more: false },
  'snapshot.search.nicovideo.jp': { meta: { status: 200, totalCount: 3 }, data: [1, 2, 3].map(n => ({ contentId: `sm${n}`, title: `Nico ${n}`, thumbnailUrl: 'https://images.example/nico.jpg', lengthSeconds: 30, userId: 42, viewCounter: 10 })) },
};

test('integrated search applies one total limit while preserving each source rank fairly', async () => {
  await withUpstreams(responses, async () => {
    const result = await searchVideos({ platform: 'all', query: 'nature', limit: 4 });
    assert.deepEqual(result.videos.map(v => [v.platform, v.id]), [
      ['bilibili', 'BVsearch1'], ['dailymotion', 'dm1'], ['nicovideo', 'sm1'], ['bilibili', 'BVsearch2'],
    ]);
    assert.equal(result.error, undefined);
    assert.equal(result.sources.find(s => s.platform === 'dailymotion').count, 3);
    assert.ok(result.sources.find(s => s.platform === 'youtube').error);
  });
});

test('total failure is an error, but a successful empty source is not', async () => {
  await withUpstreams({}, async () => {
    const result = await searchVideos({ query: 'nature', limit: 4 });
    assert.ok(result.error);
    assert.ok(result.sources.every(source => source.error));
    const vimeo = result.sources.find(source => source.platform === 'vimeo');
    assert.equal(vimeo.method, 'web-index');
    assert.equal(new URL(vimeo.searchUrl).hostname, 'www.google.com');
  });
  await withUpstreams({ 'api.dailymotion.com': { list: [], has_more: false } }, async () => {
    const result = await searchVideos({ query: 'nature', limit: 4 });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.videos, []);
    assert.equal(result.sources.find(source => source.platform === 'dailymotion').error, undefined);
  });
});
