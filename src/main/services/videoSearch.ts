import type { VideoInfo, VideoSearchPlatform, VideoSearchProviderResult, VideoSearchRequest, VideoSearchResponse, VideoSearchSource } from '../../shared/types.js';
import { VIDEO_SEARCH_PLATFORM_IDS, VIDEO_SEARCH_SITES } from '../../shared/videoSearchPlatforms.js';
import { searchBilibili } from '../search/bilibili.js';
import { searchDailymotion } from '../search/dailymotion.js';
import { searchNicovideo } from '../search/nicovideo.js';
import { searchOk } from '../search/ok.js';
import { searchVkvideo } from '../search/vkvideo.js';
import { searchYouTube } from '../search/youtube.js';
import { searchReddit } from '../search/reddit.js';
import { searchVimeo } from '../search/vimeo.js';
import { searchSocialVideos } from '../search/socialSearch.js';
import { WebIndexSearchError } from '../search/webIndexSearch.js';

const providers: Record<VideoSearchPlatform, (query: string, limit: number) => Promise<VideoInfo[] | VideoSearchProviderResult>> = {
  youtube: searchYouTube,
  twitter: (query, limit) => searchSocialVideos('twitter', query, limit),
  instagram: (query, limit) => searchSocialVideos('instagram', query, limit),
  reddit: searchReddit,
  bilibili: searchBilibili,
  dailymotion: searchDailymotion,
  nicovideo: searchNicovideo,
  ok: searchOk,
  vkvideo: searchVkvideo,
  threads: (query, limit) => searchSocialVideos('threads', query, limit),
  tiktok: (query, limit) => searchSocialVideos('tiktok', query, limit),
  vimeo: searchVimeo,
};

export interface SearchSourceResult {
  source: VideoSearchSource;
  videos: VideoInfo[];
}

async function searchSource(platform: VideoSearchPlatform, query: string, limit: number): Promise<SearchSourceResult> {
  const source: VideoSearchSource = {
    platform, method: 'native', searchUrl: VIDEO_SEARCH_SITES[platform].searchUrl(query), count: 0,
  };
  try {
    const result = await providers[platform](query, limit);
    const videos = Array.isArray(result) ? result : result.videos;
    if (!Array.isArray(result)) {
      source.method = result.method;
      source.searchUrl = result.searchUrl;
      source.nativeError = result.nativeError;
    }
    source.count = Math.min(videos.length, limit);
    return { source, videos };
  } catch (error: unknown) {
    if (error instanceof WebIndexSearchError) {
      source.method = 'web-index';
      source.searchUrl = error.searchUrl;
      source.nativeError = error.nativeError;
    }
    source.error = error instanceof Error ? error.message : String(error);
    return { source, videos: [] };
  }
}

export async function searchVideos(request: VideoSearchRequest): Promise<VideoSearchResponse> {
  const platform = request?.platform ?? 'all';
  if (!request || (platform !== 'all' && !Object.hasOwn(providers, platform))) {
    throw new Error(`Choose all or one of: ${VIDEO_SEARCH_PLATFORM_IDS.join(', ')}.`);
  }
  if (typeof request.query !== 'string' || !request.query.trim()) {
    throw new Error('Enter a video search keyword.');
  }
  const query = request.query.trim();
  const limit = request.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Search limit must be an integer from 1 to 50.');
  }
  const platforms = platform === 'all' ? VIDEO_SEARCH_PLATFORM_IDS : [platform];
  const results: SearchSourceResult[] = new Array(platforms.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let worker = 0; worker < Math.min(4, platforms.length); worker++) {
    workers.push((async () => {
      while (next < platforms.length) {
        const index = next++;
        results[index] = await searchSource(platforms[index], query, limit);
      }
    })());
  }
  await Promise.all(workers);

  const response: VideoSearchResponse = {
    platform, query, videos: [], sources: results.map(result => result.source),
    searchUrl: platform === 'all' ? undefined : results[0].source.searchUrl,
  };
  const seen = new Set<string>();
  // Interleave source ranks, rather than exhausting the first site's results.
  for (let rank = 0; rank < limit && response.videos.length < limit; rank++) {
    for (const { source, videos } of results) {
      const video = videos[rank];
      if (!video?.originalUrl || seen.has(video.originalUrl)) continue;
      seen.add(video.originalUrl);
      response.videos.push({ ...video, platform: source.platform, searchMethod: source.method });
      if (response.videos.length === limit) break;
    }
  }
  if (response.sources.every(source => source.error)) {
    response.error = platform === 'all'
      ? 'Every search source failed. Check the source errors and original search links.'
      : response.sources[0].error;
  }
  return response;
}
