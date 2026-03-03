import React, { useState } from 'react'; // useState 추가
import { motion } from 'framer-motion';
import { Eye, User, X, ImageOff } from 'lucide-react'; // ImageOff 아이콘 추가
import type { VideoInfo } from '../../../shared/types';

interface VideoPreviewProps {
  info: VideoInfo;
  onRemove: () => void;
}

// [추가] 이미지 로딩 차단 우회(CORS Bypass)를 위한 프록시 URL 생성기
const getProxiedImageUrl = (url: string) => {
  if (!url) return '';
  
  // 이미 wsrv.nl을 쓰고 있거나 로컬 파일이면 그대로 반환
  if (url.startsWith('https://wsrv.nl') || url.startsWith('file://')) return url;

  // 유튜브는 구글 서버가 잘 처리해주므로 프록시 불필요 (속도 최적화)
  if (url.includes('ytimg.com') || url.includes('youtube.com')) return url;

  // 인스타그램, 트위터, 틱톡, Bilibili 등은 프록시 필수
  // wsrv.nl은 오픈소스 이미지 캐싱 서비스입니다.
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=400&h=225&fit=cover&a=top`;
};

export const VideoPreview: React.FC<VideoPreviewProps> = ({ info, onRemove }) => {
  const [imgError, setImgError] = useState(false); // 이미지 로드 실패 상태 관리

  // 숫자 포맷팅 유틸리티
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
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -5 }}
      className="group relative bg-gray-800/40 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden hover:border-white/20 transition-colors"
    >
      {/* 썸네일 영역 */}
      <div className="relative aspect-video bg-gray-900 flex items-center justify-center">
        {!imgError && info.thumbnail ? (
          <img 
            src={getProxiedImageUrl(info.thumbnail)} 
            alt={info.title} 
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={() => setImgError(true)} // 로딩 실패 시 에러 상태로 전환
            loading="lazy"
          />
        ) : (
          // 썸네일이 없거나 로드 실패 시 보여줄 Fallback UI
          <div className="flex flex-col items-center text-gray-600 gap-1">
            <ImageOff size={24} />
            <span className="text-[10px] font-medium">No Preview</span>
          </div>
        )}
        
        {/* 그라데이션 및 뱃지 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
        <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
          {formatDuration(info.duration)}
        </span>
      </div>

      {/* 정보 영역 */}
      <div className="p-4">
        <h3 className="text-white font-semibold text-sm leading-tight line-clamp-2 mb-2 group-hover:text-blue-400 transition-colors">
          {info.title}
        </h3>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-1.5">
            <User size={12} aria-hidden="true" />
            <span className="truncate max-w-[80px]">{info.uploader}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Eye size={12} aria-hidden="true" />
            <span>{formatViews(info.view_count)}</span>
          </div>
        </div>
      </div>

      {/* 삭제 버튼 (Hover 시 등장) */}
      <button
        onClick={onRemove}
        aria-label={`Remove ${info.title} from queue`}
        className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </motion.div>
  );
};
