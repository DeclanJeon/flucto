import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, Settings2, X, Video, Music } from 'lucide-react';
import type { DownloadSettings as DownloadSettingsType, FormatOption } from '../../../shared/types';

interface DownloadSettingsProps {
  settings: DownloadSettingsType;
  onClose: () => void;
  onSettingsChange: (settings: DownloadSettingsType) => void;
  previewUrl?: string;
  currentFormat: 'mp4' | 'mp3';
  previewDurationSeconds?: number;
}

const videoQualityOptions = ['4k', '1440p', '1080p', '720p', '480p', '360p', 'worst'] as const;
const audioQualityOptions = ['320kbps', '256kbps', '192kbps', '128kbps', '64kbps', 'worst'] as const;

export const DownloadSettings: React.FC<DownloadSettingsProps> = ({
  settings,
  onClose,
  onSettingsChange,
  previewUrl,
  currentFormat,
  previewDurationSeconds,
}) => {
  const [localSettings, setLocalSettings] = useState(settings);
  const [availableFormats, setAvailableFormats] = useState<FormatOption[]>([]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    const loadFormats = async () => {
      if (!previewUrl) {
        setAvailableFormats([]);
        return;
      }
      try {
        const formats = await window.api.getAvailableFormats(previewUrl);
        setAvailableFormats(formats);
      } catch {
        setAvailableFormats([]);
      }
    };
    void loadFormats();
  }, [previewUrl]);

  const applySettings = (next: DownloadSettingsType) => {
    setLocalSettings(next);
    onSettingsChange(next);
  };

  const handleSelectDirectory = async () => {
    const path = await window.api.selectDownloadDirectory();
    if (path) {
      applySettings({ ...localSettings, downloadsDirectory: path });
    }
  };

  const handleOpenFolder = async () => {
    await window.api.openDownloadsFolder();
  };

  const handleVideoQualityChange = (quality: typeof videoQualityOptions[number]) => {
    applySettings({
      ...localSettings,
      qualityPreferences: {
        ...localSettings.qualityPreferences,
        video: quality,
      },
      formatOverrides: {
        ...localSettings.formatOverrides,
        videoFormatId: null,
      },
    });
  };

  const handleAudioQualityChange = (quality: typeof audioQualityOptions[number]) => {
    applySettings({
      ...localSettings,
      qualityPreferences: {
        ...localSettings.qualityPreferences,
        audio: quality,
      },
      formatOverrides: {
        ...localSettings.formatOverrides,
        audioFormatId: null,
      },
    });
  };

  const videoFormats = availableFormats.filter((format) => {
    const resolution = format.resolution?.toLowerCase() ?? '';
    const note = format.note?.toLowerCase() ?? '';
    return resolution !== '' && !resolution.includes('audio only') && !note.includes('audio only');
  });

  const audioFormats = availableFormats.filter((format) => {
    const resolution = format.resolution?.toLowerCase() ?? '';
    const note = format.note?.toLowerCase() ?? '';
    return resolution.includes('audio only') || note.includes('audio only') || typeof format.abrKbps === 'number';
  });

  const handleVideoFormatOverride = (value: string) => {
    applySettings({
      ...localSettings,
      formatOverrides: {
        ...localSettings.formatOverrides,
        videoFormatId: value || null,
      },
    });
  };

  const handleAudioFormatOverride = (value: string) => {
    applySettings({
      ...localSettings,
      formatOverrides: {
        ...localSettings.formatOverrides,
        audioFormatId: value || null,
      },
    });
  };

  const handleBatchItemNotificationToggle = (enabled: boolean) => {
    applySettings({
      ...localSettings,
      notifyPerItemInBatch: enabled,
    });
  };

  const targetHeightMap: Record<(typeof videoQualityOptions)[number], number> = {
    '4k': 2160,
    '1440p': 1440,
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
    '360p': 360,
    worst: 0,
  };

  const targetAbrMap: Record<(typeof audioQualityOptions)[number], number> = {
    '320kbps': 320,
    '256kbps': 256,
    '192kbps': 192,
    '128kbps': 128,
    '64kbps': 64,
    worst: 0,
  };

  const estimateLabel = (bytes?: number) => {
    if (!bytes || bytes <= 0) {
      return 'size unknown';
    }
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return `~${mb.toFixed(1)} MB`;
    }
    return `~${(mb / 1024).toFixed(2)} GB`;
  };

  const inferBytesFromAbr = (abrKbps?: number) => {
    if (!abrKbps || !previewDurationSeconds) {
      return undefined;
    }
    return (abrKbps * 1000 / 8) * previewDurationSeconds;
  };

  const getFormatBytes = (format?: FormatOption): number | undefined => {
    if (!format) {
      return undefined;
    }
    return format.filesizeBytes ?? format.filesizeApproxBytes ?? inferBytesFromAbr(format.abrKbps);
  };

  const pickBestAudioForMp4 = (): FormatOption | undefined => {
    const candidates = audioFormats.filter((format) => format.acodec && format.acodec !== 'none');
    if (candidates.length === 0) {
      return undefined;
    }
    const m4aCandidates = candidates.filter((format) => format.ext === 'm4a');
    const target = m4aCandidates.length > 0 ? m4aCandidates : candidates;
    return [...target].sort((a, b) => (b.abrKbps ?? 0) - (a.abrKbps ?? 0))[0];
  };

  const pickVideoByPreset = (preset: (typeof videoQualityOptions)[number]): FormatOption | undefined => {
    const candidates = videoFormats.filter((format) => format.vcodec && format.vcodec !== 'none');
    if (candidates.length === 0) {
      return undefined;
    }

    const mp4Candidates = candidates.filter((format) => format.ext === 'mp4');
    const targetPool = mp4Candidates.length > 0 ? mp4Candidates : candidates;
    const sorted = [...targetPool].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    if (preset === 'worst') {
      return [...sorted].reverse()[0];
    }

    const target = targetHeightMap[preset];
    return sorted.find((format) => (format.height ?? 0) <= target) ?? sorted[0];
  };

  const estimateVideoSizeByPreset = (preset: (typeof videoQualityOptions)[number]) => {
    const selectedVideo = pickVideoByPreset(preset);
    if (!selectedVideo) {
      return 'size unknown';
    }
    const selectedAudio = pickBestAudioForMp4();
    const videoBytes = getFormatBytes(selectedVideo) ?? 0;
    const audioBytes = getFormatBytes(selectedAudio) ?? 0;
    const totalBytes = videoBytes + audioBytes;
    return totalBytes > 0 ? estimateLabel(totalBytes) : 'size unknown';
  };

  const estimateAudioSizeByPreset = (preset: (typeof audioQualityOptions)[number]) => {
    const candidates = audioFormats.filter((format) => format.acodec && format.acodec !== 'none');
    if (candidates.length === 0) {
      return 'size unknown';
    }
    const sorted = [...candidates].sort((a, b) => (b.abrKbps ?? 0) - (a.abrKbps ?? 0));
    let selected: FormatOption | undefined;
    if (preset === 'worst') {
      selected = [...sorted].reverse()[0];
    } else {
      const target = targetAbrMap[preset];
      selected = sorted.find((format) => (format.abrKbps ?? 0) <= target) ?? sorted[0];
    }
    const bytes = selected?.filesizeBytes ?? selected?.filesizeApproxBytes ?? inferBytesFromAbr(selected?.abrKbps);
    return estimateLabel(bytes);
  };

  const selectedVideoOverride = localSettings.formatOverrides.videoFormatId
    ? videoFormats.find((format) => format.formatId === localSettings.formatOverrides.videoFormatId)
    : undefined;
  const selectedAudioOverride = localSettings.formatOverrides.audioFormatId
    ? audioFormats.find((format) => format.formatId === localSettings.formatOverrides.audioFormatId)
    : undefined;

  const estimatedMp4Bytes = (() => {
    const selectedVideo = selectedVideoOverride ?? pickVideoByPreset(localSettings.qualityPreferences.video);
    const selectedAudio = selectedAudioOverride ?? pickBestAudioForMp4();
    const videoBytes = getFormatBytes(selectedVideo) ?? 0;
    const audioBytes = getFormatBytes(selectedAudio) ?? 0;
    const totalBytes = videoBytes + audioBytes;
    return totalBytes > 0 ? totalBytes : undefined;
  })();

  const activeSizeLabel = currentFormat === 'mp4'
    ? estimateLabel(estimatedMp4Bytes)
    : (selectedAudioOverride
      ? estimateLabel(
        selectedAudioOverride.filesizeBytes
        ?? selectedAudioOverride.filesizeApproxBytes
        ?? inferBytesFromAbr(selectedAudioOverride.abrKbps),
      )
      : estimateAudioSizeByPreset(localSettings.qualityPreferences.audio));

  const activeSourceLabel = currentFormat === 'mp4'
    ? (localSettings.formatOverrides.videoFormatId
      ? `Format ID ${localSettings.formatOverrides.videoFormatId}`
      : `Preset ${localSettings.qualityPreferences.video}`)
    : (localSettings.formatOverrides.audioFormatId
      ? `Format ID ${localSettings.formatOverrides.audioFormatId}`
      : `Preset ${localSettings.qualityPreferences.audio}`);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="bg-gray-800/40 backdrop-blur-md border border-white/10 rounded-2xl p-6 space-y-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Settings2 size={20} />
          Download Settings
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-full transition-colors"
        >
          <X size={20} className="text-gray-400" />
        </button>
      </div>

      <div className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-3">
        <div className="text-xs text-blue-300">Current Applied Output ({currentFormat.toUpperCase()})</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="text-sm text-gray-100 font-medium">{activeSourceLabel}</div>
          <div className="text-sm text-blue-200 font-semibold">{activeSizeLabel}</div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-sm text-gray-400 flex items-center gap-2">
          <FolderOpen size={14} />
          Download Location
        </div>
        <div className="flex gap-2">
          <div className="flex-1 bg-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 truncate">
            {localSettings.downloadsDirectory || 'Default (~/Downloads)'}
          </div>
          <button
            type="button"
            onClick={handleSelectDirectory}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white transition-colors"
          >
            Change
          </button>
        </div>
        <button
          type="button"
          onClick={handleOpenFolder}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors w-full"
        >
          <FolderOpen size={14} />
          Open Folder
        </button>
      </div>

      <div className="space-y-3 pt-4 border-t border-white/10">
        <div className="text-sm text-gray-400 flex items-center gap-2">
          <Video size={14} />
          Video Quality
          <span className="text-[11px] text-gray-500">{currentFormat === 'mp4' ? '(active)' : '(used when MP4 selected)'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {videoQualityOptions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => handleVideoQualityChange(q)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                localSettings.qualityPreferences.video === q
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <span className="font-medium">{q}</span>
              <span className="ml-1 text-[10px] opacity-80">{estimateVideoSizeByPreset(q)}</span>
            </button>
          ))}
        </div>

        <div className="text-sm text-gray-400 flex items-center gap-2 pt-2">
          <Music size={14} />
          Audio Quality
          <span className="text-[11px] text-gray-500">{currentFormat === 'mp3' ? '(active)' : '(used when MP3 selected)'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {audioQualityOptions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => handleAudioQualityChange(q)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                localSettings.qualityPreferences.audio === q
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <span className="font-medium">{q}</span>
              <span className="ml-1 text-[10px] opacity-80">{estimateAudioSizeByPreset(q)}</span>
            </button>
          ))}
        </div>

        {previewUrl && (
          <div className="space-y-3 pt-4 border-t border-white/10">
            <div className="text-sm text-gray-400">Exact Format Override (optional)</div>
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Video format ID</div>
              <select
                value={localSettings.formatOverrides.videoFormatId ?? ''}
                onChange={(event) => handleVideoFormatOverride(event.target.value)}
                className="w-full bg-gray-700 text-gray-200 rounded-lg px-3 py-2 text-sm border border-white/10"
              >
                <option value="">Auto (quality preset)</option>
                {videoFormats.map((format) => (
                  <option key={format.formatId} value={format.formatId}>
                    {format.formatId} - {format.resolution ?? format.note ?? 'video'}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-gray-500">Audio format ID</div>
              <select
                value={localSettings.formatOverrides.audioFormatId ?? ''}
                onChange={(event) => handleAudioFormatOverride(event.target.value)}
                className="w-full bg-gray-700 text-gray-200 rounded-lg px-3 py-2 text-sm border border-white/10"
              >
                <option value="">Auto (quality preset)</option>
                {audioFormats.map((format) => (
                  <option key={format.formatId} value={format.formatId}>
                    {format.formatId} - {format.note ?? format.resolution ?? 'audio'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-white/10">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm text-gray-300">Per-item notification in batch</span>
            <input
              type="checkbox"
              checked={localSettings.notifyPerItemInBatch}
              onChange={(event) => handleBatchItemNotificationToggle(event.target.checked)}
              className="h-4 w-4 accent-blue-500"
            />
          </label>
        </div>
      </div>
    </motion.div>
  );
};
