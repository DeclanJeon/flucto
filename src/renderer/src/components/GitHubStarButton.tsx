import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';

interface GitHubStarButtonProps {
  owner: string;
  repo: string;
}

/**
 * Click-to-star button for the Flucto repository.
 * - With a saved GitHub token, clicking stars the repo directly via the GitHub API.
 * - Without a token, clicking opens the repo in the browser (classic starring path)
 *   and offers a one-time token setup for one-click starring next time.
 */
export const GitHubStarButton = ({ owner, repo }: GitHubStarButtonProps) => {
  const [starCount, setStarCount] = useState<number | null>(null);
  const [starred, setStarred] = useState<boolean | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showTokenSetup, setShowTokenSetup] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const repoUrl = `https://github.com/${owner}/${repo}`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await window.api.getGitHubStarState();
        if (cancelled) return;
        setStarred(state.starred);
        setHasToken(state.hasToken);
        if (state.starCount !== null) setStarCount(state.starCount);
      } catch {
        // State load is best-effort; the public count fetch below still runs.
      }
    })();
    void (async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled && typeof data.stargazers_count === 'number') {
          setStarCount(data.stargazers_count);
        }
      } catch {
        // Count stays unknown; the button still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, reloadKey]);

  const starViaToken = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.api.starFluctoRepo();
      if (result.starred) {
        setStarred(true);
        setStarCount(typeof result.starCount === 'number' ? result.starCount : (current) => (current ?? 0) + 1);
        setShowTokenSetup(false);
      } else {
        setMessage(result.message);
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleStar = async () => {
    if (starred) {
      // Already starred — open the repo so the user can manage it.
      window.open(repoUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (hasToken) {
      await starViaToken();
      return;
    }
    // No token yet: open the repo (classic starring path) and offer one-click setup.
    window.open(repoUrl, '_blank', 'noopener,noreferrer');
    setShowTokenSetup(true);
    setMessage('Tip: add a GitHub token below to star with a single click next time.');
  };

  const handleSaveToken = async () => {
    const token = tokenInput.trim();
    if (!token) return;
    setBusy(true);
    setMessage(null);
    try {
      await window.api.saveGitHubToken(token);
      setTokenInput('');
      setHasToken(true);
      setReloadKey((key) => key + 1);
      await starViaToken();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void handleStar()}
        disabled={busy}
        title={starred ? 'Starred — open repository' : 'Star Flucto on GitHub'}
        className={`flex items-center gap-2 rounded px-3 py-1.5 transition-colors duration-200 ${
          starred
            ? 'bg-yellow-500/20 hover:bg-yellow-500/30'
            : 'bg-gray-800 hover:bg-gray-700'
        } disabled:opacity-50`}
      >
        <Star className={starred ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'} />
        {starCount === null ? (
          <span className="text-gray-400 text-sm">…</span>
        ) : (
          <span className="font-semibold">{starCount}</span>
        )}
      </button>

      {showTokenSetup && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-white/10 bg-[#1c1c1e] p-3 text-xs text-gray-300 shadow-xl">
          <p className="mb-2 font-semibold text-gray-200">One-click starring</p>
          <p className="mb-2 text-gray-400">
            Paste a GitHub personal access token (no scopes needed for public repos).
            It is stored encrypted on this device and only used to star {owner}/{repo}.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={tokenInput}
              placeholder="ghp_… or github_pat_…"
              onChange={(event) => setTokenInput(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-gray-200 outline-none focus:border-blue-500/60"
            />
            <button
              type="button"
              onClick={() => void handleSaveToken()}
              disabled={busy || !tokenInput.trim()}
              className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Save
            </button>
          </div>
          {message && <p className="mt-2 text-gray-400">{message}</p>}
        </div>
      )}
    </div>
  );
};
