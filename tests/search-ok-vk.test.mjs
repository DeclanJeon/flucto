import assert from 'node:assert/strict';
import test from 'node:test';
import { searchVkvideo } from '../dist-electron/main/search/vkvideo.js';

test('VK preserves catalog ranking, deduplicates videos and resolves negative group owners', async () => {
  const originalFetch = globalThis.fetch;
  const first = { id: 456243036, owner_id: -227224978, title: 'Nature 4K OLED Demo', image: [{ url: 'https://iv.okcdn.ru/small', width: 130 }, { url: 'https://iv.okcdn.ru/big', width: 800 }] };
  const second = { id: 456242600, owner_id: -155813589, title: 'Nature Relaxation Film 4K' };
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).includes('get_anonym_token')
    ? { type: 'okay', data: { access_token: 'anonymous-fixture', expires: Date.now() / 1000 + 300 } }
    : { response: {
      catalog: { sections: [{ blocks: [{ data_type: 'catalog_videos', videos_ids: ['-227224978_456243036', '-155813589_456242600'] }] }] },
      catalog_videos: [{ video: second }, { video: first }, { video: first }, { video: { id: 1 } }],
      groups: [{ id: 227224978, name: 'Nature Films' }],
    } }), { status: 200 });
  try {
    const videos = await searchVkvideo('nature', 10);
    assert.deepEqual(videos.map(v => [v.originalUrl, v.uploader, v.thumbnail]), [
      ['https://vkvideo.ru/video-227224978_456243036', 'Nature Films', 'https://iv.okcdn.ru/big'],
      ['https://vkvideo.ru/video-155813589_456242600', '', ''],
    ]);
  } finally { globalThis.fetch = originalFetch; }
});
