import { useState, useEffect, useCallback } from 'react';
import { Star } from 'lucide-react';

interface GitHubStarButtonProps {
  owner: string;
  repo: string;
}

export const GitHubStarButton = ({ owner, repo }: GitHubStarButtonProps) => {
  const [starCount, setStarCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const loadStarCount = useCallback(async () => {
    setLoading(true);
    try {
      // GitHub REST API call to get star count
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
          headers: {
            'Accept': 'application/vnd.github+json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setStarCount(data.stargazers_count || 0);
      }
    } catch (error) {
      console.error('Failed to load star count:', error);
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    loadStarCount();
  }, [loadStarCount]);

  const handleStar = async () => {
    const url = `https://github.com/${owner}/${repo}`;
    window.open(url, '_blank', 'noopener,noreferrer');

    // Wait 1 second then refresh star count
    setTimeout(() => {
      loadStarCount();
    }, 1000);
  };

  return (
    <button
      onClick={handleStar}
      disabled={loading}
      className="flex items-center gap-2 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 transition-colors duration-200"
    >
      <Star className={starCount > 0 ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'} />
      {loading ? (
        <span className="text-gray-400 text-sm">Loading...</span>
      ) : (
        <span className="font-semibold">{starCount}</span>
      )}
    </button>
  );
};
