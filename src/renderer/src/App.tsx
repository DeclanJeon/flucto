import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainDownloader } from './components/MainDownloader';
import { ReviewsList } from './components/ReviewsList';
import { CreateReview } from './pages/CreateReview';
import { ReviewDetail } from './pages/ReviewDetail';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<MainDownloader />} />
      <Route path="/reviews" element={<ReviewsList />} />
      <Route path="/reviews/create" element={<CreateReview />} />
      <Route path="/reviews/:id" element={<ReviewDetail />} />
    </Routes>
  );
};

export default App;
