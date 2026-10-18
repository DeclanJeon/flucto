/**
 * Frozen ffmpeg/ffprobe command builders for craft analysis.
 *
 * The no-disk-frames invariant is enforced here: every media read pipes to
 * stdout ("-" output) or null. NEVER add "-f image2 <path>", "-o file", or
 * any file-path output argument — tests/disk-invariant tests will fail.
 * Frames leave as JPEG bytes on stdout and stay in memory buffers only.
 */

import path from 'path';
import { FRAME_BUFFER_MAX_PX } from '../../shared/analysisTypes.js';

/**
 * Signal passes decode at this width cap. Cut/luma evidence stays
 * candidate-level; a fixed cap keeps scores deterministic across videos
 * and cuts a full-resolution decode by ~4x on 1080p sources.
 */
export const SIGNAL_PASS_MAX_WIDTH_PX = 480;
const SIGNAL_SCALE = `scale='min(${SIGNAL_PASS_MAX_WIDTH_PX},iw)':-2`;

export interface ProbeArgsInput {
  ffprobePath: string;
  videoPath: string;
}

/** ffprobe JSON metadata for one file (no -count_frames: it forces a full
 *  decode (~10 min on an 18-min 1080p file) and parseProbeJson never reads
 *  the frame count — duration/fps come from format/stream metadata). */
export const buildProbeArgs = ({ ffprobePath, videoPath }: ProbeArgsInput): string[] => {
  return [
    ffprobePath,
    '-v', 'error',
    '-show_streams',
    '-show_format',
    '-of', 'json',
    videoPath,
  ];
};

export interface SceneDetectInput {
  ffmpegPath: string;
  videoPath: string;
  threshold: number;
}

/**
 * Scene-score pass: prints lavfi.scene_score for every frame to stdout.
 * Detector output stays DETECTOR_CANDIDATE-level evidence (boundary
 * confirmation requires both-side frame verification, added later).
 */
export const buildSceneDetectArgs = ({ ffmpegPath, videoPath, threshold }: SceneDetectInput): string[] => {
  const select = `gte(scene,${threshold})`;
  return [
    ffmpegPath,
    '-hide_banner',
    '-nostats',
    '-loglevel', 'info',
    '-i', videoPath,
    '-filter_complex',
    `${SIGNAL_SCALE},select='${select}',metadata=print:file=-`,
    '-an',
    '-f', 'null',
    '-',
  ];
};

export interface LumaPassInput {
  ffmpegPath: string;
  videoPath: string;
}

/** 2 Hz luma average (YAVG) sampling streamed as text metadata to stdout. */
export const buildLumaArgs = ({ ffmpegPath, videoPath }: LumaPassInput): string[] => {
  return [
    ffmpegPath,
    '-hide_banner',
    '-nostats',
    '-loglevel', 'info',
    '-i', videoPath,
    '-filter_complex',
    `fps=2,${SIGNAL_SCALE},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    '-an',
    '-f', 'null',
    '-',
  ];
};

export interface SilenceDetectInput {
  ffmpegPath: string;
  videoPath: string;
}

export interface AudioRmsInput {
  ffmpegPath: string;
  videoPath: string;
}

/** One audio RMS value per 48k-sample window, streamed as metadata without writing audio. */
export const buildAudioRmsArgs = ({ ffmpegPath, videoPath }: AudioRmsInput): string[] => [
  ffmpegPath,
  '-hide_banner',
  '-nostats',
  '-loglevel', 'info',
  '-i', videoPath,
  '-af', 'asetnsamples=n=48000:p=1,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
  '-vn',
  '-f', 'null',
  '-',
];

/** Audio silence map printed to stderr by silencedetect. */
export const buildSilenceArgs = ({ ffmpegPath, videoPath }: SilenceDetectInput): string[] => {
  return [
    ffmpegPath,
    '-hide_banner',
    '-nostats',
    '-i', videoPath,
    '-af', 'silencedetect=noise=-30dB:d=0.35',
    '-vn',
    '-f', 'null',
    '-',
  ];
};

export interface KeyframeExtractInput {
  ffmpegPath: string;
  videoPath: string;
  startS: number;
  durationS: number;
  frameCount: number;
}

/**
 * Shot keyframes as an in-memory JPEG pipe. NOT image2 files: frame bytes
 * travel through stdout only and live in ArrayBuffers until handed to the
 * vision provider, then are dereferenced.
 */
export const buildKeyframeArgs = ({ ffmpegPath, videoPath, startS, durationS, frameCount }: KeyframeExtractInput): string[] => {
  return [
    ffmpegPath,
    '-hide_banner',
    '-nostats',
    '-loglevel', 'error',
    '-ss', startS.toFixed(3),
    '-t', Math.max(0.05, durationS).toFixed(3),
    '-i', videoPath,
    '-vf', `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${(Math.max(0.05, durationS) / Math.max(1, frameCount)).toFixed(3)})',scale='min(${FRAME_BUFFER_MAX_PX},iw)':-2,setsar=1`,
    '-vsync', '0',
    '-frames:v', String(frameCount),
    '-vcodec', 'mjpeg',
    '-f', 'image2pipe',
    '-',
  ];
};

/** ffprobe sits next to the managed ffmpeg binary. */
export const resolveFfprobePath = (ffmpegPath: string): string => {
  const windowsPath = /^[A-Za-z]:[\\/]/.test(ffmpegPath) || ffmpegPath.includes('\\');
  const pathApi = windowsPath ? path.win32 : path;
  const dir = pathApi.dirname(ffmpegPath);
  const ext = process.platform === 'win32' || /\.exe$/i.test(ffmpegPath) ? '.exe' : '';
  return pathApi.join(dir, `ffprobe${ext}`);
};

/**
 * Invariant checker surfaced for tests: returns true when any argument pair
 * introduces a file-path media output (disk frame write) such as
 * `-f image2 <path>` or `-frames <path>` — always forbidden here.
 */
export const containsDiskFrameOutput = (args: string[]): boolean => {
  for (let i = 0; i < args.length - 1; i += 1) {
    const format = args[i];
    if (format !== '-f') continue;
    const next = args[i + 1];
    if (next !== 'image2' && next !== 'image2pipe') continue;
    // image2pipe plus a trailing bare "-" means stdout pipe (allowed);
    // image2 always names a file pattern — forbidden.
    if (next === 'image2') return true;
    const rest = args.slice(i + 2);
    if (!rest.some((arg) => arg === '-')) return true;
  }
  return false;
};
