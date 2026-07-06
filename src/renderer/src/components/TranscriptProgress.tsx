import React from 'react';
import { CheckCircle, FileText, Loader2, XCircle } from 'lucide-react';
import type { TranscriptProgress as TranscriptProgressType } from '../../../shared/types';

interface TranscriptProgressProps {
  progress: TranscriptProgressType;
}

export const TranscriptProgress: React.FC<TranscriptProgressProps> = ({ progress }) => {
  const icon = (() => {
    if (progress.status === 'completed') return <CheckCircle size={16} className="text-green-400" />;
    if (progress.status === 'error') return <XCircle size={16} className="text-red-400" />;
    if (progress.status === 'pending') return <FileText size={16} className="text-gray-500" />;
    return <Loader2 size={16} className="animate-spin text-blue-400" />;
  })();

  return (
    <div className="rounded-xl border border-white/10 bg-[#1c1c1e]/50 p-3 backdrop-blur-sm">
      <div className="mb-2 flex items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-gray-300">{progress.title || progress.url}</p>
          <p className="mt-1 text-xs capitalize text-gray-500">{progress.status}</p>
          {progress.error && <p className="mt-1 text-xs text-red-400">{progress.error}</p>}
          {progress.filePath && <p className="mt-1 truncate text-xs text-green-400">{progress.filePath}</p>}
        </div>
        <span className="text-xs font-semibold text-gray-400">{progress.progress.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-700/50">
        <div
          className={`h-1.5 rounded-full transition-all ${progress.status === 'error' ? 'bg-red-500' : progress.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${Math.max(0, Math.min(100, progress.progress))}%` }}
        />
      </div>
    </div>
  );
};
