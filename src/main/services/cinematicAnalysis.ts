/**
 * Cinematic analysis orchestrator (design A2/A3).
 *
 * Stages: probe → detect (ffmpeg signals) → label (optional vision LLM) →
 * emit (shotlog.csv + techniques.csv). Media bytes stay in memory; the only
 * persisted artifacts are the two CSV files.
 */

import path from 'path';
import {
  DEFAULT_FRAMES_PER_SHOT,
  DEFAULT_SCENE_THRESHOLD,
  MAX_CUT_CANDIDATES,
  formatSeconds,
  formatTimecode,
} from '../../shared/analysisTypes.js';
import type {
  AnalysisProgress,
  AnalysisRequest,
  AnalysisResult,
  CraftTaxonomyRow,
  CutType,
  SegmentationMode,
  ShotAnalysisStatus,
  ShotObservation,
  ShotSemanticLabels,
  ShotSignals,
  TechniqueUsageRow,
  VideoProbe,
} from '../../shared/analysisTypes.js';
import {
  computeShotSignals,
  extractShotFrames,
  readAudioRmsRows,
  probeVideo,
  readLumaRows,
  readSceneRows,
  readSilences,
  segmentShots,
  toCutCandidates,
  type MetadataRow,
  type SilenceInterval,
} from '../analysis/ffmpegSignals.js';
import {
  labelShotFrames,
  resolveVisionProviderConfig,
  VisionBudgetExceededError,
  type VisionProviderConfig,
  type VisionRequestFrame,
} from './visionProvider.js';
import {
  loadCraftTaxonomy,
} from './craftTaxonomy.js';
import { writeCsvFile } from '../analysis/csvWriter.js';
import { writeStructuredAnalysisReport } from './analysisReport.js';

const HARD_CUT_CONFIRM_THRESHOLD = 0.55;
const DEFAULT_SAMPLE_EVERY_S = 5;
const MAX_UNMATCHED_ANCHORS = 16;
const MAX_SAMPLE_TIMECODES = 5;
const MAX_CONSECUTIVE_VISION_ERRORS = 5;

export interface CraftAnalysisDeps {
  ffmpegPath: string;
  onProgress?: (progress: AnalysisProgress) => void;
}

const SIGNAL_OPERANDS = [
  'motion',
  'cutScoreMax',
  'lumaMean',
  'lumaStddev',
  'brightnessTrend',
  'silenceRatio',
] as const;

type SignalOperand = typeof SIGNAL_OPERANDS[number];

const OPERATORS = ['>=', '<=', '>', '<', '='] as const;
type Operator = typeof OPERATORS[number];

interface SignalHint {
  operand: SignalOperand;
  operator: Operator;
  value: number;
}

export const parseSignalHint = (hint: string): SignalHint | null => {
  for (const operand of SIGNAL_OPERANDS) {
    if (!hint.startsWith(operand)) continue;
    const rest = hint.slice(operand.length);
    let matchedOperator: Operator | null = null;
    for (const operator of OPERATORS) {
      if (rest.startsWith(operator)) {
        matchedOperator = operator;
        break;
      }
    }
    if (!matchedOperator) return null;
    const value = Number.parseFloat(rest.slice(matchedOperator.length));
    if (!Number.isFinite(value)) return null;
    return { operand, operator: matchedOperator, value };
  }
  return null;
};

const compare = (left: number, operator: Operator, right: number): boolean => {
  switch (operator) {
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '<': return left < right;
    case '=': return Math.abs(left - right) < 1e-9;
  }
};

const evaluateSignalHint = (hint: string, cutType: CutType, signals: ShotSignals): { hit: boolean; evidence: string | null } => {
  if (hint === 'hard-cut') {
    return { hit: cutType === 'HARD-CUT', evidence: cutType === 'HARD-CUT' ? 'hint hard-cut (cut_type=HARD-CUT)' : null };
  }
  if (hint === 'estimated-cut') {
    return { hit: cutType === 'ESTIMATED', evidence: cutType === 'ESTIMATED' ? 'hint estimated-cut (cut_type=ESTIMATED)' : null };
  }
  const parsed = parseSignalHint(hint);
  if (!parsed) return { hit: false, evidence: null };
  const value = signals[parsed.operand];
  if (value === null || value === undefined) return { hit: false, evidence: null };
  const hit = compare(value, parsed.operator, parsed.value);
  return {
    hit,
    evidence: hit ? `hint ${hint} (signals.${parsed.operand}=${value})` : null,
  };
};

