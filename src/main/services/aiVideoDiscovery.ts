import type {
  AiVideoDiscoveryCandidate,
  AiVideoDiscoveryRequest,
  AiVideoDiscoveryResponse,
  AiVideoDiscoverySourceReport,
  VideoSearchScope,
} from '../../shared/types.js';
import { VIDEO_SEARCH_PLATFORM_IDS } from '../../shared/videoSearchPlatforms.js';
import { classifyAiVideoEvidence } from './aiVideoEvidence.js';
import { searchVideos } from './videoSearch.js';

const GENERIC_QUERIES = ['AI generated video', 'video made with AI', 'AI generated animation'] as const;
const MAX_RESULTS = 50;
const MAX_QUERY_CONCURRENCY = 4;

function buildDiscoveryQueries(query?: string): string[] {
  const term = query?.trim();
  if (!term) return [...GENERIC_QUERIES];
  return [
    `AI generated ${term} video`,
    `AI generated ${term} animation`,
    `${term} video made with AI`,
  ];
}

interface QueryResult {
  reports: AiVideoDiscoverySourceReport[];
  videos: Array<{ video: AiVideoDiscoveryCandidate; query: string; rank: number; metadataAvailable: boolean }>;
}

function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|igshid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch {
    return value;
  }
}

function validateRequest(request: AiVideoDiscoveryRequest): void {
  if (!request || typeof request !== 'object') throw new Error('A discovery request is required.');
  if (request.query !== undefined && typeof request.query !== 'string') {
    throw new Error('Discovery query must be text.');
  }
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_RESULTS) {
    throw new Error(`Discovery limit must be an integer from 1 to ${MAX_RESULTS}.`);
  }
  if (request.status && !['confirmed', 'likely', 'uncertain', 'not_ai', 'unavailable'].includes(request.status)) {
    throw new Error('Choose a valid AI-media status filter.');
  }
  if (request.sort && request.sort !== 'relevance' && request.sort !== 'popularity') {
    throw new Error('Discovery sort must be relevance or popularity.');
  }
  const platform = request.platform ?? 'all';
  if (platform !== 'all' && !VIDEO_SEARCH_PLATFORM_IDS.includes(platform)) {
    throw new Error(`Choose all or one of: ${VIDEO_SEARCH_PLATFORM_IDS.join(', ')}.`);
  }
}

async function searchQuery(
  platform: VideoSearchScope,
  query: string,
  limit: number,
  queryIndex: number,
): Promise<QueryResult> {
  const response = await searchVideos({ platform, query, limit });
  return {
    reports: response.sources.map((source) => ({ ...source, query })),
    videos: response.videos.map((video, rank) => {
      const { aiDisclosures, aiDisclosureMetadataAvailable, ...videoInfo } = video;
      const metadataAvailable = aiDisclosureMetadataAvailable ?? aiDisclosures !== undefined;
      const classified = classifyAiVideoEvidence({
        disclosures: aiDisclosures ?? [],
        metadataAvailable,
      });
      return {
        video: {
          ...videoInfo,
          ...classified,
          canonicalUrl: canonicalizeUrl(video.originalUrl ?? ''),
          matchedQueries: [],
          popularityBasis: 'unknown',
          discoveryRank: queryIndex * MAX_RESULTS + rank,
        },
        query,
        metadataAvailable,
        rank,
      };
    }),
  };
}

function applyPopularityRanking(candidates: AiVideoDiscoveryCandidate[]): void {
  const byPlatform = new Map<string, AiVideoDiscoveryCandidate[]>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.view_count) || candidate.view_count! < 0) continue;
    const peers = byPlatform.get(candidate.platform) ?? [];
    peers.push(candidate);
    byPlatform.set(candidate.platform, peers);
  }
  for (const peers of byPlatform.values()) {
    if (peers.length < 2) continue;
    peers.sort((a, b) => a.view_count! - b.view_count! || a.discoveryRank - b.discoveryRank);
    peers.forEach((candidate, index) => {
      candidate.popularityScore = (index / (peers.length - 1)) * 100;
      candidate.popularityBasis = 'view_count_percentile';
    });
  }
}

