import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { assertAnalysisReferences } from '../dist-electron/main/services/analysisReport.js';
import { resolveFfprobePath } from '../dist-electron/main/analysis/avCommands.js';
import { setupUtilities } from '../dist-electron/main/services/binaryInstaller.js';
import { extractAvMember } from '../scripts/setup-binaries.mjs';

const configuredFfmpegPath = process.env.FLUCTO_TEST_FFMPEG?.trim();
const avArchivePath = process.env.FLUCTO_TEST_AV_ARCHIVE?.trim();
const execFileAsync = promisify(execFile);
const USER = 'real-av-local-smoke';
const PASSWORD = 'local-only-secret-sentinel';
const AUTH = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
const LABELS = JSON.stringify({
  shotSize: 'medium', cameraMotion: 'static', cameraAxis: 'eye-level', lightingType: 'natural',
  palette: 'warm', composition: 'centered', subjectKind: 'abstract-pattern',
  narrativeFunctionGuess: 'demonstration', transitionGuess: null,
  actionPhaseSummary: 'synthetic test pattern', confidence: 0.88,
});

const runCli = (args, env, cwd) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  let truncated = false;
  const append = (current, chunk) => {
    const combined = current + chunk;
    if (combined.length <= 1024 * 1024) return combined;
    truncated = true;
    return combined.slice(-1024 * 1024);
  };
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = append(stderr, chunk); });
  const timer = setTimeout(() => {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  }, 60000);
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('close', (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal, stdout, stderr, truncated });
  });
});

