// Renders a captured CLI transcript into a terminal-styled MP4/GIF/PNG.
// The transcript is REAL captured stdout/stderr (see capture-transcript.mjs);
// this only replays it in a styled viewer labeled "actual CLI output".
//
// Usage:
//   node scripts/demo/render-transcript.mjs --id 08-cli-inspect
//     [--speed F]            divide all frame durations by F (honest time compression; labeled)
//     [--minDwell MS]        min hold per state (default 350)
//     [--hold S]             end-card hold (default 3)
//     [--poster S]           poster frame time in final mp4 (default 40%)
//     [--titlebar 0|1]       draw fake window chrome bar (default 1)
// Outputs: assets/demo/features/<id>.{mp4,gif,png} + updates captures/<id>.capture.json
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CAP_DIR = join(HERE, 'captures');
const OUT_DIR = join(REPO, 'assets', 'demo', 'features');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTH = 1040;
const ROWS = 20;
const LINE_H = 26;
const PAD = 14;
const HEADER_H = 44;
const HEIGHT = HEADER_H + PAD * 2 + ROWS * LINE_H; // 622

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const k = process.argv[i];
  if (k.startsWith('--')) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[k.slice(2)] = next; i += 1; }
    else args[k.slice(2)] = true;
  }
}
const ID = args.id;
const SPEED = Number(args.speed || 1);
const MIN_DWELL = Number(args.minDwell || 350) / 1000;
const HOLD = Number(args.hold || 3);
const T_JSON = join(CAP_DIR, `${ID}.transcript.json`);
if (!ID || !existsSync(T_JSON)) { console.error(`missing transcript ${T_JSON}`); process.exit(2); }
mkdirSync(OUT_DIR, { recursive: true });
const transcript = JSON.parse(readFileSync(T_JSON, 'utf8'));

// ---------- console simulation ----------
const COLORS = {
  51: '#22e6e6', 75: '#5fafff', 141: '#af87ff', 84: '#5fff87', 221: '#ffd75f',
  203: '#ff5f5f', 255: '#ffffff', 245: '#9aa4ae', 177: '#d787ff',
};
const DEF_FG = '#d6dde3';
const cursorBlock = '<span class="cur">▌</span>';

