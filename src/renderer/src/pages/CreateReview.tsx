import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';


type ReviewFormState = {
  authorName: string;
  rating: number;
  content: string;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '리뷰 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.';
};

export const CreateReview = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const postIdFromQuery = searchParams.get('postId')?.trim() || '';
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

    if (!postIdFromQuery) {
      alert('게시글 정보가 없어 리뷰를 등록할 수 없습니다. 리뷰 목록에서 다시 진입해 주세요.');
      return;
    }

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
      postId: postIdFromQuery,
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
      alert(getErrorMessage(error));
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
        {!postIdFromQuery ? (
          <div className="mb-4 rounded-lg bg-red-900/40 border border-red-500/40 text-red-200 px-4 py-3 text-sm">
            게시글 식별자가 없어 리뷰를 작성할 수 없습니다. 리뷰 목록에서 "새 리뷰 작성"을 다시 시도해 주세요.
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="space-y-6 bg-gray-800 rounded-lg p-6">
          <div>
            <label htmlFor="author-name" className="block text-sm font-medium text-gray-300 mb-2">작성자 이름</label>
            <input
              id="author-name"
              type="text"
              value={form.authorName}
              onChange={(event) => setForm((prev) => ({ ...prev, authorName: event.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-gray-900 text-white border border-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
              className="w-full px-4 py-3 rounded-lg bg-gray-900 text-white border border-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none min-h-[180px]"
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
              disabled={isSubmitting || !postIdFromQuery}
            >
              {isSubmitting ? '등록 중...' : '리뷰 등록'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};
