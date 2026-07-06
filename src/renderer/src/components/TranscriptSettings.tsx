import React from 'react';
import { FileText, Languages } from 'lucide-react';
import type { TranscriptSettings as TranscriptSettingsType } from '../../../shared/types';

interface TranscriptSettingsProps {
  settings: TranscriptSettingsType;
  onSettingsChange: (settings: TranscriptSettingsType) => void;
}

const languageOptions = [
  { label: 'Auto', value: '' },
  { label: 'Korean', value: 'ko' },
  { label: 'English', value: 'en' },
  { label: 'Japanese', value: 'ja' },
  { label: 'Chinese', value: 'zh' },
];

export const TranscriptSettings: React.FC<TranscriptSettingsProps> = ({ settings, onSettingsChange }) => {
  const update = (patch: Partial<TranscriptSettingsType>) => {
    onSettingsChange({ ...settings, ...patch });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#1c1c1e]/85 p-4 text-sm text-gray-300">
      <div className="mb-4 flex items-center gap-2 text-white">
        <FileText size={16} className="text-blue-300" />
        <span className="font-semibold">Markdown Transcript Settings</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
            <Languages size={13} /> Language
          </span>
          <select
            value={settings.language ?? ''}
            onChange={(event) => update({ language: event.target.value || null })}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-gray-200 outline-none focus:border-blue-500/60"
          >
            {languageOptions.map((option) => (
              <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-xs uppercase tracking-wide text-gray-500">Paragraph gap</span>
          <input
            type="number"
            min={0}
            max={30}
            step={0.5}
            value={settings.paragraphGapSeconds}
            onChange={(event) => update({ paragraphGapSeconds: Number(event.target.value) || 0 })}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-gray-200 outline-none focus:border-blue-500/60"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <span>Include timestamps</span>
          <input
            type="checkbox"
            checked={settings.includeTimestamps}
            onChange={(event) => update({ includeTimestamps: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <span>Include metadata</span>
          <input
            type="checkbox"
            checked={settings.includeMetadata}
            onChange={(event) => update({ includeMetadata: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <span>Save .md file</span>
          <input
            type="checkbox"
            checked={settings.saveMarkdownFile}
            onChange={(event) => update({ saveMarkdownFile: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <span>Copy to clipboard</span>
          <input
            type="checkbox"
            checked={settings.copyMarkdownToClipboard}
            onChange={(event) => update({ copyMarkdownToClipboard: event.target.checked })}
          />
        </label>
      </div>
    </div>
  );
};
