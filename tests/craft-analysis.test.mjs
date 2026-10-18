import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { toCsvValue, toCsvDocument, parseCsvWithColumns } from '../dist-electron/main/analysis/csvWriter.js';
import {
  buildProbeArgs,
  buildAudioRmsArgs,
  buildSceneDetectArgs,
  buildLumaArgs,
  buildSilenceArgs,
  buildKeyframeArgs,
  resolveFfprobePath,
  containsDiskFrameOutput,
} from '../dist-electron/main/analysis/avCommands.js';
import {
  parseMetadataPrint,
  parseSilenceEvents,
  splitJpegStream,
  toCutCandidates,
  segmentShots,
  samplingWindows,
  computeShotSignals,
} from '../dist-electron/main/analysis/ffmpegSignals.js';
import {
  validateBookExtracts,
  mergeTechniqueEntries,
  BookExtractValidationError,
} from '../dist-electron/main/services/craftTaxonomy.js';
import { parseSignalHint, matchTechniques, aggregateTechniqueUsage, groupShotsIntoScenes } from '../dist-electron/main/services/cinematicAnalysis.js';
import { parseOpenCodeProviders } from '../dist-electron/main/services/openCodeRuntime.js';
import { writeStructuredAnalysisReport, assertAnalysisReferences } from '../dist-electron/main/services/analysisReport.js';
import {
  parseVisionCompletionJson,
  resolveVisionProviderConfig,
  buildOpencodePromptPayload,
  labelShotFrames,
  VISION_CONFIDENCE_FLOOR,
} from '../dist-electron/main/services/visionProvider.js';

test('csv cells escape commas, quotes and newlines per RFC 4180', () => {
  assert.equal(toCsvValue('plain'), 'plain');
  assert.equal(toCsvValue(42), '42');
  assert.equal(toCsvValue(null), '');
  assert.equal(toCsvValue(undefined), '');
  assert.equal(toCsvValue('a,b'), '"a,b"');
  assert.equal(toCsvValue('say "hi"'), '"say ""hi"""');
  assert.equal(toCsvValue('line1\nline2'), '"line1\nline2"');
});

test('csv document round-trips CRLF + BOM through the column parser', () => {
  const columns = ['a', 'b'];
  const document = toCsvDocument(columns, [['x,y', 'q"q'], ['ko-한글', '']]);
  assert.ok(document.endsWith('\r\n'));
  assert.ok(document.charCodeAt(0) === 0xFEFF === false); // BOM added at write time, not in document
  const records = parseCsvWithColumns(`\uFEFF${document}`);
  assert.equal(records.length, 2);
  assert.equal(records[0].a, 'x,y');
  assert.equal(records[0].b, 'q"q');
  assert.equal(records[1].a, 'ko-한글');
  assert.equal(records[1].b, '');
  assert.throws(() => toCsvDocument(['a'], [['too', 'wide']]), /row width/);
});

test('every frozen command builder stays disk-free for frames and prints metadata to stdout', () => {
  const ffmpegPath = 'ffmpeg';
  const videoPath = 'clip.mp4';
  const builders = {
    probe: buildProbeArgs({ ffprobePath: resolveFfprobePath(ffmpegPath), videoPath }),
    audioRms: buildAudioRmsArgs({ ffmpegPath, videoPath }),
    scene: buildSceneDetectArgs({ ffmpegPath, videoPath, threshold: 0.3 }),
    luma: buildLumaArgs({ ffmpegPath, videoPath }),
    silence: buildSilenceArgs({ ffmpegPath, videoPath }),
    keyframes: buildKeyframeArgs({ ffmpegPath, videoPath, startS: 1, durationS: 2, frameCount: 3 }),
  };
  assert.ok(resolveFfprobePath('C:/bin/ffmpeg.exe').endsWith('ffprobe.exe'));
  for (const [name, args] of Object.entries(builders)) {
    if (name === 'probe') {
      assert.ok(args.includes('-of') && args.includes('json'));
      continue;
    }
    assert.equal(containsDiskFrameOutput(args), false, `${name} must not write frames to disk`);
    assert.equal(args[args.length - 1], '-', `${name} must end with stdout pipe`);
  }
  assert.ok(builders.audioRms.some((arg) => arg.includes('astats=metadata=1:reset=1')));
  assert.ok(builders.audioRms.some((arg) => arg.includes('lavfi.astats.Overall.RMS_level:file=-')));
  assert.ok(builders.scene.some((arg) => arg.includes('metadata=print:file=-')));
  assert.ok(builders.scene.some((arg) => arg.startsWith('scale=')) && builders.scene.some((arg) => arg.includes("min(480,iw)")));
  assert.ok(builders.luma.some((arg) => arg.includes('signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-')));
  assert.ok(builders.luma.some((arg) => arg.startsWith('fps=2,scale=')));
  assert.ok(builders.keyframes.includes('image2pipe'));
  assert.equal(containsDiskFrameOutput(['ffmpeg', '-f', 'image2', 'frame%03d.jpg']), true);
  assert.equal(containsDiskFrameOutput(['ffmpeg', '-f', 'image2pipe', '-']), false);
  assert.equal(
    containsDiskFrameOutput(['ffmpeg', '-f', 'image2pipe', 'out.jpg']),
    true,
    'image2pipe without a trailing stdout dash is a disk write',
  );
});

