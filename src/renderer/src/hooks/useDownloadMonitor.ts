import { useState, useEffect } from 'react';
import type { DownloadProgress as DownloadProgressType } from '../../../shared/types';

export const useDownloadMonitor = () => {
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgressType>>({});

  useEffect(() => {
    if (!window.api?.onDownloadProgress) {
      console.warn('window.api.onDownloadProgress is not available');
      return;
    }

    window.api.onDownloadProgress((progress) => {
      setDownloadProgress((prev) => ({
        ...prev,
        [progress.requestId]: progress,
      }));
    });
  }, []);

  return downloadProgress;
};