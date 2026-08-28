import React, { useState } from 'react';
import { FileText, Globe, Languages, ShieldCheck } from 'lucide-react';
import type { TranscriptNetworkSettings, TranscriptSettings as TranscriptSettingsType } from '../../../shared/types';

interface TranscriptSettingsProps {
  settings: TranscriptSettingsType;
  onSettingsChange: (settings: TranscriptSettingsType) => void;
  /** Media URL used for on-demand caption-language availability checks. */
  previewUrl?: string;
}

const languageOptions = [
  { label: 'English', value: 'en' },
  { label: 'Auto', value: 'auto' },
  { label: 'Korean', value: 'ko' },
  { label: 'Japanese', value: 'ja' },
  { label: 'Chinese', value: 'zh' },
];

const cookiesFromBrowserOptions = [
  { label: 'Not set', value: '' },
  { label: 'Chrome', value: 'chrome' },
  { label: 'Chromium', value: 'chromium' },
  { label: 'Brave', value: 'brave' },
  { label: 'Edge', value: 'edge' },
  { label: 'Firefox', value: 'firefox' },
  { label: 'Opera', value: 'opera' },
  { label: 'Safari', value: 'safari' },
  { label: 'Vivaldi', value: 'vivaldi' },
  { label: 'Whale', value: 'whale' },
];

const defaultNetworkSettings: TranscriptNetworkSettings = {
  cookiesPath: null,
  cookiesFromBrowser: null,
  proxy: null,
  impersonate: null,
};

const networkOf = (settings: TranscriptSettingsType): TranscriptNetworkSettings =>
  settings.network ?? defaultNetworkSettings;

export const TranscriptSettings: React.FC<TranscriptSettingsProps> = ({ settings, onSettingsChange, previewUrl }) => {
  const [showNetwork, setShowNetwork] = useState(false);
  const [languageHint, setLanguageHint] = useState<string | null>(null);

  const update = (patch: Partial<TranscriptSettingsType>) => {
    onSettingsChange({ ...settings, ...patch });
  };

  const updateNetwork = (patch: Partial<TranscriptNetworkSettings>) => {
    onSettingsChange({ ...settings, network: { ...networkOf(settings), ...patch } });
  };

  const handleLanguageChange = async (value: string) => {
    update({ language: value });
    setLanguageHint(null);
    if (!previewUrl || value === 'auto') return;
    try {
      const languages = await window.api.getTranscriptLanguages(previewUrl);
      if (languages.length === 0) {
        setLanguageHint('No captions are available for this media.');
        return;
      }
      const available = languages.some((language) => language.code === value);
      const codes = languages.slice(0, 10).map((language) => language.code).join(', ');
      setLanguageHint(available
        ? `Available tracks: ${codes}${languages.length > 10 ? '…' : ''}`
        : `"${value}" was not found for this media. Available: ${codes}${languages.length > 10 ? '…' : ''}`);
    } catch {
      // Availability lookup is best-effort; the conversion itself reports errors.
      setLanguageHint(null);
    }
  };

  const handlePickCookiesFile = async () => {
    try {
      const path = await window.api.pickCookiesFile();
      updateNetwork({ cookiesPath: path });
    } catch {
      // Dialog failures leave the current value untouched.
    }
  };

  const network = networkOf(settings);

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
            value={settings.language ?? 'en'}
            onChange={(event) => void handleLanguageChange(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-gray-200 outline-none focus:border-blue-500/60"
          >
            {languageOptions.map((option) => (
              <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
            ))}
          </select>
          {languageHint && (
            <p className="text-xs text-gray-500">{languageHint}</p>
          )}
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

      <button
        type="button"
        onClick={() => setShowNetwork((prev) => !prev)}
        className="mt-4 flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-blue-300" />
          Advanced network (cookies / proxy)
        </span>
        <span className="text-xs text-gray-500">{showNetwork ? 'Hide' : 'Show'}</span>
      </button>

      {showNetwork && (
        <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-wide text-gray-500">Cookies file (cookies.txt)</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={network.cookiesPath ?? ''}
                placeholder="Select a Netscape cookies.txt file"
                onChange={(event) => updateNetwork({ cookiesPath: event.target.value || null })}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-gray-200 outline-none focus:border-blue-500/60"
              />
              <button
                type="button"
                onClick={() => void handlePickCookiesFile()}
                className="shrink-0 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-gray-200 hover:border-blue-500/60"
              >
                Browse
              </button>
            </div>
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-wide text-gray-500">Extract cookies from browser</span>
            <select
              value={network.cookiesFromBrowser ?? ''}
              onChange={(event) => updateNetwork({ cookiesFromBrowser: event.target.value || null })}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-gray-200 outline-none focus:border-blue-500/60"
            >
              {cookiesFromBrowserOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500">
              Browser extraction may fail depending on platform keychain access — a cookies.txt file is recommended.
            </p>
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
              <Globe size={13} /> Proxy
            </span>
            <input
              type="text"
              value={network.proxy ?? ''}
              placeholder="http://127.0.0.1:8080 or socks5://..."
              onChange={(event) => updateNetwork({ proxy: event.target.value || null })}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-gray-200 outline-none focus:border-blue-500/60"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-wide text-gray-500">Impersonate (optional)</span>
            <input
              type="text"
              value={network.impersonate ?? ''}
              placeholder="e.g. chrome"
              onChange={(event) => updateNetwork({ impersonate: event.target.value || null })}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-gray-200 outline-none focus:border-blue-500/60"
            />
            <p className="text-xs text-gray-500">
              Values left empty fall back to FLUCTO_* environment variables.
            </p>
          </label>
        </div>
      )}
    </div>
  );
};
