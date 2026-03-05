import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  FolderOpen,
  Plus,
  Loader2,
  Settings2,
  Youtube,
  FileText,
  ListVideo,
  Globe,
  Grid3X3,
  List,
  History,
  Activity,
  X,
} from 'lucide-react';
import { VideoPreview } from './VideoPreview';
import { VideoPreviewList } from './VideoPreviewList';
import { DownloadProgress } from './DownloadProgress';
import { DownloadSettings } from './DownloadSettings';
import { DownloadHistory } from './DownloadHistory';
import { useDownloadMonitor } from '../hooks/useDownloadMonitor';
import type { DownloadSettings as DownloadSettingsType, FormatOption, VideoInfo } from '../../../shared/types';

// [수정] 범용 URL 클리너 (YouTube ID 추출 로직 제거 및 범용화)
const cleanMediaUrl = (url: string): string | null => {
  try {
    const trimmed = url.trim();
    if (!trimmed) return null;

    // 기본적으로 http/https로 시작하는지 확인
    if (!trimmed.startsWith('http')) {
        return `https://${trimmed}`;
    }
    return trimmed;
  } catch {
    return null;
  }
};

// [수정] 플랫폼 아이콘 도우미 (TikTok 제거, Reddit/Bilibili 추가)
const getPlatformIcon = (url: string) => {
    if (url.includes('youtube') || url.includes('youtu.be')) return <Youtube size={18} className="text-red-500" />;
    if (url.includes('twitter') || url.includes('x.com')) return <span className="text-white font-bold text-xs">𝕏</span>;
    if (url.includes('instagram')) return <span className="text-purple-500 font-bold text-xs">IG</span>;
    // [추가] Reddit
    if (url.includes('reddit.com') || url.includes('redd.it')) return <span className="text-orange-500 font-bold text-xs">Reddit</span>;
    // [추가] Bilibili
    if (url.includes('bilibili.com')) return <span className="text-sky-400 font-bold text-xs">Bili</span>;

    return <Globe size={18} className="text-blue-400" />;
};

