import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { downloadImageUrls } from '../dist-electron/main/services/mediaDownload.js';
import { extractPostImages } from '../dist-electron/main/services/mediaInfo.js';

test('downloads every image URL from a multi-image post into the output folder', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'image/jpeg');
    response.end(Buffer.from(request.url.slice(1)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const extracted = extractPostImages({ title: 'Carousel', entries: [{ url: 'https://cdn.example/one.jpg', ext: 'jpg' }, { formats: [{ url: 'https://cdn.example/two.webp', ext: 'webp' }] }, { url: 'https://cdn.example/video.mp4', ext: 'mp4' }] });
  assert.deepEqual(extracted.map((item) => item.url), ['https://cdn.example/one.jpg', 'https://cdn.example/two.webp']);
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flucto-images-'));
  try {
    const base = 'http://127.0.0.1:' + address.port;
    const result = await downloadImageUrls([base + '/one', base + '/two', base + '/three'], outputDir, 'Carousel');
    assert.equal(result.succeeded.length, 3);
    assert.deepEqual(await Promise.all(result.succeeded.map((item) => fs.readFile(item.filePath, 'utf8'))), ['one', 'two', 'three']);
    assert.equal(new Set(result.succeeded.map((item) => path.basename(item.filePath))).size, 3);
  } finally {
    server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});
