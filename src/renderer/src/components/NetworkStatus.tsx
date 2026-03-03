import { useState, useEffect } from 'react';
import { WifiIcon, WifiOffIcon } from 'lucide-react';
import type { NetworkStatusEvent } from '../../../shared/types';

/**
 * 네트워크 상태 표시 컴포넌트
 * 온라인/오프라인 상태를 시각적으로 표시합니다
 */
export function NetworkStatus() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatusEvent>({
    online: true, // 기본값: 온라인으로 가정
    message: '',
  });

  const isNetworkStatusEvent = (value: unknown): value is NetworkStatusEvent => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<NetworkStatusEvent>;
    return (
      candidate !== null &&
      candidate !== undefined &&
      typeof candidate.online === 'boolean' &&
      typeof candidate.message === 'string'
    );
  };

  useEffect(() => {
    const handleNetworkChange = (event: NetworkStatusEvent | { detail: NetworkStatusEvent }) => {
      const payload = isNetworkStatusEvent(event)
        ? event
        : (event as { detail?: NetworkStatusEvent }).detail;

      if (!isNetworkStatusEvent(payload)) {
        return;
      }

      setNetworkStatus({
        online: payload.online,
        message: payload.message,
      });
    };

    window.api.onNetworkStatusChange(handleNetworkChange);

    return () => {
      window.api.offNetworkStatusChange?.(handleNetworkChange);
    };
  }, []);

  return (
    <div className="fixed bottom-4 left-4 z-50">
      {networkStatus.online ? (
        <div className="flex items-center gap-2 text-green-500">
          <WifiIcon className="w-4 h-4" />
          <span className="text-sm">온라인</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-red-500">
          <WifiOffIcon className="w-4 h-4" />
          <span className="text-sm">
            {networkStatus.message || '오프라인 (업데이트 불가)'}
          </span>
        </div>
      )}
    </div>
  );
}
