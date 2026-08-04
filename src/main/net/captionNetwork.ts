export type CookiesFromBrowser =
  | 'chrome'
  | 'chromium'
  | 'chrome-beta'
  | 'chrome-canary'
  | 'brave'
  | 'edge'
  | 'firefox'
  | 'opera'
  | 'safari'
  | 'whale'
  | 'vivaldi'
  | string;

export interface CaptionNetworkOptions {
  cookiesPath?: string | null;
  cookiesFromBrowser?: CookiesFromBrowser | null;
  proxy?: string | null;
  impersonate?: string | null;
  minIntervalMs?: number;
  maxRetries?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 1_500;
const DEFAULT_MAX_RETRIES = 3;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const resolveCaptionNetworkOptions = (
  overrides: CaptionNetworkOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): CaptionNetworkOptions => {
  const cookiesPath = overrides.cookiesPath
    ?? env.FLUCTO_COOKIES
    ?? env.YOUTUBE_COOKIES_PATH
    ?? null;
  const cookiesFromBrowser = overrides.cookiesFromBrowser
    ?? env.FLUCTO_COOKIES_FROM_BROWSER
    ?? null;
  const proxy = overrides.proxy
    ?? env.FLUCTO_PROXY
    ?? env.HTTPS_PROXY
    ?? env.HTTP_PROXY
    ?? env.ALL_PROXY
    ?? null;
  const impersonate = overrides.impersonate
    ?? env.FLUCTO_IMPERSONATE
    ?? null;

  return {
    cookiesPath: cookiesPath?.trim() || null,
    cookiesFromBrowser: cookiesFromBrowser?.trim() || null,
    proxy: proxy?.trim() || null,
    impersonate: impersonate?.trim() || null,
    minIntervalMs: overrides.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
    maxRetries: overrides.maxRetries ?? DEFAULT_MAX_RETRIES,
  };
};

export const getCaptionNetworkArgs = (network: CaptionNetworkOptions = {}): string[] => {
  const resolved = resolveCaptionNetworkOptions(network);
  const args: string[] = [];

  if (resolved.cookiesPath) {
    args.push('--cookies', resolved.cookiesPath);
  }
  if (resolved.cookiesFromBrowser) {
    args.push('--cookies-from-browser', resolved.cookiesFromBrowser);
  }
  if (resolved.proxy) {
    args.push('--proxy', resolved.proxy);
  }
  if (resolved.impersonate) {
    args.push('--impersonate', resolved.impersonate);
  }

  return args;
};

export class CaptionScheduler {
  private queue: Promise<void> = Promise.resolve();
  private lastStartAt = 0;

  run<T>(task: () => Promise<T>, minIntervalMs = DEFAULT_MIN_INTERVAL_MS): Promise<T> {
    const execute = this.queue.then(async () => {
      const elapsed = Date.now() - this.lastStartAt;
      const baseWait = Math.max(0, minIntervalMs - elapsed);
      const jitter = minIntervalMs > 0 ? Math.floor(Math.random() * Math.min(500, minIntervalMs)) : 0;
      const waitMs = baseWait + jitter;
      if (waitMs > 0) await sleep(waitMs);
      this.lastStartAt = Date.now();
      return task();
    });

    this.queue = execute.then(
      () => undefined,
      () => undefined,
    );

    return execute;
  }
}

export const globalCaptionScheduler = new CaptionScheduler();

export const backoffDelayMs = (attempt: number, retryAfterMs?: number | null): number => {
  if (retryAfterMs && retryAfterMs > 0) return retryAfterMs;
  const base = Math.min(45_000, 2_000 * (2 ** Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
};

export const parseRetryAfterMs = (message: string): number | null => {
  const match = message.match(/retry-after[=:\s]+(\d+)/i);
  if (!match) return null;
  const seconds = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
};

export const sleepMs = sleep;