function simulate(events) {
  const lines = [];                 // finished rows: array of cells [{t,cls,c}]
  let cur = [];                     // current row cells
  let col = 0;
  let fg = '', cls = '';
  const put = (ch) => {
    cur[col] = { t: ch, cls, c: fg };
    col += 1;
  };
  const states = [];
  for (const ev of events) {
    const data = ev.data;
    let i = 0;
    while (i < data.length) {
      const c = data[i];
      if (c === '\x1b') {
        const m = data.slice(i).match(/^\x1b\[([0-9;?]*)([a-zA-Z])/);
        if (m) {
          const params = m[1], code = m[2];
          if (code === 'm') {
            for (const p of params.split(';')) {
              if (p === '0' || p === '') { fg = ''; cls = ''; }
              else if (p === '1') cls = 'b';
              else if (p === '2') cls = 'dim';
              else if (p === '3') cls = 'it';
              else if (p === '22') cls = '';
              else if (p === '23') cls = '';
              else if (p === '39') fg = '';
            }
            if (params.startsWith('38;5;')) fg = COLORS[+params.split(';')[2]] || fg;
          } else if (code === 'J' && (params === '2' || params === '')) {
            lines.length = 0; cur = []; col = 0;
          } else if (code === 'K') {
            cur = []; col = 0;
          }
          i += m[0].length;
          continue;
        }
        i += 1;
        continue;
      }
      if (c === '\f') { lines.length = 0; cur = []; col = 0; i += 1; continue; }
      if (c === '\r') { col = 0; i += 1; continue; }              // carriage return: back to col 0, keep text
      if (c === '\n') { lines.push(trimRow(cur)); cur = []; col = 0; i += 1; continue; }
      put(c);
      i += 1;
    }
    states.push({ t: ev.t, view: [...lines, trimRow(cur)] });
  }
  return states;
}
function trimRow(cells) {
  const out = cells.slice();
  while (out.length && (out[out.length - 1].t === ' ' || out[out.length - 1].t === '')) out.pop();
  return out;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rowHtml = (cells) => {
  if (!cells.length) return '<div class="row">&nbsp;</div>';
  // merge consecutive cells with same style
  const spans = [];
  for (const cell of cells) {
    const last = spans[spans.length - 1];
    if (last && last.cls === cell.cls && last.c === cell.c) last.t += cell.t;
    else spans.push({ t: cell.t, cls: cell.cls, c: cell.c });
  }
  return '<div class="row">' + spans.map((s) =>
    `<span class="${s.cls}"${s.c ? ` style="color:${s.c}"` : ''}>${esc(s.t)}</span>`).join('') + '</div>';
};
const states = simulate(transcript.events);
// merge states closer than MIN_DWELL into the later one (keep earlier timestamp for dwell)
const frames = [];
for (const s of states) {
  if (frames.length && (s.t - frames[frames.length - 1].t) / 1000 < MIN_DWELL) {
    frames[frames.length - 1] = { ...s, t: frames[frames.length - 1].t };
  } else frames.push(s);
}
// per-range speed: --time "a:b:F,..." uses source-time (seconds) boundaries;
// frames whose dwell midpoint falls inside a range get that factor.
const RANGES = (args.time || '').split(',').filter(Boolean).map((s) => {
  const [a, b, f] = s.split(':').map(Number);
  return { from: a * 1000, to: b * 1000, factor: f || 1 };
});
const speedAt = (t) => (RANGES.find((r) => t >= r.from && t < r.to)?.factor ?? SPEED);
const speedRanges = [];
for (let i = 0; i < frames.length; i += 1) {
  const next = i + 1 < frames.length ? frames[i + 1].t : transcript.wallMs + HOLD * 1000 * SPEED;
  const f = speedAt(frames[i].t);
  frames[i].dur = Math.max(0.08, (next - frames[i].t) / 1000 / f);
  if (f > 1) speedRanges.push(f);
}
const maxFactor = Math.max(...speedRanges, 1);


// ---------- viewer html ----------
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; box-sizing:border-box; }
  body { width:${WIDTH}px; height:${HEIGHT}px; background:#0a0f1c; font-family:'Cascadia Mono','Malgun Gothic',monospace; }
  .bar { height:${HEADER_H}px; display:flex; align-items:center; gap:10px; padding:0 16px;
         background:#0e1626; border-bottom:1px solid #1c2a44; color:#8fa3bd; font-size:15px; }
  .dot { width:11px; height:11px; border-radius:50%; }
  .tag { margin-left:auto; font-size:12.5px; color:#56d8d8; letter-spacing:.2px; }
  .screen { padding:${PAD}px 16px; height:${HEIGHT - HEADER_H}px; overflow:hidden; }
  .row { font-size:18.5px; line-height:${LINE_H}px; white-space:pre-wrap; word-break:break-all;
         color:${DEF_FG}; min-height:${LINE_H}px; }
  .b { font-weight:700 } .dim { opacity:.55 } .it { font-style:italic }
  .cur { color:#22e6e6; animation:none; }
</style></head><body>
<div class="bar">
  <span class="dot" style="background:#ff5f57"></span>
  <span class="dot" style="background:#febc2e"></span>
  <span class="dot" style="background:#28c840"></span>
  <span id="winTitle">cmd.exe — flucto</span>
  <span class="tag">actual CLI output · Flucto 1.18.0</span>
</div>
<div class="screen" id="s"></div>
<script>
window.__set = function (rows) {
  document.getElementById('s').innerHTML = rows;
};
</script></body></html>`;
const htmlPath = join(CAP_DIR, `${ID}.viewer.html`);
writeFileSync(htmlPath, html);

// ---------- drive chrome via CDP ----------
const port = 9333 + Math.floor(Math.random() * 200);
const profile = join(CAP_DIR, `${ID}.chrome-profile-${Date.now().toString(36)}`);
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  '--hide-scrollbars', '--force-device-scale-factor=1', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`,
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 40; i += 1) {
  await sleep(400);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && t.url.includes('viewer.html'));
    if (page) break;
  } catch {}
}
if (!page) { chrome.kill(); console.error('chrome target not found'); process.exit(5); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const cdp = (method, params = {}) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

const framesDir = join(CAP_DIR, `${ID}.frames`);
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
let f = 0;
for (const st of frames) {
  const visible = st.view.slice(-ROWS);
  const htmlRows = visible.map(rowHtml).join('');
  // cursor at end of last row
  const done = st === frames[frames.length - 1];
  await cdp('Runtime.evaluate', { expression: `__set(${JSON.stringify(htmlRows)} + ${done ? JSON.stringify('<div class="row">' + cursorBlock + '</div>') : '""'})` });
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(framesDir, `f${String(f).padStart(4, '0')}.png`), Buffer.from(shot.result.data, 'base64'));
  st.frame = f;
  f += 1;
}
ws.close();
chrome.kill();
await new Promise((r) => { chrome.on('exit', r); setTimeout(r, 3000); });
// profile cleanup is best-effort (chrome may still hold locks briefly)
spawn('cmd', ['/c', 'ping', '-n', '8', '127.0.0.1', '>nul', '&', 'rd', '/s', '/q', `"${profile}"`], { detached: true, stdio: 'ignore' }).unref();

// ---------- assemble ----------
const listPath = join(CAP_DIR, `${ID}.concat.txt`);
writeFileSync(listPath, frames.map((s, i) =>
  `file '${framesDir.replace(/\\/g, '/')}/f${String(i).padStart(4, '0')}.png'\nduration ${s.dur.toFixed(3)}`
).join('\n') + `\nfile '${framesDir.replace(/\\/g, '/')}/f${String(frames.length - 1).padStart(4, '0')}.png'\n`);

const mp4Path = join(OUT_DIR, `${ID}.mp4`);
const gifPath = join(OUT_DIR, `${ID}.gif`);
const pngPath = join(OUT_DIR, `${ID}.png`);
rmSync(mp4Path, { force: true }); rmSync(gifPath, { force: true }); rmSync(pngPath, { force: true });

const badge = maxFactor > 1
  ? `,drawtext=text='time-compressed (up to ${maxFactor}x)':fontfile='C\\:/Windows/Fonts/consola.ttf':fontsize=22:fontcolor=white@0.85:borderw=2:bordercolor=black@0.6:x=w-tw-16:y=50`
  : '';
execFileSync('ffmpeg', ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
  '-vf', `fps=30${badge}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow',
  '-movflags', '+faststart', mp4Path], { stdio: 'inherit' });

const probe = (p) => JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries',
  'format=duration,size:stream=codec_name,width,height,nb_frames,avg_frame_rate',
  '-of', 'json', p], { encoding: 'utf8' }));
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const GIFFPS = 10;
const palPath = join(CAP_DIR, `${ID}.palette.png`);
execFileSync('ffmpeg', ['-hide_banner', '-y', '-i', mp4Path, '-vf', `fps=${GIFFPS},palettegen=stats_mode=diff`, palPath], { stdio: 'ignore' });
execFileSync('ffmpeg', ['-hide_banner', '-y', '-i', mp4Path, '-i', palPath,
  '-filter_complex', `fps=${GIFFPS},paletteuse=dither=none:diff_mode=rectangle`, gifPath], { stdio: 'ignore' });
if (statSync(gifPath).size > 5 * 1024 * 1024) {
  execFileSync('ffmpeg', ['-hide_banner', '-y', '-i', mp4Path, '-vf', 'fps=7,palettegen=stats_mode=diff', palPath], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-hide_banner', '-y', '-i', mp4Path, '-i', palPath,
    '-filter_complex', 'fps=7,paletteuse=dither=none:diff_mode=rectangle', gifPath], { stdio: 'ignore' });
}
const dur = Number(probe(mp4Path).format.duration);
execFileSync('ffmpeg', ['-hide_banner', '-y', '-ss', String(Number(args.poster ?? Math.max(0.5, dur * 0.4))), '-i', mp4Path, '-vframes', '1', pngPath], { stdio: 'ignore' });

const metaPath = join(CAP_DIR, `${ID}.capture.json`);
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
Object.assign(meta, {
  renderedAt: new Date().toISOString(),
  method: 'deterministic replay of real captured stdout/stderr (capture-transcript.mjs) rendered as terminal-styled viewer via headless Chrome; labeled "actual CLI output"',
  speed: SPEED,
  frameCount: frames.length,
  transcript: T_JSON,
  outputs: {
    mp4: { path: mp4Path, sha256: sha256(mp4Path), ...probe(mp4Path) },
    gif: { path: gifPath, sha256: sha256(gifPath), ...probe(gifPath) },
    png: { path: pngPath, sha256: sha256(pngPath) },
  },
});
writeFileSync(metaPath, JSON.stringify(meta, null, 2));
console.log(JSON.stringify({
  id: ID, frames: f, dur,
  mp4KB: Math.round(statSync(mp4Path).size / 1024),
  gifKB: Math.round(statSync(gifPath).size / 1024),
}, null, 1));
