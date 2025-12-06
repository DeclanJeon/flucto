import { useState, useEffect } from 'react';
import type { DownloadProgress as DownloadProgressType } from '../../../shared/types';

export const useDownloadMonitor = () => {
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgressType>>({});

  useEffect(() => {
    window.api.onDownloadProgress((progress) => {
      setDownloadProgress((prev) => ({
        ...prev,
        [progress.url]: progress,
      }));
    });
  }, []);

  return downloadProgress;
};