import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { searchYouTube } from '../dist-electron/main/search/youtube.js';
import { searchReddit } from '../dist-electron/main/search/reddit.js';

async function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const originalLaunch = chromium.launch;
  globalThis.fetch = handler;
  chromium.launch = async () => { throw new Error('Browser unavailable'); };
  try { await run(); } finally { globalThis.fetch = originalFetch; chromium.launch = originalLaunch; }
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status });
}

function ytRenderer(id, extra = {}) {
  return {
    videoRenderer: {
      videoId: id,
      title: { runs: [{ text: `Title ${id}` }] },
      lengthText: { simpleText: '1:02:03' },
      ownerText: { runs: [{ text: 'Some Channel' }] },
      viewCountText: { simpleText: '12,345 views' },
      thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hq.jpg` }] },
      ...extra,
    },
  };
}

function ytHtml(payload) {
  return `<!doctype html><html><body><script>var ytInitialData = ${JSON.stringify(payload)};</script></body></html>`;
}

test('YouTube maps ytInitialData renderers, skips non-video entries and dedupes', async () => {
  const payload = { contents: { sections: [
    ytRenderer('aaa111', {}),
    ytRenderer('bbb222', { lengthText: { simpleText: '0:45' }, viewCountText: { simpleText: '1.2M views' } }),
    { playlistRenderer: { playlistId: 'PL9' } },
    ytRenderer('aaa111'), // duplicate id
    { videoRenderer: { title: { simpleText: 'Missing id' } } },
  ] } };
  await withFetch(() => htmlResponse(ytHtml(payload)), async () => {
    const { videos } = await searchYouTube('nature', 10);
    assert.equal(videos.length, 2);
    assert.equal(videos[0].originalUrl, 'https://www.youtube.com/watch?v=aaa111');
    assert.equal(videos[0].duration, 3723);
    assert.equal(videos[0].uploader, 'Some Channel');
    assert.equal(videos[0].view_count, 12345);
    assert.equal(videos[1].duration, 45);
    assert.equal(videos[1].view_count, 1_200_000);
  });
});

test('YouTube pages through the Innertube continuation for larger limits', async () => {
  const html = `<script>"INNERTUBE_API_KEY":"FAKEKEY123","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB"}}</script>`
    + ytHtml({ contents: [ytRenderer('p1a'), { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'NEXT' } } } }] });
  await withFetch(async (url) => {
    const target = String(url);
    if (target.includes('youtubei/v1/search')) {
      assert.ok(target.includes('key=FAKEKEY123'));
      return new Response(JSON.stringify({ onResponseReceivedCommands: [ytRenderer('p2b')] }), { status: 200 });
    }
    return htmlResponse(html);
  }, async () => {
    const { videos } = await searchYouTube('nature', 30);
    assert.deepEqual(videos.map(v => v.id), ['p1a', 'p2b']);
  });
});

test('YouTube rejects gated pages instead of returning zero results', async () => {
  await withFetch(() => htmlResponse('<html>Before you continue to YouTube</html>'),
    () => assert.rejects(searchYouTube('nature', 5), /consent/i));
  await withFetch(() => htmlResponse('<html><body>No initial data here</body></html>'),
    () => assert.rejects(searchYouTube('nature', 5), /embedded result data/));
});


function redditListing(children, after = null) {
  return new Response(JSON.stringify({ kind: 'Listing', data: { children, after } }), { status: 200 });
}

function redditChild(data) {
  return { kind: 't3', data };
}

test('Reddit keeps only posts that actually contain playable video', async () => {
  const children = [
    redditChild({ id: 'self1', is_self: true, title: 'discussion', permalink: '/r/x/comments/self1/t/', url: 'https://www.reddit.com/r/x/comments/self1/t/' }),
    redditChild({ id: 'img1', post_hint: 'image', title: 'photo', permalink: '/r/x/comments/img1/t/', url: 'https://i.redd.it/a.jpg' }),
    redditChild({ id: 'gal1', is_gallery: true, title: 'album', permalink: '/r/x/comments/gal1/t/', url: 'https://www.reddit.com/gallery/gal1' }),
    redditChild({ id: 'art1', post_hint: 'link', title: 'article', permalink: '/r/x/comments/art1/t/', url: 'https://blog.example.com/story' }),
    redditChild({ id: 'thr1', title: 'thread link', permalink: '/r/x/comments/thr1/t/', url: 'https://www.reddit.com/r/y/comments/thr1/t/' }),
    redditChild({
      id: 'vid1', is_video: true, title: 'real clip', author: 'uploader7',
      permalink: '/r/x/comments/vid1/t/', url: 'https://v.redd.it/abc', thumbnail: 'https://b.thumbs.redditmedia.com/t.jpg',
      secure_media: { reddit_video: { duration: 42 } }, score: 99,
    }),
    redditChild({ id: 'ext1', title: 'youtube link', permalink: '/r/x/comments/ext1/t/', url_overridden_by_dest: 'https://www.youtube.com/watch?v=zz9' }),
    redditChild({ id: 'vid1', is_video: true, title: 'dup clip', permalink: '/r/x/comments/vid1/t/' }), // duplicate id
  ];
  await withFetch(() => redditListing(children), async () => {
    const { videos } = await searchReddit('nature', 10);
    assert.deepEqual(videos.map(v => v.id), ['vid1', 'ext1']);
    const hosted = videos[0];
    assert.equal(hosted.originalUrl, 'https://www.reddit.com/r/x/comments/vid1/t/');
    assert.equal(hosted.duration, 42);
    assert.equal(hosted.uploader, 'uploader7');
    // external youtube post is still attributed to reddit via its permalink
    assert.equal(videos[1].originalUrl, 'https://www.reddit.com/r/x/comments/ext1/t/');
  });
});

test('Reddit rejects malformed envelopes and HTTP blocks instead of reporting zero hits', async () => {
  await withFetch(() => redditListing(null), () => assert.rejects(searchReddit('nature', 5), /unexpected response/));
  await withFetch(() => new Response('{}', { status: 200 }), () => assert.rejects(searchReddit('nature', 5), /unexpected response/));
  await withFetch(() => new Response('<html>blocked</html>', { status: 403 }), () => assert.rejects(searchReddit('nature', 5), /HTTP 403/));
  await withFetch(() => redditListing([], null), async () => {
    assert.deepEqual((await searchReddit('no-match', 5)).videos, []);
  });
});