test('real FFmpeg/FFprobe decode media and CLI reports consented frames to a local mock only', {
  skip: configuredFfmpegPath || avArchivePath ? false : 'Set FLUCTO_TEST_FFMPEG or FLUCTO_TEST_AV_ARCHIVE to run the real-media smoke.',
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-real-av-cli-'));
  let ffmpegPath = configuredFfmpegPath;
  let server;
  const calls = { sessions: 0, messages: 0, frames: 0, authFailures: 0 };
  const serverErrors = [];
  try {
    if (avArchivePath) {
      const managedBin = path.join(root, 'managed-bin');
      const archiveBytes = fs.readFileSync(avArchivePath);
      let fetchCount = 0;
      const installed = await setupUtilities({
        binDir: managedBin,
        only: ['ffmpeg', 'ffprobe'],
        env: {},
        cwd: root,
        fetchImpl: async () => { fetchCount += 1; return new Response(archiveBytes, { status: 200 }); },
      });
      assert.equal(installed.valid, true, JSON.stringify(installed.utilities));
      assert.equal(fetchCount, 1, 'same Linux archive must be downloaded only once for both executables');
      fs.rmSync(managedBin, { recursive: true, force: true });
      const packageBin = path.join(root, 'package-bin');
      fs.mkdirSync(packageBin);
      const decompressedTarCache = new Map();
      ffmpegPath = path.join(packageBin, 'ffmpeg');
      const packagedFfprobePath = path.join(packageBin, 'ffprobe');
      await extractAvMember(avArchivePath, 'ffmpeg', ffmpegPath, decompressedTarCache);
      await extractAvMember(avArchivePath, 'ffprobe', packagedFfprobePath, decompressedTarCache);
      fs.chmodSync(ffmpegPath, 0o755);
      fs.chmodSync(packagedFfprobePath, 0o755);
      assert.equal(decompressedTarCache.size, 1, 'package setup should reuse one expanded TAR for the pair');
      assert.equal(fs.existsSync(decompressedTarCache.get(avArchivePath)), true);
    }
    assert.ok(ffmpegPath && fs.existsSync(ffmpegPath), `FFmpeg missing: ${ffmpegPath}`);
    const ffprobePath = resolveFfprobePath(ffmpegPath);
    assert.ok(fs.existsSync(ffprobePath), `FFprobe must be next to FFmpeg: ${ffprobePath}`);
    const [ffmpegVersion, ffprobeVersion] = await Promise.all([
      execFileAsync(ffmpegPath, ['-version'], { timeout: 20000 }),
      execFileAsync(ffprobePath, ['-version'], { timeout: 20000 }),
    ]);
    const identity = (text) => text.match(/version ([^ ]+)/)?.[1] ?? null;
    assert.ok(identity(ffmpegVersion.stdout));
    assert.equal(identity(ffmpegVersion.stdout), identity(ffprobeVersion.stdout), 'FFmpeg/FFprobe versions must match');

    const videoPath = path.join(root, 'synthetic.mp4');
    await execFileAsync(ffmpegPath, [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=4',
      '-t', '4', '-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p', videoPath,
    ], { timeout: 60000 });
    const probe = JSON.parse((await execFileAsync(ffprobePath, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', videoPath,
    ], { timeout: 20000 })).stdout);
    assert.ok(Number(probe.format?.duration) >= 3.9);
    assert.ok(probe.streams?.some((stream) => stream.codec_type === 'video'));

    server = createServer((request, response) => {
      void (async () => {
        try {
          let body = '';
          for await (const chunk of request) body += chunk;
          if (request.headers.authorization !== AUTH) {
            calls.authFailures += 1;
            response.writeHead(401).end();
            return;
          }
          assert.equal(request.method, 'POST');
          const payload = JSON.parse(body);
          if (request.url === '/session') {
            calls.sessions += 1;
            response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'real-av-local' }));
            return;
          }
          if (request.url === '/session/real-av-local/message') {
            calls.messages += 1;
            assert.deepEqual(payload.model, { providerID: 'opencode', modelID: 'mock-vision' });
            for (const part of payload.parts ?? []) {
              if (part.type !== 'file') continue;
              calls.frames += 1;
              assert.equal(part.mime, 'image/jpeg');
              assert.match(part.url, /^data:image\/jpeg;base64,/);
              const frame = Buffer.from(part.url.split(',')[1], 'base64');
              assert.equal(frame[0], 0xff, 'frame has JPEG SOI marker');
              assert.equal(frame[1], 0xd8);
              assert.equal(frame.at(-2), 0xff, 'frame has JPEG EOI marker');
              assert.equal(frame.at(-1), 0xd9);
            }
            response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ parts: [{ type: 'text', text: LABELS }] }));
            return;
          }
          response.writeHead(404).end();
        } catch (error) {
          serverErrors.push(error instanceof Error ? error.message : String(error));
          if (!response.headersSent) response.writeHead(500);
          response.end();
        }
      })();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const craftDir = path.join(root, 'craft');
    fs.mkdirSync(craftDir);
    fs.writeFileSync(path.join(craftDir, 'taxonomy.csv'), 'technique_id,craft_domain,lifecycle_stage,title_ko,title_en,definition,when_to_use,how_to_apply,pitfalls,anchor_terms_ko,anchor_terms_en,signal_hints,source_book,source_locator,evidence_level,taxonomy_version\n');
    const outputBase = path.join(root, 'output');
    const env = {
      PATH: process.env.PATH,
      HOME: root,
      USERPROFILE: root,
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_DATA_HOME: path.join(root, 'data'),
      XDG_CACHE_HOME: path.join(root, 'cache'),
      FLUCTO_VISION_PROVIDER: 'opencode-local',
      FLUCTO_VISION_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      FLUCTO_VISION_MODEL: 'mock-vision',
      FLUCTO_OPENCODE_SERVER_USERNAME: USER,
      FLUCTO_OPENCODE_SERVER_PASSWORD: PASSWORD,
    };
    const cli = path.resolve('dist-electron/cli/index.js');
    const loader = path.resolve('tests/electron-stub-loader.mjs');
    const result = await runCli([
      '--import', loader, cli, 'analyze', videoPath,
      '--ffmpeg', ffmpegPath, '--craft', craftDir, '--output-dir', outputBase, '--json',
      '--allow-vision-api', '--max-frames-per-shot', '2', '--max-api-calls', '2',
    ], env, process.cwd());
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.signal, null);
    assert.equal(result.truncated, false);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.success, true, result.stdout);
    assert.ok(report.labeledShots >= 1, JSON.stringify(report));
    assert.equal(calls.sessions, 1);
    assert.equal(calls.messages, 1);
    assert.ok(calls.frames >= 1);
    assert.equal(calls.authFailures, 0);
    assert.deepEqual(serverErrors, []);

    const reportDir = report.outputDir;
    const analysis = JSON.parse(fs.readFileSync(path.join(reportDir, 'analysis.json'), 'utf8'));
    assertAnalysisReferences(analysis);
    const schema = JSON.parse(fs.readFileSync(new URL('../schemas/analysis-run.v1.schema.json', import.meta.url), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    assert.equal(ajv.validate(schema, analysis), true, JSON.stringify(ajv.errors));
    assert.equal(analysis.visionSummary.localServerFrameRequestAttempted, true);
    assert.equal(analysis.visionSummary.externalOnwardTransmission, null);
    assert.ok(analysis.shots.some((shot) => shot.visionOutcome === 'labeled'));
    const files = fs.readdirSync(reportDir);
    assert.ok(files.includes('shots.csv') && files.includes('manifest.json'));
    for (const name of files) {
      const filePath = path.join(reportDir, name);
      if (!fs.statSync(filePath).isFile()) continue;
      const bytes = fs.readFileSync(filePath);
      assert.equal(bytes.includes(Buffer.from(PASSWORD)), false, `${name} persisted the password sentinel`);
      assert.equal(/\.jpe?g$/i.test(name), false, `${name} persisted a frame image`);
    }
    assert.equal(analysis.status, 'partial', 'onward transmission through the local mock is intentionally unknown');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
