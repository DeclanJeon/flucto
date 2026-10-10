import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverAiVideos } from '../dist-electron/main/services/aiVideoDiscovery.js';

const item = (id, views, description = '') => ({
  id,
  title: id,
  thumbnail_url: 'https://images.example/thumb.jpg',
  duration: 30,
  'owner.screenname': 'creator',
  views_total: views,
  ...(description === null ? {} : { description }),
});

const installDailymotionSearch = (respond, { failOn } = {}) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const query = url.searchParams.get('search');
    if (failOn === query) return Response.json({ error: { message: 'source unavailable' } }, { status: 503 });
    return Response.json({ list: respond(query), has_more: false });
  };
  return () => { globalThis.fetch = originalFetch; };
};

test('duplicate canonical URLs merge query provenance and respect the global candidate cap', async () => {
  const restore = installDailymotionSearch((query) => {
    if (query.includes('routine video')) return [item('shared', 100), item('first', 80)];
    if (query.includes('routine animation')) return [item('shared', 100), item('second', 60)];
    return [];
  });
  try {
    const result = await discoverAiVideos({ query: 'routine', platform: 'dailymotion', limit: 3 });
    assert.equal(result.candidates.length, 3);
    const shared = result.candidates.find((candidate) => candidate.id === 'shared');
    assert.equal(shared.originalUrl, 'https://www.dailymotion.com/video/shared');
    assert.ok(shared.matchedQueries.length >= 2);
    assert.equal(result.query, 'routine');
    assert.ok(result.sourceReports.length >= 3);
  } finally {
    restore();
  }
});

test('popularity is platform-relative and missing views remain unknown', async () => {
  const restore = installDailymotionSearch((query) => query.includes('routine video')
    ? [item('popular', 100), item('unknown', undefined)]
    : [item('less-popular', 10)]);
  try {
    const result = await discoverAiVideos({ query: 'routine', platform: 'dailymotion', limit: 5, sort: 'popularity' });
    const popular = result.candidates.find((candidate) => candidate.id === 'popular');
    const unknown = result.candidates.find((candidate) => candidate.id === 'unknown');
    assert.equal(popular.popularityBasis, 'view_count_percentile');
    assert.ok(popular.popularityScore > result.candidates.find((candidate) => candidate.id === 'less-popular').popularityScore);
    assert.equal(unknown.view_count, undefined);
    assert.equal(unknown.popularityBasis, 'unknown');
  } finally {
    restore();
  }
});

test('one failed query retains candidates and reports the source failure', async () => {
  const restore = installDailymotionSearch((query) => [item('available', 5)], { failOn: 'AI generated routine animation' });
  try {
    const result = await discoverAiVideos({ query: 'routine', platform: 'dailymotion', limit: 5 });
    assert.ok(result.candidates.length > 0);
    assert.ok(result.sourceReports.some((report) => report.error));
    assert.equal(result.partialFailure, true);
  } finally {
    restore();
  }
});

test('explicit description evidence confirms generated media while query terms alone do not', async () => {
  const disclosure = 'The animation in this video was generated with AI.';
  const restore = installDailymotionSearch((query) => query.includes('routine video')
    ? [item('disclosed', 100, disclosure), item('keyword-only', 50)]
    : []);
  try {
    const result = await discoverAiVideos({ query: 'routine', platform: 'dailymotion', limit: 5 });
    assert.equal(result.candidates.find((candidate) => candidate.id === 'disclosed').aiMediaStatus, 'confirmed');
    assert.equal(result.candidates.find((candidate) => candidate.id === 'keyword-only').aiMediaStatus, 'not_ai');
  } finally {
    restore();
  }
});

test('invalid result caps are rejected before searching', async () => {
  await assert.rejects(discoverAiVideos({ platform: 'dailymotion', limit: 51 }), /1 to 50/);
});

test('duplicate URL evidence from separate queries is merged before classification', async () => {
  const restore = installDailymotionSearch((query) => {
    if (query.includes('routine video')) return [item('conflict', 50, 'The animation was generated with AI.')];
    if (query.includes('routine animation')) return [item('conflict', 50, 'All footage is original camera video.')];
    return [];
  });
  try {
    const result = await discoverAiVideos({ query: 'routine', platform: 'dailymotion', limit: 5 });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].aiMediaStatus, 'uncertain');
    assert.equal(result.candidates[0].evidence.length, 2);
    assert.ok(result.candidates[0].reasonCodes.includes('conflicting_media_disclosures'));
  } finally {
    restore();
  }
});

test('omitted query searches the generic AI-video phrase set', async () => {
  const restore = installDailymotionSearch(() => []);
  try {
    const result = await discoverAiVideos({ platform: 'dailymotion', limit: 5 });
    assert.deepEqual(result.sourceReports.map((report) => report.query), [
      'AI generated video',
      'video made with AI',
      'AI generated animation',
    ]);
    assert.equal('query' in result, false);
  } finally {
    restore();
  }
});

test('free-text query expands retrieval phrases but is not classification evidence', async () => {
  const restore = installDailymotionSearch((query) => query.includes('cat')
    ? [item('keyword-only', 10)]
    : []);
  try {
    const result = await discoverAiVideos({ query: 'cat', platform: 'dailymotion', limit: 5 });
    assert.deepEqual(result.sourceReports.map((report) => report.query), [
      'AI generated cat video',
      'AI generated cat animation',
      'cat video made with AI',
    ]);
    assert.equal(result.candidates[0].aiMediaStatus, 'not_ai');
    assert.equal(result.candidates[0].matchedQueries.length, 3);
    assert.equal('topic' in result.candidates[0], false);
  } finally {
    restore();
  }
});

test('duplicate results keep unavailable disclosure metadata unavailable', async () => {
  const restore = installDailymotionSearch(() => [item('missing-metadata', 4, null)]);
  try {
    const result = await discoverAiVideos({ query: 'cat', platform: 'dailymotion', limit: 5 });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].matchedQueries.length, 3);
    assert.equal(result.candidates[0].aiMediaStatus, 'unavailable');
  } finally {
    restore();
  }
});

test('relevance ordering prioritizes public AI-media disclosure over no evidence', async () => {
  const restore = installDailymotionSearch((query) => {
    if (query === 'AI generated cat video') return [item('no-evidence', 100)];
    if (query === 'AI generated cat animation') return [item('disclosed', 10, 'The animation in this video was generated with AI.')];
    return [];
  });
  try {
    const result = await discoverAiVideos({ query: 'cat', platform: 'dailymotion', limit: 5 });
    assert.deepEqual(result.candidates.map((candidate) => candidate.id), ['disclosed', 'no-evidence']);
    assert.equal(result.candidates[0].aiMediaStatus, 'confirmed');
  } finally {
    restore();
  }
});
