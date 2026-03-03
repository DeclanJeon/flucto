import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

type ReviewFormState = {
  authorName: string;
  rating: number;
  content: string;
};

export const CreateReview = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<ReviewFormState>({
    authorName: '',
    rating: 0,
    content: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const stars = useMemo(() => [1, 2, 3, 4, 5], []);

  const normalizeAuthorId = (name: string): string => {
    const fromName = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]/g, '');
    return fromName || 'anonymous';
  };

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.authorName.trim()) {
      alert('이름은 필수입니다.');
      return;
    }

    if (form.rating === 0) {
      alert('별점을 선택해 주세요.');
      return;
    }

    if (!form.content.trim()) {
      alert('리뷰 내용은 필수입니다.');
      return;
    }

    const reviewData = {
      rating: form.rating,
      content: form.content.trim(),
      author: {
        id: normalizeAuthorId(form.authorName),
        name: form.authorName.trim(),
        avatar: '',
      },
    };

    setIsSubmitting(true);
    try {
      await window.api.reviewsAPI.create(reviewData);
      navigate('/reviews');
    } catch (error) {
      console.error('Failed to create review:', error);
      alert('리뷰 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-gray-100 font-sans">
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#0d0d0d]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/reviews')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ← 뒤로
          </button>
          <h1 className="text-xl font-bold text-white ml-4">리뷰 작성</h1>
        </div>
      </header>

      <main className="pt-32 pb-24 px-6 max-w-4xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6 bg-gray-800 rounded-lg p-6">
          <div>
            <label htmlFor="author-name" className="block text-sm font-medium text-gray-300 mb-2">작성자 이름</label>
            <input
              id="author-name"
              type="text"
              value={form.authorName}
              onChange={(event) => setForm((prev) => ({ ...prev, authorName: event.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-gray-900 text-white border border-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              placeholder="리뷰를 남길 이름을 입력하세요"
              required
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-300 mb-2">리뷰 점수</span>
            <div className="flex gap-1">
              {stars.map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, rating: star }))}
                  className={`w-9 h-9 flex items-center justify-center rounded transition-all ${
                    star <= form.rating
                      ? 'bg-yellow-400 text-white'
                      : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                  }`}
                  aria-label={`별점 ${star}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="review-content" className="block text-sm font-medium text-gray-300 mb-2">리뷰 내용</label>
            <textarea
              id="review-content"
              value={form.content}
              onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-gray-900 text-white border border-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[180px]"
              placeholder="리뷰 내용을 입력하세요"
              required
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate('/reviews')}
              className="px-6 py-2 rounded-lg font-medium text-gray-400 hover:text-white transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSubmitting}
            >
              {isSubmitting ? '등록 중...' : '리뷰 등록'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};
