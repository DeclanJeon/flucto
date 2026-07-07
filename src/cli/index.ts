#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs, CliUsageError, type CliOptions } from './args.js';
import { helpText, renderDownloadProgress, renderTranscriptProgress, writeError, writeHuman, writeJson, writeStatus } from './output.js';
import { checkBinaryHealth, resolveCliBinaries } from '../main/services/binaryResolver.js';
import { parseBatchFileContent, runWithConcurrency } from '../main/services/batch.js';
import { runMediaDownload } from '../main/services/mediaDownload.js';
import { getAvailableFormats, getMediaInfo } from '../main/services/mediaInfo.js';
import { convertTranscriptToMarkdown, listTranscriptLanguages } from '../main/services/transcriptMarkdown.js';
import { getManagedBinDir, setupUtilities } from '../main/services/binaryInstaller.js';
import { applyCliUpdate, checkForCliUpdate, downloadCliUpdate } from '../main/services/cliUpdater.js';
import { execa } from '../main/spawn.js';
import type { TranscriptRequest } from '../shared/types.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const outputDir = (options: CliOptions): string => path.resolve(options.outputDir ?? process.cwd());

const readPackageVersion = (): string => {
  const candidates = [
    path.resolve(moduleDir, '../../package.json'),
    path.resolve(moduleDir, '../../../package.json'),
    path.resolve(process.cwd(), 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(candidate, 'utf8')) as unknown;
      if (raw && typeof raw === 'object' && 'version' in raw && typeof raw.version === 'string') {
        return raw.version;
      }
    } catch {
      // Continue checking candidates.
    }
  }
  return '0.0.0';
};

const setupBinDir = (options: CliOptions): string => path.resolve(options.binDir ?? getManagedBinDir());

const resolveBinaries = (options: CliOptions) => resolveCliBinaries({
  binDir: setupBinDir(options),
  ytDlpPath: options.ytDlpPath,
  ffmpegPath: options.ffmpegPath,
});

const binaryVersion = async (file: string, args: string[]): Promise<string | null> => {
  const result = await execa(file, args, { reject: false });
  if (result.failed) return null;
  return (result.stdout || result.stderr).split(/\r?\n/).find((line) => line.trim())?.trim() ?? null;
};

const runDoctor = async (options: CliOptions): Promise<number> => {
  const binaries = resolveBinaries(options);
  const health = checkBinaryHealth(binaries);
  const result = {
    valid: health.valid,
    missing: health.missing,
    paths: health.paths,
    fix: health.valid ? undefined : 'Run `flucto setup` or pass --yt-dlp/--ffmpeg paths.',
    versions: {
      ytDlp: health.missing.includes('yt-dlp') ? null : await binaryVersion(binaries.ytDlpPath, ['--version']),
      ffmpeg: health.missing.includes('ffmpeg') ? null : await binaryVersion(binaries.ffmpegPath, ['-version']),
    },
  };

  if (options.json) {
    writeJson(result);
  } else if (result.valid) {
    writeHuman(`yt-dlp: ${result.versions.ytDlp ?? binaries.ytDlpPath}`);
    writeHuman(`ffmpeg: ${result.versions.ffmpeg?.split(' ')[0] ?? binaries.ffmpegPath}`);
  } else {
    writeError(`Missing binaries: ${result.missing.join(', ')}. ${result.fix}`);
  }

  return result.valid ? 0 : 3;
};

const runSetup = async (options: CliOptions): Promise<number> => {
  const result = await setupUtilities({
    binDir: setupBinDir(options),
    ytDlpPath: options.ytDlpPath,
    ffmpegPath: options.ffmpegPath,
    force: options.force,
    checkOnly: options.checkOnly,
    onStatus: options.json ? undefined : writeStatus,
  });

  if (options.json) {
    writeJson(result);
  } else if (result.valid) {
    writeHuman(`Binary directory: ${result.binDir}`);
    for (const utility of result.utilities) {
      writeHuman(`${utility.name}: ${utility.status}${utility.version ? ` (${utility.version})` : ''}`);
    }
  } else {
    writeError(`Missing binaries: ${result.missing.join(', ') || 'unknown'}. ${result.fix ?? 'Run `flucto setup`.'}`);
  }

  return result.valid ? 0 : 3;
};

const runUpdate = async (options: CliOptions): Promise<number> => {
  const currentVersion = readPackageVersion();
  try {
    if (options.updateAction === 'download') {
      const result = await downloadCliUpdate({ currentVersion, outputDir: options.outputDir });
      if (options.json) writeJson(result);
      else writeHuman(result.downloaded ? `${result.path}\n${result.next}` : result.next);
      return result.downloaded ? 0 : 4;
    }
    if (options.updateAction === 'apply') {
      const result = await applyCliUpdate({ currentVersion, assetPath: options.assetPath });
      if (options.json) writeJson(result);
      else if (result.applied) writeHuman(result.next);
      else writeError(`${result.reason ?? 'Update was not applied.'} ${result.next}`);
      return result.applied ? 0 : 4;
    }

    const result = await checkForCliUpdate({ currentVersion });
    if (options.json) {
      writeJson(result);
    } else if (result.updateAvailable) {
      writeHuman(`Flucto ${result.latestVersion} is available: ${result.releaseUrl}`);
      if (result.recommendedAsset) writeHuman(`Recommended asset: ${result.recommendedAsset}`);
    } else {
      writeHuman(`Flucto is up to date (${result.currentVersion}).`);
    }
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      writeJson({ success: false, command: 'update', action: options.updateAction, message, currentVersion });
    } else {
      writeError(message);
    }
    return 4;
  }
};

