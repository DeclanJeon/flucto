/**
 * Cinematic craft analysis shared types.
 *
 * Evidence-level discipline from contents-production-skills
 * video-production-assets references/25-reference-video-analysis.md:
 * detector output is candidate-level evidence; semantic labels are ESTIMATED;
 * unmeasured values stay UNKNOWN. Never promote LLM output to OBSERVED.
 */

export type EvidenceLevel = 'OBSERVED' | 'ESTIMATED' | 'UNKNOWN';

export type CraftDomain =
  | 'pre-production'
  | 'composition'
  | 'camera'
  | 'lighting'
  | 'performance'
  | 'editing'
  | 'sound'
  | 'narrative'
  | 'finishing-delivery';

export type LifecycleStage =
  | '01-development'
  | '02-screenwriting'
  | '03-pre-production'
  | '04-production'
  | '05-post-production'
  | '06-distribution';

export type TaxonomyEvidenceLevel = 'verified' | 'reviewed' | 'unverified';

/** One reusable filmmaking technique extracted from the knowledge sources. */
export interface CraftTaxonomyRow {
  techniqueId: string;
  craftDomain: CraftDomain;
  lifecycleStage: LifecycleStage;
  titleKo: string;
  titleEn: string;
  definition: string;
  whenToUse: string;
  howToApply: string;
  pitfalls: string;
  anchorTermsKo: string[];
  anchorTermsEn: string[];
  /** Deterministic signal hints, e.g. "hard-cut" or "scene_score>=0.6". */
  signalHints: string[];
  sourceBook: string;
  sourceLocator: string;
  evidenceLevel: TaxonomyEvidenceLevel;
  taxonomyVersion: string;
}

/** A raw technique entry before validation/merge (from agent extraction or refs parsing). */
export interface RawTechniqueEntry {
  techniqueId?: string;
  craftDomain: string;
  lifecycleStage: string;
  titleKo: string;
  titleEn: string;
  definition: string;
  whenToUse?: string;
  howToApply?: string;
  pitfalls?: string;
  anchorTermsKo?: string[];
  anchorTermsEn?: string[];
  signalHints?: string[];
  sourceBook?: string;
  sourceLocator?: string;
  evidenceLevel?: string;
}

export interface CraftBuildManifest {
  taxonomyVersion: string;
  builtAt: string;
  sources: Array<{
    kind: 'skills-references' | 'book-extracts';
    root: string;
    files: string[];
    sha256: Record<string, string>;
  }>;
  techniqueCount: number;
  verifiedCount: number;
  unverifiedCount: number;
}

export type CutType = 'HARD-CUT' | 'ESTIMATED' | 'UNKNOWN';

export interface BoundaryCandidate {
  timeSeconds: number;
  score: number;
  method: 'ffmpeg-lavfi-scene-score';
  verification: 'estimated';
}

export type ShotAnalysisStatus = 'labeled' | 'signal-only' | 'unknown';
export type VisionShotOutcome = 'not-requested' | 'skipped' | 'labeled' | 'no-labels' | 'request-failed' | 'budget-exceeded';
export type VisionFailureCode = 'timeout' | 'http-error' | 'network-error' | 'provider-unavailable' | 'provider-rejected' | 'malformed-response' | 'processing-error' | 'budget-exceeded';
export type FrameRequestDestination = 'external-provider' | 'local-server' | 'codex-cli';

/** Deterministic signal aggregates for one shot. Frame data never persists. */
export interface ShotSignals {
  /** Luma variation proxy only; not validated camera/subject motion. */
  motion: number;
  cutScoreMax: number;
  lumaMean: number;
  lumaStddev: number;
  brightnessTrend: number;
  audioRmsMean: number | null;
  silenceRatio: number | null;
}

/** Optional vision-LLM semantic labels, all ESTIMATED at best. */
export interface ShotSemanticLabels {
  shotSize?: string;
  cameraMotion?: string;
  cameraAxis?: string;
  lightingType?: string;
  palette?: string;
  composition?: string;
  subjectKind?: string;
  narrativeFunctionGuess?: string;
  transitionGuess?: string;
  actionPhaseSummary?: string;
  confidence?: number;
}

