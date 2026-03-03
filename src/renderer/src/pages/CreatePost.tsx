import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Post } from '../../shared/types';

export const CreatePost = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !content.trim()) {
      alert('Title and content are required');
      return;
    }

    const newPost = {
      title,
      content,
      tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: {
        id: 'current-user', // TODO: Implement user authentication
        name: 'Current User',
        avatar: ''
      }
    };

    await window.postsAPI.create(newPost);

    // Reset form
    setTitle('');
    setContent('');
    setTags('');

    // Navigate back to posts list
    navigate('/posts');
  };

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
          <h1 className="text-xl font-bold text-white ml-4">Create New Post</h1>
        </div>
      </header>

      {/* Content */}
      <main className="pt-32 pb-24 px-6 max-w-4xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title Input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 text-white border border-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              placeholder="Enter post title..."
              required
            />
          </div>

          {/* Content Input - WYSIWYG Editor */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Content
            </label>
            <div className="min-h-[300px] border border-gray-700 rounded-lg bg-gray-800 p-2">
              {/* TODO: Integrate Tiptap editor */}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-full min-h-[200px] bg-transparent text-white resize-none focus:outline-none"
                placeholder="Write your post content here..."
                required
              />
            </div>
          </div>

          {/* Tags Input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-gray-800 text-white border border-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              placeholder="e.g. youtube, downloader, tutorial"
            />
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate('/posts')}
              className="px-6 py-2 rounded-lg font-medium text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Create Post
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};