export interface ShotMatchOutcome {
  matchedIds: string[];
  matchedEvidence: string[];
  unmatchedAnchors: string[];
}

export const matchTechniques = (
  cutType: CutType,
  signals: ShotSignals,
  labels: ShotSemanticLabels,
  rows: CraftTaxonomyRow[],
): ShotMatchOutcome => {
  const labelText = Object.entries(labels)
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => `${key} ${String(value).toLowerCase()}`)
    .join(' ');
  const hasLabels = labelText.trim().length > 0;
  const matchedIds: string[] = [];
  const matchedEvidence: string[] = [];
  const unmatchedAnchors: string[] = [];
  for (const row of rows) {
    const hintEvaluations = row.signalHints.map((hint) => evaluateSignalHint(hint, cutType, signals));
    const hintRequired = hintEvaluations.length > 0;
    if (hintRequired && hintEvaluations.some((evaluation) => !evaluation.hit)) continue;

    const anchors = [...row.anchorTermsKo, ...row.anchorTermsEn].filter(Boolean);
    const anchorRequired = anchors.length > 0;
    const hintHits = hintEvaluations.filter((evaluation) => evaluation.evidence !== null);
    const anchorHits = anchorRequired && hasLabels
      ? anchors.filter((anchor) => labelText.includes(anchor.toLowerCase()))
      : [];
    if (anchorRequired && anchorHits.length === 0) {
      if (hintHits.length > 0 && unmatchedAnchors.length < MAX_UNMATCHED_ANCHORS) {
        unmatchedAnchors.push(...anchors);
      }
      continue;
    }
    const evidences = [
      ...hintHits.map((evaluation) => evaluation.evidence ?? ''),
      ...anchorHits.map((anchor) => `anchor '${anchor}' ⇄ labels`),
    ].filter(Boolean);
    matchedIds.push(row.techniqueId);
    matchedEvidence.push(evidences.length > 0 ? `${row.techniqueId}: ${evidences.join('; ')}` : row.techniqueId);
  }
  return {
    matchedIds,
    matchedEvidence,
    unmatchedAnchors: Array.from(new Set(unmatchedAnchors)).slice(0, MAX_UNMATCHED_ANCHORS),
  };
};

const shotIdFor = (index: number): string => `S${String(index + 1).padStart(3, '0')}`;

export const groupShotsIntoScenes = (observations: ShotObservation[]): void => {
  const continuityKeys = ['subjectKind', 'palette', 'lightingType'] as const;
  let sceneIndex = 0;
  let previous: ShotObservation | null = null;
  for (const observation of observations) {
    const shared = previous
      ? continuityKeys.filter((key) => previous?.labels[key] && observation.labels[key]
        && previous.labels[key]?.trim().toLowerCase() === observation.labels[key]?.trim().toLowerCase())
      : [];
    const hasHardContradiction = previous?.labels.subjectKind && observation.labels.subjectKind
      && previous.labels.subjectKind.trim().toLowerCase() !== observation.labels.subjectKind.trim().toLowerCase();
    const sameEstimatedScene = Boolean(previous && !hasHardContradiction && shared.length >= 2);
    if (!sameEstimatedScene) sceneIndex += 1;
    observation.sceneId = `SC${String(sceneIndex).padStart(3, '0')}`;
    previous = observation;
  }
};

export interface AggregationOutcome {
  rows: TechniqueUsageRow[];
  enrichments: Map<string, Pick<CraftTaxonomyRow, 'craftDomain' | 'lifecycleStage' | 'titleKo' | 'titleEn' | 'evidenceLevel' | 'sourceBook' | 'sourceLocator'>>;
}

