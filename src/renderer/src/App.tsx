import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainDownloader } from './components/MainDownloader';
import { PostsList } from './components/PostsList';
import { CreatePost } from './pages/CreatePost';
import { PostDetail } from './pages/PostDetail';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<MainDownloader />} />
      <Route path="/posts" element={<PostsList />} />
      <Route path="/posts/create" element={<CreatePost />} />
      <Route path="/posts/:id" element={<PostDetail />} />
    </Routes>
  );
};

export default App;
