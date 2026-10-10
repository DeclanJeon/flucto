import { useState, type FormEvent } from 'react';
import { AlertTriangle, ExternalLink, Loader2, Plus, Search } from 'lucide-react';
import type {
  AiMediaStatus,
  AiVideoDiscoveryCandidate,
  AiVideoDiscoveryResponse,
  VideoInfo,
  VideoSearchScope,
} from '../../../shared/types';
import { VIDEO_SEARCH_PLATFORM_IDS, VIDEO_SEARCH_SITES } from '../../../shared/videoSearchPlatforms';

const STATUSES: AiMediaStatus[] = ['confirmed', 'likely', 'uncertain', 'not_ai', 'unavailable'];

export function AiVideoDiscovery({ onAdd, queuedUrls, disabled }: {
  onAdd: (video: VideoInfo) => void;
  queuedUrls: Set<string>;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<VideoSearchScope>('all');
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<AiMediaStatus | ''>('');
  const [sort, setSort] = useState<'relevance' | 'popularity'>('relevance');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiVideoDiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !Number.isInteger(limit) || limit < 1 || limit > 50) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setSelected(new Set());
    try {
      setResult(await window.api.discoverAiVideos({
        query: query.trim() || undefined, platform, limit, status: status || undefined, sort,
      }));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const toggleSelection = (candidate: AiVideoDiscoveryCandidate) => {
    const key = candidate.canonicalUrl;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addSelected = () => {
    for (const candidate of result?.candidates ?? []) {
      if (selected.has(candidate.canonicalUrl) && !queuedUrls.has(candidate.originalUrl ?? '')) onAdd(candidate);
    }
    setSelected(new Set());
  };

  const sources = result?.sourceReports ?? [];
  const failedSources = sources.filter((source) => source.error);
  const selectedCount = (result?.candidates ?? []).filter((candidate) => selected.has(candidate.canonicalUrl)
    && !queuedUrls.has(candidate.originalUrl ?? '')).length;

  return (
    <section className="w-full max-w-2xl mt-6 rounded-2xl border border-white/10 bg-[#1c1c1e] p-4" aria-label="AI video discovery">
      <h2 className="mb-3 text-sm font-semibold text-gray-200">AI video discovery</h2>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="discovery-query">Search concepts (optional)</label>
        <input id="discovery-query" aria-label="Search concepts" type="search" value={query} disabled={busy}
          onChange={(event) => setQuery(event.target.value)} placeholder="Search concepts (optional)"
          className="min-w-48 flex-1 rounded-lg border border-white/15 bg-[#0d0d0d] px-3 py-2 text-sm" />
        <label className="sr-only" htmlFor="discovery-platform">Discovery platform</label>
        <select id="discovery-platform" aria-label="Discovery platform" value={platform} disabled={busy}
          onChange={(event) => setPlatform(event.target.value as VideoSearchScope)}
          className="rounded-lg border border-white/15 bg-[#0d0d0d] px-2 py-2 text-sm">
          <option value="all">All platforms</option>
          {VIDEO_SEARCH_PLATFORM_IDS.map((id) => <option key={id} value={id}>{VIDEO_SEARCH_SITES[id].name}</option>)}
        </select>
        <label className="sr-only" htmlFor="discovery-limit">Maximum candidates</label>
        <input id="discovery-limit" aria-label="Maximum candidates" type="number" min={1} max={50} step={1} value={limit}
          disabled={busy} onChange={(event) => setLimit(Number(event.target.value))}
          className="w-20 rounded-lg border border-white/15 bg-[#0d0d0d] px-2 py-2 text-sm" />
        <label className="sr-only" htmlFor="discovery-status">AI-media status filter</label>
        <select id="discovery-status" aria-label="AI-media status filter" value={status} disabled={busy}
          onChange={(event) => setStatus(event.target.value as AiMediaStatus | '')}
          className="rounded-lg border border-white/15 bg-[#0d0d0d] px-2 py-2 text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <label className="sr-only" htmlFor="discovery-sort">Discovery sort order</label>
        <select id="discovery-sort" aria-label="Discovery sort order" value={sort} disabled={busy}
          onChange={(event) => setSort(event.target.value as 'relevance' | 'popularity')}
          className="rounded-lg border border-white/15 bg-[#0d0d0d] px-2 py-2 text-sm">
          <option value="relevance">Relevance</option>
          <option value="popularity">Platform-relative popularity</option>
        </select>
        <button type="submit" disabled={busy || disabled || !Number.isInteger(limit) || limit < 1 || limit > 50}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Discover
        </button>
      </form>
      <p className="mt-2 text-xs text-gray-500">Uses public text disclosures only. Search phrases and titles do not prove generated media.</p>
      <div aria-live="polite" className="mt-3 space-y-3 text-sm">
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {result?.error && <p role="alert" className="text-red-300">{result.error}</p>}
        {failedSources.length > 0 && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-amber-200">
            <p className="mb-2 flex items-center gap-2"><AlertTriangle size={15} />Some query/platform searches failed.</p>
            {failedSources.map((source, index) => <p key={`${source.query}-${source.platform}-${index}`} className="text-xs">
              {source.platform} · {source.query}: {source.error} · <a className="underline" href={source.searchUrl} target="_blank" rel="noopener noreferrer">source</a>
            </p>)}
          </div>
        )}
        {result?.candidates.map((candidate) => {
          const url = candidate.originalUrl ?? '';
          const isQueued = queuedUrls.has(url);
          const isSelected = selected.has(candidate.canonicalUrl);
          const popularity = candidate.popularityScore === undefined
            ? 'Popularity unknown'
            : `${Math.round(candidate.popularityScore)} platform-relative view percentile`;
          return (
            <article key={candidate.canonicalUrl} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-start gap-3">
                <input type="checkbox" aria-label={`Select ${candidate.title}`} checked={isSelected} disabled={disabled || isQueued}
                  onChange={() => toggleSelection(candidate)} className="mt-1 accent-blue-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-100">{candidate.title}</span>
                    <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{candidate.aiMediaStatus}</span>
                    <span className="text-xs text-gray-400">AI assistance: {candidate.aiAssistedStatus}</span>
                    {isQueued && <span className="text-xs text-emerald-300">Queued</span>}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{VIDEO_SEARCH_SITES[candidate.platform].name} · {candidate.searchMethod}
                    {' · '}{candidate.view_count === undefined ? 'Views unavailable' : `${candidate.view_count} views`}
                    {' · '}{popularity}</p>
                  <p className="mt-1 break-words text-xs text-gray-500">Matched queries: {candidate.matchedQueries.join(' · ')}</p>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-xs text-blue-300 underline">
                    Original post <ExternalLink size={12} />
                  </a>
                  <p className="mt-1 text-xs text-gray-400">Reasons: {candidate.reasonCodes.join(', ')}</p>
                  <p className="mt-1 text-xs text-gray-500">Evidence grade: {candidate.evidenceGrade} · {candidate.classificationMethod}</p>
                  {candidate.evidence.length > 0 ? candidate.evidence.map((item, index) => (
                    <blockquote key={`${item.source}-${index}`} className="mt-1 border-l-2 border-white/15 pl-2 text-xs text-gray-300">
                      {item.source}: {item.text}
                    </blockquote>
                  )) : <p className="mt-1 text-xs text-gray-500">{candidate.aiMediaStatus === 'unavailable'
                    ? 'Disclosure metadata unavailable in this search result.'
                    : 'No direct media-generation disclosure in available search metadata.'}</p>}
                </div>
              </div>
            </article>
          );
        })}
        {result && result.candidates.length === 0 && !result.error
          && <p className="text-gray-400">No candidates matched this search and its selected filters.</p>}
        {result && result.candidates.length > 0
          && !result.candidates.some((candidate) => candidate.aiMediaStatus === 'confirmed' || candidate.aiMediaStatus === 'likely')
          && <p className="text-amber-200">No result has confirmed or likely public evidence of AI media generation. Search terms do not establish this status.</p>}
        {result && selectedCount > 0 && <button type="button" disabled={disabled} onClick={addSelected}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm disabled:opacity-50">
          <Plus size={16} /> Add {selectedCount} selected to queue
        </button>}
      </div>
      <p className="mt-3 text-xs text-gray-500">Adding a reference does not start a download. Public visibility does not grant reuse rights.</p>
    </section>
  );
}