export const aggregateTechniqueUsage = (
  observations: ShotObservation[],
  taxonomyRows: CraftTaxonomyRow[],
): AggregationOutcome => {
  const byId = new Map<string, Pick<CraftTaxonomyRow, 'craftDomain' | 'lifecycleStage' | 'titleKo' | 'titleEn' | 'evidenceLevel' | 'sourceBook' | 'sourceLocator'>>();
  for (const row of taxonomyRows) {
    byId.set(row.techniqueId, {
      craftDomain: row.craftDomain,
      lifecycleStage: row.lifecycleStage,
      titleKo: row.titleKo,
      titleEn: row.titleEn,
      evidenceLevel: row.evidenceLevel,
      sourceBook: row.sourceBook,
      sourceLocator: row.sourceLocator,
    });
  }
  const grouped = new Map<string, { hits: number; firstShot: string; timecodes: string[] }>();
  for (const observation of observations) {
    for (const techniqueId of observation.matchedTechniqueIds) {
      const existing = grouped.get(techniqueId);
      if (existing) {
        existing.hits += 1;
        if (existing.timecodes.length < MAX_SAMPLE_TIMECODES) existing.timecodes.push(observation.startTimecode);
        continue;
      }
      grouped.set(techniqueId, {
        hits: 1,
        firstShot: observation.shotId,
        timecodes: [observation.startTimecode],
      });
    }
  }
  const rows: TechniqueUsageRow[] = Array.from(grouped.entries())
    .filter(([techniqueId]) => byId.has(techniqueId))
    .map(([techniqueId, usage]) => ({
      videoPath: observations[0]?.videoPath ?? '',
      techniqueId,
      hits: usage.hits,
      firstShot: usage.firstShot,
      sampleTimecodes: usage.timecodes,
      usageMode: usage.hits === 1 ? 'single' as const : usage.hits <= 2 ? 'repeated' as const : 'motif' as const,
    }))
    .sort((left, right) => left.techniqueId.localeCompare(right.techniqueId));
  return { rows, enrichments: byId };
};

const SHOTLOG_COLUMNS = [
  'video_path',
  'shot_id',
  'scene_id',
  'shot_index',
  'start_s',
  'end_s',
  'duration_s',
  'start_timecode',
  'end_timecode',
  'cut_type',
  'segmentation_mode',
  'segmentation_reason',
  'motion',
  'cut_score_max',
  'luma_mean',
  'luma_stddev',
  'brightness_trend',
  'audio_rms_mean',
  'silence_ratio',
  'shot_size',
  'camera_motion',
  'camera_axis',
  'lighting_type',
  'palette',
  'composition',
  'subject_kind',
  'narrative_function_guess',
  'transition_guess',
  'action_phase_summary',
  'label_confidence',
  'analysis_status',
  'matched_technique_ids',
  'matched_evidence',
  'unmatched_anchors',
  'taxonomy_version',
] as const;

const TECHNIQUES_COLUMNS = [
  'video_path',
  'technique_id',
  'craft_domain',
  'lifecycle_stage',
  'title_ko',
  'title_en',
  'hits',
  'first_shot',
  'sample_timecodes',
  'usage_mode',
  'evidence_level',
  'source_book',
  'source_locator',
] as const;

const SHOTLOG_NAME = 'shotlog.csv';
const TECHNIQUES_NAME = 'techniques.csv';

export const SHOTLOG_FILE = SHOTLOG_NAME;
export const TECHNIQUES_FILE = TECHNIQUES_NAME;

export interface DetectionOutcome {
  probe: VideoProbe;
  sceneRows: MetadataRow[];
  windows: Array<{ index: number; startS: number; endS: number; cutType: CutType }>;
  segmentation: SegmentationMode;
}

/** Pure Stage 1 tail: candidates + windows from already-fetched probe and scene rows. */
export const segmentFromProbeAndRows = (
  probe: VideoProbe,
  sceneRows: MetadataRow[],
): { windows: DetectionOutcome['windows']; segmentation: SegmentationMode } => {
  const candidates = toCutCandidates(sceneRows, HARD_CUT_CONFIRM_THRESHOLD);
  const segmentation = segmentShots(candidates, probe.durationS, {
    confirmThreshold: HARD_CUT_CONFIRM_THRESHOLD,
    maxShots: MAX_CUT_CANDIDATES,
    sampleEveryS: DEFAULT_SAMPLE_EVERY_S,
  });
  return {
    windows: segmentation.windows,
    segmentation: { mode: segmentation.mode, reason: segmentation.reason },
  };
};

