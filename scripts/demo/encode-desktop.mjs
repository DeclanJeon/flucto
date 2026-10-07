import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const [rawRoot, outputRoot, ffmpeg = 'ffmpeg'] = process.argv.slice(2);
if (!rawRoot || !outputRoot) throw new Error('Usage: node encode-desktop.mjs <capture-root> <output-dir> [ffmpeg]');
const clips = [
  { id: '01-video-download', parts: ['01-published'], posterPart: '01-published', posterFrame: -3 },
  { id: '02-audio-extraction', parts: ['02-published'], posterPart: '02-published', posterFrame: -3 },
  { id: '03-search-and-queue', parts: ['03-published', '03-integrated'], posterPart: '03-published', posterFrame: -3 },
  { id: '04-batch-and-playlist', parts: ['04-complete', '04-playlist'], posterPart: '04-playlist', posterFrame: -3 },
  { id: '05-captions-to-markdown', parts: ['05-complete'], posterPart: '05-complete', posterFrame: 32 },
  { id: '06-settings-and-history', parts: ['06-complete', '06-exact-formats'], posterPart: '06-complete', posterFrame: 20 },
  { id: '07-update-center', parts: ['07-complete'], posterPart: '07-complete', posterFrame: -3 },
];
await fs.mkdir(outputRoot, { recursive: true });
const run = args => new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let error = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', text => { error += text; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${error}`)));
});
const quote = file => file.replaceAll('\\', '/').replaceAll("'", "'\\''");
const summaries = [];
for (const clip of clips) {
  const rows = [];
  const sources = [];
  const hashes = new Set();
  let duration = 0;
  for (const part of clip.parts) {
    const folder = path.resolve(rawRoot, part);
    const capture = JSON.parse(await fs.readFile(path.join(folder, 'capture.json'), 'utf8'));
    if (!capture.completed || capture.captureError || capture.frames < 3) throw new Error(`Incomplete genuine recording: ${part}`);
    let selected = 0;
    for (let i = 0; i < capture.frames; i++) {
      const at = capture.times[i] / 1000;
      // This explicitly removes the long all-sites-search wait. Results and errors stay unchanged.
      if (part === '03-integrated' && at > 5 && at < capture.elapsed / 1000 - 10) continue;
      const file = path.join(folder, `${String(i).padStart(5, '0')}.png`);
      hashes.add(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'));
      const next = capture.times[i + 1] ?? capture.elapsed;
      const dwell = Math.max(0.04, Math.min(1.25, (next - capture.times[i]) / 1000));
      rows.push(`file '${quote(file)}'`, `duration ${dwell.toFixed(4)}`);
      duration += dwell;
      selected++;
    }
    sources.push({ part, source: capture.source, rawFrames: capture.frames, includedFrames: selected, originalDurationMs: capture.elapsed, evidence: capture.evidence });
  }
  if (hashes.size < 3) throw new Error(`Recording has no verified real UI changes: ${clip.id}`);
  const list = path.join(rawRoot, `${clip.id}.ffconcat`);
  await fs.writeFile(list, `ffconcat version 1.0\n${rows.join('\n')}\n`);
  const mp4 = path.join(outputRoot, `${clip.id}.mp4`);
  const gif = path.join(outputRoot, `${clip.id}.gif`);
  const poster = path.join(outputRoot, `${clip.id}.png`);
  await run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=1100:-2:flags=lanczos,fps=12', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  await run(['-i', mp4, '-vf', 'fps=6,scale=1100:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', gif]);
  const posterFolder = path.resolve(rawRoot, clip.posterPart);
  const posterCapture = JSON.parse(await fs.readFile(path.join(posterFolder, 'capture.json'), 'utf8'));
  const posterIndex = clip.posterFrame < 0 ? posterCapture.frames + clip.posterFrame : clip.posterFrame;
  const posterSource = path.join(posterFolder, `${String(posterIndex).padStart(5, '0')}.png`);
  await run(['-i', posterSource, '-vf', 'scale=1100:-2:flags=lanczos', '-frames:v', '1', poster]);
  await run(['-i', mp4, '-f', 'null', '-']);
  await run(['-i', gif, '-f', 'null', '-']);
  const assets = {};
  for (const [kind, file] of Object.entries({ mp4, gif, png: poster })) {
    const bytes = await fs.readFile(file);
    assets[kind] = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }
  const manifest = { id: clip.id, productVersion: '1.18.0', capture: 'Actual Electron UI screenshots from an isolated owned profile; no mock UI, injected results or generated frames.', timing: `Frames remain chronological. Long wait/capture gaps capped at 1.25 seconds.${clip.parts.includes('03-integrated') ? ' The long integrated-search wait is cut.' : ''} Playback is not a speed benchmark.`, sourceRights: 'Media downloads/extraction use an original procedural video and authored WebVTT. Blender search/playlist recordings display public metadata only; no third-party video was downloaded.', durationSeconds: Number(duration.toFixed(2)), distinctCapturedFrames: hashes.size, assets, sources };
  await fs.writeFile(path.join(outputRoot, `${clip.id}.json`), JSON.stringify(manifest, null, 2));
  const summary = { id: clip.id, duration: manifest.durationSeconds, uniqueFrames: hashes.size, gifMiB: Number((assets.gif.bytes / 1048576).toFixed(2)), mp4MiB: Number((assets.mp4.bytes / 1048576).toFixed(2)) };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}
console.log(JSON.stringify({ completed: summaries.length, summaries }));
