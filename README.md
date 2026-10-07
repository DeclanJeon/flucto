# 🌊 Flucto

<p align="center">
  Flucto - creator-first desktop media downloader and caption-to-Markdown exporter for short-form and long-form captures.
</p>

<p align="center">
  <a href="https://github.com/DeclanJeon/flucto/releases"><img src="https://img.shields.io/github/v/release/DeclanJeon/flucto?style=flat&color=5865F2&label=Download&logo=github" alt="Download"></a>
  <a href="#"><img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-007ACC?style=flat&logo=linux&logoColor=white" alt="Platform"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-10B981?style=flat" alt="License"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-100%25-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

<p align="center">
  <img src="src/renderer/public/logo.svg" width="128" height="128" alt="Flucto wave download logo" />
</p>


> Flucto is an open-source desktop application for creators and curators who want one flowing way to capture media and turn available captions into Markdown notes from YouTube, X, Reddit, Bilibili, Dailymotion, Niconico, OK.ru, VK Video, Instagram, Threads, TikTok, and Vimeo.

- ✨ **Stunning UI**: Apple-inspired dark mode with glassmorphism & smooth animations
- 🌍 **Platform Support**: URL downloads from YouTube, X, Reddit, Bilibili, Dailymotion, Niconico, OK.ru, VK Video, Instagram, Threads, TikTok, and Vimeo
- 📝 **Caption to Markdown**: Convert available subtitles/captions into clean `.md` files with metadata and timestamps
- 📦 **Batch Processing**: Import `.txt` lists to download media or convert caption queues automatically
- ⚡ **Auto-Setup**: Automatically fetches and configures `yt-dlp` and `ffmpeg` binaries
- 🔒 **Anonymous Search Sessions**: Media processing stays local; keyword searches contact site APIs/public indexes without reusing your logged-in browser profile
- 🎵 **Format Choice**: Save video (MP4), audio extraction (MP3), or Markdown transcript output
- 🛡️ **Type Safe**: Built with 100% TypeScript for stability and reliability

<p align="center">
  <img src="assets/demo/flucto-channel-to-md.gif" width="100%" alt="Flucto CLI demo: channel to Markdown" />
</p>

<p align="center"><em>CLI demo — one channel → many Markdown notes in a dedicated job folder</em></p>

