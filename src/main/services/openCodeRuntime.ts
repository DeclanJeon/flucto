import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { getOpenCodeBinaryPath } from '../utils.js';

export interface OpenCodeVisionModel {
  providerID: string;
  modelID: string;
  name: string;
  free: boolean;
  acceptsImages: boolean;
  contextLimit: number | null;
}

interface ProviderModelRecord {
  id?: unknown;
  name?: unknown;
  cost?: { input?: unknown; output?: unknown };
  limit?: { context?: unknown };
  capabilities?: { input?: { image?: unknown } };
}

interface ProviderRecord {
  id?: unknown;
  models?: Record<string, ProviderModelRecord>;
}

const validId = (value: unknown): value is string => (
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
);
const validModelId = (value: unknown): value is string => (
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)
);

export const parseOpenCodeProviders = (payload: unknown): OpenCodeVisionModel[] => {
  if (!payload || typeof payload !== 'object') return [];
  const providers = (payload as { all?: unknown }).all;
  if (!Array.isArray(providers)) return [];
  const result: OpenCodeVisionModel[] = [];
  for (const rawProvider of providers) {
    if (!rawProvider || typeof rawProvider !== 'object') continue;
    const provider = rawProvider as ProviderRecord;
    if (!validId(provider.id) || !provider.models || typeof provider.models !== 'object') continue;
    for (const [mapId, model] of Object.entries(provider.models)) {
      if (!model || typeof model !== 'object') continue;
      const inputCost = model.cost?.input;
      const outputCost = model.cost?.output;
      const listedZeroCost = typeof inputCost === 'number' && inputCost === 0
        && typeof outputCost === 'number' && outputCost === 0;
      const modelName = typeof model.name === 'string' ? model.name : mapId;
      const explicitlyFree = /\bfree\b/i.test(modelName)
        || /(?:^|[-/:])free(?:$|[-/:])/i.test(mapId);
      const acceptsImages = model.capabilities?.input?.image === true;
      // Zero/absent prices in model catalogs often mean unreported pricing,
      // not free inference. Require an explicit free designation as well.
      if (!listedZeroCost || !explicitlyFree || !acceptsImages) continue;
      const modelID = validModelId(model.id) ? model.id : mapId;
      if (!validModelId(modelID)) continue;
      const context = model.limit?.context;
      result.push({
        providerID: provider.id,
        modelID,
        name: modelName,
        free: true,
        acceptsImages: true,
        contextLimit: typeof context === 'number' && Number.isFinite(context) ? context : null,
      });
    }
  }
  return result.sort((a, b) => a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name));
};

const getFreePort = async (): Promise<number> => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('Could not allocate a local OpenCode port'));
      return;
    }
    const { port } = address;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

export interface OpenCodeRuntime {
  baseURL: string;
  username: string;
  password: string;
  close(): Promise<void>;
}

export interface OpenCodeRuntimeOptions {
  binaryPath?: string;
  tempRoot?: string;
  startupTimeoutMs?: number;
  shutdownGraceMs?: number;
  spawnProcess?: typeof spawn;
}

/** Start the app-managed, loopback-only OpenCode server. Credentials are passed
 * through the OpenCode config environment and never placed on the command line. */
export const startOpenCodeRuntime = async (
  credential?: { providerID: string; apiKey: string },
  options: OpenCodeRuntimeOptions = {},
): Promise<OpenCodeRuntime> => {
  if (credential && (!validId(credential.providerID) || !credential.apiKey || credential.apiKey.length > 4096)) {
    throw new Error('OpenCode provider credentials are invalid.');
  }
  const binary = options.binaryPath ?? getOpenCodeBinaryPath();
  const port = await getFreePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const isolatedConfigDir = fs.mkdtempSync(path.join(options.tempRoot ?? os.tmpdir(), 'flucto-opencode-'));
  const serverUsername = 'flucto';
  const serverPassword = randomBytes(32).toString('base64url');
  const inheritedEnvKeys = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SYSTEMROOT', 'WINDIR', 'LANG', 'XDG_CACHE_HOME'];
  const env = Object.fromEntries(inheritedEnvKeys.flatMap((key) => process.env[key] ? [[key, process.env[key] as string]] : [])) as NodeJS.ProcessEnv;
  env.HOME = isolatedConfigDir;
  env.USERPROFILE = isolatedConfigDir;
  env.APPDATA = path.join(isolatedConfigDir, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(isolatedConfigDir, 'AppData', 'Local');
  env.XDG_CONFIG_HOME = path.join(isolatedConfigDir, 'config');
  env.XDG_DATA_HOME = path.join(isolatedConfigDir, 'data');
  env.XDG_STATE_HOME = path.join(isolatedConfigDir, 'state');
  env.XDG_CACHE_HOME = path.join(isolatedConfigDir, 'cache');
  env.OPENCODE_CONFIG_DIR = isolatedConfigDir;
  env.OPENCODE_SERVER_USERNAME = serverUsername;
  env.OPENCODE_SERVER_PASSWORD = serverPassword;
  if (credential) {
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      provider: { [credential.providerID]: { options: { apiKey: credential.apiKey } } },
    });
  }
  const child: ChildProcess = (options.spawnProcess ?? spawn)(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    env,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
  });
  let exited = false;
  let spawnError: Error | null = null;
  const exitPromise = new Promise<void>((resolve) => {
    child.once('error', (error) => { spawnError = error; exited = true; resolve(); });
    child.once('close', () => { exited = true; resolve(); });
  });
  const stop = async (): Promise<void> => {
    if (!exited) child.kill('SIGTERM');
    if (!exited) {
      const grace = options.shutdownGraceMs ?? 2500;
      await Promise.race([exitPromise, new Promise<void>((resolve) => setTimeout(resolve, grace))]);
    }
    if (!exited) {
      child.kill('SIGKILL');
      await exitPromise;
    }
  };
  const deadline = Date.now() + (options.startupTimeoutMs ?? 20000);
  let lastError: unknown;
  try {
    while (Date.now() < deadline && !exited) {
      if (spawnError) throw spawnError;
      try {
        const response = await fetch(`${baseURL}/provider`, { headers: { authorization: `Basic ${Buffer.from(`${serverUsername}:${serverPassword}`).toString('base64')}` }, signal: AbortSignal.timeout(1000), redirect: 'error' });
        if (response.ok) {
          let closePromise: Promise<void> | undefined;
          return {
            baseURL,
            username: serverUsername,
            password: serverPassword,
            close: () => closePromise ??= (async () => { try { await stop(); } finally { fs.rmSync(isolatedConfigDir, { recursive: true, force: true }); } })(),
          };
        }
        lastError = new Error(`OpenCode returned HTTP ${response.status}`);
      } catch (error) { lastError = error; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Could not start the bundled OpenCode service${spawnError ? '' : lastError instanceof Error ? `: ${lastError.message}` : ''}`);
  } catch (error) {
    try { await stop(); } finally { fs.rmSync(isolatedConfigDir, { recursive: true, force: true }); }
    if (spawnError) throw new Error('Could not start the bundled OpenCode service (spawn failed)');
    throw error;
  }
};

export const listFreeVisionModels = async (): Promise<OpenCodeVisionModel[]> => {
  const runtime = await startOpenCodeRuntime();
  try {
    const response = await fetch(`${runtime.baseURL}/provider`, { headers: { authorization: `Basic ${Buffer.from(`${runtime.username}:${runtime.password}`).toString('base64')}` }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`OpenCode model catalog failed (HTTP ${response.status})`);
    return parseOpenCodeProviders(await response.json());
  } finally {
    await runtime.close();
  }
};
