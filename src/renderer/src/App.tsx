import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  FolderOpen,
  Plus,
  Loader2,
  Settings2,
  Youtube
} from 'lucide-react';
import { VideoPreview } from './components/VideoPreview';
import { DownloadProgress } from './components/DownloadProgress';
import { useDownloadMonitor } from './hooks/useDownloadMonitor';
import type { VideoInfo } from '../../shared/types';

/**
 * Extract YouTube video ID from various URL formats
 * Supports: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, etc.
 */
const extractYouTubeVideoId = (url: string): string | null => {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/embed\/([^/?]+)/,
    /youtu\.be\/([^/?]+)/,
    /youtube\.com\/v\/([^/?]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
};

/**
 * Clean and validate YouTube URL
 * Preserves original URL parameters while ensuring it's a valid YouTube URL
 */
const cleanYouTubeUrl = (url: string): string | null => {
  try {
    // If it's already a clean YouTube URL, return as-is
    if (url.includes('youtube.com/watch?v=') || url.includes('youtu.be/')) {
      return url;
    }

    // Extract video ID and create a standard URL
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      return null;
    }

    // Create a clean YouTube URL with the original video ID
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch (error) {
    console.error('URL parsing error:', error);
    return null;
  }
};

const App: React.FC = () => {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'mp4' | 'mp3'>('mp4');
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Custom Hook
  const downloadProgress = useDownloadMonitor();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleAddVideo = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    setIsLoadingInfo(true);
    setStatusMessage('🔍 Analyzing video URL...');
    
    try {
      // Clean and validate the URL
      const cleanUrl = cleanYouTubeUrl(trimmedUrl);
      if (!cleanUrl) {
        throw new Error('Invalid YouTube URL. Please check and try again.');
      }
      
      // Check if this is a playlist URL
      const isPlaylist = trimmedUrl.includes('list=');
      if (isPlaylist) {
        setStatusMessage('⚠️ Playlist detected! Only the first video will be added to queue.');
      }
      
      setStatusMessage('📥 Fetching video information...');
      const info = await window.api.getVideoInfo(cleanUrl);
      
      // Store the original URL for downloading
      setVideos((prev) => [...prev, { ...info, originalUrl: cleanUrl }]);
      setUrl('');
      setStatusMessage(isPlaylist ? '✅ First video from playlist added to queue!' : '✅ Video added to queue successfully!');
      
      // Clear success message after 3 seconds for playlist, 2 seconds for single video
      setTimeout(() => setStatusMessage(null), isPlaylist ? 3000 : 2000);
    } catch (error: any) {
      setStatusMessage(`❌ Error: ${error.message}`);
      // Clear error message after 3 seconds
      setTimeout(() => setStatusMessage(null), 3000);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const handleRemoveVideo = (index: number) => {
    setVideos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (videos.length === 0) return;

    setIsDownloading(true);
    setStatusMessage('🚀 Starting downloads...');

    try {
      // Use the original URLs that were stored with the video info
      const urls = videos.map((v) => v.originalUrl || `https://www.youtube.com/watch?v=${v.id}`);
      setStatusMessage(`📥 Downloading ${videos.length} video${videos.length > 1 ? 's' : ''}...`);
      
      await window.api.downloadMultiple(urls, format);
      setStatusMessage('✅ All downloads completed successfully!');
      setVideos([]);
      
      // Clear success message after 3 seconds
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error: any) {
      setStatusMessage(`❌ Download failed: ${error.message}`);
      // Clear error message after 4 seconds
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-gray-100 font-sans selection:bg-blue-500/30">
      {/* --- Header --- */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#0d0d0d]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-br from-blue-600 to-purple-600 p-1.5 rounded-lg">
            <Youtube size={18} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">Flucto</span>
        </div>
        <button
          onClick={() => window.api.openDownloadsFolder()}
          className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
          aria-label="Open Downloads Folder"
        >
          <FolderOpen size={20} />
        </button>
      </header>

      {/* --- Main Content --- */}
      <main className="pt-32 pb-24 px-6 max-w-5xl mx-auto flex flex-col items-center">
        
        {/* Hero Section: Apple Style Typography */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center mb-12 space-y-4"
        >
          <h2 className="text-blue-500 font-semibold tracking-wide text-sm uppercase">
            YouTube Downloader
          </h2>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white leading-[1.1]">
            Flowing Speed.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-200 to-gray-500">
              Flawless Video.
            </span>
          </h1>
          <p className="text-xl text-gray-400 mt-4 font-light">
            Experience Flucto.
          </p>
        </motion.div>

        {/* Input Section: Rounded Pill Design */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="w-full max-w-2xl relative z-20"
        >
          <div className="relative group">
            <input
              id="video-url-input"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddVideo()}
              placeholder="Paste YouTube URL here"
              aria-label="YouTube Video URL Input"
              aria-describedby="video-url-help"
              className="w-full bg-[#1c1c1e] text-lg text-white placeholder-gray-500 px-6 py-4 rounded-full border border-white/10 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all shadow-2xl"
              disabled={isLoadingInfo || isDownloading}
            />
            <button
              onClick={handleAddVideo}
              disabled={!url.trim() || isLoadingInfo}
              aria-label="Add video to queue"
              className="absolute right-2 top-2 bottom-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full px-4 aspect-square flex items-center justify-center transition-all disabled:opacity-0 disabled:scale-75"
            >
              {isLoadingInfo ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            </button>
          </div>

          {/* Format Selection (Pill Toggle) */}
          <div className="flex justify-center mt-6 gap-4">
             <div className="bg-[#1c1c1e] p-1 rounded-full border border-white/10 flex items-center">
                {(['mp4', 'mp3'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    aria-pressed={format === fmt}
                    aria-label={`Select ${fmt.toUpperCase()} format`}
                    className={`px-6 py-1.5 rounded-full text-sm font-medium transition-all ${
                      format === fmt
                        ? 'bg-gray-700 text-white shadow-sm'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
             </div>
             <div className="flex items-center gap-2 text-xs text-gray-500 px-2">
                <Settings2 size={14} />
                <span>Best Quality</span>
             </div>
          </div>
        </motion.div>

        {/* Video Grid & Download Section */}
        <div className="w-full mt-16">
          <AnimatePresence>
            {videos.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-xl font-semibold">Queue ({videos.length})</h3>
                  <button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    aria-live="polite"
                    aria-label={`Download ${videos.length} videos in ${format.toUpperCase()} format`}
                    className="bg-white text-black hover:bg-gray-200 px-8 py-2.5 rounded-full font-semibold flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50"
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="animate-spin" size={18} />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Download size={18} />
                        Download All
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <AnimatePresence>
                    {videos.map((video, index) => (
                      <VideoPreview
                        key={video.id}
                        info={video}
                        onRemove={() => handleRemoveVideo(index)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* --- Bottom Status Bar (Floating) --- */}
      <AnimatePresence>
        {(statusMessage || Object.keys(downloadProgress).length > 0) && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-0 left-0 right-0 bg-[#1c1c1e]/90 backdrop-blur-xl border-t border-white/10 p-4 z-50"
          >
            <div className="max-w-3xl mx-auto space-y-3">
              {statusMessage && (
                <div className="text-center text-sm font-medium text-gray-300">
                  {statusMessage}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-32 overflow-y-auto">
                 {Object.values(downloadProgress).map((progress) => (
                    <DownloadProgress key={progress.url} progress={progress} />
                 ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
