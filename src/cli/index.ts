#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs, CliUsageError, type CliOptions } from './args.js';
import {
  banner,
  helpText,
  info,
  kv,
  ok,
  renderDownloadProgress,
  renderJobProgress,
  renderSummaryBox,
  renderTranscriptProgress,
  step,
  writeError,
  writeHuman,
  writeJson,
  writeStatus,
} from './output.js';
import { c } from './theme.js';
import { createMultiJobOutputDir, slugifyJobLabel } from './jobOutput.js';
import { checkBinaryHealth, resolveCliBinaries } from '../main/services/binaryResolver.js';
import { parseBatchFileContent, runWithConcurrency } from '../main/services/batch.js';
import { runMediaDownload } from '../main/services/mediaDownload.js';
import { getAvailableFormats, getMediaInfo, listChannelVideos, normalizeChannelTarget } from '../main/services/mediaInfo.js';
import { convertTranscriptToMarkdown, listTranscriptLanguages } from '../main/services/transcriptMarkdown.js';
import { MarkdownPipeline } from '../main/services/markdownPipeline.js';
import { MediaOrchestrator } from '../main/services/orchestrator.js';
import { createPlatformRegistry } from '../main/platforms/createRegistry.js';
import { sanitizeMarkdownFilename } from '../main/transcript/markdownFormatter.js';
import { getManagedBinDir, setupUtilities } from '../main/services/binaryInstaller.js';
import { applyCliUpdate, checkForCliUpdate, downloadCliUpdate } from '../main/services/cliUpdater.js';
import { execa } from '../main/spawn.js';
import type { TranscriptMarkdownResponse, TranscriptRequest } from '../shared/types.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Base output directory (parent). Multi-file jobs create a dedicated subfolder under this. */
const outputBaseDir = (options: CliOptions): string => path.resolve(options.outputDir ?? process.cwd());

