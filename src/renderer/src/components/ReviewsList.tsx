import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { Review } from '../../../shared/types';

export const ReviewsList = () => {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    try {
      if (!window.api?.reviewsAPI?.list) {
        console.warn('reviewsAPI is not available');
        setReviews([]);
        return;
      }
      const result = await window.api.reviewsAPI.list();
      setReviews(result.reviews || []);
    } catch (error) {
      console.error('Failed to load reviews:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const renderStars = (rating: number) => {
    return [1, 2, 3, 4, 5].map((star) => (
      <svg
        key={star}
        aria-hidden="true"
        className={`w-4 h-4 ${star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'}`}
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ));
  };

  const latestPostId = reviews[0]?.postId ?? '';

  const handleCreateReview = () => {
    const postQuery = latestPostId ? `?postId=${encodeURIComponent(latestPostId)}` : '';
    navigate(`/reviews/create${postQuery}`);
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-gray-100 font-sans">
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#0d0d0d]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ← 돌아가기
          </button>
          <h1 className="text-xl font-bold text-white ml-4">리뷰 목록</h1>
        </div>
        <button
          type="button"
          onClick={handleCreateReview}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full font-medium transition-all active:scale-95 flex items-center gap-2 text-sm"
        >
          <Plus size={16} />
          새 리뷰 작성
        </button>
      </header>

    <main className="pt-32 pb-24 px-6 max-w-4xl mx-auto">
        {loading ? (
          <div className="text-center text-gray-400">리뷰 로드 중...</div>
        ) : reviews.length === 0 ? (
          <div className="text-center text-gray-400 py-20">
            아직 리뷰가 없습니다. 첫 번째 리뷰를 작성해보세요!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {reviews.map((review) => (
            <button
              type="button"
              key={review.id}
              onClick={() => navigate(`/reviews/${review.id}`)}
              className="bg-gray-800 rounded-lg p-6 cursor-pointer hover:bg-gray-700 transition-colors duration-200 border border-gray-700 w-full text-left"
            >
                <div className="mb-3">
                  <div>
                    <div className="font-semibold text-white text-sm">
                      {review.author.name}
                    </div>
                    <div className="text-gray-400 text-xs">
                      {new Date(review.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>

              <div className="flex gap-1 mb-2">
                {renderStars(review.rating)}
              </div>

              <p className="text-gray-300 mt-2 line-clamp-2">{review.content}</p>
            </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