/** Fetch scene pass only; segmentation stays pure for callers to parallelize. */
export const detectShotWindows = async (
  deps: CraftAnalysisDeps,
  videoPath: string,
  sceneThreshold: number = DEFAULT_SCENE_THRESHOLD,
): Promise<DetectionOutcome> => {
  const probe = await probeVideo(deps.ffmpegPath, videoPath);
  const sceneRows = await readSceneRows(deps.ffmpegPath, videoPath, sceneThreshold);
  const segmented = segmentFromProbeAndRows(probe, sceneRows);
  return {
    probe,
    sceneRows,
    windows: segmented.windows,
    segmentation: segmented.segmentation,
  };
};

const toVisionFrames = (buffers: Buffer[]): VisionRequestFrame[] => {
  return buffers.map((buffer) => ({ base64: buffer.toString('base64'), mime: 'image/jpeg' }));
};

export interface RunCounters {
  labeledShots: number;
  signalOnlyShots: number;
  unknownShots: number;
  budgetExceeded: boolean;
  visionNote: string | null;
  apiCallsUsed: number;
}

export const runCraftAnalysis = async (
  request: AnalysisRequest,
  deps: CraftAnalysisDeps,
): Promise<AnalysisResult> => {
  const { onProgress } = deps;
  const startedAt = new Date().toISOString();
  const taxonomy = loadCraftTaxonomy(request.craftDir);
  const progress = (stage: AnalysisProgress['stage'], shotsTotal: number, shotsDone: number, message?: string): void => {
    onProgress?.({ stage, shotsTotal, shotsDone, status: 'running', message });
  };

  const videoName = basenameOf(request.videoPath);
  progress('probe', 0, 0, `Probing ${videoName}`);
  const probe = await probeVideo(deps.ffmpegPath, request.videoPath);
  progress('detect', 0, 0, `Scene + luma passes (${probe.durationS.toFixed(0)}s video)`);

  const [sceneRows, lumaRows, silences, audioRmsRows] = await Promise.all([
    readSceneRows(deps.ffmpegPath, request.videoPath, request.sceneThreshold),
    readLumaRows(deps.ffmpegPath, request.videoPath),
    probe.hasAudio ? readSilences(deps.ffmpegPath, request.videoPath) : Promise.resolve([] as SilenceInterval[]),
    probe.hasAudio ? readAudioRmsRows(deps.ffmpegPath, request.videoPath) : Promise.resolve([] as MetadataRow[]),
  ]);

  const segmented = segmentFromProbeAndRows(probe, sceneRows);
  const windows = segmented.windows;
  progress('detect', windows.length, 0, `${windows.length} shot segment(s) (${segmented.segmentation.mode})`);

  const observations: ShotObservation[] = windows.map((window) => {
    const startS = window.startS;
    const endS = window.endS;
    const signals: ShotSignals = computeShotSignals(window, sceneRows, lumaRows, silences, audioRmsRows, probe.hasAudio);
    return {
      videoPath: request.videoPath,
      videoName,
      shotId: shotIdFor(window.index),
      sceneId: '',
      index: window.index,
      startS,
      endS,
      durationS: Math.max(0, endS - startS),
      startTimecode: formatTimecode(startS),
      endTimecode: formatTimecode(endS),
      cutType: window.cutType,
      signals,
      labels: {} as ShotSemanticLabels,
      matchedTechniqueIds: [],
      matchedEvidence: [],
      unmatchedAnchors: [],
      analysisStatus: 'unknown' as ShotAnalysisStatus,
    };
  });

  const counters: RunCounters = {
    labeledShots: 0,
    signalOnlyShots: 0,
    unknownShots: 0,
    budgetExceeded: false,
    visionNote: null,
    apiCallsUsed: 0,
  };

  const visionProvider: VisionProviderConfig | null = request.vision.enabled
    ? (request.vision.provider ?? resolveVisionProviderConfig())
    : null;

  if (!request.vision.enabled) {
    for (const observation of observations) {
      observation.analysisStatus = 'signal-only';
      counters.signalOnlyShots += 1;
    }
  } else if (!visionProvider) {
    for (const observation of observations) {
      observation.analysisStatus = 'signal-only';
      counters.signalOnlyShots += 1;
    }
    counters.visionNote = 'Vision requested but provider is not configured; labels stay UNKNOWN';
  } else {
    progress('label', windows.length, 0, 'Labeling shots with vision provider');
    const counter = { used: 0, limit: request.budget.maxApiCalls };
    let visionErrorStreak = 0;
    let visionAborted = false;
    for (const observation of observations) {
      if (counters.budgetExceeded || visionAborted) {
        observation.analysisStatus = 'signal-only';
        counters.signalOnlyShots += 1;
        continue;
      }
      try {
        const buffers = await extractShotFrames(
          deps.ffmpegPath,
          request.videoPath,
          observation.startS,
          observation.durationS,
          request.budget.maxFramesPerShot,
        );
        const call = await labelShotFrames(visionProvider, toVisionFrames(buffers), observation.signals, counter);
        visionErrorStreak = 0;
        counters.apiCallsUsed += call.apiCallsUsed;
        if (call.labels) {
          observation.labels = call.labels;
          observation.analysisStatus = 'labeled';
          counters.labeledShots += 1;
        } else {
          observation.analysisStatus = 'signal-only';
          counters.signalOnlyShots += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof VisionBudgetExceededError) {
          counters.budgetExceeded = true;
          observation.analysisStatus = 'signal-only';
          counters.signalOnlyShots += 1;
          counters.visionNote = `Budget exceeded after ${counter.used} vision call(s); remaining shots stay signal-only`;
          continue;
        }
        observation.analysisStatus = 'signal-only';
        counters.signalOnlyShots += 1;
        visionErrorStreak += 1;
        if (visionErrorStreak >= MAX_CONSECUTIVE_VISION_ERRORS) {
          visionAborted = true;
          counters.visionNote = `Vision provider failed ${MAX_CONSECUTIVE_VISION_ERRORS} shots in a row; remaining shots stay signal-only (last error: ${message})`;
        } else {
          counters.visionNote = `Vision provider error: ${message}`;
        }
      }
      progress('label', windows.length, observation.index + 1);
    }
  }

  groupShotsIntoScenes(observations);

  const taxonomyRows = taxonomy.rows;
  for (const observation of observations) {
    const outcome = matchTechniques(observation.cutType, observation.signals, observation.labels, taxonomyRows);
    observation.matchedTechniqueIds = outcome.matchedIds;
    observation.matchedEvidence = outcome.matchedEvidence;
    observation.unmatchedAnchors = outcome.unmatchedAnchors;
  }

  const aggregation = aggregateTechniqueUsage(observations, taxonomyRows);
  progress('emit', windows.length, windows.length,
    `Writing craft CSVs (${aggregation.rows.length} technique(s) matched)`);

  const segmentationMode = segmented.segmentation;
  const taxonomyVersion = taxonomyRows[0]?.taxonomyVersion ?? taxonomy.manifest?.taxonomyVersion ?? '';
  const rowsIncomplete = observations.some((observation) => observation.analysisStatus !== 'labeled')
    || segmentationMode.mode === 'sampled'
    || counters.budgetExceeded;

  const shotlogPath = path.join(request.outputDir, SHOTLOG_NAME);
  const techniquesPath = path.join(request.outputDir, TECHNIQUES_NAME);
  writeCsvFile(
    shotlogPath,
    SHOTLOG_COLUMNS,
    observations.map((observation) => [
      observation.videoPath,
      observation.shotId,
      observation.sceneId,
      observation.index,
      formatSeconds(observation.startS),
      formatSeconds(observation.endS),
      formatSeconds(observation.durationS),
      observation.startTimecode,
      observation.endTimecode,
      observation.cutType,
      segmentationMode.mode,
      segmentationMode.reason ?? '',
      fmt(observation.signals?.motion),
      fmt(observation.signals?.cutScoreMax),
      fmt(observation.signals?.lumaMean),
      fmt(observation.signals?.lumaStddev),
      fmt(observation.signals?.brightnessTrend),
      fmtNullable(observation.signals?.audioRmsMean),
      fmtNullable(observation.signals?.silenceRatio),
      observation.labels.shotSize ?? '',
      observation.labels.cameraMotion ?? '',
      observation.labels.cameraAxis ?? '',
      observation.labels.lightingType ?? '',
      observation.labels.palette ?? '',
      observation.labels.composition ?? '',
      observation.labels.subjectKind ?? '',
      observation.labels.narrativeFunctionGuess ?? '',
      observation.labels.transitionGuess ?? '',
      observation.labels.actionPhaseSummary ?? '',
      observation.labels.confidence === undefined ? '' : Number(observation.labels.confidence.toFixed(3)),
      observation.analysisStatus,
      observation.matchedTechniqueIds.join('; '),
      observation.matchedEvidence.join(' | '),
      observation.unmatchedAnchors.join('; '),
      taxonomyVersion,
    ]),
  );
  writeCsvFile(
    techniquesPath,
    TECHNIQUES_COLUMNS,
    aggregation.rows.map((row) => {
      const enrichment = aggregation.enrichments.get(row.techniqueId);
      return [
        row.videoPath,
        row.techniqueId,
        enrichment?.craftDomain ?? '',
        enrichment?.lifecycleStage ?? '',
        enrichment?.titleKo ?? '',
        enrichment?.titleEn ?? '',
        row.hits,
        row.firstShot,
        row.sampleTimecodes.join('; '),
        row.usageMode,
        enrichment?.evidenceLevel ?? '',
        enrichment?.sourceBook ?? '',
        enrichment?.sourceLocator ?? '',
      ];
    }),
  );

  const structured = await writeStructuredAnalysisReport({
    request,
    probe,
    observations,
    taxonomyRows,
    segmentationMode,
    startedAt,
  });

  return {
    success: true,
    videoPath: request.videoPath,
    outputDir: request.outputDir,
    shotlogPath,
    techniquesPath,
    analysisJsonPath: structured.analysisJsonPath,
    manifestPath: structured.manifestPath,
    toolRecommendationsPath: structured.toolRecommendationsPath,
    shotCount: observations.length,
    rowsIncomplete,
    segmentationMode,
    labeledShots: counters.labeledShots,
    signalOnlyShots: counters.signalOnlyShots,
    unknownShots: counters.unknownShots,
    budgetExceeded: counters.budgetExceeded,
    matchedTechniqueCount: aggregation.rows.length,
    ...(counters.visionNote ? { error: counters.visionNote } : {}),
  };
};

