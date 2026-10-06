import assert from 'node:assert/strict';
import test from 'node:test';
import { searchWebIndex } from '../dist-electron/main/search/webIndexSearch.js';
import { searchSocialVideos } from '../dist-electron/main/search/socialSearch.js';

// Page-layer mock: returns what the anonymous index page "served" for each
// engine URL. Parsing/host/path/error boundaries are exercised through the
// public entry points; no browser is launched.

function indexRun(candidates, state = 'results') {
  return { pageUrl: 'https://index.example/results', state, servedPage: true, candidates };
}

test('web index keeps only canonical media links on the requested site', async () => {
  const runPage = async () => indexRun([
    // Tracking slug on a real Threads post -> trimmed to /@user/post/ID.
    { href: 'https://www.threads.com/@choi.openai/post/DWVPADPAWs-/video-slug?utm_source=x', title: 'Nature reel', cardText: 'Nature reel Threads에서 재생. 0:12', thumb: 'https://img.example/t.jpg' },
    // Same post without the slug -> deduplicated, richer row wins.
    { href: 'https://www.threads.com/@choi.openai/post/DWVPADPAWs-', title: 'dup', cardText: 'dup 0:12', thumb: '' },
    // Profile and login links are not media.
    { href: 'https://www.threads.com/@choi.openai', title: 'profile', cardText: 'profile', thumb: '' },
    { href: 'https://www.threads.com/login', title: 'Log in', cardText: 'login', thumb: '' },
    // Off-site link.
    { href: 'https://www.youtube.com/watch?v=other', title: 'other', cardText: 'other 1:00', thumb: '' },
    // Google redirect wrapper around a second media link.
    { href: 'https://www.google.com/url?sa=t&url=' + encodeURIComponent('https://threads.net/@bird.nerd/post/DfGh123XyZ'), title: 'Bird clip', cardText: 'Bird clip 0:30', thumb: '' },
    { href: 'https://www.google.com/url?url=' + encodeURIComponent('ftp://threads.com/@wrong/post/Ftp123'), title: 'Non-HTTP redirect', cardText: '', thumb: '' },
  ]);
  const result = await searchWebIndex('threads', 'nature', 10, { runPage });
  assert.equal(result.method, 'web-index');
  assert.equal(result.videos.length, 2);
  const [first, second] = result.videos;
  assert.equal(first.id, 'DWVPADPAWs-');
  assert.equal(first.originalUrl, 'https://www.threads.com/@choi.openai/post/DWVPADPAWs-');
  assert.equal(first.title, 'Nature reel');
  assert.equal(first.duration, 12);
  assert.equal(first.uploader, '@choi.openai');
  assert.equal(first.thumbnail, 'https://img.example/t.jpg');
  assert.equal(second.id, 'DfGh123XyZ');
  assert.equal(second.originalUrl, 'https://threads.net/@bird.nerd/post/DfGh123XyZ');
});

test('web index enforces the caller limit and normalizes youtube variants', async () => {
  const runPage = async () => indexRun([
    { href: 'https://youtu.be/abcDEF123_-?si=tracking', title: 'Short link', cardText: '0:10', thumb: '' },
    { href: 'https://www.youtube.com/watch?v=abcDEF123_-&list=xyz', title: 'dup watch', cardText: '0:10', thumb: '' },
    { href: 'https://www.youtube.com/shorts/xyzUVW45678', title: 'Shorts', cardText: '0:33', thumb: '' },
    { href: 'https://www.youtube.com/watch?v=second11111', title: 'Second', cardText: '1:02', thumb: '' },
    { href: 'https://www.youtube.com/watch?v=third333333', title: 'Third', cardText: '2:00', thumb: '' },
  ]);
  const result = await searchWebIndex('youtube', 'nature', 3, { runPage });
  assert.equal(result.videos.length, 3);
  assert.equal(result.videos[0].originalUrl, 'https://www.youtube.com/watch?v=abcDEF123_-');
  assert.equal(result.videos[0].id, 'abcDEF123_-');
  assert.equal(result.videos[1].originalUrl, 'https://www.youtube.com/shorts/xyzUVW45678');
  assert.equal(result.videos[1].id, 'xyzUVW45678');
  assert.equal(result.videos[2].originalUrl, 'https://www.youtube.com/watch?v=second11111');
});

