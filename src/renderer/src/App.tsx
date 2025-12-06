import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  FolderOpen,
  Plus,
  Loader2,
  Settings2,
  Youtube,
  FileText,
  ListVideo
} from 'lucide-react';
import { VideoPreview } from './components/VideoPreview';
import { DownloadProgress } from './components/DownloadProgress';
import { useDownloadMonitor } from './hooks/useDownloadMonitor';
import type { VideoInfo } from '../../shared/types';

// ... (extractYouTubeVideoId, cleanYouTubeUrl 함수는 기존 코드 유지) ...
const extractYouTubeVideoId = (url: string): string | null => {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/embed\/([^/?]+)/,
    /youtu\.be\/([^/?]+)/,
    /youtube\.com\/v\/([^/?]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
};

const cleanYouTubeUrl = (url: string): string | null => {
  try {
    if (url.includes('youtube.com/watch?v=') || url.includes('youtu.be/')) return url;
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch (error) {
    return null;
  }
};

const App: React.FC = () => {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'mp4' | 'mp3'>('mp4');
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);

  const downloadProgress = useDownloadMonitor();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // [수정] 단일/플레이리스트 URL 처리 로직 분리 (재사용을 위해 함수화)
  const processUrl = async (rawUrl: string): Promise<VideoInfo[]> => {
    // 1. URL이 유효한지 1차 검증 (플레이리스트는 video ID가 없을 수도 있으므로 list= 체크)
    const isPlaylist = rawUrl.includes('list=');
    const cleanUrl = isPlaylist ? rawUrl : cleanYouTubeUrl(rawUrl);

    if (!cleanUrl) throw new Error('Invalid URL');

    // 2. 플레이리스트인 경우
    if (isPlaylist) {
      // --flat-playlist 옵션을 사용하여 영상 목록만 빠르게 가져옴
      const playlistItems = await window.api.getPlaylistInfo(cleanUrl);
      return playlistItems; // 배열 반환
    } 
    // 3. 단일 영상인 경우
    else {
      const videoInfo = await window.api.getVideoInfo(cleanUrl);
      return [{ ...videoInfo, originalUrl: cleanUrl }]; // 배열로 감싸서 반환
    }
  };

  // [수정] URL 직접 추가 핸들러
  const handleAddVideo = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    setIsAnalyzing(true);
    setStatusMessage('🔍 Analyzing URL...');
    
    try {
      const newVideos = await processUrl(trimmedUrl);
      
      setVideos((prev) => {
        // 중복 제거 (기존 리스트에 없는 영상만 추가)
        const existingIds = new Set(prev.map(v => v.id));
        const uniqueNewVideos = newVideos.filter(v => !existingIds.has(v.id));
        return [...prev, ...uniqueNewVideos];
      });

      if (newVideos.length > 1) {
        setStatusMessage(`✅ Playlist loaded: ${newVideos.length} videos added!`);
      } else {
        setStatusMessage('✅ Video added to list!');
      }
      
      setUrl('');
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (error: any) {
      setStatusMessage(`❌ Error: ${error.message}`);
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // [수정] 배치 파일 로드 핸들러 (플레이리스트 확장 기능 적용)
  const handleBatchFile = async () => {
    try {
      const urls = await window.api.readBatchFile();
      if (!urls || urls.length === 0) return;

      setBatchProgress({ current: 0, total: urls.length });
      setStatusMessage(null);

      let totalAdded = 0;
      let failCount = 0;

      for (let i = 0; i < urls.length; i++) {
        const rawUrl = urls[i];
        setBatchProgress({ current: i + 1, total: urls.length });

        try {
          // 위에서 만든 processUrl 재사용 (플레이리스트면 펼쳐서 가져옴)
          const newVideos = await processUrl(rawUrl);

          setVideos(prev => {
            const existingIds = new Set(prev.map(v => v.id));
            const uniqueNewVideos = newVideos.filter(v => !existingIds.has(v.id));
            totalAdded += uniqueNewVideos.length; // 실제로 추가된 개수 누적
            return [...prev, ...uniqueNewVideos];
          });

        } catch (e) {
          console.error(`Failed to load ${rawUrl}`, e);
          failCount++;
        }
      }

      setBatchProgress(null);
      // 메시지: "3개의 링크 처리 완료 (총 150개 영상 추가됨)"
      setStatusMessage(`✅ Batch complete: ${totalAdded} videos added from ${urls.length} links.`);
      setTimeout(() => setStatusMessage(null), 4000);

    } catch (error: any) {
      setBatchProgress(null);
      setStatusMessage(`❌ Batch File Error: ${error.message}`);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleRemoveVideo = (index: number) => {
    setVideos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (videos.length === 0) return;

    setIsDownloading(true);
    setStatusMessage('🚀 Initializing downloads...');

    try {
      const downloadUrls = videos.map((v) => v.originalUrl || `https://www.youtube.com/watch?v=${v.id}`);
      await window.api.downloadMultiple(downloadUrls, format);
      setStatusMessage('✅ All downloads started!');
      setVideos([]);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error: any) {
      setStatusMessage(`❌ Download failed: ${error.message}`);
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setIsDownloading(false);
    }
  };

  const isLoading = isAnalyzing || (batchProgress !== null);

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-gray-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
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
          title="Open Downloads Folder"
        >
          <FolderOpen size={20} />
        </button>
      </header>

      {/* Main Content */}
      <main className="pt-32 pb-24 px-6 max-w-5xl mx-auto flex flex-col items-center">
        
        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
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
        </motion.div>

        {/* Input Section */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="w-full max-w-2xl relative z-20"
        >
          <div className="relative group flex gap-3">
            <div className="relative flex-1">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddVideo()}
                  placeholder="Paste YouTube Video or Playlist URL"
                  className="w-full bg-[#1c1c1e] text-lg text-white placeholder-gray-500 px-6 py-4 rounded-full border border-white/10 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all shadow-2xl disabled:opacity-50"
                  disabled={isLoading || isDownloading}
                />
                <button
                  onClick={handleAddVideo}
                  disabled={!url.trim() || isLoading}
                  className="absolute right-2 top-2 bottom-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full px-4 aspect-square flex items-center justify-center transition-all disabled:opacity-0 disabled:scale-75"
                >
                  {isAnalyzing ? <Loader2 className="animate-spin" /> : <Plus />}
                </button>
            </div>

            {/* Batch Load Button */}
            <button
                onClick={handleBatchFile}
                disabled={isLoading || isDownloading}
                title="Load playlists.txt"
                className="bg-[#1c1c1e] border border-white/10 text-gray-400 hover:text-white hover:border-white/30 rounded-full w-14 h-auto flex items-center justify-center transition-all active:scale-95 disabled:opacity-50"
            >
                {batchProgress ? <Loader2 className="animate-spin text-blue-500" /> : <FileText size={20} />}
            </button>
          </div>

          {/* Format Selection */}
          <div className="flex justify-center mt-6 gap-4">
             <div className="bg-[#1c1c1e] p-1 rounded-full border border-white/10 flex items-center">
                {(['mp4', 'mp3'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
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

        {/* Download List Section */}
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
                  <div className="flex items-center gap-2">
                    <ListVideo className="text-blue-500" size={24} />
                    <h3 className="text-xl font-semibold text-white">
                      Download List <span className="text-gray-500 text-lg font-normal ml-1">({videos.length})</span>
                    </h3>
                  </div>
                  
                  <button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="bg-white text-black hover:bg-gray-200 px-8 py-2.5 rounded-full font-semibold flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50"
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="animate-spin" size={18} />
                        Starting...
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

      {/* Bottom Status Bar */}
      <AnimatePresence>
        {(statusMessage || batchProgress || Object.keys(downloadProgress).length > 0) && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-0 left-0 right-0 bg-[#1c1c1e]/90 backdrop-blur-xl border-t border-white/10 p-4 z-50"
          >
            <div className="max-w-3xl mx-auto space-y-3">
              
              {/* Batch Processing Status */}
              {batchProgress && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-medium text-blue-400">
                    <span>Analyzing Playlists & URLs...</span>
                    <span>{Math.round((batchProgress.current / batchProgress.total) * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden">
                    <motion.div 
                      className="h-full bg-blue-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <div className="text-center text-xs text-gray-500">
                    Processing link {batchProgress.current} of {batchProgress.total}
                  </div>
                </div>
              )}

              {/* Status Message */}
              {statusMessage && !batchProgress && (
                <div className="text-center text-sm font-medium text-gray-300 animate-pulse">
                  {statusMessage}
                </div>
              )}

              {/* Download Progress List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-32 overflow-y-auto custom-scrollbar">
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
