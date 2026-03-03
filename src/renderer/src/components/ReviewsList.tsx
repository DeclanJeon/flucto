import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { Review } from '../../../shared/types';

export const ReviewsList = () => {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReviews();
  }, []);

  const loadReviews = async () => {
    setLoading(true);
    try {
      const result = await window.api.reviewsAPI.list();
      setReviews(result.reviews || []);
    } catch (error) {
      console.error('Failed to load reviews:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderStars = (rating: number) => {
    return [1, 2, 3, 4, 5].map((star) => (
      <svg
        key={star}
        className={`w-4 h-4 ${star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'}`}
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ));
  };

  return (
    <div className="min-h-screen bg-[#0d0d0] text-gray-100 font-sans">
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#0d0d0]/80 backdrop-blur-md border-b border-white/5">
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
          onClick={() => navigate('/reviews/create')}
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
              <div
                key={review.id}
                onClick={() => navigate(`/reviews/${review.id}`)}
                className="bg-gray-800 rounded-lg p-6 cursor-pointer hover:bg-gray-700 transition-colors duration-200 border border-gray-700"
              >
                <div className="flex items-center gap-3 mb-3">
                  <img
                    src={review.author.avatar || `https://ui-avatars.herokuapp.com/api/?name=${encodeURIComponent(review.author.name)}&background=random`}
                    alt={review.author.name}
                    className="w-10 h-10 rounded-full"
                  />
                  <div>
                    <div className="font-semibold text-white text-sm">
                      {review.author.name}
                    </div>
                    <div className="text-gray-400 text-xs">
                      {new Date(review.createdAt).toLocaleString()}
                    </div>
                  </div>

                <div className="flex gap-1 mb-2">
                  {renderStars(review.rating)}
                </div>

                <p className="text-gray-300 mt-2 line-clamp-2">{review.content}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
