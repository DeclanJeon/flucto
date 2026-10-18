import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseCsvWithColumns } from '../dist-electron/main/analysis/csvWriter.js';
import { runCraftAnalysis } from '../dist-electron/main/services/cinematicAnalysis.js';
import { assertAnalysisReferences } from '../dist-electron/main/services/analysisReport.js';
import { createExecutableFixtures } from './executable-fixtures.mjs';

// Orchestration/report-plumbing test only: the fake executables return hard-coded
// probe and signal output; they do not decode/probe input media. The JPEG is an
// SOI/EOI marker with sentinel bytes, not a real decodable image. The mock server
// checks request plumbing, not model behavior or semantic quality.
const API_KEY = 'integration-secret-not-to-persist';
const AUTH = `Bearer ${API_KEY}`;
const JPEG = Buffer.from([0xff, 0xd8, 0x46, 0x4c, 0x55, 0x58, 0xff, 0xd9]);
const VALID_LABELS = JSON.stringify({ shotSize: 'wide', cameraMotion: 'static', subjectKind: 'landscape', confidence: 0.91 });

const createExecutables = (binDir, registerFixture) => {
  const ffmpeg = path.join(binDir, 'ffmpeg');
  const ffprobe = path.join(binDir, 'ffprobe');
  registerFixture(ffprobe);
  registerFixture(ffmpeg);
  // The shared shim executes these fixtures through Node on Windows as well as POSIX.
  fs.writeFileSync(ffprobe, `process.stdout.write(JSON.stringify({streams:[{codec_type:'video',width:64,height:64,avg_frame_rate:'10/1'}],format:{duration:'4'}}));\n`);
  fs.writeFileSync(ffmpeg, `
const args = process.argv.slice(2);
if (args.includes('-f') && args.includes('image2pipe')) {
  const frame = Buffer.from([0xff,0xd8,0x46,0x4c,0x55,0x58,0xff,0xd9]);
  process.stdout.write(Buffer.concat([frame, frame, frame]));
} else if (args.some((arg) => arg.includes("select='gte(scene,"))) {
  process.stdout.write('frame:20 pts:200 pts_time:2.0\\nlavfi.scene_score=0.900000\\n');
} else if (args.some((arg) => arg.includes('lavfi.signalstats.YAVG'))) {
  process.stdout.write('frame:0 pts:0 pts_time:0.0\\nlavfi.signalstats.YAVG=80\\nframe:20 pts:200 pts_time:2.0\\nlavfi.signalstats.YAVG=90\\nframe:39 pts:390 pts_time:3.9\\nlavfi.signalstats.YAVG=100\\n');
}
`);
  return ffmpeg;
};

const startMockOpenAi = async ({ reject = false } = {}) => {
  const calls = { requests: 0, receivedFrames: 0, authFailures: 0 };
  const handlerErrors = [];
  const server = createServer((request, response) => {
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
        assert.equal(request.url, '/v1/chat/completions');
        assert.match(request.headers['content-type'] ?? '', /^application\/json\b/i);
        calls.requests += 1;
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'mock-vision');
        const content = payload.messages[1].content;
        const images = content.filter((part) => part.type === 'image_url');
        calls.receivedFrames += images.length;
        assert.ok(images.length > 0);
        assert.ok(images.every((part) => part.image_url.url === `data:image/jpeg;base64,${JPEG.toString('base64')}`));
        if (reject) {
          response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'private mock rejection' }));
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: VALID_LABELS } }] }));
      } catch (error) {
        handlerErrors.push(error instanceof Error ? error : new Error(String(error)));
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    server, calls, handlerErrors,
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve, rejectClose) => server.close((error) => error ? rejectClose(error) : resolve())),
  };
};