export async function discoverAiVideos(request: AiVideoDiscoveryRequest): Promise<AiVideoDiscoveryResponse> {
  validateRequest(request);
  const platform = request.platform ?? 'all';
  const normalizedQuery = request.query?.trim() || undefined;
  const queries = buildDiscoveryQueries(normalizedQuery);
  const results: QueryResult[] = new Array(queries.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(MAX_QUERY_CONCURRENCY, queries.length) }, async () => {
    while (next < queries.length) {
      const index = next++;
      try {
        results[index] = await searchQuery(platform, queries[index], request.limit, index);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const platforms = platform === 'all' ? VIDEO_SEARCH_PLATFORM_IDS : [platform];
        results[index] = {
          reports: platforms.map((sourcePlatform) => ({
            platform: sourcePlatform,
            method: 'native',
            searchUrl: '',
            count: 0,
            error: message,
            query: queries[index],
          })),
          videos: [],
        };
      }
    }
  });
  await Promise.all(workers);

  const sourceReports = results.flatMap((result) => result.reports);
  const metadataAvailability = new Map<string, boolean>();
  const byCanonicalUrl = new Map<string, AiVideoDiscoveryCandidate>();
  for (const result of results) {
    for (const { video, query, metadataAvailable } of result.videos) {
      const key = video.canonicalUrl || video.originalUrl || '';
      if (!key) continue;
      const mergedMetadataAvailable = (metadataAvailability.get(key) ?? false) || metadataAvailable;
      metadataAvailability.set(key, mergedMetadataAvailable);
      const existing = byCanonicalUrl.get(key);
      if (existing) {
        if (!existing.matchedQueries.includes(query)) existing.matchedQueries.push(query);
        const mergedEvidence = new Map(existing.evidence.map((item) => [`${item.source}\u0000${item.url ?? ''}\u0000${item.text}`, item]));
        for (const item of video.evidence) mergedEvidence.set(`${item.source}\u0000${item.url ?? ''}\u0000${item.text}`, item);
        Object.assign(existing, classifyAiVideoEvidence({
          disclosures: [...mergedEvidence.values()],
          metadataAvailable: mergedMetadataAvailable,
        }));
      } else {
        video.matchedQueries.push(query);
        byCanonicalUrl.set(key, video);
      }
    }
  }

  const evidenceRank: Record<AiVideoDiscoveryCandidate['aiMediaStatus'], number> = {
    confirmed: 0,
    likely: 1,
    uncertain: 2,
    not_ai: 3,
    unavailable: 4,
  };
  let candidates = [...byCanonicalUrl.values()].sort((a, b) =>
    evidenceRank[a.aiMediaStatus] - evidenceRank[b.aiMediaStatus]
      || a.discoveryRank - b.discoveryRank);
  applyPopularityRanking(candidates);
  if (request.status) candidates = candidates.filter((candidate) => candidate.aiMediaStatus === request.status);
  if (request.sort === 'popularity') {
    candidates.sort((a, b) => {
      const aScore = a.popularityScore;
      const bScore = b.popularityScore;
      if (aScore === undefined && bScore !== undefined) return 1;
      if (aScore !== undefined && bScore === undefined) return -1;
      return (bScore ?? 0) - (aScore ?? 0) || a.discoveryRank - b.discoveryRank;
    });
  }
  candidates = candidates.slice(0, request.limit);
  const failed = sourceReports.filter((source) => source.error);
  const allFailed = sourceReports.length > 0 && sourceReports.every((source) => source.error);
  return {
    ...(normalizedQuery ? { query: normalizedQuery } : {}),
    platform,
    candidates,
    sourceReports,
    partialFailure: failed.length > 0 && !allFailed,
    error: allFailed ? 'Every discovery search source failed. Check the source errors and original search links.' : undefined,
  };
}
