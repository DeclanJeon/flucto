import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { MainDownloader } from './components/MainDownloader';
import { UpdateSettings } from './components/UpdateSettings';
import { CodexVisionSettings } from './components/CodexVisionSettings';
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
            <CodexVisionSettings />
            <CraftAnalysisPanel />
          </>
        )}
      />
    </Routes>
  );
};

export default App;
