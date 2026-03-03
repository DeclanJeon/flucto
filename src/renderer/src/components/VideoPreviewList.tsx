import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, User, X, ImageOff } from 'lucide-react';
import type { VideoInfo } from '../../../shared/types';

interface VideoPreviewListProps {
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
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=120&h=68&fit=cover&a=top`;
};

export const VideoPreviewList: React.FC<VideoPreviewListProps> = ({ info, onRemove }) => {
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
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      whileHover={{ x: 5 }}
      className="group relative bg-gray-800/40 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-all"
    >
      <div className="flex items-center gap-4 p-3">
        {/* 썸네일 영역 */}
        <div className="relative w-32 h-18 bg-gray-900 flex items-center justify-center flex-shrink-0 rounded-lg overflow-hidden">
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
              <ImageOff size={16} />
              <span className="text-[8px] font-medium">No Preview</span>
            </div>
          )}
          
          {/* 그라데이션 및 뱃지 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[8px] px-1 py-0.5 rounded font-medium">
            {formatDuration(info.duration)}
          </span>
        </div>

        {/* 정보 영역 */}
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

        {/* 삭제 버튼 (Hover 시 등장) */}
        <button
          onClick={onRemove}
          aria-label={`Remove ${info.title} from queue`}
          className="p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  );
};
