import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Post, Review } from '../../shared/types';

export const PostDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [newReview, setNewReview] = useState({ rating: 0, content: '' });

  useEffect(() => {
    if (id) {
      loadPostAndReviews(id);
    }
  }, [id]);

  const loadPostAndReviews = async (postId: string) => {
    setLoading(true);
    try {
      // Load all posts and find target post
      const postsResult = await window.api.postsAPI.list();
      const targetPost = postsResult.posts?.find(p => p.id === postId);

      if (targetPost) {
        setPost(targetPost);

        // Load reviews for this post
        const reviewsResult = await window.api.reviewsAPI.list(postId);
        setReviews(reviewsResult.reviews || []);
      } else {
        setPost(null);
        setReviews([]);
      }
    } catch (error) {
      console.error('Failed to load post:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddReview = async () => {
    if (!id || !newReview.content.trim()) {
      alert('Review content is required');
      return;
    }

    if (newReview.rating === 0) {
      alert('Please select a rating');
      return;
    }

    const reviewData = {
      postId: id,
      rating: newReview.rating,
      content: newReview.content,
      author: {
        id: 'current-user', // TODO: Implement user authentication
        name: 'Current User',
        avatar: ''
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await window.api.reviewsAPI.create(reviewData);

    // Reset form
    setNewReview({ rating: 0, content: '' });

    // Reload reviews
    const reviewsResult = await window.api.reviewsAPI.list(id);
    setReviews(reviewsResult.reviews || []);
  };

  const renderStars = (rating: number) => {
    return [1, 2, 3, 4, 5].map((star) => (
      <svg
        key={star}
        className={`w-4 h-4 ${star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'}`}
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        />
      </svg>
    ));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] text-gray-100 flex items-center justify-center">
        <div className="text-gray-400">Loading post...</div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] text-gray-100 flex items-center justify-center">
        <div className="text-gray-400">Post not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-gray-100 font-sans">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#0d0d0d]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/posts')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
          <span className="text-gray-400 ml-2">/</span>
          <h1 className="text-xl font-bold text-white ml-4">Post Detail</h1>
        </div>
      </header>

      {/* Content */}
      <main className="pt-32 pb-24 px-6 max-w-4xl mx-auto">
        {/* Post Content */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h1 className="text-3xl font-bold text-white mb-4">
            {post.title}
          </h1>
          <div className="flex items-center gap-4 mb-4">
            <img
              src={post.author.avatar || 'https://via.placeholder.com/150'}
              alt={post.author.name}
              className="w-12 h-12 rounded-full"
            />
            <div>
              <div className="font-semibold text-white">{post.author.name}</div>
              <div className="text-gray-400 text-sm">
                {new Date(post.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Post Content - HTML from WYSIWYG */}
          <div
            className="prose prose max-w-none text-gray-300"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />

          {/* Tags */}
          {post.tags && post.tags.length > 0 && (
            <div className="flex gap-2 mt-4 flex-wrap">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block bg-blue-600 text-white text-xs px-2 py-1 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Reviews Section */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-2xl font-bold text-white mb-4">Reviews</h2>

          <div className="space-y-4">
            {reviews.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                No reviews yet. Be the first to review!
              </div>
            ) : (
              reviews.map((review) => (
                <div key={review.id} className="bg-gray-700 rounded p-4">
                  <div className="flex items-start gap-3 mb-2">
                    <img
                      src={review.author.avatar || 'https://via.placeholder.com/150'}
                      alt={review.author.name}
                      className="w-8 h-8 rounded-full"
                    />
                    <div>
                      <div className="font-semibold text-white text-sm">
                        {review.author.name}
                      </div>
                      <div className="text-gray-400 text-xs">
                        {new Date(review.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Rating Stars */}
                  <div className="flex gap-1 mb-2">
                    {renderStars(review.rating)}
                  </div>

                  <p className="text-gray-300">{review.content}</p>
                </div>
              ))
            )}
          </div>

          {/* Add Review Form */}
          <div className="mt-8 pt-6 border-t border-gray-600">
            <h3 className="text-xl font-bold text-white mb-4">Add Review</h3>

            <div className="space-y-4">
              <textarea
                value={newReview.content}
                onChange={(e) => setNewReview(prev => ({ ...prev, content: e.target.value }))}
                className="w-full px-4 py-3 rounded-lg bg-gray-800 text-white border border-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[100px]"
                placeholder="Write your review here..."
              />

              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-300">Rating:</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setNewReview(prev => ({ ...prev, rating: star }))}
                      className={`w-8 h-8 flex items-center justify-center rounded transition-all ${star <= newReview.rating ? 'bg-yellow-400 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleAddReview}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                Submit Review
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
