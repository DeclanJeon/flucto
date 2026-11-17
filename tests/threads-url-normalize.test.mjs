import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeThreadsUrl } from '../dist-electron/main/platforms/threads.js';
import { runMediaDownload } from '../dist-electron/main/services/mediaDownload.js';

const SHARED_LINK =
  'https://www.threads.com/@moongi_adventures/post/Df1VA1XgDGb/media?xmt=AQG0Acmfku8gH8GVSFtuSf_aOfliHxRPycyn7D66-5zTdtetIkKqVOiQWtD9aRE2u90yepRJ';
const CANONICAL_LINK = 'https://www.threads.com/@moongi_adventures/post/Df1VA1XgDGb';

test('shared Threads links are reduced to the canonical post URL the API accepts', () => {
  const cases = [
    [SHARED_LINK, CANONICAL_LINK],
    ['https://www.threads.com/@creator/post/AbC123/media', 'https://www.threads.com/@creator/post/AbC123'],
    ['https://www.threads.com/@creator/post/AbC123/', 'https://www.threads.com/@creator/post/AbC123'],
    ['https://www.threads.com/@creator/post/AbC123?hl=en&slof=1', 'https://www.threads.com/@creator/post/AbC123'],
    ['https://www.threads.net/@creator/post/AbC123/embed', 'https://www.threads.com/@creator/post/AbC123'],
    ['https://threads.net/@creator/tv/AbC123', 'https://www.threads.com/@creator/post/AbC123'],
    [`  ${CANONICAL_LINK}  `, CANONICAL_LINK],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeThreadsUrl(input), expected, input);
  }
});

test('non-post Threads URLs and other hosts are passed through untouched', () => {
  const untouched = [
    'https://www.threads.com/@moongi_adventures',
    'https://www.threads.com/@moongi_adventures/media',
    'https://www.threads.com/@moongi_adventures/replies',
    'https://www.youtube.com/watch?v=abc',
    'not a url',
  ];

  for (const input of untouched) {
    assert.equal(normalizeThreadsUrl(input), input);
  }
});

test('downloading a shared Threads link posts the canonical URL to the extraction API', async () => {
  const originalFetch = globalThis.fetch;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-normalize-'));
  const postedUrls = [];

  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/api/threads')) {
      postedUrls.push(JSON.parse(String(init?.body)).url);
      return Response.json({
        username: 'moongi_adventures',
        text: 'shared link regression',
        medias: [{ mediaType: 2, width: 1280, height: 720, cover: 'https://cdn.test/shared.mp4' }],
      });
    }
    return new Response(new Uint8Array([7]), { headers: { 'content-length': '1' } });
  };

  try {
    const result = await runMediaDownload(
      { url: SHARED_LINK, format: 'mp4', outputDir },
      { binaries: { ytDlpPath: 'unused', ffmpegPath: 'unused' } },
    );

    assert.equal(result.success, true, result.message);
    assert.deepEqual(postedUrls, [CANONICAL_LINK]);
    assert.deepEqual([...fs.readFileSync(result.filePath)], [7]);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
