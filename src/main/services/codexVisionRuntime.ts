import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ShotSignals } from '../../shared/analysisTypes.js';
import type { VisionRequestFrame } from './visionProvider.js';

export interface CodexVisionModel {
  id: string;
  name: string;
  description: string;
  acceptsImages: true;
  defaultReasoningEffort: string;
}

export interface CodexAppServerOptions {
  binaryPath?: string;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
  tempRoot?: string;
  cwd?: string;
}

export interface CodexVisionCallCounter {
  used: number;
  limit: number;
  onFrameRequest?: () => void;
  onFrameResponseReceived?: () => void;
}

export class CodexAppServerError extends Error {
  constructor(readonly code: 'provider-unavailable' | 'provider-rejected' | 'timeout' | 'malformed-response' | 'network-error') {
    super(`Codex vision request failed (${code}).`);
    this.name = 'CodexAppServerError';
  }
}

const MAX_STDOUT_LINE_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const SERVER_REQUEST_ERROR = { code: -32000, message: 'Interactive tools are disabled for Flucto vision requests.' };

const appServerBinary = (configured?: string): string => {
  const result = configured?.trim() || process.env.FLUCTO_CODEX_PATH?.trim() || 'codex';
  if (result.length > 4096 || /[\0\r\n]/.test(result)) throw new CodexAppServerError('provider-unavailable');
  return result;
};

interface RpcFailure { code?: unknown; message?: unknown; }
interface RpcEnvelope { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: RpcFailure; }

class AppServerProcess {
  private buffer = '';
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly notificationHandlers = new Set<(method: string, params: unknown) => void>();
  private closed = false;
  private closeError: Error | null = null;
  private stderrBytes = 0;
  private readonly closePromise: Promise<void>;

