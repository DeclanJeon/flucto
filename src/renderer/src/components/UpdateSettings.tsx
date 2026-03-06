import { useState, useEffect } from 'react';
import { CheckCircle, Loader2, RefreshCw, Settings, Wifi } from 'lucide-react';
import type { UpdateSettings as UpdateSettingsType } from '../../../shared/types';

/**
 * 업데이트 알림 설정 컴포넌트
 * 자동 업데이트 활성화/비활성화 및 체크 주기 설정
 */
export function UpdateSettings() {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<UpdateSettingsType>({
    autoUpdate: false,
    checkInterval: 86400000, // 기본값: 24시간 (밀리초)
    notifyOnUpdateReady: true,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [binaryCheckMessage, setBinaryCheckMessage] = useState('');
  const [isCheckingBinaries, setIsCheckingBinaries] = useState(false);

  // 업데이트 설정 불러오기
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loadedSettings = await window.api.getUpdateSettings();
        if (loadedSettings) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        console.error('Failed to load update settings:', error);
      }
    };

    loadSettings();
  }, []);

  // 저장 핸들러
  const handleSave = async () => {
    setIsLoading(true);
    setSaveMessage('');

    try {
      await window.api.saveUpdateSettings(settings);
      setSaveMessage('설정이 저장되었습니다.');
      setIsOpen(false);
      
      // 3초 후 메시지 제거
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('설정 저장에 실패했습니다.');
      console.error('Failed to save update settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBinaryCheck = async () => {
    setIsCheckingBinaries(true);
    setBinaryCheckMessage('');

    try {
      await window.api.checkBinaryUpdates();
      setBinaryCheckMessage('yt-dlp와 ffmpeg 상태를 정상적으로 확인했습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBinaryCheckMessage(`바이너리 확인 실패: ${message}`);
    } finally {
      setIsCheckingBinaries(false);
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-full border border-white/10 bg-[#1c1c1e]/90 p-2 text-gray-300 shadow-lg backdrop-blur-sm transition-colors hover:bg-white/10 hover:text-white"
        title="업데이트 설정"
      >
        <Settings className="h-5 w-5" />
      </button>

      {isOpen && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="mx-4 w-full max-w-md rounded-3xl border border-white/10 bg-[#151518] p-6 text-gray-100 shadow-2xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-blue-300">Update Center</p>
              <h2 className="mt-2 text-xl font-bold text-white">업데이트 설정</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* 자동 업데이트 활성화 */}
          <div className="mb-6">
            <label className="mb-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.autoUpdate}
                onChange={(e) => setSettings({ ...settings, autoUpdate: e.target.checked })}
                className="w-5 h-5 accent-blue-600"
              />
              <span className="text-sm font-medium">자동 업데이트 활성화</span>
            </label>
            <p className="text-xs leading-6 text-gray-400">
              앱 시작 시 새 버전이 있으면 알림을 표시합니다
            </p>
          </div>

          {/* 체크 주기 */}
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium">업데이트 체크 주기</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <select
                value={settings.checkInterval.toString()}
                onChange={(e) => setSettings({ ...settings, checkInterval: parseInt(e.target.value) })}
                className="flex-1 rounded-xl border border-white/10 bg-[#0d0d0d] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="3600000">1시간</option>
                <option value="43200000">12시간</option>
                <option value="86400000">24시간</option>
                <option value="172800000">48시간</option>
              </select>
              <span className="ml-2 text-xs text-gray-400">
                자동으로 업데이트를 체크하는 시간 간격
              </span>
            </div>
          </div>

          {/* 업데이트 시 알림 */}
          <div className="mb-6">
            <label className="mb-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.notifyOnUpdateReady}
                onChange={(e) => setSettings({ ...settings, notifyOnUpdateReady: e.target.checked })}
                className="w-5 h-5 accent-blue-600"
              />
              <span className="text-sm font-medium">업데이트 다운로드 완료 시 재시작 안내</span>
            </label>
            <p className="text-xs leading-6 text-gray-400">
              새 버전 다운로드가 끝나면 재시작 안내를 표시합니다
            </p>
          </div>

          {/* 현재 바이너리 버전 정보 */}
          <div className="mb-6 rounded-2xl border border-white/10 bg-[#0d0d0d] p-4">
            <h3 className="mb-2 text-sm font-semibold text-white">현재 바이너리 상태</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600">
                  <Wifi className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">yt-dlp</p>
                  <p className="text-xs text-gray-400">
                    업데이트 확인 전용
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600">
                  <CheckCircle className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">ffmpeg</p>
                  <p className="text-xs text-gray-400">
                    최신 버전 확인 중
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleBinaryCheck}
              disabled={isCheckingBinaries}
              className="mt-3 flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-300 transition-colors hover:border-blue-400/50 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCheckingBinaries ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {isCheckingBinaries ? '확인 중...' : '바이너리 상태 확인'}
            </button>
            {binaryCheckMessage && (
              <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${binaryCheckMessage.startsWith('바이너리 확인 실패') ? 'border-red-500/20 bg-red-500/10 text-red-200' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'}`}>
                {binaryCheckMessage}
              </div>
            )}
          </div>

          {/* 저장 버튼 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading}
              className="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50"
            >
              {isLoading ? '저장 중...' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-gray-200 transition-colors hover:bg-white/15"
            >
              취소
            </button>
          </div>

          {/* 저장 메시지 */}
          {saveMessage && (
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              {saveMessage}
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
