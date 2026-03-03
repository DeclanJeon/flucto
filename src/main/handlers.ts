import { ipcMain } from 'electron';
import { logger } from './logger.js';
import { supabase } from './supabase.js';
import type { Post, Review } from '../shared/types.js';

// --- Posts & Reviews Handlers ---

ipcMain.handle('posts-list', async () => {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return { posts: data || [] };
  } catch (error: unknown) {
    logger.error('Posts List Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to fetch posts');
  }
});

ipcMain.handle('posts-create', async (_event, post: Omit<Post, 'id' | 'createdAt' | 'updatedAt'>) => {
  try {
    const newPostData = {
      ...post,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      author: {
        id: 'current-user',
        name: '현재 사용자',
        avatar: ''
      }
    };

    const { data, error } = await supabase
      .from('posts')
      .insert([newPostData])
      .select();

    if (error) throw error;

    if (data && data.length > 0) {
      const insertedPost = data[0];
      logger.info('Post created:', { id: insertedPost.id, title: insertedPost.title });
      return { ...insertedPost, id: insertedPost.id };
    }

    throw new Error('Failed to create post');
  } catch (error: unknown) {
    logger.error('Post Create Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to create post');
  }
});

ipcMain.handle('posts-get', async (_event, id: string) => {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data || null;
  } catch (error: unknown) {
    logger.error('Post Get Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to get post');
  }
});

ipcMain.handle('posts-update', async (_event, { id, post }: { id: string; post: Partial<Post> }) => {
  try {
    const { error } = await supabase
      .from('posts')
      .update({
        ...post,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select();

    if (error) throw error;

    const { data } = await supabase
      .from('posts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    logger.info('Post updated:', { id });
    return data;
  } catch (error: unknown) {
    logger.error('Post Update Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to update post');
  }
});

ipcMain.handle('posts-delete', async (_event, id: string) => {
  try {
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', id);

    if (error) throw error;

    logger.info('Post deleted:', { id });
  } catch (error: unknown) {
    logger.error('Post Delete Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to delete post');
  }
});

ipcMain.handle('reviews-list', async (_event, postId: string) => {
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { reviews: data || [] };
  } catch (error: unknown) {
    logger.error('Reviews List Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to fetch reviews');
  }
});

ipcMain.handle('reviews-create', async (_event, review: Omit<Review, 'id' | 'createdAt' | 'updatedAt'>) => {
  try {
    const newReviewData = {
      ...review,
      post_id: review.postId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      author: {
        id: 'current-user',
        name: '현재 사용자',
        avatar: ''
      }
    };

    const { data, error } = await supabase
      .from('reviews')
      .insert([newReviewData])
      .select();

    if (error) throw error;

    if (data && data.length > 0) {
      const insertedReview = data[0];
      logger.info('Review created:', { id: insertedReview.id, postId: review.postId });
      return { ...insertedReview, id: insertedReview.id };
    }

    throw new Error('Failed to create review');
  } catch (error: unknown) {
    logger.error('Review Create Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to create review');
  }
});

ipcMain.handle('reviews-delete', async (_event, id: string) => {
  try {
    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('id', id);

    if (error) throw error;

    logger.info('Review deleted:', { id });
  } catch (error: unknown) {
    logger.error('Review Delete Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to delete review');
  }
});
