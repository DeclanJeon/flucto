import { BrowserWindow, ipcMain } from 'electron';
import { execa } from './spawn.js';
import { logger } from './logger.js';
import {
  ensureAuthenticatedSession,
  getSupabaseClient,
  getServerAuthorIdentity,
} from './supabase.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBinaryPath } from './utils.js';
import { getUpdateSettingsDefaults, settingsStore } from './store.js';
import type { NetworkStatusEvent, Review, UpdateSettings } from '../shared/types.js';

interface SupabaseErrorLike {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

interface ReviewRow {
  id: string;
  post_id: string;
  rating: number;
  content: string;
  github_url?: string | null;
  author: Review['author'];
  created_at: string;
  updated_at: string;
}

type ReviewInsertPayload = ReturnType<typeof toReviewInsertPayload>;

type ReviewAuthorRow = {
  id: string;
  author: Review['author'];
};

const isSupabaseError = (error: unknown): error is SupabaseErrorLike => {
  if (!error || typeof error !== 'object') return false;
  return 'message' in error && typeof (error as { message?: unknown }).message === 'string';
};

const serializeError = (error: unknown) => {
  if (isSupabaseError(error)) {
    return {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
};

const toUserErrorMessage = (prefix: string, error: unknown) => {
  if (isSupabaseError(error)) {
    return `${prefix}: ${error.message}${error.code ? ` (${error.code})` : ''}`;
  }

  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }

  return `${prefix}: Unknown error`;
};

const isMissingColumnError = (error: unknown, columnName: string): boolean => {
  if (!isSupabaseError(error)) {
    return false;
  }

  return (
    error.code === '42703' ||
    error.message.toLowerCase().includes(`could not find the '${columnName}' column`) ||
    error.message.toLowerCase().includes(`column ${columnName}`)
  );
};

let reviewGithubUrlColumnSupport: boolean | null = null;

const inspectReviewGithubUrlColumn = async (client: SupabaseClient): Promise<boolean> => {
  if (reviewGithubUrlColumnSupport !== null) {
    return reviewGithubUrlColumnSupport;
  }

  const { error } = await client.from('reviews').select('github_url').limit(0);

  if (!error) {
    reviewGithubUrlColumnSupport = true;
    return true;
  }

  if (isMissingColumnError(error, 'github_url')) {
    reviewGithubUrlColumnSupport = false;
    return false;
  }

  throw error;
};

const stripMissingReviewGithubUrlField = (payload: ReviewInsertPayload): Omit<ReviewInsertPayload, 'github_url'> => {
  const { github_url: githubUrl, ...rest } = payload;
  void githubUrl;
  return rest;
};

const isFetchFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message.toLowerCase().includes('fetch failed')) {
    return true;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const maybeErrorCode = (cause as { code?: string }).code;
    if (maybeErrorCode === 'ENOTFOUND' || maybeErrorCode === 'EAI_AGAIN' || maybeErrorCode === 'ECONNREFUSED') {
      return true;
    }
  }

  return false;
};

