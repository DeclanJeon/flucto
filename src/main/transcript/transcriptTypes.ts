export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface TranscriptMetadata {
  id: string;
  title: string;
  channel: string;
  duration: string;
  url: string;
  platform: string;
  language: string;
}

export interface CaptionLanguage {
  code: string;
  name: string;
  isAuto: boolean;
}

export interface TranscriptExtractionResult {
  segments: TranscriptSegment[];
  metadata: TranscriptMetadata;
  availableLanguages: CaptionLanguage[];
}

export interface MarkdownFormatOptions {
  includeTimestamps: boolean;
  includeMetadata: boolean;
  paragraphGapSeconds: number;
}
