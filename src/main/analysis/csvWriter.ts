/**
 * Deterministic CSV emission per RFC 4180 with UTF-8 BOM (Excel CJK safety)
 * and CRLF line endings. These writers are the ONLY artifact surface for the
 * craft analysis feature — no media, frames, or scene data is ever written.
 */

import fs from 'fs';
import path from 'path';

/** Escape one CSV cell per RFC 4180 (quote text containing comma/quote/CRLF). */
export const toCsvValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'number' ? String(value) : value;
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

export const toCsvLine = (values: ReadonlyArray<string | number | null | undefined>): string => {
  return values.map(toCsvValue).join(',');
};

export const toCsvDocument = (columns: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string => {
  const lines = [toCsvLine(columns)];
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(`CSV row width ${row.length} does not match column count ${columns.length}.`);
    }
    lines.push(toCsvLine(row));
  }
  return `${lines.join('\r\n')}\r\n`;
};

/**
 * Write a CSV document with UTF-8 BOM so Excel keeps Korean text intact.
 * BOM precedes the first line; CRLF separators; trailing CRLF terminates.
 */
export const writeCsvFile = (filePath: string, columns: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): void => {
  const document = toCsvDocument(columns, rows);
  const bom = '\uFEFF';
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(filePath, `${bom}${document}`, { encoding: 'utf8' });
};

/**
 * Parse one RFC 4180 CSV body (BOM optional) back into rows.
 * Used to reload taxonomy.csv for the analysis join; tolerant of CRLF/LF.
 */
export const parseCsvDocument = (content: string): string[][] => {
  const cleaned = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (cleaned[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.length > 1 || entry[0] !== '');
};

export const parseCsvWithColumns = (content: string): Record<string, string>[] => {
  const rows = parseCsvDocument(content);
  if (rows.length === 0) return [];
  const [header, ...data] = rows;
  return data.map((entry) => {
    const record: Record<string, string> = {};
    header.forEach((column, index) => {
      record[column] = entry[index] ?? '';
    });
    return record;
  });
};
