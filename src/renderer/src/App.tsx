import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainDownloader } from './components/MainDownloader';
import { ReviewsList } from './components/ReviewsList';
import { CreateReview } from './pages/CreateReview';
import { ReviewDetail } from './pages/ReviewDetail';
import { PostsList } from './components/PostsList';
import { CreatePost } from './pages/CreatePost';
import { CreateReview } from './pages/CreateReview';
import { PostDetail } from './pages/PostDetail';

const App: React.FC = () => {
  return (
      <Route path="/" element={<MainDownloader />} />
      <Route path="/reviews" element={<ReviewsList />} />
      <Route path="/reviews/create" element={<CreateReview />} />
      <Route path="/reviews/:id" element={<ReviewDetail />} />
      <Route path="/" element={<MainDownloader />} />
      <Route path="/posts" element={<PostsList />} />
      <Route path="/posts/create" element={<CreatePost />} />
      <Route path="/posts/:id/review" element={<CreateReview />} />
      <Route path="/posts/:id" element={<PostDetail />} />
    </Routes>
  );
};

export default App;