const basenameOf = (videoPath: string): string => path.basename(videoPath);

const fmt = (value: number | undefined): string | number => (
  value === undefined ? '' : String(value)
);

const fmtNullable = (value: number | null | undefined): string | number => (
  value === null || value === undefined ? '' : String(value)
);

export const estimateAnalysisCost = async (
  request: Pick<AnalysisRequest, 'videoPath' | 'sceneThreshold'>,
  deps: CraftAnalysisDeps,
): Promise<{
  fps: number;
  durationS: number;
  estimatedShots: number;
  estimatedFrames: number;
  estimatedApiCalls: number;
  sceneRows: number;
  segmentation: SegmentationMode;
  visionEnabled: boolean;
}> => {
  const probe = await probeVideo(deps.ffmpegPath, request.videoPath);
  const sceneRows = await readSceneRows(deps.ffmpegPath, request.videoPath, request.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD);
  const segmented = segmentFromProbeAndRows(probe, sceneRows);
  const shots = segmented.windows.length;
  const visionEnabled = Boolean(resolveVisionProviderConfig());
  return {
    fps: probe.fps,
    durationS: probe.durationS,
    estimatedShots: shots,
    estimatedFrames: visionEnabled ? shots * DEFAULT_FRAMES_PER_SHOT : 0,
    estimatedApiCalls: visionEnabled ? shots : 0,
    sceneRows: sceneRows.length,
    segmentation: segmented.segmentation,
    visionEnabled,
  };
};
