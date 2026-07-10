/**
 * Lightweight ANSI theme for Flucto CLI human output.
 * Disabled when NO_COLOR is set or stderr is not a TTY.
 */

const envNoColor = Boolean(process.env.NO_COLOR) || process.env.FORCE_COLOR === '0';
const isTty = typeof process.stderr.isTTY === 'boolean' ? process.stderr.isTTY : false;
export const colorEnabled = !envNoColor && (isTty || process.env.FORCE_COLOR === '1');

const wrap = (open: string, close: string) => (text: string): string => {
  if (!colorEnabled) return text;
  return `${open}${text}${close}`;
};

export const c = {
  reset: wrap('\x1b[0m', ''),
  bold: wrap('\x1b[1m', '\x1b[22m'),
  dim: wrap('\x1b[2m', '\x1b[22m'),
  italic: wrap('\x1b[3m', '\x1b[23m'),
  // brand-ish cyan / violet accents
  cyan: wrap('\x1b[38;5;51m', '\x1b[39m'),
  blue: wrap('\x1b[38;5;75m', '\x1b[39m'),
  violet: wrap('\x1b[38;5;141m', '\x1b[39m'),
  green: wrap('\x1b[38;5;84m', '\x1b[39m'),
  yellow: wrap('\x1b[38;5;221m', '\x1b[39m'),
  red: wrap('\x1b[38;5;203m', '\x1b[39m'),
  white: wrap('\x1b[38;5;255m', '\x1b[39m'),
  gray: wrap('\x1b[38;5;245m', '\x1b[39m'),
  magenta: wrap('\x1b[38;5;177m', '\x1b[39m'),
};

export const symbols = {
  brand: '🌊',
  bullet: '•',
  arrow: '→',
  check: '✓',
  cross: '✗',
  spark: '◈',
  folder: '📁',
  film: '🎬',
  note: '📝',
  clock: '⏱',
  warn: '⚠',
};
