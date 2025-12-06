import React from 'react';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import type { DownloadProgress as DownloadProgressType } from '../../../shared/types';

interface DownloadProgressProps {
  progress: DownloadProgressType;
}

export const DownloadProgress: React.FC<DownloadProgressProps> = ({ progress }) => {
  const getStatusIcon = () => {
    switch (progress.status) {
      case 'downloading':
        return <Loader2 size={16} className="animate-spin text-blue-400" />;
      case 'completed':
        return <CheckCircle size={16} className="text-green-400" />;
      case 'error':
        return <XCircle size={16} className="text-red-400" />;
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-gray-600" />;
    }
  };

  return (
    <div className="bg-[#1c1c1e]/50 backdrop-blur-sm rounded-xl p-3 border border-white/10">
      <div className="flex items-center gap-3 mb-2">
        {getStatusIcon()}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-300 truncate">{progress.url}</p>
          {progress.status === 'downloading' && (
            <div className="flex gap-2 text-xs text-gray-500 mt-1">
              {progress.speed && <span>{progress.speed}</span>}
              {progress.eta && <span>ETA: {progress.eta}</span>}
            </div>
          )}
          {progress.status === 'error' && (
            <p className="text-xs text-red-400 mt-1">{progress.error}</p>
          )}
        </div>
        <span className="text-xs font-semibold text-gray-400">
          {progress.progress.toFixed(0)}%
        </span>
      </div>
      <div className="w-full bg-gray-700/50 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full transition-all ${
            progress.status === 'completed' ? 'bg-green-500' :
            progress.status === 'error' ? 'bg-red-500' : 'bg-blue-500'
          }`}
          style={{ width: `${progress.progress}%` }}
        />
      </div>
    </div>
  );
};
