export interface GitHubReleaseAsset {
  name: string;
  url: string;
  size: number;
  contentType: string;
}

export interface GitHubReleaseInfo {
  tagName: string;
  version: string;
  url: string;
  publishedAt: string;
  assets: GitHubReleaseAsset[];
}

interface GitHubApiAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  content_type?: unknown;
}

interface GitHubApiRelease {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

export const normalizeVersion = (version: string): string => version.trim().replace(/^v/i, '');

export const compareVersions = (left: string, right: string): number => {
  const parse = (value: string): number[] => normalizeVersion(value).split(/[.-]/).map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const a = parse(left);
  const b = parse(right);
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
};

export const parseGitHubRelease = (payload: unknown): GitHubReleaseInfo => {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid GitHub release payload.');
  const release = payload as GitHubApiRelease;
  if (typeof release.tag_name !== 'string') throw new Error('GitHub release payload is missing tag_name.');
  const assetsPayload = Array.isArray(release.assets) ? release.assets : [];
  return {
    tagName: release.tag_name,
    version: normalizeVersion(release.tag_name),
    url: typeof release.html_url === 'string' ? release.html_url : '',
    publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
    assets: assetsPayload.flatMap((asset): GitHubReleaseAsset[] => {
      if (!asset || typeof asset !== 'object') return [];
      const candidate = asset as GitHubApiAsset;
      if (typeof candidate.name !== 'string' || typeof candidate.browser_download_url !== 'string') return [];
      return [{
        name: candidate.name,
        url: candidate.browser_download_url,
        size: typeof candidate.size === 'number' ? candidate.size : 0,
        contentType: typeof candidate.content_type === 'string' ? candidate.content_type : 'application/octet-stream',
      }];
    }),
  };
};

export const fetchLatestRelease = async (repo = 'DeclanJeon/flucto', env: NodeJS.ProcessEnv = process.env): Promise<GitHubReleaseInfo> => {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'Flucto CLI updater',
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub release check failed: HTTP ${response.status}`);
  }
  return parseGitHubRelease(await response.json());
};
