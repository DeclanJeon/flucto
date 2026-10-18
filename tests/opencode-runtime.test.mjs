import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { startOpenCodeRuntime } from '../dist-electron/main/services/openCodeRuntime.js';

const waitGone = async (pid) => {
  for (let i = 0; i < 50; i += 1) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`process ${pid} did not terminate`);
};

test('managed runtime passes per-run credentials to a controlled auth server and awaited close removes isolated state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-opencode-test-'));
  const script = path.join(root, 'fake-server.cjs');
  const pidFile = path.join(root, 'child.pid');
  const argvFile = path.join(root, 'child.argv');
  fs.writeFileSync(script, `
const http = require('node:http');
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv));
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const auth = 'Basic ' + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ':' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
http.createServer((req,res) => {
  if (req.headers.authorization !== auth) { res.writeHead(401).end(); return; }
  if (req.url === '/provider') { res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({all:[]})); return; }
  res.writeHead(404).end();
}).listen(port, '127.0.0.1');
`);
  const runtime = await startOpenCodeRuntime(undefined, {
    binaryPath: process.execPath,
    tempRoot: root,
    spawnProcess: (_binary, args, options) => spawn(process.execPath, [script, ...args], options),
    startupTimeoutMs: 5000,
    shutdownGraceMs: 500,
  });
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  try {
    const unauthenticated = await fetch(`${runtime.baseURL}/provider`);
    assert.equal(unauthenticated.status, 401);
    const runtimeAuth = `Basic ${Buffer.from(`${runtime.username}:${runtime.password}`).toString('base64')}`;
    const authenticated = await fetch(`${runtime.baseURL}/provider`, { headers: { authorization: runtimeAuth } });
    assert.equal(authenticated.status, 200);
    assert.deepEqual(await authenticated.json(), { all: [] });
  } finally {
    const firstClose = runtime.close();
    assert.equal(runtime.close(), firstClose);
    await firstClose;
  }
  await waitGone(pid);
  assert.deepEqual(fs.readdirSync(root).sort(), ['child.argv', 'child.pid', 'fake-server.cjs']);
  const childArgv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
  assert.equal(childArgv.includes(runtime.password), false);
  assert.equal(childArgv.includes(runtime.username), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('startup timeout escalates to forced termination and removes isolated storage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-opencode-timeout-'));
  const script = path.join(root, 'stalled-server.cjs');
  const pidFile = path.join(root, 'child.pid');
  fs.writeFileSync(script, `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
  try {
    await assert.rejects(startOpenCodeRuntime(undefined, {
      binaryPath: process.execPath,
      tempRoot: root,
      spawnProcess: (_binary, args, options) => spawn(process.execPath, [script, ...args], options),
      startupTimeoutMs: 1000,
      shutdownGraceMs: 100,
    }), /Could not start the bundled OpenCode service/);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await waitGone(pid);
    assert.deepEqual(fs.readdirSync(root).sort(), ['child.pid', 'stalled-server.cjs']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('startup spawn failure removes isolated directory and rejects without leaking details', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-opencode-failure-'));
  try {
    await assert.rejects(startOpenCodeRuntime(undefined, {
      binaryPath: path.join(root, 'missing-binary'),
      tempRoot: root,
      startupTimeoutMs: 1000,
      shutdownGraceMs: 100,
    }), /Could not start the bundled OpenCode service/);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
