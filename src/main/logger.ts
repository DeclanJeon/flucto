import path from 'path';
import fs from 'fs';
import { config } from './config.js';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';
type LogMeta = Record<string, unknown> | undefined;

const logDir = config.paths.logs;
const errorLogPath = path.join(logDir, 'error.log');
const combinedLogPath = path.join(logDir, 'combined.log');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const toLogLine = (level: LogLevel, message: string, meta?: LogMeta): string => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ?? {}),
  };

  try {
    return `${JSON.stringify(entry)}\n`;
  } catch {
    return JSON.stringify({
      timestamp: entry.timestamp,
      level,
      message,
      meta: String(meta),
    }) + '\n';
  }
};

const writeLog = (level: LogLevel, message: string, meta?: LogMeta): void => {
  const line = toLogLine(level, message, meta);
  fs.appendFileSync(combinedLogPath, line);

  if (level === 'error') {
    fs.appendFileSync(errorLogPath, line);
  }

  if (config.isDev) {
    const output = meta ? [message, meta] : [message];
    if (level === 'error') {
      console.error(...output);
    } else if (level === 'warn') {
      console.warn(...output);
    } else if (level === 'debug') {
      console.debug(...output);
    } else {
      console.info(...output);
    }
  }
};

export const logger = {
  error: (message: string, meta?: LogMeta): void => writeLog('error', message, meta),
  warn: (message: string, meta?: LogMeta): void => writeLog('warn', message, meta),
  info: (message: string, meta?: LogMeta): void => writeLog('info', message, meta),
  debug: (message: string, meta?: LogMeta): void => writeLog('debug', message, meta),
};