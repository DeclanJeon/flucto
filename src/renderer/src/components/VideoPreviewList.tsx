import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, User, X, ImageOff, Download } from 'lucide-react';
import type { VideoInfo } from '../../../shared/types';

interface VideoPreviewListProps {
  info: VideoInfo;
  onRemove: () => void;
  onDownload?: (info: VideoInfo) => void;
}

const getProxiedImageUrl = (url: string) => {
  if (!url) return '';
  
  if (url.startsWith('https://wsrv.nl') || url.startsWith('file://')) return url;

  if (url.includes('ytimg.com') || url.includes('youtube.com')) return url;

  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=120&h=68&fit=cover&a=top`;
};

export const VideoPreviewList: React.FC<VideoPreviewListProps> = ({ info, onRemove, onDownload }) => {
  const [imgError, setImgError] = useState(false);

  const formatViews = (views?: number) => {
    if (!views) return 'N/A';
    return new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(views);
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 
      ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      : `${m}:${s.toString().padStart(2, '0')}`;
  }

  const handleIndividualDownload = async () => {
    if (onDownload) {
      onDownload(info)
    }
  }

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      whileHover={{ x: 5 }}
      className="group relative bg-gray-800/40 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-all"
    >
      <div className="flex items-center gap-4 p-3">
        <div className="relative w-32 h-18 bg-gray-900 flex items-center justify-center flex-shrink-0 rounded-lg overflow-hidden">
          {!imgError && info.thumbnail ? (
            <img 
              src={getProxiedImageUrl(info.thumbnail)} 
              alt={info.title} 
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={() => setImgError(true)}
              loading="lazy"
            />
          ) : (
            <div className="flex flex-col items-center text-gray-600 gap-1">
              <ImageOff size={16} />
              <span className="text-[8px] font-medium">No Preview</span>
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[8px] px-1 py-0.5 rounded font-medium">
            {formatDuration(info.duration)}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-sm leading-tight line-clamp-2 mb-2 group-hover:text-blue-400 transition-colors">
            {info.title}
          </h3>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <div className="flex items-center gap-1.5">
              <User size={12} aria-hidden="true" />
              <span className="truncate max-w-[120px]">{info.uploader}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Eye size={12} aria-hidden="true" />
              <span>{formatViews(info.view_count)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${info.title} from queue`}
            className="p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-500/80"
          >
            <X size={14} aria-hidden="true" />
          </button>
          
          {onDownload && (
            <button
              type="button"
              onClick={handleIndividualDownload}
              className="p-1.5 bg-blue-600 hover:bg-blue-500 rounded-full opacity-0 group-hover:opacity-100 text-white transition-all"
              title="Download this video"
            >
              <Download size={14} aria-hidden="true" />
            </button>
          )}
         </div>
       </div>
     </motion.div>
   );
};