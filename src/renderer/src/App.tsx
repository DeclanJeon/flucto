import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainDownloader } from './components/MainDownloader';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<MainDownloader />} />
    </Routes>
  );
};

export default App;
