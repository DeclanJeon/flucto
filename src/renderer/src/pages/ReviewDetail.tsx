import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Star, Trash2 } from 'lucide-react';
import type { Review } from '../../../shared/types';

export const ReviewDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentAuthorId, setCurrentAuthorId] = useState('');

  const loadReview = useCallback(async (reviewId: string) => {
    setLoading(true);
    try {
      const result = await window.api.reviewsAPI.get(reviewId);
      setReview(result);
    } catch (error) {
      console.error('Failed to load review:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) {
      loadReview(id);
    }
  }, [id, loadReview]);

  useEffect(() => {
    const loadAuthor = async () => {
      try {
        const currentAuthor = await window.api.reviewsAPI.getCurrentAuthor();
        setCurrentAuthorId(currentAuthor.id);
      } catch (error) {
        console.error('Failed to load current author:', error);
      }
    };

    loadAuthor();
  }, []);

  const canDeleteReview = Boolean(review && currentAuthorId && review.author.id === currentAuthorId);

  const handleDelete = async () => {
    if (!review?.id) return;
    if (!canDeleteReview) return;

    if (confirm('정말 삭제하시겠습니까?')) {
      try {
        await window.api.reviewsAPI.delete(review.id);
        navigate('/reviews');
      } catch (error) {
        console.error('Failed to delete review:', error);
        if (error instanceof Error) {
          alert(error.message);
          return;
        }

        alert('리뷰 삭제에 실패했습니다.');
      }
    }
  };

  const renderStars = (rating: number) => {
    return [1, 2, 3, 4, 5].map((star) => (
      <Star
        key={star}
        className={`w-5 h-5 ${star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`}
      />
    ));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] text-gray-100 flex items-center justify-center">
        <div className="text-gray-400">리뷰 로드 중...</div>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] text-gray-100 flex items-center justify-center">
        <div className="text-gray-400">리뷰를 찾을 수 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-gray-100 font-sans">
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#0d0d0d]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/reviews')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ← 목록으로
          </button>
          <h1 className="text-xl font-bold text-white ml-4">리뷰 상세</h1>
        </div>
        {canDeleteReview && (
          <button
            type="button"
            onClick={handleDelete}
            className="text-red-400 hover:text-red-300 transition-colors flex items-center gap-2"
          >
            <Trash2 size={16} />
            삭제
          </button>
        )}
      </header>

      <main className="pt-32 pb-24 px-6 max-w-4xl mx-auto">
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <div>
              <div className="font-semibold text-white text-lg">{review.author.name}</div>
              <div className="text-gray-400 text-sm">
                {new Date(review.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="flex gap-1 mb-4">
            {renderStars(review.rating)}
          </div>

          <div className="mt-6">
            <p className="text-gray-300 text-lg leading-relaxed">{review.content}</p>
          </div>

          {review.githubUrl && (
            <a
              href={review.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors mt-4"
            >
              <span>GitHub에서 보기</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </main>
    </div>
  );
};
