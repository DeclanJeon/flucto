import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';

// 로그 디렉토리가 없으면 생성
if (!fs.existsSync(config.paths.logs)) {
  fs.mkdirSync(config.paths.logs, { recursive: true });
}

// 로그 포맷 설정
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// 개발 환경에서는 콘솔에도 출력
const transports: winston.transport[] = [
  new winston.transports.File({
    filename: path.join(config.paths.logs, 'error.log'),
    level: 'error',
    format: logFormat,
  }),
  new winston.transports.File({
    filename: path.join(config.paths.logs, 'combined.log'),
    format: logFormat,
  }),
];

if (config.isDev) {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

export const logger = winston.createLogger({
  level: config.isDev ? 'debug' : 'info',
  format: logFormat,
  transports,
  exitOnError: false,
});