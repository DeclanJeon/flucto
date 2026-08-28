export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

const apiHeaders = (token?: string | null): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Flucto-Desktop',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

/** Public endpoint — no token needed. Returns null when the count cannot be resolved. */
export const fetchRepoStarCount = async (ref: GitHubRepoRef): Promise<number | null> => {
  try {
    const response = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { stargazers_count?: unknown };
    return typeof payload.stargazers_count === 'number' ? payload.stargazers_count : null;
  } catch {
    return null;
  }
};

/**
 * Whether the authenticated user has starred the repo.
 * Returns null when unknown (no token, network failure, or unexpected response).
 */
export const isRepoStarred = async (ref: GitHubRepoRef, token: string): Promise<boolean | null> => {
  try {
    const response = await fetch(`https://api.github.com/user/starred/${ref.owner}/${ref.repo}`, {
      headers: apiHeaders(token),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 204) return true;
    if (response.status === 404) return false;
    return null;
  } catch {
    return null;
  }
};

/** Stars the repo as the authenticated user. Throws with a readable message on failure. */
export const starRepo = async (ref: GitHubRepoRef, token: string): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/user/starred/${ref.owner}/${ref.repo}`, {
      method: 'PUT',
      headers: apiHeaders(token),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error: unknown) {
    throw new Error(`GitHub request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status === 204) return;
  if (response.status === 401) throw new Error('GitHub token was rejected (401). Check the token and its scopes.');
  if (response.status === 403) throw new Error('GitHub rejected the request (403). The token may lack the `repo`/`user` scope or be rate-limited.');
  throw new Error(`GitHub starring failed: HTTP ${response.status}`);
};
