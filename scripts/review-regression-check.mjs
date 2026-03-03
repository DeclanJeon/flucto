import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const read = async (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

const ensure = (condition, message) => {
  assert.ok(condition, message);
};

const ensureText = (source, regex, message) => {
  ensure(regex.test(source), message);
};

const ensureTextAbsent = (source, regex, message) => {
  ensure(!regex.test(source), message);
};

const run = async () => {
  const createReviewSource = await read('src/renderer/src/pages/CreateReview.tsx');
  const reviewDetailSource = await read('src/renderer/src/pages/ReviewDetail.tsx');
  const preloadSource = await read('src/preload/index.ts');
  const handlerSource = await read('src/main/handlers.ts');
  const typesSource = await read('src/shared/types.ts');
  const reviewListSource = await read('src/renderer/src/components/ReviewsList.tsx');

  ensureText(createReviewSource, /useSearchParams/, 'CreateReview should read postId from useSearchParams (query-only input).');
  ensureText(createReviewSource, /postIdFromQuery\s*=\s*searchParams\.get\('postId'\)/, 'CreateReview should derive postId from query string.');
  ensureText(createReviewSource, /postId:\s*postIdFromQuery/, 'CreateReview payload should include postId from query only.');
  ensureText(
    createReviewSource,
    /if\s*\(!postIdFromQuery\)\s*\{[\s\S]{0,220}?등록할 수 없습니다\./,
    'CreateReview should block submit when postId is missing.',
  );
  ensureText(
    createReviewSource,
    /disabled=\{isSubmitting\s*\|\|\s*!postIdFromQuery\}/,
    'CreateReview submit button should be disabled when postId is missing.',
  );
  ensureTextAbsent(
    createReviewSource,
    /<\s*input[^>]+(?:name|id)=["']postId["']/,
    'CreateReview should not render a manual postId field.',
  );

  ensureText(typesSource, /postId:\s*string/, 'Shared Review type should include postId string.');

  ensureText(preloadSource, /reviewsAPI:\s*\{[\s\S]*getCurrentAuthor:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('reviews-current-author'\)/, 'Preload should expose reviewsAPI.getCurrentAuthor().');
  ensureText(reviewDetailSource, /getCurrentAuthor\(\)/, 'ReviewDetail should call reviewsAPI.getCurrentAuthor().');
  ensureText(reviewDetailSource, /const canDeleteReview/, 'ReviewDetail should compute canDeleteReview for ownership UI gating.');
  ensureTextAbsent(createReviewSource, /ui-avatars\.herokuapp\.com/, 'CreateReview should not render avatar fallback image URLs.');
  ensureTextAbsent(reviewDetailSource, /review\.author\.avatar/, 'ReviewDetail should not render review author avatar image.');
  ensureTextAbsent(reviewDetailSource, /<\s*img\s+/, 'ReviewDetail should not render avatar image tags for review entries.');
  ensureTextAbsent(reviewListSource, /<\s*img\s+/, 'Review list should not render avatar image tags for review entries.');
  ensureTextAbsent(reviewListSource, /ui-avatars\.herokuapp\.com/, 'Review list should not render avatar fallback image URLs.');

  const deleteGatedInHandler =
    /const currentAuthor = await getRequestingAuthor\(\);/.test(handlerSource) &&
    /select\('id,author'\)/.test(handlerSource) &&
    /targetReview\.author\.id !== currentAuthor\.id/.test(handlerSource) &&
    /only the author can delete this review/.test(handlerSource);
  ensure(deleteGatedInHandler, 'Backend delete handler must verify requester is review author.');

  const hasCreatePostIdResolution = /const resolvedPostId\s*=\s*await\s+withAuthenticatedDbSession[\s\S]*resolveReviewPostId/.test(handlerSource);
  ensure(hasCreatePostIdResolution, 'Backend should resolve requested postId before creating review.');
  ensureText(
    handlerSource,
    /Cannot create review: valid postId is required\./,
    'Backend should reject review creation without a valid postId.',
  );

  const hasDeleteButtonOwnershipUI = /\{canDeleteReview && \(/.test(reviewDetailSource) && /Trash2/.test(reviewDetailSource);
  ensure(hasDeleteButtonOwnershipUI, 'Delete button should only render for owners in UI.');

  console.log('Review regression checks passed.');
};

run().catch((error) => {
  console.error('Review regression check failed:', error.message || error);
  process.exit(1);
});
