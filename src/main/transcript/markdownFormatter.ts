import type { MarkdownFormatOptions, TranscriptMetadata, TranscriptSegment } from './transcriptTypes.js';

const htmlEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const formatTranscriptTime = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(secs)}`;
  }
  return `${pad2(minutes)}:${pad2(secs)}`;
};

export const cleanTranscriptText = (text: string): string => {
  const withoutTags = text.replace(/<[^>]+>/g, '');
  const decoded = withoutTags.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return htmlEntities[entity] ?? match;
  });
  return decoded
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const groupSegmentsByGap = (segments: TranscriptSegment[], paragraphGapSeconds: number): TranscriptSegment[][] => {
  if (segments.length === 0) {
    return [];
  }

  const paragraphs: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [segments[0]];

  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const segment = segments[index];
    const gap = segment.start - (previous.start + previous.duration);
    if (gap >= paragraphGapSeconds) {
      paragraphs.push(current);
      current = [segment];
    } else {
      current.push(segment);
    }
  }

  paragraphs.push(current);
  return paragraphs;
};

const formatMetadata = (metadata: TranscriptMetadata): string => {
  const lines = [
    `# ${metadata.title}`,
    '',
    `> **채널:** ${metadata.channel}  `,
  ];

  if (metadata.duration && metadata.duration !== 'N/A') {
    lines.push(`> **길이:** ${metadata.duration}  `);
  }

  const extractedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  lines.push(
    `> **URL:** [${metadata.url}](${metadata.url})  `,
    `> **추출일:** ${extractedAt}  `,
    '',
    '---',
    '',
  );

  return lines.join('\n');
};

const formatWithTimestamps = (segments: TranscriptSegment[], paragraphGapSeconds: number): string => {
  const lines: string[] = [];
  for (const paragraph of groupSegmentsByGap(segments, paragraphGapSeconds)) {
    const start = paragraph[0]?.start ?? 0;
    const text = cleanTranscriptText(paragraph.map((segment) => segment.text).join(' '));
    if (!text) {
      continue;
    }
    lines.push(`## [${formatTranscriptTime(start)}]`, '', text, '');
  }
  return lines.join('\n');
};

const formatWithoutTimestamps = (segments: TranscriptSegment[], paragraphGapSeconds: number): string => {
  const lines: string[] = [];
  for (const paragraph of groupSegmentsByGap(segments, paragraphGapSeconds)) {
    const text = cleanTranscriptText(paragraph.map((segment) => segment.text).join(' '));
    if (!text) {
      continue;
    }
    lines.push(text, '');
  }
  return lines.join('\n');
};

export const formatTranscriptMarkdown = (
  segments: TranscriptSegment[],
  metadata: TranscriptMetadata,
  options: MarkdownFormatOptions,
): string => {
  const parts: string[] = [];
  if (options.includeMetadata) {
    parts.push(formatMetadata(metadata));
  }

  parts.push(
    options.includeTimestamps
      ? formatWithTimestamps(segments, options.paragraphGapSeconds)
      : formatWithoutTimestamps(segments, options.paragraphGapSeconds),
  );

  return parts.filter((part) => part.length > 0).join('\n');
};

export const sanitizeMarkdownFilename = (title: string, date = new Date()): string => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const dateStamp = `${year}${month}${day}`;
  const base = title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .slice(0, 50);
  const fallback = base.length > 0 ? base : 'transcript';
  const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  return `${reservedNames.test(fallback) ? `${fallback}_file` : fallback}_${dateStamp}.md`;
};
