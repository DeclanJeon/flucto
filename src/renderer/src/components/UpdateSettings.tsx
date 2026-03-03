import { useState, useEffect } from 'react';
import { CheckCircle, RefreshCw, Settings, Wifi } from 'lucide-react';
import type { UpdateSettings as UpdateSettingsType } from '../../../shared/types';

/**
 * 업데이트 알림 설정 컴포넌트
 * 자동 업데이트 활성화/비활성화 및 체크 주기 설정
 */
export function UpdateSettings() {
  const [settings, setSettings] = useState<UpdateSettingsType>({
    autoUpdate: false,
    checkInterval: 86400000, // 기본값: 24시간 (밀리초)
    notifyOnStart: true,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

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
      
      // 3초 후 메시지 제거
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('설정 저장에 실패했습니다.');
      console.error('Failed to save update settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50">
      <button
        onClick={() => {
          // TODO: 설정 모달 열기
        }}
        className="bg-white/10 backdrop-blur-sm p-2 rounded-full shadow-lg hover:bg-gray-100 transition-colors"
      >
        <Settings className="w-5 h-5 text-gray-600" />
      </button>

      {/* 설정 모달 (기본적으로 숨김) */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">업데이트 설정</h2>
            <button
              onClick={() => {/* TODO: 닫기 핸들러 */}}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          {/* 자동 업데이트 활성화 */}
          <div className="mb-6">
            <label className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={settings.autoUpdate}
                onChange={(e) => setSettings({ ...settings, autoUpdate: e.target.checked })}
                className="w-5 h-5 accent-blue-600"
              />
              <span className="text-sm font-medium">자동 업데이트 활성화</span>
            </label>
            <p className="text-xs text-gray-500">
              앱 시작 시 새 버전이 있으면 알림을 표시합니다
            </p>
          </div>

          {/* 체크 주기 */}
          <div className="mb-6">
            <label className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium">업데이트 체크 주기</span>
            </label>
            <div className="flex items-center gap-2 mt-2">
              <select
                value={settings.checkInterval.toString()}
                onChange={(e) => setSettings({ ...settings, checkInterval: parseInt(e.target.value) })}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="3600000">1시간</option>
                <option value="43200000">12시간</option>
                <option value="86400000">24시간</option>
                <option value="172800000">48시간</option>
              </select>
              <span className="text-xs text-gray-500 ml-2">
                자동으로 업데이트를 체크하는 시간 간격
              </span>
            </div>
          </div>

          {/* 업데이트 시 알림 */}
          <div className="mb-6">
            <label className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={settings.notifyOnStart}
                onChange={(e) => setSettings({ ...settings, notifyOnStart: e.target.checked })}
                className="w-5 h-5 accent-blue-600"
              />
              <span className="text-sm font-medium">앱 시작 시 업데이트 알림</span>
            </label>
            <p className="text-xs text-gray-500">
              자동 업데이트가 활성화된 경우에만 알림을 표시합니다
            </p>
          </div>

          {/* 현재 바이너리 버전 정보 */}
          <div className="bg-gray-50 rounded-md p-4 mb-6">
            <h3 className="text-sm font-semibold mb-2">현재 바이너리 버전</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <Wifi className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium">yt-dlp</p>
                  <p className="text-xs text-gray-500">
                    업데이트 확인 전용
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium">ffmpeg</p>
                  <p className="text-xs text-gray-500">
                    최신 버전 확인 중
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={() => window.api.checkBinaryUpdates()}
              className="flex items-center gap-2 text-blue-600 text-sm hover:text-blue-700 mt-2"
            >
              <RefreshCw className="w-4 h-4" />
              업데이트 체크
            </button>
          </div>

          {/* 저장 버튼 */}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isLoading}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:opacity-50 transition-colors"
            >
              {isLoading ? '저장 중...' : '저장'}
            </button>
            <button
              onClick={() => {/* TODO: 닫기 */}}
              className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300 transition-colors"
            >
              취소
            </button>
          </div>

          {/* 저장 메시지 */}
          {saveMessage && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md text-sm">
              {saveMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