export interface ShotObservation {
  videoPath: string;
  videoName: string;
  shotId: string;
  sceneId: string;
  index: number;
  /** Cut entry point in seconds (PTS). */
  startS: number;
  endS: number;
  durationS: number;
  startTimecode: string;
  endTimecode: string;
  cutType: CutType;
  outgoingBoundaryCandidate: BoundaryCandidate | null;
  signals: ShotSignals;
  labels: ShotSemanticLabels;
  visionOutcome?: VisionShotOutcome;
  visionFailureCode?: VisionFailureCode;
  frameRequestAttempted?: boolean;
  frameRequestResponseReceived?: boolean;
  frameRequestDestination?: FrameRequestDestination | null;
  matchedTechniqueIds: string[];
  matchedEvidence: string[];
  unmatchedAnchors: string[];
  analysisStatus: ShotAnalysisStatus;
}

export interface TechniqueUsageRow {
  videoPath: string;
  techniqueId: string;
  hits: number;
  firstShot: string;
  sampleTimecodes: string[];
  usageMode: 'single' | 'repeated' | 'motif';
}

export interface VideoProbe {
  path: string;
  durationS: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export interface SegmentationMode {
  mode: 'full' | 'sampled';
  reason: string | null;
}

export interface AnalysisBudget {
  maxFramesPerShot: number;
  maxApiCalls: number;
}

export interface VisionProviderRequestConfig {
  provider: 'openai' | 'codex-cli';
  /** Optional path to the user's authenticated Codex CLI executable. */
  codexPath?: string;
  baseURL: string;
  model: string;
  apiKey: string;
}

export interface AnalysisRequest {
  videoPath: string;
  sourceUrl?: string;
  craftDir: string;
  outputDir: string;
  budget: AnalysisBudget;
  vision: {
    enabled: boolean;
    provider: VisionProviderRequestConfig | null;
  };
  sceneThreshold: number;
}

export type AnalysisStage = 'download' | 'probe' | 'detect' | 'label' | 'emit';

export interface AnalysisProgress {
  stage: AnalysisStage;
  shotsTotal: number;
  shotsDone: number;
  status: 'running' | 'budget_exceeded' | 'done';
  message?: string;
}

export interface AnalysisResult {
  success: boolean;
  videoPath: string;
  outputDir: string;
  shotlogPath: string | null;
  techniquesPath: string | null;
  analysisJsonPath: string | null;
  manifestPath: string | null;
  toolRecommendationsPath: string | null;
  shotCount: number;
  rowsIncomplete: boolean;
  segmentationMode: SegmentationMode;
  labeledShots: number;
  signalOnlyShots: number;
  unknownShots: number;
  budgetExceeded: boolean;
  visionSummary?: {
    attemptedModelCalls: number;
    modelCallLimit: number;
    labeledShots: number;
    signalOnlyShots: number;
    partialReasons: string[];
    frameRequestAttempted: boolean;
    frameRequestResponseReceived: boolean;
    externalFrameRequestAttempted: boolean;
    localServerFrameRequestAttempted: boolean;
    externalOnwardTransmission: boolean | null;
  };
  /** Distinct techniques present in techniques.csv (0 = header-only output). */
  matchedTechniqueCount: number;
  error?: string;
}

export const MAX_CUT_CANDIDATES = 2000;
export const DEFAULT_SCENE_THRESHOLD = 0.3;
export const DEFAULT_FRAMES_PER_SHOT = 3;
export const DEFAULT_MAX_API_CALLS = 400;
export const FRAME_BUFFER_MAX_PX = 768;

/** Format seconds as "h:mm:ss.mmm" used in shotlog/techniques CSV columns. */
export const formatTimecode = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const totalMs = Math.round(safe * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
};

/** Format seconds as fixed "s.SSS" column value. */
export const formatSeconds = (seconds: number): string => seconds.toFixed(3);