/** @deprecated single-file jobs still write directly into base */
const outputDir = (options: CliOptions): string => outputBaseDir(options);

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
    banner('doctor  ·  binary health', readPackageVersion());
    ok(`yt-dlp   ${c.white(result.versions.ytDlp ?? binaries.ytDlpPath)}`);
    ok(`ffmpeg   ${c.white((result.versions.ffmpeg ?? binaries.ffmpegPath).split(' ')[0] ?? '')}`);
    writeStatus('');
  } else {
    banner('doctor  ·  binary health', readPackageVersion());
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

const runMd = async (options: CliOptions): Promise<number> => {
  const binaries = resolveBinaries(options);
  const registry = createPlatformRegistry();
  const orchestrator = new MediaOrchestrator(registry);
  const pipeline = new MarkdownPipeline(orchestrator, binaries);

  const result = await pipeline.convert(options.positional[0], {
    language: options.language ?? undefined,
    stdout: options.stdout,
    outputDir: outputDir(options),
  });

  if (options.stdout && result.markdown) {
    process.stdout.write(result.markdown);
    if (!result.markdown.endsWith('\n')) process.stdout.write('\n');
  } else if (options.json) {
    writeJson(result);
  } else if (result.success) {
    writeHuman(result.filePath ?? result.message ?? 'Markdown conversion complete.');
  } else {
    writeError(result.message ?? 'Markdown conversion failed.');
  }

  await registry.dispose();
  return result.success ? 0 : 5;
};

const runBatch = async (options: CliOptions): Promise<number> => {
  const filePath = path.resolve(options.positional[0]);
  const urls = parseBatchFileContent(fs.readFileSync(filePath, 'utf8'));
  const formatKind = options.format === 'md' ? 'batch-md' : options.format === 'mp3' ? 'batch-mp3' : 'batch-mp4';
  const batchLabel = path.parse(filePath).name || 'batch';
  const jobDir = createMultiJobOutputDir(outputBaseDir(options), formatKind, batchLabel);
  const startedAt = Date.now();

  if (!options.json) {
    banner(`batch · ${options.format.toUpperCase()} · ${urls.length} items`, readPackageVersion());
    step(`source  ${filePath}`);
    ok(`job folder  ${jobDir}`);
    step(`running with concurrency ${options.concurrency}`);
  }

  let completed = 0;
  const results = await runWithConcurrency(urls, options.concurrency, async (url, index) => {
    const result = options.format === 'md'
      ? await convertTranscriptToMarkdown(transcriptRequest(url, options), {
        binaries: resolveBinaries(options),
        outputDir: jobDir,
        onProgress: options.progressJson
          ? (progress) => renderTranscriptProgress(progress, true)
          : undefined,
      })
      : await runMediaDownload(
        {
          url,
          format: options.format === 'mp3' ? 'mp3' : 'mp4',
          outputDir: jobDir,
          quality: {
            video: options.quality,
            audio: options.audioQuality,
          },
        },
        {
          binaries: resolveBinaries(options),
          onProgress: options.progressJson
            ? (progress) => renderDownloadProgress(progress, true)
            : undefined,
        },
      );

    completed += 1;
    if (!options.json && !options.progressJson) {
      const title = ('title' in result && result.title) ? String(result.title) : url;
      renderJobProgress({
        done: completed,
        total: urls.length,
        title,
        filePath: result.success ? result.filePath : undefined,
        error: result.success ? undefined : result.message,
      });
    }
    return result;
  });
  const failed = results.filter((result) => !result.success);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (options.json) {
    writeJson({
      success: failed.length === 0,
      total: results.length,
      failed: failed.length,
      outputDir: jobDir,
      results,
    });
  } else {
    renderSummaryBox([
      c.bold(failed.length === 0 ? c.green('Batch complete') : c.yellow('Batch finished with errors')),
      `${c.dim('processed')}  ${results.length - failed.length}/${results.length} ok`,
      `${c.dim('folder')}     ${jobDir}`,
      `${c.dim('time')}       ${elapsed}s`,
    ]);
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

const runChannelToMd = async (options: CliOptions): Promise<number> => {
  const version = readPackageVersion();
  const binaries = resolveBinaries(options);
  const targetInput = options.positional[0];
  const channelUrl = normalizeChannelTarget(targetInput);
  const startedAt = Date.now();

  if (!options.json) {
    banner('channel to-md  ·  captions → Markdown', version);
    step(`resolving  ${c.white(targetInput)}`);
  }

  let listed;
  try {
    listed = await listChannelVideos(channelUrl, binaries, { limit: options.limit });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      writeJson({ success: false, command: 'channel-to-md', message, channelUrl });
    } else {
      writeError(message);
    }
    return 5;
  }

  const videos = listed.videos;
  // Dedicated job folder under --out / cwd (never dump loose files into base)
  const outDir = createMultiJobOutputDir(
    outputBaseDir(options),
    'channel-md',
    listed.channelTitle || slugifyJobLabel(targetInput),
  );

  if (!options.json) {
    ok(`channel   ${c.bold(listed.channelTitle)}`);
    ok(`folder    ${c.cyan(outDir)}`);
    ok(`videos    ${c.bold(String(videos.length))}  ${c.dim(`(limit ${options.limit})`)}`);
    step('extracting captions → markdown');
    writeStatus('');
  }

  if (videos.length === 0) {
    if (options.json) {
      writeJson({
        success: true,
        command: 'channel-to-md',
        channelTitle: listed.channelTitle,
        channelUrl: listed.channelUrl,
        total: 0,
        succeeded: 0,
        failed: 0,
        outputDir: outDir,
        results: [],
      });
    } else {
      info('No videos found on this channel.');
      kv('folder', outDir);
    }
    return 0;
  }

  type ItemResult = {
    index: number;
    id: string;
    title: string;
    url: string;
    success: boolean;
    filePath?: string;
    message: string;
  };

  const results: ItemResult[] = new Array(videos.length);
  let completed = 0;

  await runWithConcurrency(videos.map((video, index) => ({ video, index })), options.concurrency, async ({ video, index }) => {
    const url = video.originalUrl || `https://www.youtube.com/watch?v=${video.id}`;
    const response: TranscriptMarkdownResponse = await convertTranscriptToMarkdown(
      {
        ...transcriptRequest(url, options),
        title: video.title,
      },
      {
        binaries,
        outputDir: outDir,
        onProgress: options.json || options.stdout
          ? undefined
          : (progress) => {
            if (options.progressJson) renderTranscriptProgress(progress, true);
          },
      },
    );

    let filePath = response.filePath;
    // Rename to ordered 001_title.md when possible
    if (response.success && filePath && fs.existsSync(filePath)) {
      const pad = String(index + 1).padStart(3, '0');
      const safe = path.parse(sanitizeMarkdownFilename(response.title || video.title)).name;
      const dest = path.join(outDir, `${pad}_${safe}.md`);
      if (path.resolve(filePath) !== path.resolve(dest)) {
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          fs.renameSync(filePath, dest);
          filePath = dest;
        } catch {
          // keep original path if rename fails
        }
      }
    }

    const item: ItemResult = {
      index: index + 1,
      id: video.id,
      title: response.title || video.title,
      url,
      success: response.success,
      filePath,
      message: response.message,
    };
    results[index] = item;
    completed += 1;

    if (!options.json && !options.progressJson) {
      renderJobProgress({
        done: completed,
        total: videos.length,
        title: item.title || video.title,
        filePath: item.success ? item.filePath : undefined,
        error: item.success ? undefined : item.message,
      });
    }

    return item;
  });

  const ordered = results.filter(Boolean);
  const failed = ordered.filter((item) => !item.success);
  const succeeded = ordered.length - failed.length;
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const avg = ordered.length > 0 ? ((Date.now() - startedAt) / 1000 / ordered.length).toFixed(1) : '0';

  const payload = {
    success: failed.length === 0,
    command: 'channel-to-md',
    channelTitle: listed.channelTitle,
    channelUrl: listed.channelUrl,
    outputDir: outDir,
    limit: options.limit,
    total: ordered.length,
    succeeded,
    failed: failed.length,
    elapsedSeconds: Number(elapsedSec),
    averageSecondsPerVideo: Number(avg),
    results: ordered,
  };

  if (options.json) {
    writeJson(payload);
  } else {
    renderSummaryBox([
      c.bold(failed.length === 0 ? c.green('Complete') : c.yellow('Finished with some failures')),
      `${c.dim('channel')}   ${listed.channelTitle}`,
      `${c.dim('markdown')}  ${succeeded}/${ordered.length} files` + (failed.length ? c.red(`  ·  ${failed.length} failed`) : ''),
      `${c.dim('folder')}    ${outDir}`,
      `${c.dim('time')}      ${elapsedSec}s  ·  avg ${avg}s / video`,
      `${c.dim('agent')}     채널 1 → 영상 ${ordered.length} → MD ${succeeded}`,
    ]);
  }

  return failed.length === 0 ? 0 : 7;
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
    case 'md':
      return runMd(options);
    case 'channel-to-md':
      return runChannelToMd(options);
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
