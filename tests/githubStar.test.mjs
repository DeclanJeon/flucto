import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchRepoStarCount,
  isRepoStarred,
  starRepo,
} from '../dist-electron/main/services/githubStar.js';

const REF = { owner: 'DeclanJeon', repo: 'flucto' };

test('github star helpers fetch the public count, check starred state, and star the repo', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const method = init.method ?? 'GET';
    calls.push({ url: target, method, headers: init.headers ?? {} });
    if (target === 'https://api.github.com/repos/DeclanJeon/flucto') {
      return new Response(JSON.stringify({ stargazers_count: 42 }), { status: 200 });
    }
    if (target.includes('/user/starred/')) {
      if (method === 'PUT') return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    assert.equal(await fetchRepoStarCount(REF), 42);
    assert.equal(await isRepoStarred(REF, 'tok'), false);
    await starRepo(REF, 'tok');

    const put = calls.find((call) => call.method === 'PUT');
    assert.ok(put, 'expected a PUT star request');
    assert.equal(put.url, 'https://api.github.com/user/starred/DeclanJeon/flucto');
    assert.equal(put.headers.Authorization, 'Bearer tok');
    const countCall = calls.find((call) => call.url.endsWith('/repos/DeclanJeon/flucto'));
    assert.ok(countCall, 'public count must not use the token');
    assert.equal(countCall.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('github star helpers treat unknown states as null and auth failures as readable errors', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'PUT') return new Response(null, { status: 401 });
    return new Response(null, { status: 500 });
  };
  try {
    assert.equal(await fetchRepoStarCount(REF), null);
    assert.equal(await isRepoStarred(REF, 'tok'), null);
    await assert.rejects(() => starRepo(REF, 'tok'), /401/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
