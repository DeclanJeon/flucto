// Captures a demo .cmd script's REAL stdout/stderr with timestamps.
// Runs `cmd /c <script>` in a hidden process (no window needed), FORCE_COLOR=1 so
// the CLI emits its true ANSI styling. Produces:
//   captures/<id>.transcript.json  — [{t, stream, data}] chunk events, exits, env
//   captures/<id>.transcript.log   — plain-text combined log (ANSI stripped)
// Usage: node scripts/demo/capture-transcript.mjs --id 08-cli-inspect --script tmp/demos/demo-08.cmd [--env A=B,...]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAP_DIR = join(HERE, 'captures');
mkdirSync(CAP_DIR, { recursive: true });

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
const SCRIPT = args.script ? resolve(args.script) : null;
if (!ID || !SCRIPT || !existsSync(SCRIPT)) { console.error('usage: --id <name> --script <cmd-file>'); process.exit(2); }

const extraEnv = {};
for (const kv of (args.env || '').split(',').filter(Boolean)) {
  const eq = kv.indexOf('=');
  extraEnv[kv.slice(0, eq)] = kv.slice(eq + 1);
}
const env = {
  ...process.env,
  FORCE_COLOR: '1',
  FLUCTO_DEMO_TRANSCRIPT: '1',
  ...extraEnv,
};
delete env.NO_COLOR;

const events = [];
const t0 = Date.now();
const mark = (stream, data) => events.push({ t: Date.now() - t0, stream, data });

const proc = spawn('cmd.exe', ['/c', SCRIPT], { env, windowsHide: true });
proc.stdout.on('data', (d) => mark('out', d.toString('utf8')));
proc.stderr.on('data', (d) => mark('err', d.toString('utf8')));

const exitCode = await new Promise((res) => proc.on('exit', res));
const wallMs = Date.now() - t0;

const jsonPath = join(CAP_DIR, `${ID}.transcript.json`);
const logPath = join(CAP_DIR, `${ID}.transcript.log`);
const transcript = {
  id: ID,
  script: SCRIPT,
  capturedAt: new Date(t0).toISOString(),
  wallMs,
  exitCode,
  envNote: 'cmd /c, FORCE_COLOR=1 (real CLI ANSI output), hidden process — no synthetic content',
  scriptSha256: createHash('sha256').update(readFileSync(SCRIPT)).digest('hex'),
  events,
};
writeFileSync(jsonPath, JSON.stringify(transcript, null, 1));
const ansi = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;
const plain = events.map((e) => `[${(e.t / 1000).toFixed(2)}s ${e.stream}] ${e.data}`).join('').replace(ansi, '');
writeFileSync(logPath, plain);
console.log(`captured ${events.length} events, ${wallMs}ms, exit=${exitCode} -> ${jsonPath}`);