test('metadata print pairs frame lines with following lavfi metrics', () => {
  const stdout = [
    'frame:12 pts:360 pts_time:6.0',
    'lavfi.scene_score=0.412000',
    'frame:13 pts:372 pts_time:6.2',
    'lavfi.scene_score=0.010000',
    'unrelated line',
  ].join('\n');
  const rows = parseMetadataPrint(stdout);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { frameIndex: 12, ptsS: 6.0, metrics: { 'lavfi.scene_score': 0.412 } });
  assert.equal(rows[1].ptsS, 6.2);
  assert.equal(parseMetadataPrint('').length, 0);
});

test('silence events pair starts with ends and ignore dangling starts', () => {
  const stderr = [
    'some noise',
    '[silencedetect @ 0] silence_start: 1.5',
    '[silencedetect @ 0] silence_end: 3.2 | silence_duration: 1.7',
    '[silencedetect @ 0] silence_start: 9.0',
  ].join('\n');
  const intervals = parseSilenceEvents(stderr);
  assert.deepEqual(intervals, [{ startS: 1.5, endS: 3.2 }]);
});

test('jpeg stream splitting keeps only SOI..EOI payloads', () => {
  const soi = Buffer.from([0xFF, 0xD8]);
  const eoi = Buffer.from([0xFF, 0xD9]);
  const junk = Buffer.from('junk');
  const frameA = Buffer.concat([soi, Buffer.from('AAA'), eoi]);
  const frameB = Buffer.concat([soi, Buffer.from('BB'), eoi]);
  const frames = splitJpegStream(Buffer.concat([junk, frameA, junk, frameB, junk]));
  assert.equal(frames.length, 2);
  assert.ok(frames[0].slice(0, 2).equals(soi));
  assert.ok(frames[0].slice(-2).equals(eoi));
});

test('cut candidates merge nearby clusters and remain estimated without two-sided boundary verification', () => {
  const rows = [
    { frameIndex: 0, ptsS: 1.0, metrics: { 'lavfi.scene_score': 0.6 } },
    { frameIndex: 1, ptsS: 1.1, metrics: { 'lavfi.scene_score': 0.8 } },
    { frameIndex: 2, ptsS: 2.0, metrics: { 'lavfi.scene_score': 0.2 } },
    { frameIndex: 3, ptsS: 2.05, metrics: { 'lavfi.scene_score': 0.3 } },
  ];
  const candidates = toCutCandidates(rows, 0.55);
  assert.deepEqual(candidates, [
    { ptsS: 1.1, score: 0.8, cutType: 'ESTIMATED' },
    { ptsS: 2.05, score: 0.3, cutType: 'ESTIMATED' },
  ]);
  assert.equal(toCutCandidates([], 0.55).length, 0);
});

test('segmentShots fills windows between boundaries and degrades to sampled mode past the cap', () => {
  const { windows, mode, reason } = segmentShots(
    [
      { ptsS: 2, score: 0.9, cutType: 'HARD-CUT' },
      { ptsS: 5, score: 0.2, cutType: 'ESTIMATED' },
    ],
    8,
    { confirmThreshold: 0.55, maxShots: 3, sampleEveryS: 5 },
  );
  assert.equal(mode, 'full');
  assert.equal(reason, null);
  assert.deepEqual(windows, [
    { index: 0, startS: 0, endS: 2, cutType: 'HARD-CUT' },
    { index: 1, startS: 2, endS: 5, cutType: 'ESTIMATED' },
    { index: 2, startS: 5, endS: 8, cutType: 'UNKNOWN' },
  ]);

  const sampled = segmentShots(
    [{ ptsS: 1, score: 0.9, cutType: 'HARD-CUT' }],
    8,
    { confirmThreshold: 0.55, maxShots: 1, sampleEveryS: 4 },
  );
  assert.equal(sampled.mode, 'sampled');
  assert.ok(sampled.reason.includes('cap'));
  assert.equal(sampled.windows.length, 2);
});