  constructor(private readonly child: ChildProcess, private readonly timeoutMs: number) {
    this.closePromise = new Promise((resolve) => {
      child.once('error', (error) => { this.failPending(error); resolve(); });
      child.once('close', (code, signal) => {
        this.closed = true;
        if (code !== 0 && !this.closeError) this.closeError = new Error(`Codex app-server exited (${code ?? signal ?? 'unknown'}).`);
        this.failPending(this.closeError ?? new Error('Codex app-server closed.'));
        resolve();
      });
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr?.on('data', (chunk: Buffer | string) => { this.stderrBytes = Math.min(MAX_STDERR_BYTES, this.stderrBytes + Buffer.byteLength(chunk)); });
  }

  private failPending(error: Error): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_STDOUT_LINE_BYTES && !this.buffer.includes('\n')) {
      this.closeError = new Error('Codex app-server response exceeded the size limit.');
      this.child.kill('SIGKILL');
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > MAX_STDOUT_LINE_BYTES) {
        this.closeError = new Error('Codex app-server response exceeded the size limit.');
        this.child.kill('SIGKILL');
        return;
      }
      let message: RpcEnvelope;
      try { message = JSON.parse(line) as RpcEnvelope; } catch {
        this.closeError = new Error('Codex app-server returned malformed protocol data.');
        this.child.kill('SIGKILL');
        return;
      }
      if (typeof message.id === 'number' || typeof message.id === 'string') {
        const pending = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.id as number);
          if (message.error) pending.reject(this.rpcError(message.error));
          else pending.resolve(message.result);
        } else {
          // Codex requests are never permitted to launch tools or request approval.
          this.write({ id: message.id, error: SERVER_REQUEST_ERROR });
        }
        continue;
      }
      if (typeof message.method === 'string') {
        for (const handler of this.notificationHandlers) handler(message.method, message.params);
      }
    }
  }

  private rpcError(error: RpcFailure): Error {
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
    if (/unauthori[sz]ed|forbidden|not logged in|authentication/.test(message)) return new CodexAppServerError('provider-rejected');
    if (/unavailable|not found|not installed|no such file|invalid params|unknown method/.test(message)
      || error.code === -32600 || error.code === -32601 || error.code === -32602) return new CodexAppServerError('provider-unavailable');
    return new CodexAppServerError('provider-unavailable');
  }

  private write(value: unknown): void {
    if (this.closed || !this.child.stdin?.writable) throw new Error('Codex app-server is not writable.');
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  request(method: string, params: unknown = {}, timeoutMs = this.timeoutMs): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closeError ?? new Error('Codex app-server is closed.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexAppServerError('timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error('Codex app-server request failed.'));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(handler: (method: string, params: unknown) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  async close(graceMs = 1200): Promise<void> {
    if (!this.closed) {
      this.child.stdin?.end();
      await Promise.race([this.closePromise, new Promise<void>((resolve) => setTimeout(resolve, graceMs))]);
    }
    if (!this.closed) {
      if (process.platform === 'win32') this.child.kill('SIGKILL');
      else if (this.child.pid) { try { process.kill(-this.child.pid, 'SIGKILL'); } catch { this.child.kill('SIGKILL'); } }
      await this.closePromise;
    }
  }
}

const spawnAppServer = (options: CodexAppServerOptions, cwd: string): AppServerProcess => {
  const binary = appServerBinary(options.binaryPath);
  const envKeys = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'WINDIR', 'CODEX_HOME', 'CODEX_CONFIG_DIR', 'LANG', 'LC_ALL', 'NO_COLOR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
  const env = Object.fromEntries(envKeys.flatMap((key) => process.env[key] ? [[key, process.env[key] as string]] : [])) as NodeJS.ProcessEnv;
  const spawnOptions: SpawnOptions = { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, detached: process.platform !== 'win32' };
  let child: ChildProcess;
  try { child = (options.spawnProcess ?? spawn)(binary, ['app-server', '--stdio'], spawnOptions); }
  catch { throw new CodexAppServerError('provider-unavailable'); }
  return new AppServerProcess(child, options.timeoutMs ?? 120_000);
};

const initialize = async (client: AppServerProcess): Promise<void> => {
  await client.request('initialize', {
    clientInfo: { name: 'flucto', title: 'Flucto cinematic analysis', version: '1.0.0' },
    capabilities: null,
  }, 15_000);
  client.notify('initialized');
};

const withAppServer = async <T>(
  options: CodexAppServerOptions,
  fn: (client: AppServerProcess, cwd: string) => Promise<T>,
): Promise<T> => {
  const cwd = fs.mkdtempSync(path.join(options.tempRoot ?? os.tmpdir(), 'flucto-codex-vision-'));
  if (process.platform !== 'win32') fs.chmodSync(cwd, 0o700);
  let client: AppServerProcess | null = null;
  try {
    client = spawnAppServer(options, cwd);
    await initialize(client);
    return await fn(client, options.cwd ?? cwd);
  } catch (error) {
    if (error instanceof CodexAppServerError) throw error;
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw new CodexAppServerError('timeout');
    if (error instanceof Error && /ENOENT|spawn/i.test(error.message)) throw new CodexAppServerError('provider-unavailable');
    throw new CodexAppServerError('network-error');
  } finally {
    await client?.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
};

const extractModels = (payload: unknown): CodexVisionModel[] => {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw): CodexVisionModel[] => {
    if (!raw || typeof raw !== 'object') return [];
    const model = raw as Record<string, unknown>;
    const id = typeof model.model === 'string' ? model.model : typeof model.id === 'string' ? model.id : '';
    const name = typeof model.displayName === 'string' ? model.displayName : id;
    const modalities = model.inputModalities;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(id) || !Array.isArray(modalities) || !modalities.includes('image')) return [];
    return [{
      id,
      name: name.slice(0, 160),
      description: typeof model.description === 'string' ? model.description.slice(0, 500) : '',
      acceptsImages: true,
      defaultReasoningEffort: typeof model.defaultReasoningEffort === 'string' ? model.defaultReasoningEffort : 'medium',
    }];
  });
};

export const listCodexVisionModels = async (options: CodexAppServerOptions = {}): Promise<CodexVisionModel[]> => withAppServer(options, async (client) => {
  const models: CodexVisionModel[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const response = await client.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }) as { data?: unknown; nextCursor?: unknown };
    models.push(...extractModels(response));
    cursor = typeof response.nextCursor === 'string' ? response.nextCursor : null;
    if (!cursor) break;
  }
  return models;
});

