import { useState, type FormEvent } from 'react';
import { AlertTriangle, ExternalLink, Loader2, Plus, Search } from 'lucide-react';
import type { VideoInfo, VideoSearchResponse, VideoSearchScope } from '../../../shared/types';
import { VIDEO_SEARCH_PLATFORM_IDS, VIDEO_SEARCH_SITES } from '../../../shared/videoSearchPlatforms';


export function VideoSearch({ onAdd, queuedUrls, disabled }: {
  onAdd: (video: VideoInfo) => void;
  queuedUrls: Set<string>;
  disabled: boolean;
}) {
  const [scope, setScope] = useState<VideoSearchScope>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VideoSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !query.trim()) return;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      setResult(await window.api.searchVideos({ platform: scope, query, limit: 20 }));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const sources = result?.sources ?? [];
  const failedSources = sources.filter((source) => source.error);
  const hasIndexed = sources.some((source) => source.method === 'web-index');

  return (
    <section className="w-full max-w-2xl mt-6 rounded-2xl border border-white/10 bg-[#1c1c1e] p-4" aria-label="Video search">
      <h2 className="text-sm font-semibold text-gray-200 mb-3">Search videos</h2>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <select aria-label="Search platform" value={scope} disabled={busy}
          onChange={(event) => { setScope(event.target.value as VideoSearchScope); setResult(null); setError(null); }}
          className="rounded-lg bg-[#0d0d0d] border border-white/15 px-3 py-2 text-sm">
          <option value="all">All sites (integrated)</option>
          {VIDEO_SEARCH_PLATFORM_IDS.map((id) => <option key={id} value={id}>{VIDEO_SEARCH_SITES[id].name}</option>)}
        </select>
        <input aria-label="Video search keyword" placeholder="Enter a keyword" value={query}
          onChange={(event) => setQuery(event.target.value)} disabled={busy}
          className="min-w-32 flex-1 rounded-lg bg-[#0d0d0d] border border-white/15 px-3 py-2 text-sm focus:outline-blue-500" />
        <button type="submit" disabled={busy || !query.trim()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Search
        </button>
      </form>
      <div aria-live="polite" className="mt-3 text-sm">
        {busy && <p className="text-gray-400">Searching…</p>}
        {error && <p role="alert" className="text-amber-300">{error}</p>}
        {result && <>
          {result.error
            ? <p role="alert" className="text-amber-300">{result.error}</p>
            : result.videos.length > 0
              ? <p className="text-gray-400">{result.videos.length} results · add videos to your download queue</p>
              : <p className="text-gray-400">No videos found.</p>}
          {sources.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className={`cursor-pointer ${failedSources.length ? 'text-amber-300' : 'text-gray-400'}`}>
                Search sources ({sources.length}) · {failedSources.length} failed
              </summary>
              <ul className="mt-2 space-y-1" aria-label="Search source status">
                {sources.map((source) => (
                  <li key={source.platform} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-400">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-medium text-gray-200">{VIDEO_SEARCH_SITES[source.platform].name}</span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 uppercase tracking-wide text-gray-500">{source.method === 'native' ? 'native' : 'index'}</span>
                    {source.error
                      ? <span className="inline-flex items-center gap-1 text-amber-300"><AlertTriangle size={12} />{source.error}</span>
                      : <span>{source.count} result{source.count === 1 ? '' : 's'}</span>}
                    {source.nativeError && (
                      <span className="inline-flex items-center gap-1 text-amber-300" title={source.nativeError}>
                        <AlertTriangle size={12} />native unavailable
                      </span>
                    )}
                    <a href={source.searchUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-400 underline">
                      {source.method === 'web-index' ? 'index search' : 'site search'}<ExternalLink size={11} />
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {hasIndexed && (
            <p className="mt-2 text-xs text-gray-500">
              Public indexes can miss videos or require verification. Indexed videos may need a site session or be unavailable for download.
            </p>
          )}
          <ul className="mt-3 max-h-96 overflow-y-auto space-y-2">
            {result.videos.map((video) => {
              const queued = queuedUrls.has(video.originalUrl ?? '');
              return <li key={`${video.platform}:${video.originalUrl}`} className="flex items-center gap-3 rounded-lg bg-black/20 p-2">
                {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-12 w-20 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <a href={video.originalUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-gray-200 hover:text-blue-300">{video.title}</a>
                  <p className="text-xs text-gray-500 truncate">
                    <span className="mr-1 rounded bg-white/10 px-1 py-0.5 text-gray-300">{VIDEO_SEARCH_SITES[video.platform].name} · {video.searchMethod === 'native' ? 'native' : 'index'}</span>
                    {video.uploader}{video.duration > 0 ? ` · ${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, '0')}` : ''}
                  </p>
                </div>
                <button type="button" disabled={disabled || queued || !video.originalUrl} onClick={() => onAdd(video)} aria-label={`Add ${video.title} to queue`}
                  className="flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-xs disabled:opacity-40">
                  <Plus size={14} />{queued ? 'Added' : 'Add'}
                </button>
              </li>;
            })}
          </ul>
        </>}
      </div>
    </section>
  );
}
