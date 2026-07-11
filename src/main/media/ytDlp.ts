import { execa } from '../spawn.js';

export type YtDlpMetadata = Record<string, unknown>;

export const isThreadsUrl = (url: string): boolean =>
  url.includes('threads.com') || url.includes('threads.net');

export const getRefererForUrl = (url: string): string | null => {
  if (url.includes('x.com') || url.includes('twitter.com')) {
    return 'https://x.com/';
  }
  if (url.includes('reddit.com')) {
    return 'https://www.reddit.com/';
  }
  if (url.includes('bilibili.com')) {
    return 'https://www.bilibili.com/';
  }
  if (isThreadsUrl(url)) {
    return 'https://www.threads.com/';
  }
  return null;
};

// Platform-specific yt-dlp options shared by download, metadata, format, and transcript paths.
export const getCommonYtDlpArgs = (url: string): string[] => {
  const args: string[] = [];

  if (url.includes('x.com') || url.includes('twitter.com')) {
    args.push(
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: en-US,en;q=0.9',
      '--add-header',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      '--add-header',
      'Accept-Encoding: gzip, deflate, br',
      '--add-header',
      'DNT: 1',
      '--add-header',
      'Connection: keep-alive',
      '--add-header',
      'Upgrade-Insecure-Requests: 1',
      '--add-header',
      'Sec-Fetch-Dest: document',
      '--add-header',
      'Sec-Fetch-Mode: navigate',
      '--add-header',
      'Sec-Fetch-Site: none',
      '--add-header',
      'Sec-Fetch-User: ?1',
      '--add-header',
      'Cache-Control: max-age=0',
      '--extractor-args',
      'twitter:api=legacy',
      '--extractor-args',
      'twitter:video=true',
    );
  } else if (url.includes('reddit.com')) {
    args.push(
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: en-US,en;q=0.9',
      '--add-header',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      '--extractor-args',
      'reddit:client_id=download_client',
      '--extractor-args',
      'reddit:client_secret=',
      '--ignore-errors',
      '--extractor-args',
      'reddit:username=',
    );
  } else if (url.includes('bilibili.com')) {
    args.push(
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
      '--add-header',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      '--add-header',
      'Referer: https://www.bilibili.com/',
      '--add-header',
      'Origin: https://www.bilibili.com',
      '--add-header',
      'Sec-Fetch-Dest: document',
      '--add-header',
      'Sec-Fetch-Mode: navigate',
      '--add-header',
      'Sec-Fetch-Site: same-origin',
      '--extractor-args',
      'bilibili:session_data=',
      '--extractor-args',
      'bilibili:quality=116',
    );
  } else if (url.includes('instagram.com') || url.includes('facebook.com')) {
    args.push(
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language: en-US,en;q=0.9',
    );
  } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
    args.push('--force-ipv4', '--windows-filenames');
  }

  return args;
};

export const parseJsonLines = (stdout: string): YtDlpMetadata[] => {
  const parsed: YtDlpMetadata[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value && typeof value === 'object') {
        parsed.push(value as YtDlpMetadata);
      }
    } catch {
      // yt-dlp can mix warnings into stdout on some platforms. Ignore non-JSON lines.
    }
  }
  return parsed;
};

export const parseLastJsonObjectFromStdout = (stdout: string): YtDlpMetadata => {
  const items = parseJsonLines(stdout);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if ('id' in item || 'title' in item || 'formats' in item) {
      return item;
    }
  }
  throw new Error('Could not parse yt-dlp JSON output');
};

export const runYtDlpJson = async (url: string, extraArgs: string[], ytDlpPath: string): Promise<YtDlpMetadata> => {
  const referer = getRefererForUrl(url);
  const result = await execa(
    ytDlpPath,
    [
      url,
      '--dump-json',
      '--no-warnings',
      ...(referer ? ['--add-header', `referer:${referer}`] : []),
      ...getCommonYtDlpArgs(url),
      ...extraArgs,
    ],
    { reject: false },
  );

  if (result.failed && !result.stdout.trim()) {
    throw new Error(result.stderr || 'No output from yt-dlp');
  }

  return parseLastJsonObjectFromStdout(result.stdout);
};