const LABEL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    shotSize: { type: ['string', 'null'] }, cameraMotion: { type: ['string', 'null'] }, cameraAxis: { type: ['string', 'null'] },
    lightingType: { type: ['string', 'null'] }, palette: { type: ['string', 'null'] }, composition: { type: ['string', 'null'] },
    subjectKind: { type: ['string', 'null'] }, narrativeFunctionGuess: { type: ['string', 'null'] }, transitionGuess: { type: ['string', 'null'] },
    actionPhaseSummary: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['shotSize', 'cameraMotion', 'cameraAxis', 'lightingType', 'palette', 'composition', 'subjectKind', 'narrativeFunctionGuess', 'transitionGuess', 'actionPhaseSummary', 'confidence'],
};

const labelPrompt = (signals: ShotSignals): string => [
  'Label one video shot from the supplied sampled JPEG images for a filmmaking craft log.',
  'Use only visible evidence. Do not invent details, source intent, creator identity, equipment, or production facts.',
  'Return only the required JSON object. Use null when a field cannot be supported by the images.',
  'All semantic fields are estimates, not verified facts. Confidence is your uncalibrated self-reported certainty.',
  `Measured signal context (not visual facts): cut_score_max=${signals.cutScoreMax}; luma_mean=${signals.lumaMean}; luma_stddev=${signals.lumaStddev}; brightness_trend=${signals.brightnessTrend}.`,
].join('\n');

const completedTurnText = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const turn = (payload as { turn?: unknown }).turn;
  if (!turn || typeof turn !== 'object') return null;
  const items = (turn as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const messages = items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as { type?: unknown; text?: unknown };
    return entry.type === 'agentMessage' && typeof entry.text === 'string' ? [entry.text] : [];
  });
  return messages.length ? messages.join('\n').trim() : null;
};

export interface CodexVisionCallResult { text: string | null; apiCallsUsed: number; }

export const requestCodexVisionLabels = async (
  config: { model: string; binaryPath?: string },
  frames: VisionRequestFrame[],
  signals: ShotSignals,
  counter: CodexVisionCallCounter,
  options: CodexAppServerOptions = {},
): Promise<CodexVisionCallResult> => {
  if (!frames.length) return { text: null, apiCallsUsed: 0 };
  if (counter.used >= counter.limit) throw new Error('Codex vision request budget exceeded.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(config.model)) throw new CodexAppServerError('provider-unavailable');
  return withAppServer({ ...options, ...(config.binaryPath ? { binaryPath: config.binaryPath } : {}) }, async (client, cwd) => {
    const started = await client.request('thread/start', {
      model: config.model,
      cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      developerInstructions: 'Perform image-only classification for the current request. Do not use tools, inspect local files, or execute commands. Return only the JSON result requested by the user.',
    }) as { thread?: { id?: unknown } };
    const threadId = started?.thread?.id;
    if (typeof threadId !== 'string' || !threadId) throw new CodexAppServerError('malformed-response');
    let resolveCompletion: (value: unknown) => void = () => undefined;
    let rejectCompletion: (error: Error) => void = () => undefined;
    const completion = new Promise<unknown>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
    const settledCompletion = completion.then((value) => ({ value }), (error: unknown) => ({ error }));
    const unsubscribe = client.onNotification((method, params) => {
      if (method === 'turn/completed') {
        const value = params as { threadId?: unknown; turn?: { status?: unknown; error?: unknown } };
        if (value?.threadId !== threadId) return;
        const status = value.turn?.status;
        if (status === 'failed' || status === 'interrupted') rejectCompletion(new CodexAppServerError('provider-rejected'));
        else resolveCompletion(params);
      }
      if (method === 'error') rejectCompletion(new CodexAppServerError('network-error'));
    });
    const timeout = setTimeout(() => rejectCompletion(new CodexAppServerError('timeout')), options.timeoutMs ?? 120_000);
    try {
      counter.used += 1;
      counter.onFrameRequest?.();
      await client.request('turn/start', {
        threadId,
        cwd,
        model: config.model,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        outputSchema: LABEL_SCHEMA,
        input: [
          { type: 'text', text: labelPrompt(signals), text_elements: [] },
          ...frames.map((frame) => ({ type: 'image', detail: 'high', url: `data:${frame.mime};base64,${frame.base64}` })),
        ],
      });
      const outcome = await settledCompletion;
      if ('error' in outcome) throw outcome.error;
      counter.onFrameResponseReceived?.();
      const text = completedTurnText(outcome.value);
      if (!text) throw new CodexAppServerError('malformed-response');
      return { text, apiCallsUsed: 1 };
    } finally {
      clearTimeout(timeout);
      unsubscribe();
    }
  });
};