const makeWorkspace = (root, registerFixture) => {
  const binDir = path.join(root, 'bin');
  const craftDir = path.join(root, 'craft');
  const outputDir = path.join(root, 'out');
  fs.mkdirSync(binDir);
  fs.mkdirSync(craftDir);
  fs.mkdirSync(outputDir);
  fs.writeFileSync(path.join(craftDir, 'taxonomy.csv'), 'technique_id,craft_domain,lifecycle_stage,title_ko,title_en,definition,when_to_use,how_to_apply,pitfalls,anchor_terms_ko,anchor_terms_en,signal_hints,source_book,source_locator,evidence_level,taxonomy_version\r\n');
  const videoPath = path.join(root, 'synthetic-input.bin');
  fs.writeFileSync(videoPath, 'synthetic placeholder; fake binaries never decode this file');
  return { ffmpegPath: createExecutables(binDir, registerFixture), videoPath, craftDir, outputDir };
};

const run = (workspace, provider) => runCraftAnalysis({
  videoPath: workspace.videoPath,
  craftDir: workspace.craftDir,
  outputDir: workspace.outputDir,
  sceneThreshold: 0.3,
  budget: { maxFramesPerShot: 3, maxApiCalls: 10 },
  vision: { enabled: true, provider: { provider: 'openai', baseURL: provider.baseURL, model: 'mock-vision', apiKey: API_KEY } },
}, { ffmpegPath: workspace.ffmpegPath });

