import type { VideoInfo } from '../../shared/types.js';
import { searchBrowserVideos } from './browserSearch.js';

// Anonymous search uses st.gsq, not q. The q route returns an empty page.
export async function searchOk(query: string, limit: number): Promise<VideoInfo[]> {
  return searchBrowserVideos('ok', query, limit);
}
