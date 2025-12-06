import { useState } from 'react';
import type { DownloadRequest, DownloadResponse } from '../../../shared/types';

interface UseDownloaderReturn {
  isLoading: boolean;
  statusMessage: string | null;
  download: (url: string, format: 'mp4' | 'mp3') => Promise<void>;
}

/**
 * Custom hook to manage youtube download state and IPC communication.
 */
export const useDownloader = (): UseDownloaderReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const download = async (url: string, format: 'mp4' | 'mp3') => {
    setIsLoading(true);
    setStatusMessage('Initializing download process...');

    try {
      // Input Validation
      if (!url.trim()) {
        throw new Error('Please enter a valid YouTube URL.');
      }

      setStatusMessage('Analyzing video and downloading...');

      // IPC Call to Main Process
      const response: DownloadResponse = await window.api.downloadVideo({
        url,
        format,
      });

      if (response.success) {
        setStatusMessage(`✅ Success! Saved to: ${response.filePath}`);
      } else {
        throw new Error(response.message);
      }
    } catch (error: any) {
      console.error('Download Hook Error:', error);
      setStatusMessage(
        `❌ Error: ${error.message || 'Unknown error occurred'}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  return { isLoading, statusMessage, download };
};
