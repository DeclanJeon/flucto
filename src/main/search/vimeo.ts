import type { VideoSearchProviderResult } from '../../shared/types.js';
import { searchWebIndex } from './webIndexSearch.js';

export function searchVimeo(query: string, limit: number): Promise<VideoSearchProviderResult> {
  return searchWebIndex('vimeo', query, limit);
}
