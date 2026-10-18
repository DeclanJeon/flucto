/**
 * ffmpeg/ffprobe-driven deterministic signal layer (design A2 Stage 1).
 *
 * Every media access is a stdout pipe or null sink. Frame pixels exist only
 * inside pipeline buffers during a run — the aggregate numbers are the only
 * values that survive (see docs/cinematic-craft-analysis-design.md).
 */

import { spawn } from 'child_process';
import type { CutType, ShotSignals, VideoProbe } from '../../shared/analysisTypes.js';
import {
  buildAudioRmsArgs,
  buildKeyframeArgs,
  buildLumaArgs,
  buildProbeArgs,
  buildSceneDetectArgs,
  buildSilenceArgs,
  resolveFfprobePath,
} from './avCommands.js';

export interface MetadataRow {
  frameIndex: number;
  ptsS: number;
  metrics: Record<string, number>;
}

interface RunTextResult {
  stdout: string;
  stderr: string;
  code: number;
}

class BinaryError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly code: number,
  ) {
    super(message);
  }
}

const collect = (spawnProcess: ReturnType<typeof spawn>): Promise<{ stdout: string; stderr: string; code: number }> => {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    spawnProcess.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    spawnProcess.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    spawnProcess.on('error', (error) => reject(error));
    spawnProcess.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
};

const runText = (file: string, args: string[]): Promise<RunTextResult> => {
  const child = spawn(file, args, { shell: false, windowsHide: true });
  return collect(child);
};

interface RunBufferResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

/** stdout as raw Buffer — used ONLY for in-memory JPEG pipes. */
const MAX_KEYFRAME_PIPE_BYTES = 24 * 1024 * 1024;

const runBuffered = (file: string, args: string[]): Promise<RunBufferResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell: false, windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_KEYFRAME_PIPE_BYTES) {
        child.kill('SIGKILL');
        if (!settled) {
          settled = true;
          reject(new Error(`Keyframe pipe exceeded ${MAX_KEYFRAME_PIPE_BYTES} bytes; reducing frame size or count is required.`));
        }
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8').slice(0, 64 * 1024 - stderr.length); });
    child.on('error', (error) => {
      if (!settled) { settled = true; reject(error); }
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr, code: code ?? -1 });
    });
  });
};

const ensureBinaryOk = (result: { code: number; stderr: string; command: string }): void => {
  if (result.code !== 0) {
    throw new BinaryError(
      `${result.command} failed with exit code ${result.code}`,
      result.stderr,
      result.code,
    );
  }
};

/**
 * Parse ffmpeg metadata=print output pairs:
 *   frame:12 pts:360 pts_time:6.0
 *   lavfi.scene_score=0.412
 */
export const parseMetadataPrint = (stdout: string): MetadataRow[] => {
  const rows: MetadataRow[] = [];
  const lines = stdout.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const timeMatch = /^frame:\s*(\d+)\s+pts:\s*([-\d]+)\s+pts_time:([\d.]+)/.exec(lines[i].trim());
    if (!timeMatch) continue;
    const frameIndex = Number.parseInt(timeMatch[1], 10);
    const ptsS = Number.parseFloat(timeMatch[3]);
    const metrics: Record<string, number> = {};
    let j = i + 1;
    while (j < lines.length) {
      const kv = /^(lavfi\.[^\s]+)=([-+]?(?:[\d.]+(?:e[-+]?\d+)?|inf))$/i.exec(lines[j].trim());
      if (!kv) break;
      metrics[kv[1]] = kv[2].toLowerCase() === '-inf' ? -120 : kv[2].toLowerCase() === 'inf' ? 0 : Number.parseFloat(kv[2]);
      j += 1;
    }
    i = j - 1;
    rows.push({ frameIndex, ptsS, metrics });
  }
  return rows;
};

const isEmpty = (value: number): boolean => !Number.isFinite(value);

