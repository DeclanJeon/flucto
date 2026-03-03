import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { Post } from '../../shared/types';

export const PostsList = () => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async () => {
    setLoading(true);
    try {
      const result = await window.postsAPI.list();
      setPosts(result.posts || []);
    } catch (error) {
      console.error('Failed to load posts:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-gray-100 font-sans">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#0d0d0d]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-xl font-bold text-white ml-4">Posts</h1>
        </div>
        <button
          onClick={() => navigate('/posts/create')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full font-medium transition-all active:scale-95 flex items-center gap-2 text-sm"
        >
          <Plus size={16} />
          Create Post
        </button>
      </header>

      {/* Content */}
      <main className="pt-32 pb-24 px-6 max-w-4xl mx-auto">
        {loading ? (
          <div className="text-center text-gray-400">Loading posts...</div>
        ) : posts.length === 0 ? (
          <div className="text-center text-gray-400 py-20">
            No posts yet. Create your first post!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <div
                key={post.id}
                onClick={() => navigate(`/posts/${post.id}`)}
                className="bg-gray-800 rounded-lg p-6 cursor-pointer hover:bg-gray-700 transition-colors duration-200 border border-gray-700"
              >
                <h2 className="text-xl font-bold text-white mb-2 line-clamp-2">
                  {post.title}
                </h2>
                <p className="text-gray-400 text-sm mb-2">
                  {post.author.name} • {new Date(post.createdAt).toLocaleDateString()}
                </p>
                {/* Preview HTML content safely */}
                <div
                  className="prose prose-sm max-h-[100px] overflow-hidden text-gray-300 line-clamp-3"
                  dangerouslySetInnerHTML={{ __html: post.content }}
                />
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
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
