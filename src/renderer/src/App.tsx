import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainDownloader } from './components/MainDownloader';
import { UpdateSettings } from './components/UpdateSettings';

const App: React.FC = () => {
  return (
    <Routes>
      <Route
        path="/"
        element={(
          <>
            <MainDownloader />
            <UpdateSettings />
          </>
        )}
      />
    </Routes>
  );
};

export default App;
