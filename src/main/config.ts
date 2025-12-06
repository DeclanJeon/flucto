import { app } from 'electron';
import path from 'path';
import dotenv from 'dotenv';

// 개발 환경에서만 .env 로드
if (process.env.NODE_ENV === 'development') {
  dotenv.config({ path: path.join(process.cwd(), '.env') });
}

export const config = {
  isDev: process.env.NODE_ENV === 'development',
  paths: {
    // 사용자 데이터 폴더 내 logs 디렉토리
    logs: path.join(app.getPath('userData'), 'logs'),
    // 기본 다운로드 폴더 (환경변수로 오버라이드 가능)
    downloads: process.env.DEFAULT_DOWNLOAD_DIR || app.getPath('downloads'),
  },
  ytdlp: {
    // 4K 이상 다운로드 허용 여부 등 향후 확장 가능
    allow4k: process.env.ALLOW_4K === 'true',
  }
};