const mapReviewRowToReview = (row: ReviewRow): Review => ({
  id: row.id,
  postId: row.post_id,
  rating: row.rating,
  content: row.content,
  githubUrl: row.github_url ?? undefined,
  author: row.author,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const withAuthenticatedDbSession = async <T>(query: (client: SupabaseClient) => Promise<T>): Promise<T> => {
  await ensureAuthenticatedSession();
  const dbClient = getSupabaseClient();
  try {
    return await query(dbClient);
  } catch (error: unknown) {
    if (isFetchFailure(error)) {
      throw new Error(`Forum backend is unavailable: Supabase network error. ${
        error instanceof Error ? error.message : 'Unknown error'
      }`);
    }
    throw error;
  }
};

const toReviewInsertPayload = (review: Omit<Review, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Review, 'createdAt' | 'updatedAt'>>) => ({
  post_id: review.postId,
  rating: review.rating,
  content: review.content,
  github_url: review.githubUrl ?? null,
  author: review.author,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const NETWORK_STATUS_CHANNEL = 'network-status-change';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: string): boolean => UUID_V4_RE.test(value);

type PostRow = { id: string };

const resolveReviewPostId = async (client: SupabaseClient, requestedPostId: string): Promise<string> => {
  const normalizedPostId = requestedPostId?.trim() || '';

  if (isUuid(normalizedPostId)) {
    return normalizedPostId;
  }

  const { data, error } = await client.from('posts').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (error) {
    throw error;
  }

  const fallbackPostId = data ? (data as PostRow).id : '';
  if (isUuid(fallbackPostId)) {
    return fallbackPostId;
  }

  throw new Error('Cannot create review: valid postId is required.');
};

const getRequestingAuthor = async () =>
  getServerAuthorIdentity({
    id: 'anonymous',
    name: '익명',
    avatar: '',
  });

const isUpdateSettings = (value: unknown): value is UpdateSettings => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.autoUpdate === 'boolean' &&
    typeof candidate.checkInterval === 'number' &&
    Number.isInteger(candidate.checkInterval) &&
    candidate.checkInterval > 0 &&
    typeof candidate.notifyOnStart === 'boolean'
  );
};

const getStoredUpdateSettings = (): UpdateSettings => {
  const stored = settingsStore.get('updateSettings');
  if (isUpdateSettings(stored)) {
    return {
      ...stored,
    };
  }

  const defaults = getUpdateSettingsDefaults();
  settingsStore.set('updateSettings', defaults);
  return defaults;
};

let networkStatus: NetworkStatusEvent = {
  online: true,
  message: '',
};

const emitNetworkStatus = (status: NetworkStatusEvent): void => {
  networkStatus = status;
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((window) => {
    window.webContents.send(NETWORK_STATUS_CHANNEL, status);
  });
};

ipcMain.handle('reviews-list', async () => {
  try {
    const hasGithubUrl = await withAuthenticatedDbSession(async (client) => inspectReviewGithubUrlColumn(client));
    if (hasGithubUrl) {
      const { data, error } = await withAuthenticatedDbSession(async (client) =>
        client
          .from('reviews')
          .select('id,post_id,rating,content,github_url,author,created_at,updated_at')
          .order('created_at', { ascending: false })
          .limit(50),
      );

      if (error) {
        throw error;
      }

      return { reviews: (data as ReviewRow[] | null)?.map(mapReviewRowToReview) || [] };
    }

    const { data, error } = await withAuthenticatedDbSession(async (client) =>
      client
        .from('reviews')
        .select('id,post_id,rating,content,author,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(50),
    );

    if (error) {
      throw error;
    }

    return { reviews: (data as ReviewRow[] | null)?.map(mapReviewRowToReview) || [] };
  } catch (error: unknown) {
    logger.error('Reviews List Error:', serializeError(error));
    throw new Error(toUserErrorMessage('Failed to fetch reviews', error));
  }
});

ipcMain.handle('reviews-get', async (_event, id: string) => {
  try {
    const hasGithubUrl = await withAuthenticatedDbSession(async (client) => inspectReviewGithubUrlColumn(client));

    if (hasGithubUrl) {
      const { data, error } = await withAuthenticatedDbSession(async (client) =>
        client
          .from('reviews')
          .select('id,post_id,rating,content,github_url,author,created_at,updated_at')
          .eq('id', id)
          .single(),
      );

      if (error) throw error;
      return data ? mapReviewRowToReview(data as ReviewRow) : null;
    }

    const { data, error } = await withAuthenticatedDbSession(async (client) =>
      client
        .from('reviews')
        .select('id,post_id,rating,content,author,created_at,updated_at')
        .eq('id', id)
        .single(),
    );

    if (error) throw error;
    return data ? mapReviewRowToReview(data as ReviewRow) : null;
  } catch (error: unknown) {
    logger.error('Review Get Error:', serializeError(error));
    throw new Error(toUserErrorMessage('Failed to get review', error));
  }
});

ipcMain.handle('reviews-create', async (_event, review: Omit<Review, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Review, 'createdAt' | 'updatedAt'>>) => {
  try {
    const author = await getServerAuthorIdentity(review.author);
    const authorWithoutAvatar = {
      ...author,
      avatar: '',
    };
    const resolvedPostId = await withAuthenticatedDbSession(async (client) => resolveReviewPostId(client, review.postId));
    const newReviewData = toReviewInsertPayload({
      ...review,
      postId: resolvedPostId,
      author: authorWithoutAvatar,
    });

    const hasGithubUrl = await withAuthenticatedDbSession(async (client) => inspectReviewGithubUrlColumn(client));
    const payloadForInsert: Omit<ReviewInsertPayload, 'github_url'> | ReviewInsertPayload = hasGithubUrl
      ? newReviewData
      : stripMissingReviewGithubUrlField(newReviewData);

    const { data, error } = await withAuthenticatedDbSession(async (client) => {
      const { data, error } = await client
        .from('reviews')
        .insert([payloadForInsert])
        .select();
      return { data, error };
    });

    if (error && isMissingColumnError(error, 'github_url')) {
      reviewGithubUrlColumnSupport = false;
      const fallbackPayload = stripMissingReviewGithubUrlField(newReviewData);

      const retryResult = await withAuthenticatedDbSession(async (client) => {
        const { data, error } = await client
          .from('reviews')
          .insert([fallbackPayload])
          .select();
        return { data, error };
      });

      if (retryResult.error) {
        throw retryResult.error;
      }

      if (retryResult.data && retryResult.data.length > 0) {
        const insertedReview = mapReviewRowToReview(retryResult.data[0] as ReviewRow);
        logger.info('Review created:', { id: insertedReview.id, withoutGithubUrl: true });
        return insertedReview;
      }

      throw new Error('Failed to create review');
    }

    if (error) throw error;

    if (data && data.length > 0) {
      const insertedReview = mapReviewRowToReview(data[0] as ReviewRow);
      logger.info('Review created:', { id: insertedReview.id });
      return insertedReview;
    }

    throw new Error('Failed to create review');
  } catch (error: unknown) {
    logger.error('Review Create Error:', serializeError(error));
    throw new Error(toUserErrorMessage('Failed to create review', error));
  }
});

ipcMain.handle('reviews-current-author', async () => {
  try {
    return await getRequestingAuthor();
  } catch (error: unknown) {
    logger.error('Current Review Author Error:', serializeError(error));
    throw new Error(toUserErrorMessage('Failed to get current author', error));
  }
});

ipcMain.handle('reviews-delete', async (_event, id: string) => {
  try {
    const currentAuthor = await getRequestingAuthor();

    const { data, error: getError } = await withAuthenticatedDbSession(async (client) =>
      client
        .from('reviews')
        .select('id,author')
        .eq('id', id)
        .maybeSingle(),
    );

    if (getError) {
      throw getError;
    }

    const targetReview = data as ReviewAuthorRow | null;

    if (!targetReview) {
      throw new Error('Failed to delete review: target review not found.');
    }

    if (targetReview.author.id !== currentAuthor.id) {
      throw new Error('Failed to delete review: only the author can delete this review.');
    }

    const { error: deleteError } = await withAuthenticatedDbSession(async (client) =>
      client
        .from('reviews')
        .delete()
        .eq('id', id),
    );

    if (deleteError) {
      throw deleteError;
    }

    logger.info('Review deleted:', { id, by: currentAuthor.id });
  } catch (error: unknown) {
    logger.error('Review Delete Error:', serializeError(error));
    throw new Error(toUserErrorMessage('Failed to delete review', error));
  }
});

ipcMain.handle('get-update-settings', () => {
  return getStoredUpdateSettings();
});

ipcMain.handle('save-update-settings', (_event, settings: unknown): void => {
  if (!isUpdateSettings(settings)) {
    throw new Error('Invalid update settings payload');
  }

  settingsStore.set('updateSettings', settings);
});

ipcMain.handle('check-binary-updates', async () => {
  try {
    const ytDlpPath = getBinaryPath('yt-dlp');
    const ffmpegPath = getBinaryPath('ffmpeg');

    await Promise.all([
      execa(ytDlpPath, ['--version']),
      execa(ffmpegPath, ['-version']),
    ]);

    const settings = getStoredUpdateSettings();
    emitNetworkStatus({
      ...networkStatus,
      online: settings.autoUpdate ? networkStatus.online : true,
      message: settings.autoUpdate ? networkStatus.message : '',
    });
    logger.info('Binary update check passed', { ytDlpPath, ffmpegPath });
  } catch (error: unknown) {
    logger.error('Check Binary Updates Error:', serializeError(error));
    emitNetworkStatus({
      online: false,
      message: '바이너리 업데이트를 확인할 수 없습니다.',
    });
    throw new Error(toUserErrorMessage('Failed to check binary updates', error));
  }
});

ipcMain.on('render-ready', () => {
  emitNetworkStatus(networkStatus);
});