- [Report Bug](https://github.com/DeclanJeon/flucto/issues)

## Key Features

- **Smart Media Engine:** Flucto parses single video, playlist, and social-media URLs while sharing platform-specific `yt-dlp` headers, referers, and retry behavior across preview, download, and transcript flows.
- **Integrated Video Search:** Search all 12 registered sites together or select one site, see native/index source attribution and partial failures, then add results to the existing MP4/MP3 download queue. Desktop and CLI share the same service.
- **Extensible Platform Architecture:** Plugin-based `PlatformAdapter` system — adding a new platform is one file. Supports yt-dlp-based platforms, custom API extraction, and browser-based fallback strategies.
- **Caption-to-Markdown Conversion:** Uses `yt-dlp` subtitle/caption output when available, parses JSON3, XML/SRV3, and VTT captions, cleans caption markup, groups nearby captions into readable paragraphs, and writes filesystem-safe `.md` files.
- **Transcript Options:** Default new Markdown conversions to English captions (`en`) while still allowing `Auto` or a concrete caption language, include/exclude timestamps and metadata, choose paragraph gap rules, save Markdown files, and optionally copy generated Markdown to the clipboard.
- **Batch Queue System:** Supports loading hundreds of URLs via text files. Batch media downloads and batch transcript conversions both use bounded concurrency so large queues remain responsive.
- **Download History:** Records output type (`mp4`, `mp3`, or `md`) so media downloads and Markdown conversions stay visible in history.
- **Zero Configuration:** Unlike other GUI wrappers, Flucto includes a `setup-binaries` script that automatically downloads the correct version of `yt-dlp` and `ffmpeg` for your OS upon installation.
- **Network Resilience:** Implements retry logic, updater metadata checks, and transcript circuit-breaker behavior for unstable connections, rate limits, and unavailable caption sources.

## Brand

Flucto's logo is a wave-download mark: the `🌊` idea reshaped into a cyan-to-violet flow that curls like a wave and lands as a download arrow. The mark is used consistently across the packaged app icon, favicon, Apple touch icon, web manifest, and social preview card.

Brand assets live in:

| Asset | Path |
| --- | --- |
| App icon source | `assets/icon.png` |
| Windows icon | `assets/icon.ico` |
| Web logo | `src/renderer/public/logo.svg` |
| Favicon | `src/renderer/public/favicon.svg` |
| Social preview | `src/renderer/public/og-image.svg` |
| Brand source of truth | `DESIGN.md` |


## Output Modes

| Mode | What it creates | Best for |
| --- | --- | --- |
| `MP4` | Video files from supported URLs | Archiving videos, clips, playlists, and social media posts |
| `MP3` | Extracted audio files | Podcasts, lectures, music, and offline listening |
| `MD` | Markdown transcript files from available captions/subtitles | Research notes, summaries, quote extraction, and searchable archives |

Markdown conversion is caption-based. If a platform or video does not expose captions/subtitles through `yt-dlp`, Flucto reports the transcript as unavailable instead of silently falling back to speech-to-text. No Python/FastAPI server, Whisper runtime, or external transcription service is embedded.

## Video Search

In the desktop app, **Search videos** defaults to **All sites (integrated)** and searches all 12 registered sites. Choose an individual site to narrow the search, enter a keyword, and click **Add** beside a result to use the existing download queue. Results show their site and **native** or **index** search method. Expand **Search sources** for per-site counts, actual errors, native-search restrictions, and site/index search links. A failed site does not hide the other sites' results.

```bash
# Integrated search; omitting --platform defaults to all
flucto search "nature" --limit 20 --json
flucto search "nature" --platform all --limit 50
flucto search "nature" --platform youtube --json
flucto search "nature" --platform threads --json
flucto search "nature" --platform instagram --json
flucto search "nature" --platform bilibili --limit 20 --json
flucto search "nature" --platform dailymotion --json
flucto search "初音ミク" --platform nicovideo --json
flucto search "nature" --platform ok --json
flucto search "nature" --platform vkvideo --json
flucto download "<originalUrl from a search result>" --format mp4 --output-dir ./captures
```

`--limit` is a **total** result cap of 1–50 (default 20), not a per-site output quota. Integrated search interleaves source ranks and removes duplicate original URLs. Search does not provision media binaries. JSON contains `platform`, `query`, annotated `videos` (`platform`, `searchMethod`), and `sources` (`platform`, `method`, `count`, `searchUrl`, optional `error` and `nativeError`). Source counts describe fetched results before the integrated cap, so their sum can exceed the displayed total. Single-site responses also include `searchUrl`. Partial failures and successful empty searches exit 0; an entirely failed search includes top-level `error` and exits 4.

| Site | Search method | Download method / restrictions |
| --- | --- | --- |
| YouTube | Public results page and Innertube continuation; public video index fallback | Existing `yt-dlp` adapter; captions/transcripts and authorized download settings remain supported. |
| X / Twitter | Public video index; native anonymous keyword search requires login | Existing `yt-dlp` adapter; indexed statuses can still require authorized cookies when downloading. |
| Instagram | Public video index; native anonymous keyword search requires login | Existing `yt-dlp` adapter for reels/video posts; index coverage is not the entire Instagram catalog. |
| Reddit | Public search JSON filtered to playable-video posts; public video index fallback on blocks | Existing `yt-dlp` adapter; anonymous API requests may receive HTTP 403. Image/text-only posts are excluded from native results. |
| Bilibili | Public web search API; anonymous Chrome fallback on API failure | `yt-dlp`; supports `bilibili.com` and `b23.tv`. Some quality levels and paid videos require authorized cookies. |
| Dailymotion | Public [Graph API](https://developers.dailymotion.com/api/) | `yt-dlp`; supports `dailymotion.com` and `dai.ly`. Use a current standalone build with impersonation support. |
| Niconico | Official [Snapshot Search API v2](https://site.nicovideo.jp/search-api-docs/snapshot) | `yt-dlp`; supports `nicovideo.jp` and `nico.ms`. MP4 audio tracks are merged with the video. Snapshot results are updated daily; uploader names are represented by user/channel IDs. |
| OK.ru | Anonymous search page rendered in headless Chrome | `yt-dlp`; supports `ok.ru` and `odnoklassniki.ru`. Requires the official nightly extractor fix for [upstream issue #17585](https://github.com/yt-dlp/yt-dlp/issues/17585). Search uses `st.gsq`; the superficially similar `?q=` route does not perform this search. |
| VK Video | Website's anonymous token exchange and catalog API; anonymous Chrome fallback if unavailable | `yt-dlp`; public video URLs on `vkvideo.ru` and VK aliases. The anonymous API's public web-client configuration can change. |
| Threads | Anonymous headless search selects posts with actual video elements; public video index fallback | Existing Threads adapter; native visibility is session-dependent. Image/text-only native posts are excluded. |
| TikTok | Public video index; anonymous native video search is unavailable on the checked route | Existing `yt-dlp` adapter; download availability can depend on cookies, region, or upstream restrictions. |
| Vimeo | Public video index | Existing `yt-dlp` adapter; private/password-protected or restricted clips need the appropriate authorized download options. |

OK.ru search, Threads native search, public-index searches, and browser fallbacks require **Google Chrome installed locally**, or `FLUCTO_CHROME_PATH` pointing to a compatible Chromium executable. Browser contexts are temporary and anonymous; they do not read your logged-in browser profile. Integrated searches run at most four providers concurrently; public-index/Threads browser work shares a two-page pool and closes the browser when idle.

Public-index queries are sent to **Google video search**, then **DuckDuckGo** and **Bing** when needed—not to an AI provider. Index coverage and relevance differ from native site search; results can be sparse or stale. Human-verification pages, HTTP blocks, and off-site-only responses are not disguised as successful zero-hit searches. A genuinely served empty search remains a valid zero-result response. Search does not solve CAPTCHAs, bypass regional restrictions, or access paid/private media.

For media downloads that require your own authorized session, use `--cookies PATH` or `--cookies-from-browser BROWSER`; media downloads also honor existing `FLUCTO_*` network overrides. Search sessions remain anonymous. A searchable video can still be deleted, private, DRM-protected, or unavailable in your region when downloading.

Flucto now provisions and refreshes the **official yt-dlp nightly channel**, [recommended upstream for regular users](https://github.com/yt-dlp/yt-dlp#update-channels), so OK.ru's metadata fix is available without a local extractor patch. Linux provisioning uses the standalone build with impersonation support. Run `flucto setup --yt-dlp-only --force` to replace an older managed binary. Explicit `--yt-dlp` / `FLUCTO_YT_DLP_PATH` overrides remain user-managed and must also contain the fix.


## CLI Mode

Flucto ships `flucto` and the shorter `fl` command for automation, batch jobs, and AI-agent workflows. The CLI uses the same TypeScript service layer as the desktop app; it does not launch the Electron window and does not call desktop IPC handlers.

### Demo: channel → Markdown

![flucto channel to-md demo](assets/demo/flucto-channel-to-md.gif)

```bash
# Real command (creates a dedicated job folder under --out)
flucto channel to-md "@LIFECODEofficial" --limit 100 --out ./notes
# → ./notes/<channel>-channel-md-<timestamp>/001_….md …
```

Demo assets: `assets/demo/flucto-channel-to-md.gif`, `assets/demo/flucto-channel-to-md.mp4`  
(MP4 is used for Threads / social video posts; GIF for README embeds.)

### Build and run locally

```bash
npm install
npm run build:electron
npm link
fl h
fl doc
```

`npm link` registers the local build as both `flucto` and `fl`. Without linking, use `npm run cli -- --help` from the project root.

Packaged releases expose both commands through `package.json`'s `bin` entry. Short command aliases are available for common flows.

### Commands

| Command | Short form | Purpose | Typical output |
| --- | --- | --- | --- |
| `flucto doctor` | `fl doc` | Verify `yt-dlp` and `ffmpeg` discovery | Binary paths and versions |
| `flucto setup` | `fl s` | Provision missing managed `yt-dlp` and `ffmpeg` binaries | Setup status, paths, versions, and fix guidance |
| `flucto info <url>` | `fl i <url>` | Read media metadata | id, title, thumbnail, duration, uploader, view count |
| `flucto search "<keyword>" --platform <site>` | — | Search the five supported video sites | Video metadata and original download URLs |
| `flucto formats <url>` | `fl f <url>` | List downloadable formats | format id, extension, resolution, note |
| `flucto download <url>` | `fl d <url>` | Download MP4 video or MP3 audio | Generated media file |
| `flucto languages <url>` | `fl l <url>` | List available caption languages | language code/name and auto/manual flag |
| `flucto transcript <url>` | `fl t <url>` | Convert available captions/subtitles to Markdown | `.md` file or stdout Markdown |
| `flucto md <url>` | `fl md <url>` | Download media and convert to Markdown in one step | `.md` file with metadata + transcript |
| `flucto update check` | `fl u check` | Check GitHub releases for a newer Flucto version | Current/latest version and recommended asset |
| `flucto update download` | `fl u download` | Download the recommended GitHub release asset | Downloaded asset path and checksum status |
| `flucto update apply` | `fl u apply` | Apply an already downloaded asset when safe | Conservative apply result or manual install instructions |

Short option aliases: `-j` = `--json`, `-p` = `--progress-json`, `-f` = `--format`, `-q` = `--quality`, `-a` = `--audio-quality`, `-l` = `--language`, `-s` = `--stdout`, `-o` = `--output-dir`, and `-c` = `--concurrency`.


### Common examples

```bash
# Check bundled or configured binaries
fl doc -j

# Provision managed binaries without touching system package managers
fl s -j
fl s --check-only --bin-dir ./bin -j

# Inspect a media URL before downloading
fl i "https://www.youtube.com/watch?v=..." -j
fl f "https://www.youtube.com/watch?v=..."

# Download video or audio
fl d "https://www.youtube.com/watch?v=..." -f mp4 -o ./captures -j
fl d "https://www.threads.com/@user/post/ABC" -f mp4 -o ./captures
fl d "https://www.tiktok.com/@user/video/123" -f mp4 -o ./captures
fl l "https://www.youtube.com/watch?v=..." -j
fl t "https://www.youtube.com/watch?v=..." -l en -o ./notes -j
fl t "https://www.youtube.com/watch?v=..." -l auto -s > transcript.md

# Whole channel → Markdown notes (capped by --limit; dedicated job folder under --out)
fl channel to-md "@LIFECODEofficial" --limit 100 -o ./notes
flucto channel to-md "https://www.youtube.com/@learn-ai-lab" --limit 20 -o ./notes -l ko -c 2

# Process URL lists (also creates a dedicated job subfolder under the base output dir)
fl b urls.txt -f mp4 -c 2 -o ./captures -j
fl b urls.txt -f md -c 2 -o ./notes -j


# Check and download GitHub release updates from CLI
fl u check -j
fl u download -o ~/Downloads -j
fl u apply --asset ~/Downloads/Flucto-1.9.2-x86_64.AppImage -j
```

`batch` files are plain text. Empty lines and lines starting with `#`, `;`, or `]` are ignored, so URL lists can contain comments:

```text
# research clips
https://www.youtube.com/watch?v=...
https://samplelib.com/lib/preview/mp4/sample-5s.mp4
```

### Output and automation rules

- `--json` / `-j`: writes the final result object to stdout.
- `--progress-json` / `-p`: writes progress events as newline-delimited JSON to stderr.
- Human progress messages are written to stderr when `--progress-json` is not set.
- `--stdout` / `-s` on `transcript` writes Markdown content to stdout instead of only saving a file.
- **Multi-file jobs** (`batch`, `channel to-md`) always create a **dedicated subfolder** under `--output-dir` / `--out` (or the current working directory). Files are never dumped loose into the base path.
  - Channel example: `./notes/라이프코드_LIFECODE-channel-md-20260710-143012/001_….md`
  - Batch example: `./captures/urls-batch-mp4-20260710-143012/….mp4`
- JSON results for multi-file jobs include the resolved `outputDir` (the job folder).
- Non-zero exit codes indicate command failure; the JSON response includes the error message when `--json` is set.

### Binary and output configuration

Flucto bundles `yt-dlp` and `ffmpeg` for the desktop release. The CLI also supports `fl s`, which provisions missing managed binaries without mutating system package managers.

```bash
fl doc --bin-dir /opt/flucto/bin -j
fl d "$URL" --yt-dlp /usr/local/bin/yt-dlp --ffmpeg /usr/local/bin/ffmpeg
```

Useful settings:

- `--output-dir DIR`: write generated media or Markdown files to `DIR`.
- `FLUCTO_OUTPUT_DIR`: default output directory when `--output-dir` is omitted.
- `--bin-dir DIR`: directory containing both `yt-dlp` and `ffmpeg`.
- `--yt-dlp PATH`, `--ffmpeg PATH`: explicit binary paths.
- `FLUCTO_BIN_DIR`: default managed binary directory override for `flucto setup`.

Managed binary defaults:

| OS | Default managed bin directory |
| --- | --- |
| Linux | `~/.local/share/flucto/bin` or `$XDG_DATA_HOME/flucto/bin` |
| macOS | `~/Library/Application Support/Flucto/bin` |
| Windows | `%LOCALAPPDATA%\\Flucto\\bin` |

Resolution order is explicit paths, environment paths, `--bin-dir`, managed bin directory, package-local `bin/`, module-relative `bin/`, then system `PATH`.


### CLI updates

The desktop app continues to use Electron's auto-updater. CLI update commands use GitHub releases directly:

```bash
flucto update check --json
flucto update download --output-dir ~/Downloads --json
flucto update apply --asset ~/Downloads/Flucto-1.9.2-x86_64.AppImage --json
```

`check` and `download` are safe automation commands. `apply` is intentionally conservative: unsupported install modes return manual installation instructions instead of silently overwriting application files. When a release includes `checksums-sha256.txt`, downloaded assets are verified before the command reports success.

### Current limitations

- Markdown conversion is caption-based. If the platform/video does not expose captions through `yt-dlp`, Flucto reports the transcript as unavailable; it does not run Whisper or another speech-to-text engine.
- Some platforms, including YouTube, can return media-download `403`/rate-limit/cookie errors while still allowing metadata, format, language, or caption reads. In that case the CLI returns a structured error instead of silently retrying with credentials.
- Direct media URLs from generic extractors are supported by the `v1.9.1` MP4 selector fallback.

## Recent Updates

### v1.17.0 source changes

- Integrated keyword search across all 12 registered sites, with individual-site selection and one total result cap.
- Native YouTube, Reddit, and video-bearing Threads search paths; anonymous public video indexes for login-gated sites and Vimeo. Source errors and search restrictions remain visible instead of becoming false zero-hit results.
- Explicit Dailymotion, Niconico, OK.ru, and VK Video download adapters, plus Bilibili short-link support.
- Official yt-dlp nightly provisioning for the OK.ru extractor fix, and Niconico MP4 video/audio merging.
- Browser-backed searches require locally installed Chrome or `FLUCTO_CHROME_PATH`; search does not reuse signed-in profiles or solve CAPTCHAs.

### v1.12.0

- **Threads Support:** Added Threads (threads.com/threads.net) video download via dedicated `threadsdl.app` API extraction, bypassing yt-dlp.
- **Extensible Platform Architecture:** Refactored platform-specific code into a plugin-based `PlatformAdapter` system with `PlatformRegistry`, `MediaOrchestrator`, and typed error handling (`PlatformError`).
- **New Platforms:** Added TikTok and Vimeo adapters (yt-dlp-based).
- **Markdown Pipeline:** Added `MarkdownPipeline` service and `flucto md` CLI command for direct URL-to-Markdown conversion.
- **Platform Adapters:** YouTube, Twitter/X, Instagram, Reddit, Bilibili, Threads, TikTok, Vimeo — each as a single adapter file.

### v1.9.1

- Fixed CLI MP4 downloads for generic direct media URLs where `yt-dlp` exposes a literal `mp4` format id instead of YouTube-style `bestvideo`/`bestaudio` formats.
- Verified real CLI flows for binary discovery, metadata, format listing, caption language listing, caption-to-Markdown conversion, generic MP4 download, and generated artifact cleanup.

### v1.9.0

- Added first-class `flucto` CLI mode for automation and AI-agent workflows.
- Added CLI commands for `doctor`, `info`, `formats`, `download`, `languages`, `transcript`, and `batch`.
- Reused the desktop TypeScript service layer without launching Electron or importing desktop IPC handlers.
- Added JSON output and NDJSON progress streams for script-friendly automation.

### v1.7.1

- Fixed Linux `.deb` updater metadata so installed Debian/Ubuntu builds can select the `.deb` update asset instead of failing inside `DebUpdater`.
- Refreshed update metadata before manual app-update downloads so stale update checks do not trigger `electron-updater` provider-cache errors.

### v1.7.0

- Added Markdown transcript output mode next to MP4 and MP3.
- Added transcript language selection, timestamp/metadata toggles, paragraph gap control, file saving, and clipboard copy options.
- Added JSON3, XML/SRV3, and VTT caption parsing for `yt-dlp` subtitle outputs.
- Added transcript progress UI for analyzing, extracting, formatting, saving, and completion/error states.
- Added `md` entries to download history so generated Markdown files remain visible after conversion.

## 📦 CI/CD & Automated Releases

Flucto uses GitHub Actions and semantic-release for automated validation and releases:

- **Automatic Versioning**: Semantic versioning based on Conventional Commit types
- **Generated Release Notes**: `feat`, `fix`, and breaking-change commits become GitHub Release notes and `CHANGELOG.md` entries
- **Multi-Platform Builds**: Windows, macOS, and Linux binaries built automatically
- **Bundled Binaries**: CI verifies packaged yt-dlp and FFmpeg executables. macOS setup uses the same current-release FFmpeg download endpoint as the runtime installer.
- **Release Gate**: Every push to main/master runs lint, TypeScript checks, tests, build, and CLI smoke checks on Windows, macOS, and Linux before release preparation
- **Auto-Release**: Release-worthy commits on main/master create npm packages and GitHub releases; other commits still run validation

The reusable `ci.yml` workflow also validates pull requests and pushes to development branches. All jobs use Node.js 24 and lockfile-based `npm ci` installs. Run the same checks locally with `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

The release workflow predicts the next version using only commit analysis and release notes generation; this step does not load publishing plugins or require npm authentication. It builds Windows/macOS/Linux packages with that version, validates updater manifests and file hashes, generates SHA256 checksums, and publishes through the repository's locked semantic-release installation. Publication updates `package.json`, `package-lock.json`, and `CHANGELOG.md` and creates the version tag. A `feat` commit triggers a minor release; do not manually create a competing release tag.

npm publishing uses GitHub Actions OIDC trusted publishing, not `NPM_TOKEN`. Register the publisher in the npm package's **Settings → Trusted Publisher** section:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `DeclanJeon` |
| Repository | `flucto` |
| Workflow filename | `release.yml` (filename only) |
| Environment name | Leave empty; the release job does not use a GitHub environment |
| Allowed actions | Allow direct publishing with `npm publish`; stage-only permission is insufficient |

Publishing jobs use Node.js 24, npm 11.17.0, and semantic-release 25. Keep `id-token: write` enabled on these jobs; provenance is generated automatically by trusted publishing. No npm token secret is required. An OIDC exchange error or npm `403` requires checking the package's actual Trusted Publisher configuration; adding permissions to GitHub alone cannot fix npm-side authorization.

Local AI-agent metadata under `.commandcode/` is ignored and must not be committed; generated paths can be incompatible with Windows.

### Recover a partially published release

semantic-release creates the Git tag before publishing. If publication fails, fixing authentication and rerunning commit analysis may report no new release. Use the workflow's independent manual recovery job for the existing version:

```bash
# After the workflow changes are pushed and npm Trusted Publisher is configured:
gh workflow run release.yml --ref master \
  -f source_run_id=37508545685 \
  -f release_version=1.17.0
```

`source_run_id` must identify a completed `release.yml` push run on main/master whose three packaging jobs succeeded. `release_version` must match an existing tag and all downloaded artifacts. Recovery validates that the tag has the same application code and dependency metadata as the build commit, then checks out that tag separately for the npm build. It never creates, deletes, or moves the tag.

Recovery skips npm versions that already exist, completes missing GitHub release assets, and publishes a newly created release only after its uploads finish. Recovering an older version preserves a newer `latest`; an unpublished older npm version uses the `release-VERSION` dist-tag. Authentication/network errors are failures, not evidence that a package or release is absent. Publication failures remain visible; there is no automatic dispatch retry.

New build artifacts are retained for 14 days. The original `37508545685` artifacts were created with the old one-day retention and expire on **2026-10-07 around 18:07–18:09 UTC**; the new workflow cannot extend their lifetime. Recovery requires unexpired artifacts. If they expire, stop and rebuild the original version's packages in a new verified source run rather than substituting artifacts from the current branch. A failure before tag creation is not eligible for this recovery path; use the normal release workflow.


### Commit Conventions

Follow [Conventional Commits](./COMMIT_CONVENTIONS.md) to trigger automatic releases. Keep commit subjects release-note ready because they are copied into GitHub Releases and `CHANGELOG.md`.

```bash
# Feature release
git commit -m "feat(transcript): add caption-to-markdown output mode"

# Bug fix release
git commit -m "fix(updater): publish deb updater metadata"

# Breaking change release
git commit -m "feat!: redesign download request API"
```

For user-facing changes, include concrete behavior in the commit subject or body: supported output modes, parser formats, UI controls, platform-specific updater behavior, and known limitations. See [COMMIT_CONVENTIONS.md](./COMMIT_CONVENTIONS.md) for full guidelines.

## How to get started (Development)

1. **Clone the repository** to your local machine.
   ```bash
   git clone https://github.com/DeclanJeon/flucto.git
   cd flucto
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Setup Binaries** - This script will detect your OS and download the required `yt-dlp` and `ffmpeg` binaries to the `/bin` directory.

   ```bash
   npm run postinstall
   ```

4. **Set Supabase environment variables** before running forum features

   ```bash
   cp .env.example .env
   ```

   Required values:

   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`)
   - `SUPABASE_SERVICE_ROLE_KEY` (optional)

   You can verify Supabase auth/RLS write behavior with:

   ```bash
   npm run supabase:smoke
   ```

5. **Start the development server** - This runs both the Vite renderer and the Electron main process concurrently.

   ```bash
   npm run dev
   ```

## Architecture & Tech Stack

Flucto is built with a modern stack prioritizing performance and developer experience:

- **Runtime**: Electron + Node.js
- **Frontend**: React 19, Tailwind CSS v4, Framer Motion
- **Language**: TypeScript (Strict Mode)
- **Core Engine**: `yt-dlp` (Python backend), `ffmpeg` (Media processing)
- **Build Tooling**: Vite, Electron-Builder, Rolldown
- **State Management**: React Hooks (`useDownloader`, `useDownloadMonitor`)

## Build for Distribution

To create installers for your platform (NSIS for Windows, DMG for macOS, AppImage for Linux):

```bash
# Build the renderer and main process
npm run build

# Package the application
npm run dist
```

## Contributing

Contributions are welcome! Whether it's fixing bugs, improving the documentation, or proposing new features.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="center">
<strong>Made with ❤️ by Flucto Team</strong>
</p>