test('web index distinguishes zero-match pages from engine failures', async () => {
  const empty = await searchWebIndex('vimeo', 'nothingmatches', 5, {
    runPage: async () => ({ pageUrl: 'https://index.example/empty', state: 'none', servedPage: true, candidates: [] }),
  });
  assert.deepEqual(empty.videos, []);
  assert.equal(empty.method, 'web-index');

  await assert.rejects(
    searchWebIndex('vimeo', 'nature', 5, {
      runPage: async () => ({ pageUrl: 'https://index.example/challenge', state: 'challenge', servedPage: false, candidates: [] }),
    }),
    /Google.*DuckDuckGo.*Bing/s,
  );
});

test('off-site index results are failures rather than a successful zero-match search', async () => {
  await assert.rejects(searchWebIndex('instagram', 'nature', 5, {
    runPage: async () => indexRun([
      { href: 'https://www.youtube.com/watch?v=unrelated', title: 'Other site', cardText: '0:20', thumb: '' },
    ]),
  }), /none scoped to Instagram/);
});

test('social search reports the login boundary and returns indexed X statuses', async () => {
  const seen = [];
  const runPage = async (url) => {
    seen.push(url);
    if (url.includes('duckduckgo.com')) {
      return indexRun([
        { href: 'https://x.com/NatureInFocuss/status/2107413009249472669', title: 'Quolls hunt', cardText: 'Quolls hunt 0:45', thumb: 'https://t.example/x.jpg' },
        { href: 'https://twitter.com/NatGeoTV/status/2106388056009736238?s=20', title: 'Africa wild', cardText: 'Africa wild', thumb: '' },
      ]);
    }
    return { pageUrl: url, state: 'challenge', servedPage: false, candidates: [] };
  };
  const result = await searchSocialVideos('twitter', 'nature quolls', 5, { runPage });
  assert.equal(result.method, 'web-index');
  assert.match(result.nativeError, /login/i);
  assert.match(result.searchUrl, /duckduckgo\.com/);
  assert.equal(result.videos.length, 2);
  assert.equal(result.videos[0].originalUrl, 'https://x.com/NatureInFocuss/status/2107413009249472669');
  assert.equal(result.videos[0].duration, 45);
  assert.equal(result.videos[1].originalUrl, 'https://twitter.com/NatGeoTV/status/2106388056009736238');
  assert.ok(seen.some(url => decodeURIComponent(url).includes('site:x.com') && decodeURIComponent(url).includes('nature quolls')));
});

test('threads social search prefers native video posts and ignores text and image-only posts', async () => {
  const runPage = async (url) => {
    assert.match(url, /threads\.com\/search\?q=nature/);
    return indexRun([
      { href: 'https://www.threads.com/@jessy/post/DeJ4VixluvW', title: 'nature post', cardText: '@jessy 2시간 Roses in my garden 번역하기', thumb: '', hasVideo: true },
      { href: 'https://www.threads.com/@maria/post/DeHtDN0iB0w', title: 'text post', cardText: '@maria 22시간 just text', thumb: '', hasVideo: false },
      { href: 'https://www.threads.com/@esva/post/DeJJqKiDFkZ/media', title: 'media link', cardText: '', thumb: '', hasVideo: false },
      { href: 'https://www.threads.com/@esva/post/DeJJqKiDFkZ', title: 'image post', cardText: '@esva 5시간 sunset photo 번역하기', thumb: 'https://img.example/s.jpg', hasVideo: false },
    ]);
  };
  const result = await searchSocialVideos('threads', 'nature', 10, { runPage });
  assert.equal(result.method, 'native');
  assert.match(result.searchUrl, /threads\.com\/search/);
  const urls = result.videos.map(v => v.originalUrl).sort();
  assert.deepEqual(urls, [
    'https://www.threads.com/@jessy/post/DeJ4VixluvW',
  ]);
});

test('threads social search falls back to the index when native is blocked', async () => {
  const runPage = async (url) => {
    if (url.includes('threads.com/search')) {
      // Native page rendered only a login wall -> timeout state.
      return { pageUrl: url, state: 'timeout', servedPage: false, candidates: [] };
    }
    if (url.includes('duckduckgo.com')) {
      return indexRun([
        { href: 'https://www.threads.com/@user/post/Ab12Cd34EfG/video-clip', title: 'Clip', cardText: 'Clip 0:20', thumb: '' },
      ]);
    }
    return { pageUrl: url, state: 'challenge', servedPage: false, candidates: [] };
  };
  const result = await searchSocialVideos('threads', 'nature', 5, { runPage });
  assert.equal(result.method, 'web-index');
  assert.match(result.nativeError, /login wall|no video-bearing posts/i);
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].originalUrl, 'https://www.threads.com/@user/post/Ab12Cd34EfG');
});
