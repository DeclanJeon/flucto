import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainDownloader } from './components/MainDownloader';
import { UpdateSettings } from './components/UpdateSettings';
import { OpenCodeVisionSettings } from './components/OpenCodeVisionSettings';
import { CraftAnalysisPanel } from './components/CraftAnalysisPanel';

const App: React.FC = () => {
  return (
    <Routes>
      <Route
        path="/"
        element={(
          <>
            <MainDownloader />
            <UpdateSettings />
            <OpenCodeVisionSettings />
            <CraftAnalysisPanel />
          </>
        )}
      />
    </Routes>
  );
};

export default App;
