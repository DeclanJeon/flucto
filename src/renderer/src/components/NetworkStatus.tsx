import { useState, useEffect } from 'react';
import { WifiIcon, WifiOffIcon } from 'lucide-react';

interface NetworkStatusProps {
  online: boolean;
  message: string;
}

/**
 * 네트워크 상태 표시 컴포넌트
 * 온라인/오프라인 상태를 시각적으로 표시합니다
 */
export function NetworkStatus() {
  const [networkStatus, setNetworkStatus] = useState<{
    online: boolean;
    message: string;
  }>({
    online: true, // 기본값: 온라인으로 가정
    message: '',
  });

  useEffect(() => {
    const handleNetworkChange = (event: any) => {
      setNetworkStatus({
        online: event.detail.online,
        message: event.detail.message,
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