/** ffprobe JSON → normalized probe (hasAudio covers audio stream with no metadata assumptions). */
export const parseProbeJson = (
  stdout: string,
  videoPath: string,
): VideoProbe => {
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== 'object' || !('streams' in parsed)) {
    throw new Error(`Unrecognized ffprobe output for ${videoPath}`);
  }
  const document = parsed as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }>;
    format?: { duration?: string };
  };
  const video = document.streams?.find((stream) => stream.codec_type === 'video');
  const audio = document.streams?.some((stream) => stream.codec_type === 'audio');
  if (!video) {
    throw new Error(`No video stream in ${videoPath}`);
  }
  const [numerator, denominator] = (video.avg_frame_rate ?? '25/1').split('/').map(Number);
  if (!numerator || !denominator) {
    throw new Error(`Unreadable frame rate for ${videoPath}`);
  }
  const durationRaw = document.format?.duration ?? video.duration ?? null;
  const durationS = durationRaw === null ? Number.NaN : Number.parseFloat(durationRaw);
  if (isEmpty(durationS)) {
    throw new Error(`No duration reported for ${videoPath}`);
  }
  return {
    path: videoPath,
    durationS,
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: numerator / denominator,
    hasAudio: audio ?? false,
  };
};

export const probeVideo = (ffmpegPath: string, videoPath: string): Promise<VideoProbe> => {
  const [file, ...args] = buildProbeArgs({ ffprobePath: resolveFfprobePath(ffmpegPath), videoPath });
  return runText(file, args).then((result) => {
    ensureBinaryOk({ ...result, command: 'ffprobe' });
    return parseProbeJson(result.stdout, videoPath);
  });
};

export const readSceneRows = (ffmpegPath: string, videoPath: string, threshold: number): Promise<MetadataRow[]> => {
  const [file, ...args] = buildSceneDetectArgs({ ffmpegPath, videoPath, threshold });
  return runText(file, args).then((result) => {
    ensureBinaryOk({ ...result, command: 'ffmpeg scene pass' });
    return parseMetadataPrint(result.stdout).filter((row) => row.metrics['lavfi.scene_score'] !== undefined);
  });
};

export const readLumaRows = (ffmpegPath: string, videoPath: string): Promise<MetadataRow[]> => {
  const [file, ...args] = buildLumaArgs({ ffmpegPath, videoPath });
  return runText(file, args).then((result) => {
    ensureBinaryOk({ ...result, command: 'ffmpeg luma pass' });
    return parseMetadataPrint(result.stdout).filter((row) => row.metrics['lavfi.signalstats.YAVG'] !== undefined);
  });
};

export interface SilenceInterval {
  startS: number;
  endS: number;
}

export const parseSilenceEvents = (stderr: string): SilenceInterval[] => {
  const intervals: SilenceInterval[] = [];
  let openStart: number | null = null;
  for (const rawLine of stderr.split(/\r?\n/)) {
    const line = rawLine.trim();
    const startMatch = /silence_start:\s*([\d.+-]+)/.exec(line);
    if (startMatch) {
      openStart = Number.parseFloat(startMatch[1]);
      continue;
    }
    const endMatch = /silence_end:\s*([\d.+-]+)/.exec(line);
    if (endMatch && openStart !== null) {
      intervals.push({
        startS: openStart,
        endS: Number.parseFloat(endMatch[1]),
      });
      openStart = null;
    }
  }
  return intervals;
};

export const readAudioRmsRows = (ffmpegPath: string, videoPath: string): Promise<MetadataRow[]> => {
  const [file, ...args] = buildAudioRmsArgs({ ffmpegPath, videoPath });
  return runText(file, args).then((result) => {
    ensureBinaryOk({ ...result, command: 'ffmpeg audio RMS pass' });
    return parseMetadataPrint(result.stdout).filter((row) => row.metrics['lavfi.astats.Overall.RMS_level'] !== undefined);
  });
};

