import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History,
  Trash2,
  CheckCircle,
  XCircle,
  FileVideo,
  FileAudio,
  Clock,
  ExternalLink,
  AlertCircle,
  X,
  FolderOpen,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { DownloadHistoryEntry } from '../../../shared/types';

interface NotificationState {
  id: string;
  message: string;
  type: 'error' | 'success' | 'info';
}

export const DownloadHistory: React.FC = () => {
  const [history, setHistory] = useState<DownloadHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationState[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);

  // Show notification helper
  const showNotification = useCallback((message: string, type: NotificationState['type'] = 'info') => {
    const id = Date.now().toString();
    setNotifications((prev) => [...prev, { id, message, type }]);
    
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4000);
  }, []);

  // Dismiss notification
  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Load history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const entries = await window.api.getDownloadHistory();
        // Sort by timestamp descending (newest first)
        const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
        setHistory(sorted);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load history';
        showNotification(message, 'error');
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [showNotification]);

  // Clear history handler
  const handleClearHistory = async () => {
    try {
      await window.api.clearDownloadHistory();
      setHistory([]);
      showNotification('History cleared successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to clear history';
      showNotification(message, 'error');
    }
  };

  // Open file location
  const handleOpenFolder = async () => {
    try {
      await window.api.openDownloadsFolder();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open folder';
      showNotification(message, 'error');
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  // Get notification icon
  const getNotificationIcon = (type: NotificationState['type']) => {
    switch (type) {
      case 'error':
        return <AlertCircle size={16} className="text-red-400" />;
      case 'success':
        return <CheckCircle size={16} className="text-green-400" />;
      default:
        return <AlertCircle size={16} className="text-blue-400" />;
    }
  };

  // Group history by date
  const groupedHistory = history.reduce((groups, entry) => {
    const date = new Date(entry.timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(entry);
    return groups;
  }, {} as Record<string, DownloadHistoryEntry[]>);

  return (
    <>
      {/* Notification Toasts */}
      <AnimatePresence>
        {notifications.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-20 right-6 z-[100] space-y-2 max-w-sm"
          >
            {notifications.map((notification) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, x: 100, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 100, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-lg ${
                  notification.type === 'error'
                    ? 'bg-red-950/80 border-red-500/30'
                    : notification.type === 'success'
                    ? 'bg-green-950/80 border-green-500/30'
                    : 'bg-blue-950/80 border-blue-500/30'
                }`}
              >
                {getNotificationIcon(notification.type)}
                <p className="text-sm text-gray-100 flex-1">{notification.message}</p>
                <button
                  onClick={() => dismissNotification(notification.id)}
                  className="p-1 hover:bg-white/10 rounded-full transition-colors"
                  aria-label="Dismiss notification"
                >
                  <X size={14} className="text-gray-400" />
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full mt-8"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 group"
          >
            <History className="text-purple-400" size={20} />
            <h3 className="text-lg font-semibold text-white">
              Download History
              {history.length > 0 && (
                <span className="text-gray-500 text-sm font-normal ml-2">
                  ({history.length})
                </span>
              )}
            </h3>
            {isExpanded ? (
              <ChevronUp size={16} className="text-gray-500 group-hover:text-gray-300 transition-colors" />
            ) : (
              <ChevronDown size={16} className="text-gray-500 group-hover:text-gray-300 transition-colors" />
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-all"
              title="Open Downloads Folder"
            >
              <FolderOpen size={14} />
              <span className="hidden sm:inline">Open Folder</span>
            </button>
            {history.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg border border-red-500/20 transition-all"
                title="Clear History"
              >
                <Trash2 size={14} />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full"
                  />
                </div>
              ) : history.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-12 text-gray-500"
                >
                  <History size={48} className="mb-3 opacity-30" />
                  <p className="text-sm">No download history yet</p>
                  <p className="text-xs text-gray-600 mt-1">Your completed downloads will appear here</p>
                </motion.div>
              ) : (
                <div className="space-y-6 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
                  {Object.entries(groupedHistory).map(([date, entries]) => (
                    <motion.div
                      key={date}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      {/* Date Header */}
                      <p className="text-xs text-gray-500 font-medium mb-2 px-1 sticky top-0 bg-[#0d0d0d]/90 backdrop-blur-sm py-1">
                        {date}
                      </p>

                      {/* Entries */}
                      <div className="space-y-2">
                        <AnimatePresence>
                          {entries.map((entry, index) => (
                            <motion.div
                              key={entry.id}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 20 }}
                              transition={{ delay: index * 0.05 }}
                              whileHover={{ scale: 1.01 }}
                              className={`group flex items-center gap-4 p-3 rounded-xl border backdrop-blur-sm transition-all ${
                                entry.status === 'error'
                                  ? 'bg-red-950/20 border-red-500/20 hover:border-red-500/40'
                                  : 'bg-[#1c1c1e]/50 border-white/10 hover:border-white/20'
                              }`}
                            >
                              {/* Status Icon */}
                              <div className="flex-shrink-0">
                                {entry.status === 'success' ? (
                                  <CheckCircle size={18} className="text-green-400" />
                                ) : (
                                  <XCircle size={18} className="text-red-400" />
                                )}
                              </div>

                              {/* Format Icon */}
                              <div className="flex-shrink-0">
                                {entry.format === 'mp3' ? (
                                  <FileAudio size={18} className="text-purple-400" />
                                ) : (
                                  <FileVideo size={18} className="text-blue-400" />
                                )}
                              </div>

                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-100 truncate font-medium">
                                  {entry.title || entry.url}
                                </p>
                                {entry.status === 'error' && entry.errorMessage && (
                                  <p className="text-xs text-red-400 truncate mt-0.5">
                                    {entry.errorMessage}
                                  </p>
                                )}
                                {entry.filePath && (
                                  <p className="text-xs text-gray-500 truncate mt-0.5">
                                    {entry.filePath}
                                  </p>
                                )}
                              </div>

                              {/* Timestamp */}
                              <div className="flex items-center gap-1.5 text-xs text-gray-500 flex-shrink-0">
                                <Clock size={12} />
                                <span>{formatTimestamp(entry.timestamp)}</span>
                              </div>

                              {/* Open External Link */}
                              {entry.status === 'success' && entry.filePath && (
                                <button
                                  onClick={handleOpenFolder}
                                  className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded-lg transition-all"
                                  title="Open in folder"
                                >
                                  <ExternalLink size={14} className="text-gray-400" />
                                </button>
                              )}
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
};