export const MainDownloader: React.FC = () => {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'mp4' | 'mp3'>('mp4');
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list'); // 뷰어 모드 상태 추가 (기본값: 리스트)

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);

  const downloadProgress = useDownloadMonitor();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [appliedSummary, setAppliedSummary] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showStatusPanel, setShowStatusPanel] = useState(true);
  const [downloadSettings, setDownloadSettings] = useState<DownloadSettingsType>({
    downloadsDirectory: null,
    qualityPreferences: {
      video: '1080p',
      audio: '320kbps',
    },
    formatOverrides: {
      videoFormatId: null,
      audioFormatId: null,
    },
    notifyPerItemInBatch: false,
  });

  const handleReviewWrite = () => {
    window.open('https://reviewlink.ponslink.online/write', '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const saved = await window.api.getDownloadSettings();
        setDownloadSettings(saved);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(`❌ Failed to load settings: ${message}`);
      }
    };
    void loadSettings();
  }, []);

  const formatBytesLabel = (bytes?: number): string => {
    if (!bytes || bytes <= 0) {
      return 'size unknown';
    }
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return `~${mb.toFixed(1)} MB`;
    }
    return `~${(mb / 1024).toFixed(2)} GB`;
  };

  const inferBytesFromAbr = (abrKbps?: number, durationSec?: number): number | undefined => {
    if (!abrKbps || !durationSec) {
      return undefined;
    }
    return (abrKbps * 1000 / 8) * durationSec;
  };

  const estimateAppliedSummary = async (targetUrl: string, durationSec?: number): Promise<string> => {
    const sourceVideo = downloadSettings.formatOverrides.videoFormatId
      ? `Format ID ${downloadSettings.formatOverrides.videoFormatId}`
      : `Preset ${downloadSettings.qualityPreferences.video}`;
    const sourceAudio = downloadSettings.formatOverrides.audioFormatId
      ? `Format ID ${downloadSettings.formatOverrides.audioFormatId}`
      : `Preset ${downloadSettings.qualityPreferences.audio}`;

    try {
      const formats = await window.api.getAvailableFormats(targetUrl);
      const videoFormats = formats.filter((format) => format.vcodec && format.vcodec !== 'none');
      const audioFormats = formats.filter((format) => format.acodec && format.acodec !== 'none');

      if (format === 'mp4') {
        let selected: FormatOption | undefined;
        if (downloadSettings.formatOverrides.videoFormatId) {
          selected = videoFormats.find((f) => f.formatId === downloadSettings.formatOverrides.videoFormatId);
        } else {
          const targetHeight: Record<string, number> = {
            '4k': 2160,
            '1440p': 1440,
            '1080p': 1080,
            '720p': 720,
            '480p': 480,
            '360p': 360,
            worst: 0,
          };
          const sorted = [...videoFormats].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
          if (downloadSettings.qualityPreferences.video === 'worst') {
            selected = [...sorted].reverse()[0];
          } else {
            const target = targetHeight[downloadSettings.qualityPreferences.video];
            selected = sorted.find((f) => (f.height ?? 0) <= target) ?? sorted[0];
          }
        }
        const bytes = selected?.filesizeBytes ?? selected?.filesizeApproxBytes;
        return `Applied (MP4): ${sourceVideo} | Estimated: ${formatBytesLabel(bytes)}`;
      }

      let selected: FormatOption | undefined;
      if (downloadSettings.formatOverrides.audioFormatId) {
        selected = audioFormats.find((f) => f.formatId === downloadSettings.formatOverrides.audioFormatId);
      } else {
        const targetAbr: Record<string, number> = {
          '320kbps': 320,
          '256kbps': 256,
          '192kbps': 192,
          '128kbps': 128,
          '64kbps': 64,
          worst: 0,
        };
        const sorted = [...audioFormats].sort((a, b) => (b.abrKbps ?? 0) - (a.abrKbps ?? 0));
        if (downloadSettings.qualityPreferences.audio === 'worst') {
          selected = [...sorted].reverse()[0];
        } else {
          const target = targetAbr[downloadSettings.qualityPreferences.audio];
          selected = sorted.find((f) => (f.abrKbps ?? 0) <= target) ?? sorted[0];
        }
      }
      const bytes = selected?.filesizeBytes ?? selected?.filesizeApproxBytes ?? inferBytesFromAbr(selected?.abrKbps, durationSec);
      return `Applied (MP3): ${sourceAudio} | Estimated: ${formatBytesLabel(bytes)}`;
    } catch {
      return `Applied (${format.toUpperCase()}): ${format === 'mp4' ? sourceVideo : sourceAudio} | Estimated: size unknown`;
    }
  };

  // [수정] URL 처리 로직 (YouTube Playlist 감지 로직만 유지하고 나머지는 범용 처리)
  const processUrl = async (rawUrl: string): Promise<VideoInfo[]> => {
    const cleanUrl = cleanMediaUrl(rawUrl);
    if (!cleanUrl) throw new Error('Invalid URL');

    // YouTube Playlist만 특별 취급 (list 파라미터 확인)
    const isYoutubePlaylist = (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) && cleanUrl.includes('list=');

    if (isYoutubePlaylist) {
      const playlistItems = await window.api.getPlaylistInfo(cleanUrl);
      return playlistItems;
    } else {
      // 그 외 모든 URL(Twitter, TikTok, Instagram, YouTube Single)은 단일 처리 시도
      const videoInfo = await window.api.getVideoInfo(cleanUrl);
      return [{ ...videoInfo, originalUrl: cleanUrl }];
    }
  };

  const handleAddVideo = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    setIsAnalyzing(true);
    setStatusMessage('🔍 Analyzing Media URL...');

    try {
      const newVideos = await processUrl(trimmedUrl);

      setVideos((prev) => {
        const existingIds = new Set(prev.map(v => v.id));
        const uniqueNewVideos = newVideos.filter(v => !existingIds.has(v.id));
        return [...prev, ...uniqueNewVideos];
      });

      setStatusMessage(`✅ Added ${newVideos.length} media item(s)!`);
      setUrl('');
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(`❌ Error: ${message}`);
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setIsAnalyzing(false);
    }
  };

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
          const newVideos = await processUrl(rawUrl);
          setVideos(prev => {
            const existingIds = new Set(prev.map(v => v.id));
            const uniqueNewVideos = newVideos.filter(v => !existingIds.has(v.id));
            totalAdded += uniqueNewVideos.length;
            return [...prev, ...uniqueNewVideos];
          });
        } catch (error) {
          console.error(`Failed to load ${rawUrl}`, error);
          failCount++;
        }
      }
      setBatchProgress(null);
      setStatusMessage(
        failCount > 0
          ? `✅ Batch complete: ${totalAdded} items added. ${failCount} failed.`
          : `✅ Batch complete: ${totalAdded} items added.`,
      );
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (error: unknown) {
      setBatchProgress(null);
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(`❌ Batch File Error: ${message}`);
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
      // id가 없는 경우(일부 사이트) 대비 안전장치
      const downloadUrls = videos.map((v) => v.originalUrl || `https://www.youtube.com/watch?v=${v.id}`);
      const downloadTitles = videos.map((v) => v.title || (v.originalUrl || v.id));
      const summary = await estimateAppliedSummary(downloadUrls[0], videos[0]?.duration);
      setAppliedSummary(summary);
      await window.api.downloadMultiple(
        downloadUrls,
        format,
        downloadSettings.qualityPreferences,
        downloadTitles,
        downloadSettings.formatOverrides,
        downloadSettings.notifyPerItemInBatch,
      );
      setStatusMessage('✅ All downloads started!');
      setVideos([]);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(`❌ Download failed: ${message}`);
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadSettingsChange = async (settings: DownloadSettingsType) => {
    setDownloadSettings(settings);
    await window.api.setDownloadSettings(settings);
  };

  const handleIndividualDownload = async (video: VideoInfo) => {
    const targetUrl = video.originalUrl || `https://www.youtube.com/watch?v=${video.id}`;
    const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await window.api.downloadSingle({
      
      url: targetUrl,
      format,
      requestId,
      quality: downloadSettings.qualityPreferences,
      formatOverrides: downloadSettings.formatOverrides,
      title: video.title,
    });
    const summary = await estimateAppliedSummary(targetUrl, video.duration);
    setAppliedSummary(summary);
  };

  const isLoading = isAnalyzing || (batchProgress !== null);
  const hasStatusContent = Boolean(statusMessage || batchProgress || Object.keys(downloadProgress).length > 0 || appliedSummary);

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-gray-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#0d0d0d]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2">
          {/* 로고 영역 살짝 수정 */}
          <div className="bg-gradient-to-br from-blue-600 to-purple-600 p-1.5 rounded-lg flex items-center justify-center">
            <Globe size={18} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">Flucto</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReviewWrite}
            className="px-3 py-1.5 rounded-full border border-white/10 bg-[#1c1c1e] text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-all"
            title="리뷰작성"
          >
            리뷰작성
          </button>
          <button
            type="button"
            onClick={() => setShowHistory((prev) => !prev)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
            title="Toggle Download History"
          >
            <History size={20} />
          </button>
          <button
            type="button"
            onClick={() => setShowSettings((prev) => !prev)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
            title="Open Download Settings"
          >
            <Settings2 size={20} />
          </button>
          <button
            type="button"
            onClick={() => window.api.openDownloadsFolder()}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
            title="Open Downloads Folder"
          >
            <FolderOpen size={20} />
          </button>
          <button
            type="button"
            onClick={() => setShowStatusPanel((prev) => !prev)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
            title={showStatusPanel ? 'Hide Download Status' : 'Show Download Status'}
          >
            <Activity size={20} />
          </button>
        </div>
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
            Universal Media Downloader
          </h2>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white leading-[1.1]">
            Any Platform.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-200 to-gray-500">
              One Downloader.
            </span>
          </h1>
          <p className="text-gray-500 text-sm mt-2">
            Support for YouTube, Twitter (X), Reddit, Bilibili & Instagram
          </p>
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
                  placeholder="Paste URL (YouTube, Reddit, Bilibili, X, Instagram)"
                  className="w-full bg-[#1c1c1e] text-lg text-white placeholder-gray-500 px-6 py-4 rounded-full border border-white/10 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all shadow-2xl disabled:opacity-50"
                  disabled={isLoading || isDownloading}
                />
                <button
                  type="button"
                  onClick={handleAddVideo}
                  disabled={!url.trim() || isLoading}
                  className="absolute right-2 top-2 bottom-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full px-4 aspect-square flex items-center justify-center transition-all disabled:opacity-0 disabled:scale-75"
                >
                  {isAnalyzing ? <Loader2 className="animate-spin" /> : <Plus />}
                </button>
            </div>

            {/* Batch Load Button */}
            <button
                type="button"
                onClick={handleBatchFile}
                disabled={isLoading || isDownloading}
                title="Load URL list (.txt)"
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
                    type="button"
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

        <div className="w-full max-w-2xl mt-6 space-y-4">
          <AnimatePresence>
            {showSettings && (
              <DownloadSettings
                settings={downloadSettings}
                onClose={() => setShowSettings(false)}
                onSettingsChange={handleDownloadSettingsChange}
                previewUrl={videos[0] ? (videos[0].originalUrl || `https://www.youtube.com/watch?v=${videos[0].id}`) : undefined}
                previewDurationSeconds={videos[0]?.duration}
                currentFormat={format}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showHistory && <DownloadHistory />}
          </AnimatePresence>
        </div>

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
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <ListVideo className="text-blue-500" size={24} />
                      <h3 className="text-xl font-semibold text-white">
                        Download List <span className="text-gray-500 text-lg font-normal ml-1">({videos.length})</span>
                      </h3>
                    </div>

                    {/* 뷰어 모드 전환 버튼 */}
                    <div className="bg-[#1c1c1e] p-1 rounded-full border border-white/10 flex items-center">
                      <button
                        type="button"
                        onClick={() => setViewMode('grid')}
                        className={`p-2 rounded-full transition-all ${
                          viewMode === 'grid'
                            ? 'bg-gray-700 text-white shadow-sm'
                            : 'text-gray-400 hover:text-white'
                        }`}
                        title="Grid View"
                      >
                        <Grid3X3 size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('list')}
                        className={`p-2 rounded-full transition-all ${
                          viewMode === 'list'
                            ? 'bg-gray-700 text-white shadow-sm'
                            : 'text-gray-400 hover:text-white'
                        }`}
                        title="List View"
                      >
                        <List size={16} />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
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

                {/* 뷰어 모드에 따른 렌더링 */}
                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <AnimatePresence>
                      {videos.map((video) => {
                        const itemKey = video.originalUrl ?? `${video.id}-${video.title}`;
                        return (
                        <div key={itemKey} className="relative group">
                          {/* 플랫폼 아이콘 뱃지 */}
                          <div className="absolute top-3 left-3 z-10 bg-black/60 backdrop-blur-sm p-1.5 rounded-md border border-white/10">
                              {getPlatformIcon(video.originalUrl || '')}
                          </div>
                           <VideoPreview
                               info={video}
                               onDownload={handleIndividualDownload}
                                onRemove={() => {
                                  const index = videos.findIndex((item) => item === video);
                                  if (index >= 0) {
                                    handleRemoveVideo(index);
                                 }
                               }}
                           />
                        </div>
                      )})}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <AnimatePresence>
                      {videos.map((video) => {
                        const itemKey = video.originalUrl ?? `${video.id}-${video.title}`;
                        return (
                        <div key={itemKey} className="relative group">
                           <VideoPreviewList
                                info={video}
                                onDownload={handleIndividualDownload}
                                onRemove={() => {
                                  const index = videos.findIndex((item) => item === video);
                                  if (index >= 0) {
                                    handleRemoveVideo(index);
                                 }
                               }}
                           />
                          {/* 플랫폼 아이콘 뱃지 */}
                          <div className="absolute top-3 left-3 z-10 bg-black/60 backdrop-blur-sm p-1.5 rounded-md border border-white/10">
                              {getPlatformIcon(video.originalUrl || '')}
                          </div>
                        </div>
                      )})}
                    </AnimatePresence>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Bottom Status Bar */}
      <AnimatePresence>
        {hasStatusContent && showStatusPanel && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-0 left-0 right-0 bg-[#1c1c1e]/90 backdrop-blur-xl border-t border-white/10 p-4 z-50"
          >
            <div className="max-w-3xl mx-auto space-y-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowStatusPanel(false)}
                  className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/10"
                  title="Close status panel"
                >
                  <X size={14} />
                </button>
              </div>
              {batchProgress && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-medium text-blue-400">
                    <span>Analyzing URLs...</span>
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

              {statusMessage && !batchProgress && (
                <div className="text-center text-sm font-medium text-gray-300 animate-pulse">
                  {statusMessage}
                </div>
              )}

              {appliedSummary && !batchProgress && (
                <div className="text-center text-xs font-medium text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                  {appliedSummary}
                </div>
              )}

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-32 overflow-y-auto custom-scrollbar">
                  {Object.values(downloadProgress).map((progress) => (
                     <DownloadProgress key={progress.requestId} progress={progress} />
                  ))}
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
