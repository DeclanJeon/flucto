/**
 * Vision provider (design A2 stage 2).
 *
 * OpenAI-compatible chat/completions client that frames JPEG buffers into
 * base64 data URLs and requests labeled ShotSemanticLabels. Provider output is
 * NEVER promoted above ESTIMATED; low-confidence fields drop to UNKNOWN
 * (absent) instead of guessing.
 */

import { FRAME_BUFFER_MAX_PX } from '../../shared/analysisTypes.js';
import type {
  FrameRequestDestination,
  ShotSemanticLabels,
  ShotSignals,
  VisionFailureCode,
  VisionProviderRequestConfig,
} from '../../shared/analysisTypes.js';
import { CodexAppServerError, requestCodexVisionLabels } from './codexVisionRuntime.js';

export const VISION_CONFIDENCE_FLOOR = 0.55;

export interface VisionRequestFrame {
  base64: string;
  mime: string;
}

export type VisionProviderConfig = VisionProviderRequestConfig;

export class VisionBudgetExceededError extends Error {
  constructor(readonly used: number, readonly limit: number) {
    super('Vision request budget exceeded.');
    this.name = 'VisionBudgetExceededError';
  }
}

export class VisionProviderError extends Error {
  constructor(readonly code: Exclude<VisionFailureCode, 'budget-exceeded'>) {
    super(`Vision provider request failed (${code}).`);
    this.name = 'VisionProviderError';
  }
}

/**
 * Env-contract (external API, not inferable from code):
 * provider=openai: BASE_URL + API_KEY + MODEL all required.
 * provider=codex-cli: authenticated local Codex CLI app-server; MODEL required, no Flucto API key.
 */

export const resolveVisionProviderConfig = (env: NodeJS.ProcessEnv = process.env): VisionProviderConfig | null => {
  const providerRaw = env.FLUCTO_VISION_PROVIDER?.trim().toLowerCase() ?? '';
  const model = env.FLUCTO_VISION_MODEL?.trim() ?? '';
  if (!model) return null;
  if (providerRaw === 'codex-cli') {
    return {
      provider: 'codex-cli', baseURL: '', model, apiKey: '',
      ...(env.FLUCTO_CODEX_PATH?.trim() ? { codexPath: env.FLUCTO_CODEX_PATH.trim() } : {}),
    };
  }
  if (providerRaw && providerRaw !== 'openai') return null;
  const provider = 'openai' as const;
  const baseURL = env.FLUCTO_VISION_BASE_URL?.trim() ?? '';
  const apiKey = env.FLUCTO_VISION_API_KEY?.trim() ?? '';
  if (!baseURL || !apiKey) return null;
  return { provider, baseURL, model, apiKey };
};

const SYSTEM_PROMPT = [
  'You label shots from sampled JPEG frames for a filmmaking craft log.',
  'Estimate using ONLY what is visible; do NOT invent values.',
  'Reply with JSON only, no markdown fences, matching exactly this schema:',
  '{ "shotSize": string|null, "cameraMotion": string|null, "cameraAxis": string|null,',
  '  "lightingType": string|null, "palette": string|null, "composition": string|null,',
  '  "subjectKind": string|null, "narrativeFunctionGuess": string|null,',
  '  "transitionGuess": string|null, "actionPhaseSummary": string|null,',
  '  "confidence": number 0..1 }',
  'Use null for anything you cannot see. confidence is your overall certainty.',
].join('\n');

const LABEL_KEYS = [
  'shotSize',
  'cameraMotion',
  'cameraAxis',
  'lightingType',
  'palette',
  'composition',
  'subjectKind',
  'narrativeFunctionGuess',
  'transitionGuess',
  'actionPhaseSummary',
] as const;

export interface VisionCompletionJsonResult {
  labels: ShotSemanticLabels | null;
  rawConfidence: number | null;
}

/** Schema-locked parse; confidence below the floor demotes fields to UNKNOWN. */
export const parseVisionCompletionJson = (content: string): VisionCompletionJsonResult => {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { labels: null, rawConfidence: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { labels: null, rawConfidence: null };
  }
  const record = parsed as Record<string, unknown>;
  let confidence: number | null = null;
  if (typeof record.confidence === 'number' && Number.isFinite(record.confidence)) {
    confidence = Math.min(1, Math.max(0, record.confidence));
  }
  const labels: ShotSemanticLabels = confidence !== null && confidence >= VISION_CONFIDENCE_FLOOR
    ? { confidence }
    : {};
  if (confidence !== null && confidence >= VISION_CONFIDENCE_FLOOR) {
    for (const key of LABEL_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0 && value.length <= 200) {
        labels[key] = value.trim();
      }
    }
  }
  return { labels, rawConfidence: confidence };
};

export interface VisionApiCallResult {
  labels: ShotSemanticLabels | null;
  apiCallsUsed: number;
  failureCode?: VisionFailureCode;
}

export interface VisionApiCallCounter {
  used: number;
  limit: number;
  onFrameRequest?: (destination: FrameRequestDestination) => void;
  onFrameResponseReceived?: () => void;
}

