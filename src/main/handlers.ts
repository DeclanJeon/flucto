import { ipcMain } from 'electron';
import { logger } from './logger.js';
import { postsStore } from './store.js';
import type { Post, Review } from '../shared/types.js';

// --- Posts & Reviews Handlers ---

ipcMain.handle('posts-list', async () => {
  try {
    const posts = (postsStore as unknown as Record<string, Post[]>).posts || [];
    return { posts };
  } catch (error: unknown) {
    logger.error('Posts List Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to fetch posts');
  }
});

ipcMain.handle('posts-create', async (_event, post: Omit<Post, 'id' | 'createdAt' | 'updatedAt'>) => {
  try {
    const posts = (postsStore as unknown as Record<string, Post[]>).posts || [];
    const newPost: Post = {
      ...post,
      id: `post-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    (postsStore as unknown as Record<string, Post[]>).posts = [...posts, newPost];
    logger.info('Post created:', { id: newPost.id, title: newPost.title });
    return newPost;
  } catch (error: unknown) {
    logger.error('Post Create Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to create post');
  }
});

ipcMain.handle('posts-get', async (_event, id: string) => {
  try {
    const posts = (postsStore as unknown as Record<string, Post[]>).posts || [];
    return posts.find((p: Post) => p.id === id) || null;
  } catch (error: unknown) {
    logger.error('Post Get Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to get post');
  }
});

ipcMain.handle('posts-update', async (_event, { id, post }: { id: string; post: Partial<Post> }) => {
  try {
    const posts = (postsStore as unknown as Record<string, Post[]>).posts || [];
    const index = posts.findIndex((p: Post) => p.id === id);
    if (index === -1) {
      throw new Error('Post not found');
    }
    posts[index] = { ...posts[index], ...post, updatedAt: new Date().toISOString() };
    (postsStore as unknown as Record<string, Post[]>).posts = posts;
    logger.info('Post updated:', { id });
    return posts[index];
  } catch (error: unknown) {
    logger.error('Post Update Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to update post');
  }
});

ipcMain.handle('posts-delete', async (_event, id: string) => {
  try {
    const posts = (postsStore as unknown as Record<string, Post[]>).posts || [];
    const filtered = posts.filter((p: Post) => p.id !== id);
    (postsStore as unknown as Record<string, Post[]>).posts = filtered;
    logger.info('Post deleted:', { id });
  } catch (error: unknown) {
    logger.error('Post Delete Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to delete post');
  }
});

ipcMain.handle('reviews-list', async (_event, postId: string) => {
  try {
    const allReviews = (postsStore as unknown as Record<string, Record<string, Review[]>>).reviews || {};
    const postReviews = allReviews[postId] || [];
    return { reviews: postReviews };
  } catch (error: unknown) {
    logger.error('Reviews List Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to fetch reviews');
  }
});

ipcMain.handle('reviews-create', async (_event, review: Omit<Review, 'id' | 'createdAt' | 'updatedAt'>) => {
  try {
    const allReviews = (postsStore as unknown as Record<string, Record<string, Review[]>>).reviews || {};
    const postReviews = allReviews[review.postId] || [];
    const newReview: Review = {
      ...review,
      id: `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    postReviews.push(newReview);
    allReviews[review.postId] = postReviews;
    (postsStore as unknown as Record<string, Record<string, Review[]>>).reviews = allReviews;
    logger.info('Review created:', { id: newReview.id, postId: review.postId });
    return newReview;
  } catch (error: unknown) {
    logger.error('Review Create Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to create review');
  }
});

ipcMain.handle('reviews-delete', async (_event, id: string) => {
  try {
    const allReviews = (postsStore as unknown as Record<string, Record<string, Review[]>>).reviews || {};
    for (const postId in allReviews) {
      const postReviews = allReviews[postId];
      const filtered = postReviews.filter((r: Review) => r.id !== id);
      if (filtered.length !== postReviews.length) {
        allReviews[postId] = filtered;
        (postsStore as unknown as Record<string, Record<string, Review[]>>).reviews = allReviews;
        logger.info('Review deleted:', { id });
        break;
      }
    }
  } catch (error: unknown) {
    logger.error('Review Delete Error:', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error('Failed to delete review');
  }
});
