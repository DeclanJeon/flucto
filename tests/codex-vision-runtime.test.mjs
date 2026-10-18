import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listCodexVisionModels, requestCodexVisionLabels } from '../dist-electron/main/services/codexVisionRuntime.js';
import { labelShotFrames } from '../dist-electron/main/services/visionProvider.js';
import { writeStructuredAnalysisReport, assertAnalysisReferences } from '../dist-electron/main/services/analysisReport.js';

const completion = JSON.stringify({
  shotSize: 'medium', cameraMotion: 'static', cameraAxis: 'eye-level', lightingType: 'natural',
  palette: 'warm', composition: 'centered', subjectKind: 'abstract-pattern',
  narrativeFunctionGuess: 'demonstration', transitionGuess: null,
  actionPhaseSummary: 'synthetic frame', confidence: 0.88,
});
const signals = { cutScoreMax: 0.2, lumaMean: 100, lumaStddev: 4, brightnessTrend: 0 };

const createMockAppServer = (options = {}) => {
  const requests = [];
  let turnId = 0;
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.pid = 1234;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          const request = JSON.parse(line);
          requests.push(request);
          if (request.id === undefined) continue;
          const respond = (result) => child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
          if (request.method === 'initialize') respond({ userAgent: 'codex-cli-test' });
          else if (request.method === 'model/list') respond({ data: [
            { id: 'gpt-codex-text', model: 'gpt-codex-text', displayName: 'Text only', inputModalities: ['text'] },
            { id: 'gpt-codex-vision', model: 'gpt-codex-vision', displayName: 'Vision', description: 'Image-capable', inputModalities: ['text', 'image'], defaultReasoningEffort: 'medium' },
          ], nextCursor: null });
          else if (request.method === 'thread/start') respond({ thread: { id: 'ephemeral-test-thread' } });
          else if (request.method === 'turn/start') {
            if (options.rejectTurn) {
              child.stdout.write(`${JSON.stringify({ id: request.id, error: { code: -32602, message: 'invalid params' } })}\n`);
            } else {
              turnId += 1;
              respond({ turn: { id: `turn-${turnId}`, status: 'inProgress' } });
              child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
                threadId: 'ephemeral-test-thread',
                turn: { id: `turn-${turnId}`, status: 'completed', items: [{ type: 'agentMessage', text: completion }] },
              } })}\n`);
            }
          } else child.stdout.write(`${JSON.stringify({ id: request.id, error: { code: -32601, message: 'unknown method' } })}\n`);
        }
        callback();
      },
      final(callback) { setImmediate(() => child.emit('close', 0, null)); callback(); },
    });
    child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGKILL')); return true; };
    return child;
  };
  return { requests, spawnProcess };
};

const codexConfig = { provider: 'codex-cli', baseURL: '', model: 'gpt-codex-vision', apiKey: '' };
const frames = [{ base64: '/9j/2Q==', mime: 'image/jpeg' }];

test('Codex app-server model discovery filters for image input without an inference request', async () => {
  const mock = createMockAppServer();
  const models = await listCodexVisionModels({ spawnProcess: mock.spawnProcess });
  assert.deepEqual(models.map((model) => model.id), ['gpt-codex-vision']);
  assert.equal(mock.requests.some((request) => request.method === 'turn/start'), false);
  assert.equal(mock.requests.some((request) => request.method === 'model/list'), true);
});

test('Codex provider sends in-memory image data URLs to an ephemeral read-only turn and parses labels', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-codex-test-'));
  const mock = createMockAppServer();
  const requestState = { frameRequested: false, responseReceived: false };
  const counter = {
    used: 0,
    limit: 1,
    onFrameRequest: (destination) => { assert.equal(destination, 'codex-cli'); requestState.frameRequested = true; },
    onFrameResponseReceived: () => { requestState.responseReceived = true; },
  };
  try {
    const result = await labelShotFrames(codexConfig, frames, signals, counter, undefined, { spawnProcess: mock.spawnProcess, tempRoot });
    assert.equal(result.labels?.shotSize, 'medium');
    assert.equal(result.labels?.confidence, 0.88);
    assert.equal(result.apiCallsUsed, 1);
    assert.equal(counter.used, 1);
    assert.equal(requestState.frameRequested, true);
    assert.equal(requestState.responseReceived, true);
    const thread = mock.requests.find((request) => request.method === 'thread/start');
    assert.equal(thread.params.ephemeral, true);
    assert.equal(thread.params.sandbox, 'read-only');
    assert.equal(thread.params.approvalPolicy, 'never');
    const turn = mock.requests.find((request) => request.method === 'turn/start');
    assert.deepEqual(turn.params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    assert.equal(turn.params.input[1].type, 'image');
    assert.equal(turn.params.input[1].url, 'data:image/jpeg;base64,/9j/2Q==');
    assert.equal(turn.params.outputSchema.required.includes('confidence'), true);
    assert.deepEqual(fs.readdirSync(tempRoot), [], 'Codex scratch directory must be removed after request');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Codex failed turn attempts are counted and provider details are not surfaced', async () => {
  const mock = createMockAppServer({ rejectTurn: true });
  const counter = { used: 0, limit: 1 };
  await assert.rejects(
    labelShotFrames(codexConfig, frames, signals, counter, undefined, { spawnProcess: mock.spawnProcess }),
    (error) => error.code === 'provider-unavailable' && !error.message.includes('invalid params'),
  );
  assert.equal(counter.used, 1);
  assert.equal(mock.requests.filter((request) => request.method === 'turn/start').length, 1);
});

test('Codex report keeps external onward transmission unknown when response is not observable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-codex-report-'));
  try {
    const craftDir = path.join(root, 'craft');
    const outputDir = path.join(root, 'output');
    fs.mkdirSync(craftDir);
    fs.mkdirSync(outputDir);
    const videoPath = path.join(root, 'local.mp4');
    fs.writeFileSync(videoPath, 'synthetic-reference');
    const observation = {
      videoPath, videoName: 'local.mp4', shotId: 'S001', sceneId: 'SC001', index: 0,
      startS: 0, endS: 2, durationS: 2, startTimecode: '00:00:00.000', endTimecode: '00:00:02.000',
      cutType: 'UNKNOWN', signals: { motion: 0, cutScoreMax: 0, lumaMean: 0, lumaStddev: 0, brightnessTrend: 0, audioRmsMean: null, silenceRatio: null },
      labels: {}, matchedTechniqueIds: [], matchedEvidence: [], unmatchedAnchors: [], analysisStatus: 'signal-only',
      visionOutcome: 'request-failed', visionFailureCode: 'network-error', frameRequestAttempted: true,
      frameRequestResponseReceived: false, frameRequestDestination: 'codex-cli',
    };
    const report = await writeStructuredAnalysisReport({
      request: { videoPath, craftDir, outputDir, budget: { maxFramesPerShot: 1, maxApiCalls: 1 }, vision: { enabled: true, provider: codexConfig }, sceneThreshold: 0.3 },
      probe: { path: videoPath, durationS: 2, width: 320, height: 240, fps: 24, hasAudio: false },
      observations: [observation], taxonomyRows: [], segmentationMode: { mode: 'full', reason: null }, startedAt: new Date(0).toISOString(),
      visionSummary: { attemptedModelCalls: 1, modelCallLimit: 1, labeledShots: 0, signalOnlyShots: 1, partialReasons: ['network-error'], frameRequestAttempted: true, frameRequestResponseReceived: false, externalFrameRequestAttempted: true, localServerFrameRequestAttempted: true, externalOnwardTransmission: null },
    });
    const data = JSON.parse(fs.readFileSync(report.analysisJsonPath, 'utf8'));
    assertAnalysisReferences(data);
    const evidence = data.evidence.find((entry) => entry.kind === 'frame');
    assert.equal(evidence.requestDestination, 'codex-cli');
    assert.equal(evidence.transmittedExternally, null);
    assert.equal(evidence.modelVersion, 'codex-cli/gpt-codex-vision');
    assert.equal(data.provenance.generators.find((generator) => generator.model === 'codex-cli/gpt-codex-vision').name, 'Codex CLI vision');
    assert.equal(evidence.externalOnwardTransmission, null);
    const manifest = JSON.parse(fs.readFileSync(report.manifestPath, 'utf8'));
    assert.equal(manifest.externalOnwardTransmission, null);
    assert.equal(manifest.externalFrameRequestAttempted, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
