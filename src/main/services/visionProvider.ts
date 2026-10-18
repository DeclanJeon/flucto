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
  ShotSemanticLabels,
  ShotSignals,
  VisionProviderRequestConfig,
} from '../../shared/analysisTypes.js';

export const VISION_CONFIDENCE_FLOOR = 0.55;

export interface VisionRequestFrame {
  base64: string;
  mime: string;
}

export type VisionProviderConfig = VisionProviderRequestConfig;

export class VisionBudgetExceededError extends Error {
  constructor(readonly used: number, readonly limit: number) {
    super(`Vision API budget exceeded: ${used} calls used of ${limit} allowed.`);
    this.name = 'VisionBudgetExceededError';
  }
}

/**
 * Env-contract (external API, not inferable from code):
 * provider=openai: BASE_URL + API_KEY + MODEL all required.
 * provider=opencode-local: local `opencode serve`; only MODEL required. BASE_URL
 * defaults to http://127.0.0.1:4096; MODEL drops a leading `opencode/`; VARIANT defaults to low.
 */
export const resolveVisionProviderConfig = (env: NodeJS.ProcessEnv = process.env): VisionProviderConfig | null => {
  const providerRaw = env.FLUCTO_VISION_PROVIDER?.trim().toLowerCase() ?? '';
  const provider = providerRaw === 'opencode-local' ? 'opencode-local' as const : 'openai' as const;
  const model = env.FLUCTO_VISION_MODEL?.trim() ?? '';
  if (!model) return null;
  if (provider === 'opencode-local') {
    return {
      provider,
      baseURL: env.FLUCTO_VISION_BASE_URL?.trim() || 'http://127.0.0.1:4096',
      model: model.replace(/^opencode\//i, ''),
      apiKey: env.FLUCTO_VISION_API_KEY?.trim() ?? '',
      variant: env.FLUCTO_VISION_VARIANT?.trim() || 'low',
    };
  }
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
}

const dataUrl = (frame: VisionRequestFrame): { type: 'image_url'; image_url: { url: string } } => ({
  type: 'image_url',
  image_url: { url: `data:${frame.mime};base64,${frame.base64}` },
});

const shotContextText = (signals: ShotSignals, frameCount: number): string => [
  `Shot start/end already measured by ffmpeg (do not repeat into JSON):`,
  `cut_score_max=${signals.cutScoreMax} luma_mean=${signals.lumaMean} luma_std=${signals.lumaStddev}`,
  `brightness_trend=${signals.brightnessTrend}. ${frameCount} sampled frame(s) follow.`,
].join('\n');

export const buildOpencodePromptPayload = (
  config: VisionProviderConfig,
  frames: VisionRequestFrame[],
  signals: ShotSignals,
): unknown => ({
  model: { providerID: config.providerID ?? 'opencode', modelID: config.model },
  variant: config.variant ?? 'low',
  parts: [
    { type: 'text', text: `${shotContextText(signals, frames.length)}\n\n${SYSTEM_PROMPT}` },
    ...frames.map((frame) => ({ type: 'file', mime: frame.mime, url: `data:${frame.mime};base64,${frame.base64}` })),
  ],
});

const extractTextPart = (payload: unknown): string | null => {
  const parts = (payload as { parts?: Array<{ type?: unknown; text?: unknown }> }).parts;
  if (!Array.isArray(parts)) return null;
  const part = parts.find(
    (entry) => entry.type === 'text' && typeof entry.text === 'string' && entry.text.trim().length > 0,
  );
  return part ? (part.text as string) : null;
};

export const labelShotFramesOpencodeLocal = async (
  config: VisionProviderConfig,
  frames: VisionRequestFrame[],
  signals: ShotSignals,
  counter: { used: number; limit: number },
  fetchImpl: typeof fetch = fetch,
): Promise<VisionApiCallResult> => {
  if (frames.length === 0) return { labels: null, apiCallsUsed: 0 };
  if (counter.used >= counter.limit) {
    throw new VisionBudgetExceededError(counter.used, counter.limit);
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.serverUsername && config.serverPassword) {
    headers.authorization = `Basic ${Buffer.from(`${config.serverUsername}:${config.serverPassword}`).toString('base64')}`;
  } else if (config.apiKey.length > 0) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }
  const base = config.baseURL.replace(/\/+$/, '');
  const requestTimeout = AbortSignal.timeout(120_000);
  const sessionResponse = await fetchImpl(`${base}/session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'flucto-vision' }),
    signal: requestTimeout,
  });
  if (!sessionResponse.ok) {
    const body = await sessionResponse.text().catch(() => '');
    throw new Error(`Vision provider HTTP ${sessionResponse.status} (opencode session): ${body.slice(0, 300)}`);
  }
  const sessionId = (await sessionResponse.json() as { id?: unknown }).id;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('Vision provider opencode-local: session create returned no id');
  }
  const messageResponse = await fetchImpl(`${base}/session/${sessionId}/message`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildOpencodePromptPayload(config, frames, signals)),
    signal: requestTimeout,
  });
  if (!messageResponse.ok) {
    const body = await messageResponse.text().catch(() => '');
    throw new Error(`Vision provider HTTP ${messageResponse.status} (opencode message): ${body.slice(0, 300)}`);
  }
  counter.used += 1;
  const text = extractTextPart(await messageResponse.json());
  if (text === null) return { labels: null, apiCallsUsed: 1 };
  const { labels } = parseVisionCompletionJson(text);
  return { labels: labels && Object.keys(labels).length > 0 ? labels : null, apiCallsUsed: 1 };
};

export const labelShotFramesOpenai = async (
  config: VisionProviderConfig,
  frames: VisionRequestFrame[],
  signals: ShotSignals,
  counter: { used: number; limit: number },
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
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Vision provider HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  counter.used += 1;
  const payload: unknown = await response.json();
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0];
  if (!choice || typeof choice !== 'object' || typeof choice.message?.content !== 'string') {
    return { labels: null, apiCallsUsed: 1 };
  }
  const { labels } = parseVisionCompletionJson(choice.message.content);
  return { labels: labels && Object.keys(labels).length > 0 ? labels : null, apiCallsUsed: 1 };
};

export const labelShotFrames = (
  config: VisionProviderConfig,
  frames: VisionRequestFrame[],
  signals: ShotSignals,
  counter: { used: number; limit: number },
  fetchImpl: typeof fetch = fetch,
): ReturnType<typeof labelShotFramesOpenai> => {
  if (config.provider === 'opencode-local') {
    return labelShotFramesOpencodeLocal(config, frames, signals, counter, fetchImpl);
  }
  return labelShotFramesOpenai(config, frames, signals, counter, fetchImpl);
};

export const frameMaxPixel = FRAME_BUFFER_MAX_PX;