export const readSilences = (ffmpegPath: string, videoPath: string): Promise<SilenceInterval[]> => {
  const [file, ...args] = buildSilenceArgs({ ffmpegPath, videoPath });
  return runText(file, args).then((result) => {
    ensureBinaryOk({ ...result, command: 'ffmpeg silence pass' });
    return parseSilenceEvents(result.stderr);
  });
};

/** Split an image2pipe stream into individual JPEG payloads. */
export const splitJpegStream = (buffer: Buffer): Buffer[] => {
  const SOI = Buffer.from([0xFF, 0xD8]);
  const EOI = Buffer.from([0xFF, 0xD9]);
  const frames: Buffer[] = [];
  let start = buffer.indexOf(SOI);
  while (start !== -1) {
    const end = buffer.indexOf(EOI, start + 2);
    if (end === -1) break;
    frames.push(buffer.subarray(start, end + 2));
    start = buffer.indexOf(SOI, end + 2);
  }
  return frames;
};

/** Shot keyframes piped as JPEG — in-memory only. */
export const extractShotFrames = (
  ffmpegPath: string,
  videoPath: string,
  startS: number,
  durationS: number,
  frameCount: number,
): Promise<Buffer[]> => {
  const [file, ...args] = buildKeyframeArgs({ ffmpegPath, videoPath, startS, durationS, frameCount });
  return runBuffered(file, args).then((result) => {
    ensureBinaryOk({ ...result, command: 'ffmpeg keyframe pipe' });
    return splitJpegStream(result.stdout);
  });
};

// ---------------------------------------------------------------------------
// Segmentation + aggregation (pure; unit-tested)
// ---------------------------------------------------------------------------

export interface CutCandidate {
  ptsS: number;
  score: number;
  cutType: CutType;
}

/**
 * Detector rows → candidate boundaries. A scene score alone never confirms
 * a hard cut; all candidates remain ESTIMATED until both-side verification is implemented. Nearby candidates merge.
 */
export const toCutCandidates = (sceneRows: MetadataRow[], confirmThreshold: number, minGapS = 0.35): CutCandidate[] => {
  // Kept as an API compatibility parameter; it must not promote detector-only evidence.
  void confirmThreshold;
  const candidateRows = sceneRows
    .filter((row) => row.metrics['lavfi.scene_score'] !== undefined)
    .map((row) => ({
      ptsS: row.ptsS,
      score: row.metrics['lavfi.scene_score'],
    }));
  const spaced: CutCandidate[] = [];
  for (const row of candidateRows) {
    const previous = spaced[spaced.length - 1];
    if (previous && row.ptsS - previous.ptsS < minGapS) {
      if (row.score > previous.score) spaced[spaced.length - 1] = {
        ptsS: row.ptsS,
        score: row.score,
        cutType: 'ESTIMATED',
      };
      continue;
    }
    spaced.push({
      ptsS: row.ptsS,
      score: row.score,
      cutType: 'ESTIMATED',
    });
  }
  return spaced;
};

const mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const stddev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
};

const sumIntervalIntersection = (
  intervals: SilenceInterval[],
  windowStart: number,
  windowEnd: number,
): number => {
  let total = 0;
  for (const interval of intervals) {
    const start = Math.max(interval.startS, windowStart);
    const end = Math.min(interval.endS, windowEnd);
    if (end > start) total += end - start;
  }
  return total;
};

export interface ShotWindow {
  index: number;
  startS: number;
  endS: number;
  cutType: CutType;
}

/** Uniform sampling fallback when the detector produces no candidates. */
export const samplingWindows = (durationS: number, sampleEveryS: number): ShotWindow[] => {
  const windows: ShotWindow[] = [];
  let start = 0;
  let index = 0;
  while (start < durationS - 0.05) {
    const end = Math.min(start + sampleEveryS, durationS);
    windows.push({ index, startS: start, endS: end, cutType: 'UNKNOWN' });
    start = end;
    index += 1;
  }
  return windows;
};