const hasSemanticLabels = (labels: ShotSemanticLabels | null): labels is ShotSemanticLabels => Boolean(
  labels && Object.entries(labels).some(([key, value]) => key !== 'confidence' && typeof value === 'string' && value.trim().length > 0),
);
const failureCodeFor = (error: unknown): Exclude<VisionFailureCode, 'budget-exceeded'> => {
  if (error instanceof VisionProviderError) return error.code;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return 'timeout';
  return 'network-error';
};
const safeHttpError = (status: number): VisionProviderError => new VisionProviderError(
  status === 401 || status === 403 ? 'provider-rejected' : status === 404 || status === 503 ? 'provider-unavailable' : 'http-error',
);

const dataUrl = (frame: VisionRequestFrame): { type: 'image_url'; image_url: { url: string } } => ({
  type: 'image_url',
  image_url: { url: `data:${frame.mime};base64,${frame.base64}` },
});

const shotContextText = (signals: ShotSignals, frameCount: number): string => [
  `Shot start/end already measured by ffmpeg (do not repeat into JSON):`,
  `cut_score_max=${signals.cutScoreMax} luma_mean=${signals.lumaMean} luma_std=${signals.lumaStddev}`,
  `brightness_trend=${signals.brightnessTrend}. ${frameCount} sampled frame(s) follow.`,
].join('\n');

export const labelShotFramesOpenai = async (
  config: VisionProviderConfig,
  frames: VisionRequestFrame[],
  signals: ShotSignals,
  counter: VisionApiCallCounter,
  fetchImpl: typeof fetch = fetch,
): Promise<VisionApiCallResult> => {
  if (frames.length === 0) return { labels: null, apiCallsUsed: 0 };
  if (counter.used >= counter.limit) {
    throw new VisionBudgetExceededError(counter.used, counter.limit);
  }
  const requestBody = {
    model: config.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: shotContextText(signals, frames.length) },
          ...frames.map(dataUrl),
        ],
      },
    ],
  };
  const endpoint = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`;
  counter.used += 1;
  counter.onFrameRequest?.('external-provider');
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      redirect: 'manual',
    });
  } catch (error) { throw new VisionProviderError(failureCodeFor(error)); }
  counter.onFrameResponseReceived?.();
  if (!response.ok) throw safeHttpError(response.status);
  let payload: unknown;
  try { payload = await response.json(); } catch { return { labels: null, apiCallsUsed: 1, failureCode: 'malformed-response' }; }
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0];
  if (!choice || typeof choice !== 'object' || typeof choice.message?.content !== 'string') {
    return { labels: null, apiCallsUsed: 1, failureCode: 'malformed-response' };
  }
  const parsed = parseVisionCompletionJson(choice.message.content);
  if (!parsed.labels) return { labels: null, apiCallsUsed: 1, failureCode: parsed.rawConfidence === null ? 'malformed-response' : undefined };
  return { labels: hasSemanticLabels(parsed.labels) ? parsed.labels : null, apiCallsUsed: 1 };
};

export const labelShotFramesCodexCli = async (
  config: VisionProviderConfig,
  frames: VisionRequestFrame[],
  signals: ShotSignals,
  counter: VisionApiCallCounter,
  codexOptions: import('./codexVisionRuntime.js').CodexAppServerOptions = {},
): Promise<VisionApiCallResult> => {
  if (!frames.length) return { labels: null, apiCallsUsed: 0 };
  if (counter.used >= counter.limit) throw new VisionBudgetExceededError(counter.used, counter.limit);
  const codexCounter = {
    used: counter.used,
    limit: counter.limit,
    onFrameRequest: () => counter.onFrameRequest?.('codex-cli'),
    onFrameResponseReceived: () => counter.onFrameResponseReceived?.(),
  };
  try {
    const result = await requestCodexVisionLabels(
      { model: config.model, ...(config.codexPath ? { binaryPath: config.codexPath } : {}) },
      frames,
      signals,
      codexCounter,
      codexOptions,
    );
    if (!result.text) return { labels: null, apiCallsUsed: result.apiCallsUsed, failureCode: 'malformed-response' };
    const parsed = parseVisionCompletionJson(result.text);
    if (!parsed.labels) return { labels: null, apiCallsUsed: result.apiCallsUsed, failureCode: parsed.rawConfidence === null ? 'malformed-response' : undefined };
    return { labels: hasSemanticLabels(parsed.labels) ? parsed.labels : null, apiCallsUsed: result.apiCallsUsed };
  } catch (error) {
    if (error instanceof CodexAppServerError) throw new VisionProviderError(error.code);
    throw new VisionProviderError(failureCodeFor(error));
  } finally {
    counter.used = codexCounter.used;
  }
};

export const labelShotFrames = (
  config: VisionProviderConfig,
  frames: VisionRequestFrame[],
  signals: ShotSignals,
  counter: VisionApiCallCounter,
  fetchImpl: typeof fetch = fetch,
  codexOptions: import('./codexVisionRuntime.js').CodexAppServerOptions = {},
): ReturnType<typeof labelShotFramesOpenai> => {
  if (config.provider === 'codex-cli') return labelShotFramesCodexCli(config, frames, signals, counter, codexOptions);
  return labelShotFramesOpenai(config, frames, signals, counter, fetchImpl);
};

export const frameMaxPixel = FRAME_BUFFER_MAX_PX;
