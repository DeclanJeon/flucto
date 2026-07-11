import fs from 'fs';
import path from 'path';
import type { VideoInfo } from '../../shared/types.js';
import type { BinaryResolver } from './binaryResolver.js';
import type { MediaOrchestrator } from './orchestrator.js';
import { extractTranscript } from '../transcript/captionExtractor.js';
import { formatTranscriptMarkdown, sanitizeMarkdownFilename } from '../transcript/markdownFormatter.js';
import type { TranscriptMetadata, TranscriptSegment } from '../transcript/transcriptTypes.js';
import { toTranscriptError } from '../transcript/transcriptError.js';

export interface MarkdownResult {
  success: boolean;
  filePath?: string;
  markdown?: string;
  wordCount?: number;
  message?: string;
}

export interface MarkdownConvertOptions {
  language?: string;
  stdout?: boolean;
  outputDir?: string;
}

const countWords = (text: string): number => {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
};

const formatDuration = (seconds: number): string => {
  if (!seconds) return 'N/A';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

const escapeYamlString = (value: string): string => {
  if (!value) return '""';
  if (/[:{}\[\],&*?|>!%@`]/.test(value) || value.includes('\n')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `"${value}"`;
};

const buildFrontmatter = (info: VideoInfo, url: string, platform: string): string => {
  const lines = [
    '---',
    `title: ${escapeYamlString(info.title ?? '')}`,
    `uploader: ${escapeYamlString(info.uploader ?? '')}`,
    `url: ${url}`,
    `duration: ${info.duration ?? 0}`,
    `downloaded: ${new Date().toISOString()}`,
    `platform: ${platform}`,
    '---',
  ];
  return lines.join('\n');
};

const buildMarkdown = (
  info: VideoInfo,
  url: string,
  platform: string,
  segments: TranscriptSegment[],
  language: string,
): string => {
  const parts: string[] = [];

  // YAML frontmatter
  parts.push(buildFrontmatter(info, url, platform));
  parts.push('');

  // Thumbnail
  if (info.thumbnail) {
    parts.push(`![thumbnail](${info.thumbnail})`);
    parts.push('');
  }

  // Transcript
  const metadata: TranscriptMetadata = {
    id: info.id,
    title: info.title,
    channel: info.uploader,
    duration: formatDuration(info.duration),
    url,
    platform,
    language,
  };

  const transcriptMarkdown = formatTranscriptMarkdown(segments, metadata, {
    includeTimestamps: true,
    includeMetadata: false,
    paragraphGapSeconds: 3,
  });

  parts.push(transcriptMarkdown);
  return parts.join('\n');
};

const saveMarkdown = (outputDir: string, title: string, markdown: string): string => {
  fs.mkdirSync(outputDir, { recursive: true });
  const parsed = path.parse(sanitizeMarkdownFilename(title));
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const filePath = path.join(outputDir, `${parsed.name}${suffix}${parsed.ext}`);
    try {
      fs.writeFileSync(filePath, markdown, { encoding: 'utf8', flag: 'wx' });
      return filePath;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
  throw new Error('Could not allocate a unique Markdown filename.');
};

export class MarkdownPipeline {
  constructor(
    private readonly orchestrator: MediaOrchestrator,
    private readonly binaries: BinaryResolver,
  ) {}

  async convert(url: string, options?: MarkdownConvertOptions): Promise<MarkdownResult> {
    try {
      // 1. Get video info via orchestrator
      const info = await this.orchestrator.getInfoWithDeps(url, { binaries: this.binaries });

      // 2. Try adapter.extractTranscript() if available
      let segments: TranscriptSegment[] | null = null;
      let language = options?.language ?? 'en';

      const adapter = this.orchestrator.getAdapter(url);
      if (adapter?.extractTranscript) {
        try {
          const result = await adapter.extractTranscript(url);
          if (result && result.segments.length > 0) {
            // Convert adapter segments ({ start, end, text }) to transcript format ({ start, duration, text })
            segments = result.segments.map((seg) => ({
              text: seg.text,
              start: seg.start,
              duration: Math.max(0, seg.end - seg.start),
            }));
            language = result.language ?? language;
          }
        } catch {
          // Adapter extraction failed — fall through to yt-dlp
        }
      }

      // 3. Fall back to yt-dlp caption extraction
      if (!segments) {
        const extraction = await extractTranscript(url, options?.language, this.binaries);
        segments = extraction.segments;
        language = extraction.metadata.language;
      }

      // 4. Format to markdown
      const platform = adapter?.id ?? 'generic';
      const markdown = buildMarkdown(info, url, platform, segments, language);

      // 5. Save to .md file
      let filePath: string | undefined;
      if (!options?.stdout) {
        const outDir = options?.outputDir ?? process.cwd();
        filePath = saveMarkdown(outDir, info.title, markdown);
      }

      // 6. Return result
      return {
        success: true,
        filePath,
        markdown,
        wordCount: countWords(markdown),
      };
    } catch (error: unknown) {
      const transcriptError = toTranscriptError(error);
      return {
        success: false,
        wordCount: 0,
        message: transcriptError.message,
      };
    }
  }
}