export interface SegmentOptions {
  confirmThreshold: number;
  /** Cap before switching to sampled mode. */
  maxShots: number;
  sampleEveryS: number;
}

/**
 * Candidate boundaries → shot windows. If the cap is exceeded the run stays
 * honest and downgrades to uniformly sampled windows instead of pretending
 * per-shot coverage (segmentation_mode: sampled).
 */
export const segmentShots = (
  candidates: CutCandidate[],
  durationS: number,
  options: SegmentOptions,
): { windows: ShotWindow[]; mode: 'full' | 'sampled'; reason: string | null } => {
  if (candidates.length === 0) {
    return { windows: samplingWindows(durationS, options.sampleEveryS), mode: 'sampled', reason: 'No strong scene-change candidates detected' };
  }
  if (candidates.length + 1 > options.maxShots) {
    return { windows: samplingWindows(durationS, options.sampleEveryS), mode: 'sampled', reason: `Shot candidate count ${candidates.length} exceeds cap ${options.maxShots}` };
  }
  const windows: ShotWindow[] = [];
  for (let index = 0; index <= candidates.length; index += 1) {
    const startS = index === 0 ? 0 : candidates[index - 1].ptsS;
    const endS = index === candidates.length ? durationS : candidates[index].ptsS;
    windows.push({ index, startS, endS, cutType: index === candidates.length ? 'UNKNOWN' : candidates[index].cutType });
  }
  return { windows, mode: 'full', reason: null };
};

export const computeShotSignals = (
  window: ShotWindow,
  sceneRows: MetadataRow[],
  lumaRows: MetadataRow[],
  silences: SilenceInterval[],
  audioRmsRows: MetadataRow[] = [],
  hasAudio = silences.length > 0,
): ShotSignals => {
  const windowEnd = Math.max(window.startS + 0.04, window.endS);
  const scoresInShot = sceneRows
    .filter((row) => row.ptsS > window.startS && row.ptsS <= windowEnd)
    .map((row) => row.metrics['lavfi.scene_score']);
  const lumaInShot = lumaRows
    .filter((row) => row.ptsS > window.startS && row.ptsS <= windowEnd)
    .map((row) => row.metrics['lavfi.signalstats.YAVG']);
  const duration = windowEnd - window.startS;
  const silenceRatio = duration > 0 && hasAudio
    ? sumIntervalIntersection(silences, window.startS, windowEnd) / duration
    : null;
  const rmsDbRows = audioRmsRows
    .filter((row) => row.ptsS >= window.startS && row.ptsS <= windowEnd)
    .map((row) => row.metrics['lavfi.astats.Overall.RMS_level'])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const audioRmsMean = rmsDbRows.length > 0
    ? mean(rmsDbRows.map((db) => 10 ** (db / 20)))
    : null;
  const firstLuma = lumaInShot[0];
  const lastLuma = lumaInShot[lumaInShot.length - 1];
  const trend = firstLuma === undefined || lastLuma === undefined || lumaInShot.length < 2
    ? 0
    : ((lastLuma - firstLuma) / (duration || 1)) / 128;
  return {
    motion: Number((stddev(lumaInShot) / 128).toFixed(4)),
    cutScoreMax: Number(mean(scoresInShot.length > 0 ? scoresInShot : [0]).toFixed(4)),
    lumaMean: Number(mean(lumaInShot).toFixed(2)),
    lumaStddev: Number(stddev(lumaInShot).toFixed(2)),
    brightnessTrend: Number(trend.toFixed(4)),
    audioRmsMean: audioRmsMean === null ? null : Number(audioRmsMean.toFixed(6)),
    silenceRatio: silenceRatio === null ? null : Number(Math.min(1, silenceRatio).toFixed(4)),
  };
};