test('sampling windows cover the duration without floating residue', () => {
  const windows = samplingWindows(10, 3);
  assert.deepEqual(windows.map((window) => [window.startS, window.endS]), [[0, 3], [3, 6], [6, 9], [9, 10]]);
});

test('computeShotSignals aggregates luma/silence signals inside the window only', () => {
  const window = { index: 0, startS: 1, endS: 4, cutType: 'HARD-CUT' };
  const lumaRows = [
    { frameIndex: 0, ptsS: 0.5, metrics: { 'lavfi.signalstats.YAVG': 200 } },
    { frameIndex: 1, ptsS: 2.0, metrics: { 'lavfi.signalstats.YAVG': 100 } },
    { frameIndex: 2, ptsS: 3.0, metrics: { 'lavfi.signalstats.YAVG': 120 } },
    { frameIndex: 3, ptsS: 4.5, metrics: { 'lavfi.signalstats.YAVG': 10 } },
  ];
  const signals = computeShotSignals(window, [], lumaRows, [{ startS: 2.5, endS: 3.5 }]);
  assert.equal(signals.lumaMean, 110);
  assert.equal(signals.silenceRatio, 0.3333);
  assert.ok(signals.brightnessTrend > 0);
  assert.ok(signals.motion > 0);
  assert.equal(signals.audioRmsMean, null);
});

test('audio RMS is measured per shot and no detected silence means zero when an audio stream exists', () => {
  const window = { index: 0, startS: 1, endS: 3, cutType: 'UNKNOWN' };
  const signals = computeShotSignals(window, [], [], [], [
    { frameIndex: 1, ptsS: 1.5, metrics: { 'lavfi.astats.Overall.RMS_level': -20 } },
    { frameIndex: 2, ptsS: 2.5, metrics: { 'lavfi.astats.Overall.RMS_level': -40 } },
    { frameIndex: 3, ptsS: 3.5, metrics: { 'lavfi.astats.Overall.RMS_level': -3 } },
  ], true);
  assert.equal(signals.audioRmsMean, 0.055);
  assert.equal(signals.silenceRatio, 0);
});

test('parseSignalHint accepts threshold forms and rejects free text', () => {
  assert.deepEqual(parseSignalHint('motion>=0.4'), { operand: 'motion', operator: '>=', value: 0.4 });
  assert.deepEqual(parseSignalHint('lumaMean=110'), { operand: 'lumaMean', operator: '=', value: 110 });
  assert.equal(parseSignalHint('hard-cut'), null);
  assert.equal(parseSignalHint('scene_height>2'), null);
});

const taxonomyRow = (overrides = {}) => ({
  techniqueId: 'CTX-TST-00000001',
  craftDomain: 'editing',
  lifecycleStage: '05-post-production',
  titleKo: '하드컷 리듬 편집',
  titleEn: 'hard-cut rhythm editing',
  definition: 'test definition',
  whenToUse: '',
  howToApply: '',
  pitfalls: '',
  anchorTermsKo: [],
  anchorTermsEn: [],
  signalHints: [],
  sourceBook: 'test.md',
  sourceLocator: 'line 1',
  evidenceLevel: 'reviewed',
  taxonomyVersion: '1.0.1+seed',
  ...overrides,
});

test('analysis reference validation rejects dangling and duplicate IDs', () => {
  const valid = { evidence: [{ id: 'E1' }], scenes: [{ id: 'SC1', shotIds: ['SH1'], claims: {} }], shots: [{ id: 'SH1', sceneId: 'SC1', techniqueApplicationIds: [], claims: {} }], techniqueApplications: [], productionPlan: [{ id: 'T1', evidenceIds: ['E1'], toolRecommendationIds: [] }], toolRecommendations: [] };
  assert.doesNotThrow(() => assertAnalysisReferences(valid));
  assert.throws(() => assertAnalysisReferences({ ...valid, shots: [{ ...valid.shots[0], sceneId: 'missing' }] }), /unknown id missing/);
  assert.throws(() => assertAnalysisReferences({ ...valid, evidence: [{ id: 'E1' }, { id: 'E1' }] }), /duplicate id/);
});

