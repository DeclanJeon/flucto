import { app, BrowserWindow, ipcMain, shell, dialog, Notification } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execa } from "./spawn.js";
import { getBinaryPath, checkSystemHealth } from "./utils.js";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { initializeAutoUpdater } from "./updater.js";
import type { DownloadRequest, DownloadQualityPreferences, DownloadSettings, FormatOption } from "../shared/types.js";
import { settingsStore, getStoredDownloadSettings } from './store.js';
import { appendHistoryEntry, clearHistory, getHistoryEntries } from './historyStore.js';
import './handlers.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type YtDlpMetadata = Record<string, unknown>;

const toStringValue = (value: unknown): string | null => {
  return typeof value === "string" ? value : null;
};

const toNumberValue = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const toMetadata = (value: unknown): YtDlpMetadata | null => {
  return typeof value === "object" && value !== null ? (value as YtDlpMetadata) : null;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getVideoFormatSelector = (preset: DownloadQualityPreferences['video']): string => {
  const constrainedSelector = (height: number): string => {
    return `bestvideo[ext=mp4][height<=${height}]+bestaudio[ext=m4a]/best[ext=mp4][height<=${height}][acodec!=none]/best[ext=mp4][acodec!=none]/worst[ext=mp4][acodec!=none]`;
  };

  switch (preset) {
    case '4k':
      return constrainedSelector(2160);
    case '1440p':
      return constrainedSelector(1440);
    case '1080p':
      return constrainedSelector(1080);
    case '720p':
      return constrainedSelector(720);
    case '480p':
      return constrainedSelector(480);
    case '360p':
      return constrainedSelector(360);
    case 'worst':
      return 'worst[ext=mp4]/worst';
    default:
      return constrainedSelector(1080);
  }
};

const getAudioQualityValue = (preset: DownloadQualityPreferences['audio']): string => {
  switch (preset) {
    case '320kbps':
      return '320K';
    case '256kbps':
      return '256K';
    case '192kbps':
      return '192K';
    case '128kbps':
      return '128K';
    case '64kbps':
      return '64K';
    case 'worst':
      return '64K';
    default:
      return '320K';
  }
};

const showDesktopNotification = (title: string, body: string): void => {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (error: unknown) {
    logger.warn('Notification failed', { error: getErrorMessage(error) });
  }
};

// 가비지 컬렉션 방지를 위한 전역 변수
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false, // 준비될 때까지 숨김 (깜빡임 방지)
    autoHideMenuBar: true,
    backgroundColor: "#111827", // 다크모드 배경색
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  // HMR for development or load production build
  // Use app.isPackaged for reliable environment detection
  if (!app.isPackaged && process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
    // mainWindow.webContents.openDevTools(); // 개발자 도구 필요시 주석 해제
  } else {
    // In production, load the built renderer from dist/
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

// --- App Lifecycle ---
app.whenReady().then(async () => {
  // 1. 시스템 무결성 검사
  const health = await checkSystemHealth();

  if (!health.valid) {
    logger.error("Missing required binaries:", { missing: health.missing });

    dialog.showMessageBoxSync({
      type: "error",
      title: "Flucto - System Error",
      message: "Required system components are missing.",
      detail: `The following binaries were not found:\n${health.missing.join(", ")}\n\nPlease restart the application setup.`,
      buttons: ["Exit"],
    });

    app.quit();
    return;
  }

  // 2. 윈도우 생성
  createWindow();

  await initializeAutoUpdater();

  logger.info("Electron application is ready and healthy.");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// --- IPC Handlers ---

// [수정] 공통 옵션 생성기 (플랫폼별 특화 옵션 추가)
const getCommonYtDlpArgs = (url: string) => {
  const args: string[] = [];

  // Twitter/X 플랫폼 처리
  if (url.includes("x.com") || url.includes("twitter.com")) {
    args.push(
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--add-header",
      "Accept-Language: en-US,en;q=0.9",
      "--add-header",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "--add-header",
      "Accept-Encoding: gzip, deflate, br",
      "--add-header",
      "DNT: 1",
      "--add-header",
      "Connection: keep-alive",
      "--add-header",
      "Upgrade-Insecure-Requests: 1",
      "--add-header",
      "Sec-Fetch-Dest: document",
      "--add-header",
      "Sec-Fetch-Mode: navigate",
      "--add-header",
      "Sec-Fetch-Site: none",
      "--add-header",
      "Sec-Fetch-User: ?1",
      "--add-header",
      "Cache-Control: max-age=0",
      "--extractor-args",
      "twitter:api=legacy", // Twitter 레거시 API 사용
      "--extractor-args",
      "twitter:video=true", // 비디오 추출 명시
    );
  }

  // Reddit 플랫폼 처리
  else if (url.includes("reddit.com")) {
    args.push(
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--add-header",
      "Accept-Language: en-US,en;q=0.9",
      "--add-header",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "--extractor-args",
      "reddit:client_id=download_client", // Reddit 클라이언트 ID 지정
      "--extractor-args",
      "reddit:client_secret=", // 클라이언트 시크릿 (빈 값)
      "--ignore-errors", // 인증 오류 무시
      "--extractor-args",
      "reddit:username=", // 사용자명 (빈 값으로 공개 콘텐츠만)
    );
  }

  // Bilibili 플랫폼 처리
  else if (url.includes("bilibili.com")) {
    args.push(
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--add-header",
      "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
      "--add-header",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "--add-header",
      "Referer: https://www.bilibili.com/",
      "--add-header",
      "Origin: https://www.bilibili.com",
      "--add-header",
      "Sec-Fetch-Dest: document",
      "--add-header",
      "Sec-Fetch-Mode: navigate",
      "--add-header",
      "Sec-Fetch-Site: same-origin",
      "--extractor-args",
      "bilibili:session_data=", // Bilibili 세션 데이터 (빈 값)
      "--extractor-args",
      "bilibili:quality=116", // 최고 품질 설정
    );
  }

  // Instagram, Facebook 등은 모바일 User-Agent를 사용하면 더 잘 작동하는 경우가 있음
  else if (url.includes("instagram.com") || url.includes("facebook.com")) {
    args.push(
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--add-header",
      "Accept-Language: en-US,en;q=0.9",
    );
  }

  else if (url.includes("youtube.com") || url.includes("youtu.be")) {
    args.push(
      "--force-ipv4",
      "--windows-filenames",
    );
  }

  return args;
};

// [추가] 최적의 썸네일 추출 헬퍼 함수
const extractBestThumbnail = (info: YtDlpMetadata): string | null => {
  // 1. 최우선: thumbnail 필드에 유효한 URL이 있는 경우
  if (
    info.thumbnail &&
    typeof info.thumbnail === "string" &&
    info.thumbnail.startsWith("http")
  ) {
    return info.thumbnail;
  }

  // 2. 차선: thumbnails 배열이 있는 경우 가장 마지막 항목(통상적으로 고화질) 선택
  if (
    info.thumbnails &&
    Array.isArray(info.thumbnails) &&
    info.thumbnails.length > 0
  ) {
    // url 필드가 있는 마지막 아이템을 찾음
    const validItems = info.thumbnails.filter(
      (thumbnail) =>
        typeof thumbnail === "object" &&
        thumbnail !== null &&
        "url" in thumbnail &&
        typeof (thumbnail as { url: unknown }).url === "string",
    ) as Array<{ url: unknown }>;
    if (validItems.length > 0) {
      const candidate = validItems[validItems.length - 1];
      const candidateUrl = candidate?.url;
      return typeof candidateUrl === "string" ? candidateUrl : null;
    }
  }

  return null;
};

// 1. Get Playlist Info Handler [최종 수정]
ipcMain.handle("get-playlist-info", async (_event, url: string) => {
  const ytDlpPath = getBinaryPath("yt-dlp");

  try {
    logger.info(`Fetching playlist info for: ${url}`);

    // 플랫폼별 기본 Referer 설정
    let referer = "";
    if (url.includes("x.com") || url.includes("twitter.com")) {
      referer = "https://x.com/";
    } else if (url.includes("reddit.com")) {
      referer = "https://www.reddit.com/";
    } else if (url.includes("bilibili.com")) {
      referer = "https://www.bilibili.com/";
    }

    // [보완 1] { reject: false } 추가: 일부 영상 다운 불가 에러로 인해 전체 프로세스가 멈추지 않도록 함
    const result = await execa(
      ytDlpPath,
      [
        url,
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--skip-download",
        "--ignore-errors",
        "--compat-options",
        "no-youtube-unavailable-videos", // [보완 2] 삭제된 동영상 정보 제외
        "--compat-options",
        "no-youtube-unavailable-videos", // [보완 2] 삭제된 동영상 정보 제외
        ...(referer ? ["--add-header", `referer:${referer}`] : []), // 플랫폼별 Referer 추가
        ...getCommonYtDlpArgs(url), // [추가] 플랫폼별 특화 옵션 적용
      ],
      { reject: false },
    ); // <-- 중요: 에러가 발생해도 멈추지 않고 결과 반환

    // stdout이 아예 비어있으면 진짜 에러
    if (result.failed && !result.stdout.trim()) {
      throw new Error(
        result.stderr || "Failed to fetch playlist info (No output)",
      );
    }

    const playlistItems = result.stdout
      .split(/\r?\n/) // [보완 3] 윈도우(\r\n)와 리눅스(\n) 줄바꿈 모두 대응하는 정규식 사용
      .filter((line) => line.trim() !== "")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          // 파싱 실패한 줄은 경고 로그만 남기고 무시
          logger.warn("Skipping invalid JSON line");
          return null;
        }
      })
      .filter((item): item is YtDlpMetadata => {
        // [보완 4] 유효한 비디오 아이템인지 검증 (플레이리스트 자체 메타데이터 제외)
        const metadata = toMetadata(item);

        return (
          metadata !== null &&
          typeof metadata.id === "string" &&
          metadata._type !== "playlist"
        );
      });

    if (playlistItems.length === 0) {
      logger.warn("Playlist is empty or all items were filtered out", { url });
    }

    return playlistItems.map((item) => ({
      id: toStringValue(item.id) ?? "Unknown",
      title: toStringValue(item.title) ?? "Untitled Video",
      // [수정] 썸네일 추출 로직 강화
      thumbnail: extractBestThumbnail(item),
      duration: toNumberValue(item.duration),
      uploader:
        toStringValue(item.uploader) ??
        toStringValue(item.channel) ??
        "Unknown",
      view_count: toNumberValue(item.view_count),
      originalUrl:
        toStringValue(item.url) ??
        `https://www.youtube.com/watch?v=${toStringValue(item.id) ?? ""}`,
    }));
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error("Get Playlist Info Error:", {
      url,
      error: errorMessage,
    });
    throw new Error(`Failed to fetch playlist info: ${errorMessage}`);
  }
});

// 2. Get Video Info Handler [수정됨: SNS 지원 및 에러 방지 강화]
ipcMain.handle("get-video-info", async (_event, url: string) => {
  const ytDlpPath = getBinaryPath("yt-dlp");

  try {
    logger.info(`Fetching video info for: ${url}`);

    // 플랫폼별 기본 Referer 설정
    let referer = "";
    if (url.includes("x.com") || url.includes("twitter.com")) {
      referer = "https://x.com/";
    } else if (url.includes("reddit.com")) {
      referer = "https://www.reddit.com/";
    } else if (url.includes("bilibili.com")) {
      referer = "https://www.bilibili.com/";
    }

    // 재시도 로직을 위한 함수
    const tryFetch = async (retryCount = 0): Promise<YtDlpMetadata> => {
      const args = [
        url,
        "--dump-json",
        "--no-warnings",
        "--no-playlist", // 단일 영상 정보만 요청
        "--ignore-errors", // 에러 무시 (삭제된 트윗 등)
        "--compat-options",
        "no-youtube-unavailable-videos",
        "--compat-options",
        "no-youtube-unavailable-videos",
        ...(referer ? ["--add-header", `referer:${referer}`] : []), // 플랫폼별 Referer 추가
        // [추가] 플랫폼별 특화 옵션 적용
        ...getCommonYtDlpArgs(url),
      ];

      // Twitter/X의 경우 재시도 시 다른 API 옵션 시도
      if (
        (url.includes("x.com") || url.includes("twitter.com")) &&
        retryCount > 0
      ) {
        args.push("--extractor-args", "twitter:api=graph");
      }

      // { reject: false }로 실행 (경고 무시)
      const result = await execa(ytDlpPath, args, { reject: false });

      // 결과값이 아예 없으면 에러
      if (result.failed && !result.stdout.trim()) {
        // Twitter/X의 경우 404/403 오류 시 재시도
        if (
          (url.includes("x.com") || url.includes("twitter.com")) &&
          retryCount < 2
        ) {
          logger.warn(`Retrying Twitter/X fetch (attempt ${retryCount + 1})`);
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (retryCount + 1)),
          ); // 지수 백오프
          return tryFetch(retryCount + 1);
        }
        throw new Error(result.stderr || "No output from yt-dlp");
      }

      // [핵심] JSON 파싱 로직 강화 (Warning 메시지가 섞여 있어도 동작하도록)
      // stdout을 줄바꿈으로 나누고, 유효한 JSON 객체 중 마지막 것을 사용 (보통 마지막 줄이 실제 데이터)
      const lines = result.stdout
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "");
      let info: YtDlpMetadata | null = null;

      // 뒤에서부터 탐색하여 가장 먼저 발견되는 유효한 JSON을 채택
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          // 유효한 메타데이터인지 확인 (id나 title이 있어야 함)
          if (typeof parsed === "object" && parsed !== null && ("id" in parsed || "title" in parsed)) {
            info = parsed;
            break;
          }
        } catch {
          continue; // JSON이 아니면(경고 메시지 등) 무시
        }
      }

      if (!info) {
        // Twitter/X의 경우 재시도
        if (
          (url.includes("x.com") || url.includes("twitter.com")) &&
          retryCount < 2
        ) {
          logger.warn(
            `Retrying Twitter/X fetch due to parse error (attempt ${retryCount + 1})`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (retryCount + 1)),
          ); // 지수 백오프
          return tryFetch(retryCount + 1);
        }
        throw new Error("Could not parse video metadata from yt-dlp output");
      }

      return info as YtDlpMetadata;
    };

    const info = await tryFetch();

    // SNS별 메타데이터 필드 정규화
    return {
      id: toStringValue(info.id) ?? "",
      title:
        toStringValue(info.title) ||
        toStringValue(info.description)?.slice(0, 50) ||
        "Untitled Media", // 트위터/인스타는 제목이 없을 수 있음
      // [수정] 썸네일 추출 로직 강화
      thumbnail: extractBestThumbnail(info),
      duration: toNumberValue(info.duration),
      uploader:
        toStringValue(info.uploader) ??
        toStringValue(info.uploader_id) ??
        "Unknown",
      view_count:
        toNumberValue(info.view_count) || toNumberValue(info.like_count), // 뷰 카운트 없으면 좋아요 수로 대체
    };
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error("Get Info Error:", { url, error: errorMessage });
    throw new Error(`Failed to fetch video info: ${errorMessage}`);
  }
});

