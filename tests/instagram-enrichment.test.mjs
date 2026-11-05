import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { instagramTarget, inputTargets, profileFromObservation, authorFromObservation,
  externalLink, classifyLink, hubLinks, parseObservation, observeInstagramPage, multipleLinksRef, isLinkHub } from '../scripts/instagram-profile-model.mjs';
import { optionsFromArgs } from '../scripts/instagram-enrichment.mjs';

test('finds the author in a div-only options/follow row without including commenters', () => {
  // Given: narrow DOM fixture reproducing the observed layout without article/header.
  const author = { innerText: 'sample_shop', href: 'https://www.instagram.com/sample_shop/', getClientRects: () => [1] };
  const commenter = { ...author, innerText: 'commenter', href: 'https://www.instagram.com/commenter/' };
  const row = { innerText: 'sample_shop\n팔로우', querySelectorAll: () => [author], parentElement: null };
  const options = { getAttribute: () => '옵션 더 보기', parentElement: row };
  const main = { innerText: 'sample_shop\n팔로우\ncommenter', querySelectorAll: () => [author, commenter] };
  const doc = { querySelector: selector => selector === 'main' ? main : null,
    querySelectorAll: () => [options], body: main };
  const previous = globalThis.location;
  globalThis.location = { href: 'https://www.instagram.com/p/abc/' };
  try {
    // When
    const result = observeInstagramPage(doc);
    // Then
    assert.deepEqual(result.authorLinks, [{ text: 'sample_shop', url: author.href }]);
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
});

const target = instagramTarget('https://www.instagram.com/sample_shop/');
function profile(changes = {}) {
  return { url: target.url, pageText: '', headerText: '', authorLinks: [], links: [],
    headerLinks: [{ text: 'sample_shop', url: target.url }, { text: '팔로워 5.1만', url: `${target.url}#` }], ...changes };
}

test('preserves rounded follower display when profile identity matches', () => {
  // Given
  const observation = profile();
  // When
  const result = profileFromObservation(observation, target);
  // Then
  assert.equal(result.followerDisplay, '팔로워 5.1만');
  assert.equal(result.status, 'observed');
});

test('does not copy counts when redirected to another account', () => {
  // Given
  const observation = profile({ url: 'https://www.instagram.com/other/' });
  // When
  const result = profileFromObservation(observation, target);
  // Then
  assert.equal(result.status, 'identity_unconfirmed');
  assert.equal(result.followerDisplay, null);
});

test('reports missing followers rather than zero when header is incomplete', () => {
  // Given
  const observation = profile({ headerLinks: [{ text: 'sample_shop', url: target.url }] });
  // When
  const result = profileFromObservation(observation, target);
  // Then
  assert.equal(result.status, 'followers_unavailable');
  assert.equal(result.followerDisplay, null);
});

for (const [changes, expected] of [
  [{ url: 'https://www.instagram.com/accounts/login/' }, 'auth_or_challenge'],
  [{ pageText: 'Try again later' }, 'rate_limited'],
  [{ pageText: '보안 확인' }, 'auth_or_challenge'],
]) {
  test(`stops with ${expected} when access is interrupted`, () => {
    // Given
    const observation = profile(changes);
    // When
    const result = profileFromObservation(observation, target);
    // Then
    assert.equal(result.status, expected);
    assert.equal(result.followerDisplay, null);
  });
}

test('extracts only the post header author when commenters are present', () => {
  // Given
  const observation = profile({ authorLinks: [{ text: 'sample_shop', url: target.url }],
    links: [{ text: 'commenter', url: 'https://www.instagram.com/commenter/' }] });
  // When
  const author = authorFromObservation(observation);
  // Then
  assert.equal(author.handle, 'sample_shop');
});

test('rejects ambiguous authors when a post has multiple named header profiles', () => {
  // Given
  const observation = profile({ authorLinks: [{ text: 'sample_shop', url: target.url },
    { text: 'other', url: 'https://www.instagram.com/other/' }] });
  // When / Then
  assert.throws(() => authorFromObservation(observation), { code: 'author_ambiguous' });
});

test('selects the multiple-links button without selecting the follow button', () => {
  // Given
  const snapshot = 'e35 button "팔로우"\ne36 button "링크 아이콘 link.inpock.co.kr/shop 외 2개"';
  // When
  const ref = multipleLinksRef(snapshot);
  // Then
  assert.equal(ref, 'e36');
});

test('retains purchase parameters while removing Instagram tracking from links', () => {
  // Given
  const url = 'https://l.instagram.com/?u=' + encodeURIComponent('https://shop.example/product?id=42&utm_source=ig&fbclid=abc');
  // When
  const result = externalLink(url);
  // Then
  assert.equal(result, 'https://shop.example/product?id=42');
});

for (const url of ['javascript:alert(1)', 'http://127.0.0.1/test', 'http://localhost/', 'https://user:secret@shop.example/']) {
  test(`rejects unsafe external URL ${url}`, () => {
    // Given / When
    const result = externalLink(url);
    // Then
    assert.equal(result, null);
  });
}

test('keeps sales links separate from instructions and ambiguous products', () => {
  // Given
  const labels = ['비비드유니 자사몰', '공구제품 섭취설명서', '제품A', '송송마켓', '올레토샷 CS', '공동구매 가이드북'];
  // When
  const kinds = labels.map(classifyLink);
  // Then
  assert.deepEqual(kinds, ['promotion', 'other', 'candidate', 'promotion', 'other', 'other']);
});

test('preserves hub provenance when a promoted product is linked', () => {
  // Given
  const observation = profile({ url: 'https://litt.ly/sample_shop', links: [{ text: '공동구매', url: 'https://shop.example/buy' }] });
  // When
  const result = hubLinks(observation);
  // Then
  assert.deepEqual(result, [{ url: 'https://shop.example/buy', label: '공동구매', sourceUrl: observation.url, kind: 'promotion' }]);
});

test('deduplicates canonical profile URLs when reading a Flucto envelope', () => {
  // Given
  const raw = { videos: [{ originalUrl: target.url }, { originalUrl: `${target.url}?utm_source=search` }] };
  // When
  const result = inputTargets(raw);
  // Then
  assert.deepEqual(result, [target]);
});

test('rejects malformed observation instead of interpreting it as no followers', () => {
  // Given
  const observation = { ...profile(), headerLinks: 'invalid' };
  // When / Then
  assert.throws(() => parseObservation(observation), { code: 'protocol' });
});

test('recognizes the verified Inpock short-domain hub', () => {
  // Given
  const url = 'https://inpk.link/dreamyaksa';
  // When
  const recognized = isLinkHub(url);
  // Then
  assert.equal(recognized, true);
});

test('exits with usage error through the real CLI when the batch exceeds its cap', () => {
  // Given
  const script = new URL('../scripts/instagram-enrichment.mjs', import.meta.url);
  // When
  const result = spawnSync(process.execPath, [fileURLToPath(script), '--input', 'missing.json', '--output', 'unused.jsonl', '--limit', '1100'], { encoding: 'utf8' });
  // Then
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).code, 'usage');
});

test('rejects excess batch size before browser work', () => {
  // Given
  const args = ['--input', 'in.json', '--output', 'out.jsonl', '--limit', '1100'];
  // When / Then
  assert.throws(() => optionsFromArgs(args), { code: 'usage' });
});

test('rejects reserved and off-site targets before browser work', () => {
  // Given
  const urls = ['https://www.instagram.com/accounts/login/', 'https://evil.example/p/abc/'];
  // When / Then
  for (const url of urls) assert.throws(() => instagramTarget(url), { code: 'input' });
});