test('structured report emits evidence-linked JSON and CSVs without persisting frame bytes', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-report-test-'));
  try {
    const videoPath = path.join(tempDir, 'input.mp4');
    const outputDir = path.join(tempDir, 'out');
    fs.writeFileSync(videoPath, 'test-video-placeholder');
    const technique = taxonomyRow({ techniqueId: 'CTX-CAM-00000001', howToApply: 'Use a locked-off medium shot.' });
    const observation = {
      videoPath, videoName: 'input.mp4', shotId: 'S001', sceneId: 'SC01', index: 0,
      startS: 0, endS: 2, durationS: 2, startTimecode: '00:00:00.000', endTimecode: '00:00:02.000',
      cutType: 'UNKNOWN', signals: { motion: 0.1, cutScoreMax: 0, lumaMean: 90, lumaStddev: 2, brightnessTrend: 0, audioRmsMean: null, silenceRatio: null },
      labels: { shotSize: 'medium', confidence: 0.8 }, matchedTechniqueIds: [technique.techniqueId],
      matchedEvidence: ['scene observation'], unmatchedAnchors: [], analysisStatus: 'labeled',
    };
    const result = await writeStructuredAnalysisReport({
      request: { videoPath, sourceUrl: 'https://www.youtube.com/watch?v=test&list=private-list&token=secret#fragment', craftDir: tempDir, outputDir, budget: { maxFramesPerShot: 3, maxApiCalls: 1 }, vision: { enabled: true, provider: { provider: 'opencode-local', providerID: 'opencode', baseURL: 'http://127.0.0.1:1', model: 'vision-free', apiKey: '' } }, sceneThreshold: 0.3 },
      probe: { path: videoPath, durationS: 2, width: 640, height: 360, fps: 30, hasAudio: false },
      observations: [observation], taxonomyRows: [technique], segmentationMode: { mode: 'full', reason: null }, startedAt: new Date(0).toISOString(),
    });
    const data = JSON.parse(fs.readFileSync(result.analysisJsonPath, 'utf8'));
    const schema = JSON.parse(fs.readFileSync(new URL('../schemas/analysis-run.v1.schema.json', import.meta.url), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    assert.equal(ajv.validate(schema, data), true, JSON.stringify(ajv.errors));
    assert.equal(data.schemaVersion, '1.0.0');
    assert.equal(data.source.kind, 'url');
    assert.equal(data.source.canonicalUrl, 'https://www.youtube.com/watch?v=test');
    assert.equal(data.shots[0].claims.shotSize.evidenceLevel, 'INFERRED');
    assert.equal(data.shots[0].claims.motion.evidenceLevel, 'UNKNOWN');
    assert.equal(data.techniqueApplications.length, 1);
    assert.ok(data.productionPlan.length >= 3);
    assert.equal(data.toolRecommendations.length, 1);
    assert.equal(data.toolRecommendations[0].name, 'DaVinci Resolve');
    assert.equal(data.toolRecommendations[0].claim.evidenceLevel, 'INFERRED');
    assert.equal(data.toolRecommendations[0].pricingStatus, 'unknown');
    assert.equal(data.toolRecommendations[0].licenseStatus, 'unknown');
    assert.equal(result.toolRecommendationsPath, path.join(outputDir, 'tool_recommendations.csv'));
    assert.equal(data.evidence.find((entry) => entry.id === 'E-TOOL-DAVINCI-RESOLVE').evidenceLevel, 'SOURCE_CONFIRMED');
    for (const name of ['scenes.csv', 'evidence.csv', 'technique_applications.csv', 'production_plan.csv', 'tool_recommendations.csv', 'manifest.json']) {
      assert.ok(fs.existsSync(path.join(outputDir, name)), `${name} emitted`);
    }
    assert.equal(fs.readdirSync(outputDir).some((name) => /frame|\.jpe?g$/i.test(name)), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('scene grouping is distinct from cuts and only merges adjacent shots with multiple matching labels', () => {
  const makeShot = (shotId, labels) => ({ shotId, sceneId: '', labels });
  const shots = [
    makeShot('S001', { subjectKind: 'person', palette: 'warm', lightingType: 'soft' }),
    makeShot('S002', { subjectKind: 'person', palette: 'warm', lightingType: 'hard' }),
    makeShot('S003', { subjectKind: 'landscape', palette: 'cool', lightingType: 'hard' }),
    makeShot('S004', {}),
  ];
  groupShotsIntoScenes(shots);
  assert.equal(shots[0].sceneId, shots[1].sceneId, 'two matching semantic labels can group across a hard cut');
  assert.notEqual(shots[1].sceneId, shots[2].sceneId, 'subject contradiction starts a new scene');
  assert.notEqual(shots[2].sceneId, shots[3].sceneId, 'unknown scene labels are not silently merged');
});

test('matchTechniques joins signal hints and requires anchors only when labeled', () => {
  const labels = {};
  const signals = { motion: 0.5, cutScoreMax: 0.9, lumaMean: 110, lumaStddev: 20, brightnessTrend: 0, audioRmsMean: null, silenceRatio: 0.5 };
  const hintOnly = taxonomyRow({ signalHints: ['hard-cut', 'motion>=0.4'] });
  const outcome = matchTechniques('HARD-CUT', signals, labels, [hintOnly]);
  assert.deepEqual(outcome.matchedIds, ['CTX-TST-00000001']);
  assert.ok(outcome.matchedEvidence[0].includes('hint hard-cut'));
  assert.equal(matchTechniques('ESTIMATED', signals, labels, [hintOnly]).matchedIds.length, 0);

  const anchored = taxonomyRow({
    techniqueId: 'CTX-TST-00000002',
    anchorTermsEn: ['on-the-nose cut'],
    signalHints: ['hard-cut'],
  });
  const anchorMiss = matchTechniques('HARD-CUT', signals, labels, [anchored]);
  assert.equal(anchorMiss.matchedIds.length, 0);
  assert.deepEqual(anchorMiss.unmatchedAnchors, ['on-the-nose cut']);
  const anchorHit = matchTechniques('HARD-CUT', signals, { composition: 'on-the-nose cut' }, [anchored]);
  assert.deepEqual(anchorHit.matchedIds, ['CTX-TST-00000002']);
});

test('aggregateTechniqueUsage counts hits, keeps taxonomy rows, and sorts deterministically', () => {
  const observations = [
    { videoPath: 'v.mp4', shotId: 'S001', startTimecode: '0:00:00.000', matchedTechniqueIds: ['A'] },
    { videoPath: 'v.mp4', shotId: 'S002', startTimecode: '0:00:02.000', matchedTechniqueIds: ['A', 'B'] },
    { videoPath: 'v.mp4', shotId: 'S003', startTimecode: '0:00:04.000', matchedTechniqueIds: ['A'] },
    { videoPath: 'v.mp4', shotId: 'S004', startTimecode: '0:00:06.000', matchedTechniqueIds: ['ZZZ-missing'] },
  ];
  const outcome = aggregateTechniqueUsage(observations, [
    taxonomyRow({ techniqueId: 'A' }),
    taxonomyRow({ techniqueId: 'B', evidenceLevel: 'unverified' }),
  ]);
  const byId = Object.fromEntries(outcome.rows.map((row) => [row.techniqueId, row]));
  assert.equal(byId.A.hits, 3);
  assert.equal(byId.A.firstShot, 'S001');
  assert.equal(byId.A.usageMode, 'motif');
  assert.equal(byId.B.hits, 1);
  assert.equal(byId.B.usageMode, 'single');
  assert.ok(!byId['ZZZ-missing']);
  assert.equal(outcome.rows.at(-1).techniqueId, 'B');
});

test('book extracts validate entries, reject overlong definitions, and dedupe on merge', () => {
  const good = {
    craftDomain: 'camera',
    lifecycleStage: '04-production',
    titleKo: '프레임 안 밀기',
    titleEn: 'do-not-push-the-frame',
    definition: 'paraphrase under the cap',
    anchorTermsKo: ['프레임'],
  };
  const { entries, rejected } = validateBookExtracts([
    good,
    { ...good, definition: 'x'.repeat(401) },
    { ...good, definition: 'y'.repeat(400) },
    null,
  ]);
  assert.equal(entries.length, 2);
  assert.equal(rejected, 2);
  assert.equal(entries[0].evidenceLevel, 'unverified');
  assert.equal(entries[1].definition.length, 400);
  assert.throws(() => validateBookExtracts({}), BookExtractValidationError);
  assert.throws(
    () => validateBookExtracts([{ definition: 'x', craftDomain: 'camera', lifecycleStage: '01-development' }]),
    /title/,
  );
  assert.throws(
    () => validateBookExtracts([{ ...good, lifecycleStage: '00-none' }]),
    /lifecycle_stage/,
  );
  const merged = mergeTechniqueEntries([good, { ...good, titleKo: '다른 제목', anchorTermsEn: ['second term'] }]);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].anchorTermsEn.includes('second term'));
});

test('vision completion parse locks the schema and demotes low confidence to UNKNOWN', () => {
  const good = JSON.stringify({
    shotSize: 'medium',
    cameraMotion: 'static',
    composition: 'rule of thirds',
    confidence: 0.83,
    observedInstead: 'hidden',
  });
  const parsed = parseVisionCompletionJson(good);
  assert.equal(parsed.labels.shotSize, 'medium');
  assert.equal(parsed.labels.cameraMotion, 'static');
  assert.equal(parsed.rawConfidence, 0.83);
  assert.equal(parsed.labels.observedInstead, undefined);

  const low = parseVisionCompletionJson(JSON.stringify({ shotSize: 'wide', confidence: VISION_CONFIDENCE_FLOOR - 0.01 }));
  assert.ok(!('shotSize' in low.labels));

  assert.equal(parseVisionCompletionJson('```json\n{"confidence": 0.9, "palette": "warm"}\n```').labels.palette, 'warm');
  assert.equal(parseVisionCompletionJson('not json at all').labels, null);
  assert.equal(parseVisionCompletionJson('[1,2,3]').labels, null);
});

test('vision config resolution: opencode-local needs only a model and drops the opencode/ prefix', () => {
  const local = resolveVisionProviderConfig({
    FLUCTO_VISION_PROVIDER: 'opencode-local',
    FLUCTO_VISION_MODEL: 'opencode/glm-5.3-flash-free',
  });
  assert.equal(local?.provider, 'opencode-local');
  assert.equal(local?.baseURL, 'http://127.0.0.1:4096');
  assert.equal(local?.model, 'glm-5.3-flash-free');
  assert.equal(local?.variant, 'low');
  assert.equal(local?.apiKey, '');

  assert.deepEqual(
    resolveVisionProviderConfig({
      FLUCTO_VISION_PROVIDER: 'opencode-local',
      FLUCTO_VISION_BASE_URL: 'http://127.0.0.1:7777',
      FLUCTO_VISION_MODEL: ' nemotron-3.5-super-vl-free ',
      FLUCTO_VISION_VARIANT: 'none',
    }),
    { provider: 'opencode-local', baseURL: 'http://127.0.0.1:7777', model: 'nemotron-3.5-super-vl-free', apiKey: '', variant: 'none' },
  );

  assert.equal(resolveVisionProviderConfig({}), null);
  assert.equal(resolveVisionProviderConfig({ FLUCTO_VISION_BASE_URL: 'https://api.example/v1', FLUCTO_VISION_API_KEY: 'k' }), null);
  assert.equal(resolveVisionProviderConfig({ FLUCTO_VISION_BASE_URL: 'https://api.example/v1', FLUCTO_VISION_API_KEY: '', FLUCTO_VISION_MODEL: 'm' }), null);

  const openai = resolveVisionProviderConfig({ FLUCTO_VISION_BASE_URL: 'https://api.example/v1', FLUCTO_VISION_API_KEY: 'k', FLUCTO_VISION_MODEL: 'vl-model' });
  assert.deepEqual(openai, { provider: 'openai', baseURL: 'https://api.example/v1', model: 'vl-model', apiKey: 'k' });
});

test('OpenCode catalog requires an explicit free label and zero-cost image-input metadata', () => {
  const models = parseOpenCodeProviders({ all: [
    { id: 'provider-a', models: {
      vision: { id: 'vision', name: 'Free Vision', cost: { input: 0, output: 0 }, capabilities: { input: { image: true } }, limit: { context: 8192 } },
      text: { id: 'text', cost: { input: 0, output: 0 }, capabilities: { input: { image: false } } },
      paid: { id: 'paid', cost: { input: 1, output: 1 }, capabilities: { input: { image: true } } },
      unknownPrice: { id: 'unknownPrice', cost: {}, capabilities: { input: { image: true } } },
      unpriced: { id: 'unpriced', name: 'Vision XL', cost: { input: 0, output: 0 }, capabilities: { input: { image: true } } },
    } },
    { id: 'provider-b', models: { other: { id: 'other', name: 'Also Free Vision', cost: { input: 0, output: 0 }, capabilities: { input: { image: true } } } } },
  ] });
  assert.deepEqual(models.map(({ providerID, modelID, free, acceptsImages }) => ({ providerID, modelID, free, acceptsImages })), [
    { providerID: 'provider-a', modelID: 'vision', free: true, acceptsImages: true },
    { providerID: 'provider-b', modelID: 'other', free: true, acceptsImages: true },
  ]);
  assert.equal(models[0].contextLimit, 8192);
  assert.deepEqual(parseOpenCodeProviders({ all: [] }), []);
});

test('opencode-local payload builder locks provider/model id, variant and data-url file parts', () => {
  const payload = buildOpencodePromptPayload(
    { provider: 'opencode-local', baseURL: 'http://127.0.0.1:4096', model: 'glm-5.3-flash-free', apiKey: '', variant: 'low' },
    [{ base64: 'AAA', mime: 'image/jpeg' }],
    { cutScoreMax: 0.42, lumaMean: 55, lumaStddev: 7, brightnessTrend: -0.03 },
  );
  assert.deepEqual(payload.model, { providerID: 'opencode', modelID: 'glm-5.3-flash-free' });
  assert.equal(payload.variant, 'low');
  assert.equal(payload.parts.length, 2);
  assert.match(payload.parts[0].text, /cut_score_max=0\.42/);
  assert.match(payload.parts[0].text, /Reply with JSON only/);
  assert.deepEqual(payload.parts[1], { type: 'file', mime: 'image/jpeg', url: 'data:image/jpeg;base64,AAA' });
});

test('OpenCode local requests authenticate to the loopback server with its ephemeral Basic auth', async () => {
  const authorization = [];
  const fetchImpl = async (_url, init) => {
    authorization.push(init.headers.authorization);
    return { ok: true, json: async () => ({ id: 'ses_auth', parts: [{ type: 'text', text: '{"shotSize":"wide","confidence":0.9}' }] }) };
  };
  const config = { provider: 'opencode-local', providerID: 'opencode', baseURL: 'http://127.0.0.1:4096', model: 'vision-free', apiKey: '', serverUsername: 'flucto', serverPassword: 'ephemeral-secret' };
  await labelShotFrames(config, [{ base64: 'QQ==', mime: 'image/jpeg' }], { cutScoreMax: 0.5, lumaMean: 60, lumaStddev: 6, brightnessTrend: 0 }, { used: 0, limit: 5 }, fetchImpl);
  assert.deepEqual(authorization, [
    `Basic ${Buffer.from('flucto:ephemeral-secret').toString('base64')}`,
    `Basic ${Buffer.from('flucto:ephemeral-secret').toString('base64')}`,
  ]);
});

test('labelShotFrames dispatches opencode-local through session + message endpoints', async () => {
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith('/session')) {
      return { ok: true, json: async () => ({ id: 'ses_probe' }) };
    }
    return {
      ok: true,
      json: async () => ({ parts: [{ type: 'text', text: '{"shotSize":"wide","confidence":0.9}' }] }),
    };
  };
  const config = { provider: 'opencode-local', baseURL: 'http://127.0.0.1:4096', model: 'glm-5.3-flash-free', apiKey: '', variant: 'low' };
  const counter = { used: 0, limit: 5 };
  const result = await labelShotFrames(config, [{ base64: 'QQ==', mime: 'image/jpeg' }], { cutScoreMax: 0.5, lumaMean: 60, lumaStddev: 6, brightnessTrend: 0 }, counter, stub);
  assert.equal(counter.used, 1);
  assert.deepEqual(result, { labels: { confidence: 0.9, shotSize: 'wide' }, apiCallsUsed: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://127.0.0.1:4096/session');
  assert.equal(calls[1].url, 'http://127.0.0.1:4096/session/ses_probe/message');
  assert.deepEqual(calls[1].body.model, { providerID: 'opencode', modelID: 'glm-5.3-flash-free' });
});