const runDownload = async (options: CliOptions): Promise<number> => {
  const binaries = resolveBinaries(options);
  const response = await runMediaDownload(
    {
      url: options.positional[0],
      format: options.format === 'mp3' ? 'mp3' : 'mp4',
      outputDir: outputDir(options),
      quality: {
        video: options.quality,
        audio: options.audioQuality,
      },
    },
    {
      binaries,
      onProgress: (progress) => renderDownloadProgress(progress, options.progressJson),
    },
  );

  if (options.json) {
    writeJson(response);
  } else if (response.success) {
    writeHuman(response.filePath ?? response.message);
  } else {
    writeError(response.message);
  }

  return response.success ? 0 : 4;
};

const transcriptRequest = (url: string, options: CliOptions): TranscriptRequest => ({
  url,
  settings: {
    language: options.language,
    includeTimestamps: options.timestamps ?? true,
    includeMetadata: options.metadata ?? true,
    paragraphGapSeconds: 3,
    saveMarkdownFile: !options.stdout,
    copyMarkdownToClipboard: false,
  },
});

const runTranscript = async (options: CliOptions): Promise<number> => {
  const binaries = resolveBinaries(options);
  const response = await convertTranscriptToMarkdown(
    transcriptRequest(options.positional[0], options),
    {
      binaries,
      outputDir: outputDir(options),
      onProgress: options.stdout ? undefined : (progress) => renderTranscriptProgress(progress, options.progressJson),
    },
  );

  if (options.stdout && response.markdown) {
    process.stdout.write(response.markdown);
    if (!response.markdown.endsWith('\n')) process.stdout.write('\n');
  } else if (options.json) {
    writeJson(response);
  } else if (response.success) {
    writeHuman(response.filePath ?? response.message);
  } else {
    writeError(response.message);
  }

  return response.success ? 0 : 5;
};

const runBatch = async (options: CliOptions): Promise<number> => {
  const filePath = path.resolve(options.positional[0]);
  const urls = parseBatchFileContent(fs.readFileSync(filePath, 'utf8'));
  const results = await runWithConcurrency(urls, options.concurrency, async (url) => {
    if (options.format === 'md') {
      return convertTranscriptToMarkdown(transcriptRequest(url, options), {
        binaries: resolveBinaries(options),
        outputDir: outputDir(options),
        onProgress: (progress) => renderTranscriptProgress(progress, options.progressJson),
      });
    }
    return runMediaDownload(
      {
        url,
        format: options.format === 'mp3' ? 'mp3' : 'mp4',
        outputDir: outputDir(options),
        quality: {
          video: options.quality,
          audio: options.audioQuality,
        },
      },
      {
        binaries: resolveBinaries(options),
        onProgress: (progress) => renderDownloadProgress(progress, options.progressJson),
      },
    );
  });
  const failed = results.filter((result) => !result.success);

  if (options.json) {
    writeJson({ success: failed.length === 0, total: results.length, failed: failed.length, results });
  } else {
    writeHuman(`Processed ${results.length} item(s), failed ${failed.length}.`);
  }

  return failed.length === 0 ? 0 : 7;
};

const runInfo = async (options: CliOptions): Promise<number> => {
  const result = await getMediaInfo(options.positional[0], resolveBinaries(options));
  if (options.json) {
    writeJson(result);
  } else {
    writeHuman(`${result.title}\n${result.uploader}`);
  }
  return 0;
};

const runFormats = async (options: CliOptions): Promise<number> => {
  const result = await getAvailableFormats(options.positional[0], resolveBinaries(options));
  if (options.json) {
    writeJson(result);
  } else {
    writeHuman(result.map((format) => `${format.formatId}\t${format.ext ?? ''}\t${format.resolution ?? ''}\t${format.note ?? ''}`).join('\n'));
  }
  return 0;
};

const runLanguages = async (options: CliOptions): Promise<number> => {
  const result = await listTranscriptLanguages(options.positional[0], resolveBinaries(options));
  if (options.json) {
    writeJson(result);
  } else {
    writeHuman(result.map((language) => `${language.code}\t${language.name}${language.isAuto ? '\t(auto)' : ''}`).join('\n'));
  }
  return 0;
};

const dispatch = async (options: CliOptions): Promise<number> => {
  switch (options.command) {
    case 'help':
      writeHuman(helpText);
      return 0;
    case 'version':
      writeHuman(readPackageVersion());
      return 0;
    case 'doctor':
      return runDoctor(options);
    case 'setup':
      return runSetup(options);
    case 'update':
      return runUpdate(options);
    case 'download':
      return runDownload(options);
    case 'batch':
      return runBatch(options);
    case 'transcript':
      return runTranscript(options);
    case 'info':
      return runInfo(options);
    case 'formats':
      return runFormats(options);
    case 'languages':
      return runLanguages(options);
    default:
      writeError('Unhandled command.');
      return 1;
  }
};

try {
  const options = parseCliArgs(process.argv.slice(2));
  const exitCode = await dispatch(options);
  process.exitCode = exitCode;
} catch (error: unknown) {
  if (error instanceof CliUsageError) {
    writeError(error.message);
    writeStatus(helpText);
    process.exitCode = error.exitCode;
  } else {
    writeError(error instanceof Error ? error.message : String(error));
    process.exitCode = 4;
  }
}
