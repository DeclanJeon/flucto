// Minimal static server for the self-authored Flucto demo fixture site.
// Serves scripts/demo/work/site on 127.0.0.1:58080. No external content.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./work/site/', import.meta.url));
const PORT = Number(process.env.FLUCTO_DEMO_PORT || 58080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/rss+xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(ROOT, p || 'index.html');
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`fixture server ready: http://127.0.0.1:${PORT}/`);
});