const readRun = (workspace, outputDir = workspace.outputDir) => {
  const json = JSON.parse(fs.readFileSync(path.join(outputDir, 'analysis.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
  assertAnalysisReferences(json);
  const schema = JSON.parse(fs.readFileSync(new URL('../schemas/analysis-run.v1.schema.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  assert.equal(ajv.validate(schema, json), true, JSON.stringify(ajv.errors));
  return { json, manifest };
};

const runCliProcess = (args, env, cwd) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  let stdout = '';
  let stderr = '';
  let outputTruncated = false;
  const appendBounded = (current, chunk) => {
    const combined = current + chunk;
    if (combined.length <= 1024 * 1024) return combined;
    outputTruncated = true;
    return combined.slice(-1024 * 1024);
  };
  let timedOut = false;
  let termination;
  const terminateTree = () => new Promise((done) => {
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      done();
      return;
    }
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.once('error', () => { child.kill('SIGKILL'); done(); });
    killer.once('close', () => done());
  });
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
  const timer = setTimeout(() => { timedOut = true; termination = terminateTree(); }, 30000);
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('close', async (code, signal) => {
    clearTimeout(timer);
    if (timedOut) await termination;
    resolve({ code, signal, stdout, stderr, outputTruncated });
  });
});

const artifactFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const fullPath = path.join(directory, entry.name);
  return entry.isDirectory() ? artifactFiles(fullPath) : [fullPath];
});

const assertSentinelFixturesNotPersisted = (workspace) => {
  const files = artifactFiles(workspace.outputDir);
  assert.equal(files.some((file) => /(?:frame|\.jpe?g$)/i.test(path.basename(file))), false);
  for (const file of files) {
    const contents = fs.readFileSync(file);
    assert.equal(contents.includes(Buffer.from(API_KEY)), false, `${path.relative(workspace.outputDir, file)} persisted API-key sentinel`);
    assert.equal(contents.includes(Buffer.from(AUTH)), false, `${path.relative(workspace.outputDir, file)} persisted bearer-auth sentinel`);
    assert.equal(contents.includes(JPEG), false, `${path.relative(workspace.outputDir, file)} persisted fake JPEG sentinel bytes`);
  }
};

test('runCraftAnalysis orchestration/report plumbing emits consistent labeled artifacts with request-only sentinel fixtures', async () => {
  const registerFixture = createExecutableFixtures();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-cinematic-integration-'));
  const workspace = makeWorkspace(root, registerFixture);
  const provider = await startMockOpenAi();
  try {
    const result = await run(workspace, provider);
    assert.equal(result.success, true);
    assert.equal(result.shotCount, 2);
    assert.equal(result.labeledShots, 2);
    assert.equal(result.signalOnlyShots, 0);
    assert.equal(result.visionSummary.attemptedModelCalls, 2);
    assert.equal(provider.calls.requests, 2);
    assert.equal(provider.calls.receivedFrames, 6);
    assert.equal(provider.calls.authFailures, 0);
    assert.deepEqual(provider.handlerErrors, []);
    const { json, manifest } = readRun(workspace);
    assert.equal(json.shots.length, 2);
    assert.ok(json.shots.every((shot) => shot.visionOutcome === 'labeled'));
    assert.equal(json.visionSummary.attemptedModelCalls, 2);
    assert.equal(json.visionSummary.externalOnwardTransmission, null);
    assert.equal(manifest.visionSummary.attemptedModelCalls, json.visionSummary.attemptedModelCalls);
    assert.equal(manifest.status, json.status);
    assert.equal(manifest.frameRequestAttempted, true);
    assert.equal(manifest.frameRequestResponseReceived, true);
    assert.equal(manifest.externalOnwardTransmission, null);
    const shots = parseCsvWithColumns(fs.readFileSync(path.join(workspace.outputDir, 'shots.csv'), 'utf8'));
    assert.equal(shots.length, 2);
    assert.deepEqual(shots.map((shot) => shot.shot_id), json.shots.map((shot) => shot.id));
    assert.ok(shots.every((shot) => shot.vision_outcome === 'labeled'));
    assertSentinelFixturesNotPersisted(workspace);
  } finally {
    await provider.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('compiled CLI analyze dispatch honors vision consent and emits structured authenticated reports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-cinematic-cli-process-'));
  const registerFixture = createExecutableFixtures();
  const workspace = makeWorkspace(root, registerFixture);
  const provider = await startMockOpenAi();
  try {
    const preload = path.join(root, 'fake-binary-spawn-loader.mjs');
    fs.writeFileSync(preload, `
import childProcess from 'node:child_process';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const nativeSpawn = childProcess.spawn;
const fakePaths = new Set([process.env.FLUCTO_TEST_FFMPEG_PATH, path.join(path.dirname(process.env.FLUCTO_TEST_FFMPEG_PATH), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')].map((value) => path.resolve(value)));
childProcess.spawn = (file, args = [], options) => fakePaths.has(path.resolve(file))
  ? nativeSpawn(process.execPath, [file, ...args], options)
  : nativeSpawn(file, args, options);
syncBuiltinESMExports();
`);
    const cliEntry = path.resolve('dist-electron/cli/index.js');
    const electronLoader = path.resolve('tests/electron-stub-loader.mjs');
    const baseEnv = {
      ...process.env,
      FLUCTO_TEST_FFMPEG_PATH: workspace.ffmpegPath,
      FLUCTO_VISION_PROVIDER: 'openai',
      FLUCTO_VISION_BASE_URL: provider.baseURL,
      FLUCTO_VISION_API_KEY: API_KEY,
      FLUCTO_VISION_MODEL: 'mock-vision',
    };
    const invoke = async (outputBase, allowVision) => {
      const args = ['--import', electronLoader, '--import', preload, cliEntry, 'analyze', workspace.videoPath,
        '--ffmpeg', workspace.ffmpegPath, '--craft', workspace.craftDir, '--output-dir', outputBase, '--json',
        '--max-api-calls', '10', ...(allowVision ? ['--allow-vision-api'] : [])];
      const processResult = await runCliProcess(args, baseEnv, process.cwd());
      assert.equal(processResult.code, 0, processResult.stderr || processResult.stdout);
      assert.equal(processResult.signal, null);
      assert.equal(processResult.outputTruncated, false, 'CLI output exceeded bounded test capture');
      const report = JSON.parse(processResult.stdout.trim());
      assert.equal(report.success, true, processResult.stdout);
      assert.ok(fs.statSync(report.outputDir).isDirectory());
      return { report, outputDir: report.outputDir };
    };

    const consented = await invoke(path.join(root, 'allowed-output'), true);
    assert.equal(consented.report.labeledShots, 2);
    assert.equal(consented.report.visionSummary.attemptedModelCalls, 2);
    assert.equal(provider.calls.requests, 2);
    assert.equal(provider.calls.receivedFrames, 6);
    assert.equal(provider.calls.authFailures, 0);
    const consentedArtifacts = readRun(workspace, consented.outputDir);
    assert.equal(consentedArtifacts.json.shots.length, 2);
    assert.ok(consentedArtifacts.json.shots.every((shot) => shot.visionOutcome === 'labeled'));
    assert.equal(consentedArtifacts.manifest.status, consentedArtifacts.json.status);
    assertSentinelFixturesNotPersisted({ ...workspace, outputDir: consented.outputDir });

    const denied = await invoke(path.join(root, 'denied-output'), false);
    assert.equal(denied.report.labeledShots, 0);
    assert.equal(denied.report.signalOnlyShots, 2);
    assert.equal(denied.report.visionSummary.attemptedModelCalls, 0);
    assert.equal(provider.calls.requests, 2, 'without --allow-vision-api CLI must make no provider requests');
    assert.equal(provider.calls.requests, 2);
    assert.equal(provider.calls.receivedFrames, 6);
    const deniedArtifacts = readRun(workspace, denied.outputDir);
    assert.ok(deniedArtifacts.json.shots.every((shot) => shot.visionOutcome === 'not-requested'));
    assert.equal(deniedArtifacts.manifest.status, deniedArtifacts.json.status);
    assertSentinelFixturesNotPersisted({ ...workspace, outputDir: denied.outputDir });
    assert.deepEqual(provider.handlerErrors, []);
  } finally {
    await provider.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCraftAnalysis aborts on provider HTTP 403 and reports partial orchestration consistently', async () => {
  const registerFixture = createExecutableFixtures();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-cinematic-rejected-'));
  const workspace = makeWorkspace(root, registerFixture);
  const provider = await startMockOpenAi({ reject: true });
  try {
    const result = await run(workspace, provider);
    assert.equal(result.success, true);
    assert.equal(result.shotCount, 2);
    assert.equal(result.labeledShots, 0);
    assert.equal(result.signalOnlyShots, 2);
    assert.equal(result.visionSummary.attemptedModelCalls, 1);
    assert.equal(provider.calls.requests, 1);
    assert.equal(provider.calls.receivedFrames, 3);
    assert.equal(provider.calls.authFailures, 0);
    assert.deepEqual(provider.handlerErrors, []);
    const { json, manifest } = readRun(workspace);
    assert.equal(json.status, 'partial');
    assert.equal(manifest.status, json.status);
    assert.equal(json.visionSummary.attemptedModelCalls, 1);
    assert.equal(json.visionSummary.externalOnwardTransmission, null);
    assert.equal(manifest.visionSummary.attemptedModelCalls, 1);
    assert.equal(manifest.externalOnwardTransmission, null);
    assert.equal(json.shots[0].visionFailureCode, 'provider-rejected');
    assert.equal(json.shots[0].visionOutcome, 'request-failed');
    assert.equal(json.shots[1].visionOutcome, 'skipped');
    assert.deepEqual(json.visionSummary.partialReasons, ['provider-rejected', 'skipped']);
    const shots = parseCsvWithColumns(fs.readFileSync(path.join(workspace.outputDir, 'shots.csv'), 'utf8'));
    assert.equal(shots.length, 2);
    assert.equal(shots[0].vision_failure_code, 'provider-rejected');
    assert.equal(shots[1].vision_outcome, 'skipped');
    assertSentinelFixturesNotPersisted(workspace);
  } finally {
    await provider.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