ipcMain.handle("get-available-formats", async (_event, url: string): Promise<FormatOption[]> => {
  const ytDlpPath = getBinaryPath('yt-dlp');
  const result = await execa(ytDlpPath, [url, '-J', '--no-warnings', '--no-playlist'], { reject: false });

  if (result.failed && !result.stdout.trim()) {
    throw new Error(result.stderr || 'Failed to fetch available formats');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error: unknown) {
    throw new Error(`Failed to parse available formats JSON: ${getErrorMessage(error)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.formats)) {
    return [];
  }

  const formats: FormatOption[] = [];
  for (const raw of root.formats) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const format = raw as Record<string, unknown>;
    const formatId = typeof format.format_id === 'string' ? format.format_id : null;
    if (!formatId) {
      continue;
    }

    formats.push({
      formatId,
      ext: typeof format.ext === 'string' ? format.ext : undefined,
      resolution: typeof format.resolution === 'string' ? format.resolution : undefined,
      width: typeof format.width === 'number' ? format.width : undefined,
      height: typeof format.height === 'number' ? format.height : undefined,
      fps: typeof format.fps === 'number' ? format.fps : undefined,
      vcodec: typeof format.vcodec === 'string' ? format.vcodec : undefined,
      acodec: typeof format.acodec === 'string' ? format.acodec : undefined,
      abrKbps: typeof format.abr === 'number' ? format.abr : undefined,
      tbrKbps: typeof format.tbr === 'number' ? format.tbr : undefined,
      filesizeBytes: typeof format.filesize === 'number' ? format.filesize : undefined,
      filesizeApproxBytes: typeof format.filesize_approx === 'number' ? format.filesize_approx : undefined,
      note: typeof format.format_note === 'string'
        ? format.format_note
        : typeof format.format === 'string'
          ? format.format
          : undefined,
    });
  }

  return formats;
});

// 2. Download Multiple Videos Handler
ipcMain.handle(
  "download-multiple",
  async (
    event,
    {
      urls,
      format,
      quality,
      titles,
      formatOverrides,
      notifyPerItemInBatch,
    }: {
      urls: string[];
      format: "mp4" | "mp3";
      quality?: DownloadQualityPreferences;
      titles?: string[];
      formatOverrides?: { videoFormatId: string | null; audioFormatId: string | null };
      notifyPerItemInBatch?: boolean;
    },
  ) => {
    const ytDlpPath = getBinaryPath("yt-dlp");
    const ffmpegPath = getBinaryPath("ffmpeg");
    const settings = getStoredDownloadSettings();
    const selectedQuality = quality ?? settings.qualityPreferences;
    const resolvedOverrides = formatOverrides ?? settings.formatOverrides;
    const shouldNotifyPerItem = notifyPerItemInBatch ?? settings.notifyPerItemInBatch;
    const outputTemplate = path.join(
      settings.downloadsDirectory || config.paths.downloads,
      "%(title)s.%(ext)s",
    );

    showDesktopNotification('Batch Download Started', `${urls.length} media item(s) started.`);

    const downloadPromises = urls.map(async (url, index) => {
      const requestId = `batch-${Date.now()}-${index}`;
      const mediaTitle = titles?.[index] ?? url;
      try {
        event.sender.send("download-progress", {
          requestId,
          url,
          status: "downloading",
          progress: 0,
          title: mediaTitle,
        });

        // 플랫폼별 기본 Referer 설정
        let referer = "";
        if (url.includes("x.com") || url.includes("twitter.com")) {
          referer = "https://x.com/";
        } else if (url.includes("reddit.com")) {
          referer = "https://www.reddit.com/";
        } else if (url.includes("bilibili.com")) {
          referer = "https://www.bilibili.com/";
        }

        // 재시도 로직을 위한 함수
        const tryDownload = async (retryCount = 0): Promise<void> => {
          // 다운로드 인자 구성
          const args = [
            url,
            "--output",
            outputTemplate,
            "--encoding",
            "utf-8",
            "--no-check-certificates",
            "--no-warnings",
            "--newline",
            "--no-playlist",
            "--force-overwrites",
            ...(referer ? ["--add-header", `referer:${referer}`] : []),
            "--ffmpeg-location",
            path.dirname(ffmpegPath),
            // [추가] 플랫폼별 특화 옵션 적용
            ...getCommonYtDlpArgs(url),
          ];

          // Twitter/X의 경우 재시도 시 다른 API 옵션 시도
          if (
            (url.includes("x.com") || url.includes("twitter.com")) &&
            retryCount > 0
          ) {
            args.push("--extractor-args", "twitter:api=graph");
          }

          if (format === "mp3") {
            if (resolvedOverrides.audioFormatId) {
              args.push("--format", resolvedOverrides.audioFormatId);
            }
            const resolvedAudioQuality = getAudioQualityValue(selectedQuality.audio);
            args.push(
              "--extract-audio",
              "--audio-format",
              "mp3",
              "--audio-quality",
              resolvedAudioQuality,
            );
            logger.info('Batch download audio selection', {
              requestId,
              url,
              preset: selectedQuality.audio,
              overrideFormatId: resolvedOverrides.audioFormatId,
              resolvedAudioQuality,
            });
          } else {
            const resolvedVideoSelector = resolvedOverrides.videoFormatId
              ? `${resolvedOverrides.videoFormatId}+bestaudio[ext=m4a]/${resolvedOverrides.videoFormatId}+bestaudio/${resolvedOverrides.videoFormatId}/best[ext=mp4][acodec!=none]/best`
              : getVideoFormatSelector(selectedQuality.video);
            args.push(
              "--format",
              resolvedVideoSelector,
              "--merge-output-format",
              "mp4",
            );
            logger.info('Batch download video selection', {
              requestId,
              url,
              preset: selectedQuality.video,
              overrideFormatId: resolvedOverrides.videoFormatId,
              resolvedVideoSelector,
            });
          }

          try {
            const subprocess = execa(ytDlpPath, args);

            subprocess.stdout?.on("data", (data) => {
              const output = data.toString();
              const progressMatch = output.match(
                /(\d+\.?\d*)%.*?(\d+\.?\d*\w+\/s).*?ETA\s+(\d+:\d+)/,
              );

              if (progressMatch) {
                event.sender.send("download-progress", {
                  requestId,
                  url,
                  status: "downloading",
                  progress: parseFloat(progressMatch[1]),
                  speed: progressMatch[2],
                  eta: progressMatch[3],
                  title: mediaTitle,
                });
              }
            });

            await subprocess;
          } catch (error: unknown) {
            // Twitter/X의 경우 404/403 오류 시 재시도
            if (
              (url.includes("x.com") || url.includes("twitter.com")) &&
              retryCount < 2
            ) {
              logger.warn(
                `Retrying Twitter/X download (attempt ${retryCount + 1}) for ${url}`,
              );
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * (retryCount + 1)),
              ); // 지수 백오프
              return tryDownload(retryCount + 1);
            }
            throw error;
          }
        };

        await tryDownload();
        appendHistoryEntry({
          id: requestId,
          url,
          title: mediaTitle,
          timestamp: Date.now(),
          status: 'success',
          filePath: outputTemplate,
          format,
        });
        event.sender.send("download-progress", {
          requestId,
          url,
          status: "completed",
          progress: 100,
          title: mediaTitle,
        });
        if (shouldNotifyPerItem) {
          showDesktopNotification('Download Complete', mediaTitle);
        }
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        logger.error(`Download Error for ${url}:`, { error: errorMessage });
        appendHistoryEntry({
          id: requestId,
          url,
          title: mediaTitle,
          timestamp: Date.now(),
          status: 'error',
          filePath: null,
          errorMessage,
          format,
        });
        event.sender.send("download-progress", {
          requestId,
          url,
          status: "error",
          progress: 0,
          error: errorMessage,
          title: mediaTitle,
        });
        if (shouldNotifyPerItem) {
          showDesktopNotification('Download Failed', `${mediaTitle}: ${errorMessage}`);
        }
      }
    });

    await Promise.all(downloadPromises);
    showDesktopNotification('Batch Download Finished', `${urls.length} media item(s) processed.`);
  },
);

// 3. Download Video Handler (single)
ipcMain.handle("download-video", async (_event, args: DownloadRequest) => {
  const { url, format } = args;
  const settings = getStoredDownloadSettings();
  const quality = args.quality ?? settings.qualityPreferences;

  // 다운로드 경로 설정
  const outputTemplate = path.join(settings.downloadsDirectory || config.paths.downloads, "%(title)s.%(ext)s");

  // 바이너리 경로 가져오기 (utils.ts 활용)
  const ytDlpPath = getBinaryPath("yt-dlp");
  const ffmpegPath = getBinaryPath("ffmpeg");

  logger.info(`Starting download: ${url} (Format: ${format})`);
  logger.debug(`Binaries - yt-dlp: ${ytDlpPath}, ffmpeg: ${ffmpegPath}`);
  showDesktopNotification('Download Started', 'Download has started.');

  try {
    // 플랫폼별 기본 Referer 설정
    let referer = "";
    if (url.includes("x.com") || url.includes("twitter.com")) {
      referer = "https://x.com/";
    } else if (url.includes("reddit.com")) {
      referer = "https://www.reddit.com/";
    } else if (url.includes("bilibili.com")) {
      referer = "https://www.bilibili.com/";
    }

    // 재시도 로직을 위한 함수
    const tryDownload = async (retryCount = 0): Promise<void> => {
      const downloadArgs = [
        url,
        "--output",
        outputTemplate,
        "--encoding",
        "utf-8",
        "--no-check-certificates",
        "--no-warnings",
        "--no-playlist",
        "--force-overwrites",
        ...(referer ? ["--add-header", `referer:${referer}`] : []),
        "--ffmpeg-location",
        path.dirname(ffmpegPath),
        // [추가] 플랫폼별 특화 옵션 적용
        ...getCommonYtDlpArgs(url),
      ];

      // Twitter/X의 경우 재시도 시 다른 API 옵션 시도
      if (
        (url.includes("x.com") || url.includes("twitter.com")) &&
        retryCount > 0
      ) {
        downloadArgs.push("--extractor-args", "twitter:api=graph");
      }

      if (format === "mp3") {
        downloadArgs.push(
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          getAudioQualityValue(quality.audio),
        );
      } else {
        downloadArgs.push(
          "--format",
          getVideoFormatSelector(quality.video),
          "--merge-output-format",
          "mp4",
        );
      }

      logger.debug(`Executing: ${ytDlpPath} ${downloadArgs.join(" ")}`);

      try {
        // 실행 (execa)
        await execa(ytDlpPath, downloadArgs);
      } catch (error: unknown) {
        // Twitter/X의 경우 404/403 오류 시 재시도
        if (
          (url.includes("x.com") || url.includes("twitter.com")) &&
          retryCount < 2
        ) {
          logger.warn(
            `Retrying Twitter/X download (attempt ${retryCount + 1}) for ${url}`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (retryCount + 1)),
          ); // 지수 백오프
          return tryDownload(retryCount + 1);
        }
        throw error;
      }
    };

    await tryDownload();

    return {
      success: true,
      message: "Download Complete!",
      filePath: outputTemplate,
    };
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error("Download Error:", { error: errorMessage });
    showDesktopNotification('Download Failed', errorMessage);
    return { success: false, message: errorMessage || "Process Failed" };
  }
});

// 4. Read Batch File Handler
ipcMain.handle("read-batch-file", async () => {
  if (!mainWindow) return null;

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Select Batch File (URL List)",
    properties: ["openFile"],
    filters: [{ name: "Text Files", extensions: ["txt", "list"] }],
  });

  if (canceled || filePaths.length === 0) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePaths[0], "utf-8");

    // yt-dlp --batch-file 규칙에 따른 파싱
    const urls = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => {
        // 빈 줄 제거
        if (!line) return false;
        // 주석 제거 (#, ;, ])
        const firstChar = line.charAt(0);
        return !["#", ";", "]"].includes(firstChar);
      });

    return urls;
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error("Batch File Read Error:", { error: errorMessage });
    throw new Error("Failed to read batch file");
  }
});

// 5. Open Folder Handler
ipcMain.handle("open-downloads-folder", async () => {
  const settings = getStoredDownloadSettings();
  const downloadsPath = settings.downloadsDirectory || config.paths.downloads;
  await shell.openPath(downloadsPath);
});

// 6. Download Settings Handlers
ipcMain.handle("get-download-settings", async () => {
  return getStoredDownloadSettings();
});

ipcMain.handle("set-download-settings", async (_event, settings: DownloadSettings) => {
  const current = getStoredDownloadSettings();
  const next = {
    downloadsDirectory: settings.downloadsDirectory ?? current.downloadsDirectory,
    qualityPreferences: settings.qualityPreferences ?? current.qualityPreferences,
    formatOverrides: settings.formatOverrides ?? current.formatOverrides,
    notifyPerItemInBatch: settings.notifyPerItemInBatch ?? current.notifyPerItemInBatch,
  };
  settingsStore.set('downloadSettings', next);
});

ipcMain.handle("set-download-directory", async (_event, path: string | null) => {
  const settings = getStoredDownloadSettings();
  settings.downloadsDirectory = path;
  settingsStore.set('downloadSettings', settings);
});

ipcMain.handle("select-download-directory", async () => {
  if (!mainWindow) return null;

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Select Download Directory",
    properties: ["openDirectory"],
  });

  if (canceled || filePaths.length === 0) {
    return null;
  }

  const selectedPath = filePaths[0];
  const settings = getStoredDownloadSettings();
  settings.downloadsDirectory = selectedPath;
  settingsStore.set('downloadSettings', settings);
  
  return selectedPath;
});

ipcMain.handle("get-download-history", async () => {
  return getHistoryEntries();
});

ipcMain.handle("clear-download-history", async () => {
  clearHistory();
});

ipcMain.handle("download-single", async (event, args: { url: string; format: 'mp4' | 'mp3'; requestId: string; title?: string; quality?: DownloadQualityPreferences; formatOverrides?: { videoFormatId: string | null; audioFormatId: string | null } }) => {
  const { url, format, requestId, title } = args;
  
  const ytDlpPath = getBinaryPath("yt-dlp");
  const ffmpegPath = getBinaryPath("ffmpeg");
  
  const settings = getStoredDownloadSettings();
  const downloadsPath = settings.downloadsDirectory || config.paths.downloads;
  const outputTemplate = path.join(downloadsPath, "%(title)s.%(ext)s");
  const quality = args.quality ?? settings.qualityPreferences;
  const formatOverrides = args.formatOverrides ?? settings.formatOverrides;

  logger.info(`Starting single download: ${url} (Format: ${format}, RequestId: ${requestId})`);
  showDesktopNotification('Download Started', title || 'Download has started.');

  try {
    let referer = "";
    if (url.includes("x.com") || url.includes("twitter.com")) {
      referer = "https://x.com/";
    } else if (url.includes("reddit.com")) {
      referer = "https://www.reddit.com/";
    } else if (url.includes("bilibili.com")) {
      referer = "https://www.bilibili.com/";
    }

    const downloadArgs = [
      url,
      "--output", outputTemplate,
      "--encoding", "utf-8",
      "--no-check-certificates",
      "--no-warnings",
      "--newline",
      "--no-playlist",
      "--force-overwrites",
      ...(referer ? ["--add-header", `referer:${referer}`] : []),
      "--ffmpeg-location", path.dirname(ffmpegPath),
      ...getCommonYtDlpArgs(url),
    ];

    if (format === "mp3") {
      if (formatOverrides.audioFormatId) {
        downloadArgs.push("--format", formatOverrides.audioFormatId);
      }
      const resolvedAudioQuality = getAudioQualityValue(quality.audio);
      downloadArgs.push(
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", resolvedAudioQuality,
      );
      logger.info('Single download audio selection', {
        requestId,
        url,
        preset: quality.audio,
        overrideFormatId: formatOverrides.audioFormatId,
        resolvedAudioQuality,
      });
    } else {
      const resolvedVideoSelector = formatOverrides.videoFormatId
        ? `${formatOverrides.videoFormatId}+bestaudio[ext=m4a]/${formatOverrides.videoFormatId}+bestaudio/${formatOverrides.videoFormatId}/best[ext=mp4][acodec!=none]/best`
        : getVideoFormatSelector(quality.video);
      downloadArgs.push(
        "--format",
        resolvedVideoSelector,
        "--merge-output-format",
        "mp4",
      );
      logger.info('Single download video selection', {
        requestId,
        url,
        preset: quality.video,
        overrideFormatId: formatOverrides.videoFormatId,
        resolvedVideoSelector,
      });
    }

    event.sender.send("download-progress", {
      requestId,
      url,
      status: "downloading",
      progress: 0,
      title: title || "Downloading...",
    });

    const subprocess = execa(ytDlpPath, downloadArgs);
    let finalFilePath: string | undefined;

    subprocess.stdout?.on("data", (data) => {
      const output = data.toString();
      const progressMatch = output.match(/(\d+\.?\d*)%.*?(\d+\.?\d*\w+\/s).*?ETA\s+(\d+:\d+)/);
      if (progressMatch) {
        event.sender.send("download-progress", {
          requestId,
          url,
          status: "downloading",
          progress: parseFloat(progressMatch[1]),
          speed: progressMatch[2],
          eta: progressMatch[3],
          title: title || "Downloading...",
        });
      }
      const filePathMatch = output.match(/\[Merger\].*?-> (.+\.mp4)|Merging formats into.*?"(.+\.mp4)"/);
      if (filePathMatch) {
        finalFilePath = filePathMatch[1] || filePathMatch[2];
      }
    });

    await subprocess;

    const historyEntry = {
      id: requestId,
      url,
      title: title || "Downloaded Media",
      timestamp: Date.now(),
      status: "success" as const,
      filePath: finalFilePath || outputTemplate,
      format,
    };
    appendHistoryEntry(historyEntry);

    event.sender.send("download-progress", {
      requestId,
      url,
      status: "completed",
      progress: 100,
      filePath: finalFilePath || outputTemplate,
      title: title || "Download Complete",
    });

    showDesktopNotification('Download Complete', title || 'Your media has been downloaded successfully.');

    return { success: true, message: "Download Complete!", filePath: finalFilePath || outputTemplate };
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error("Download Single Error:", { error: errorMessage });

    const historyEntry = {
      id: requestId,
      url,
      title: title || "Failed Download",
      timestamp: Date.now(),
      status: "error" as const,
      filePath: null,
      errorMessage,
      format,
    };
    appendHistoryEntry(historyEntry);

    event.sender.send("download-progress", {
      requestId,
      url,
      status: "error",
      progress: 0,
      error: errorMessage,
      title: title || "Download Failed",
    });

    showDesktopNotification('Download Failed', errorMessage);

    return { success: false, message: errorMessage };
  }
});
