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


> Flucto is an open-source desktop application for creators and curators who want one flowing way to capture media and turn available captions into Markdown notes from YouTube, X, Reddit, Bilibili, and Instagram.

- ✨ **Stunning UI**: Apple-inspired dark mode with glassmorphism & smooth animations
- 🌍 **Universal Support**: Download from YouTube, X, Reddit, Bilibili, Instagram
- 📝 **Caption to Markdown**: Convert available subtitles/captions into clean `.md` files with metadata and timestamps
- 📦 **Batch Processing**: Import `.txt` lists to download media or convert caption queues automatically
- ⚡ **Auto-Setup**: Automatically fetches and configures `yt-dlp` and `ffmpeg` binaries
- 🔒 **Privacy First**: No tracking, local processing, and proxied thumbnail loading
- 🎵 **Format Choice**: Save video (MP4), audio extraction (MP3), or Markdown transcript output
- 🛡️ **Type Safe**: Built with 100% TypeScript for stability and reliability

<p align="center">
  <img src="https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExMmZiM2g1MmJiZHk0am8xcXkxMXBrb3I2OWxrMXJ2a3BuczAxN3NwbSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/arv0uz1yGEtdL8Xkqq/giphy.gif" width="100%" alt="Flucto Screenshot" />
</p>

- [Report Bug](https://github.com/DeclanJeon/flucto/issues)

## Key Features

- **Smart Media Engine:** Flucto parses single video, playlist, and social-media URLs while sharing platform-specific `yt-dlp` headers, referers, and retry behavior across preview, download, and transcript flows.
- **MP4 / MP3 / MD Output Modes:** Choose between media download, audio extraction, or Markdown transcript conversion without changing the Electron + TypeScript desktop stack.
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

## CLI Mode

Flucto ships `flucto` and the shorter `fl` command for automation, batch jobs, and AI-agent workflows. The CLI uses the same TypeScript service layer as the desktop app; it does not launch the Electron window and does not call desktop IPC handlers.

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
| `flucto formats <url>` | `fl f <url>` | List downloadable formats | format id, extension, resolution, note |
| `flucto download <url>` | `fl d <url>` | Download MP4 video or MP3 audio | Generated media file |
| `flucto languages <url>` | `fl l <url>` | List available caption languages | language code/name and auto/manual flag |
| `flucto transcript <url>` | `fl t <url>` | Convert available captions/subtitles to Markdown | `.md` file or stdout Markdown |
| `flucto batch <file>` | `fl b <file>` | Process a text file of URLs | Multiple media downloads or Markdown conversions |
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
fl d "https://www.youtube.com/watch?v=..." -f mp3 -o ./audio -j

# Convert captions/subtitles to Markdown
fl l "https://www.youtube.com/watch?v=..." -j
fl t "https://www.youtube.com/watch?v=..." -l en -o ./notes -j
fl t "https://www.youtube.com/watch?v=..." -l auto -s > transcript.md

# Process URL lists
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

### Next

- Added `flucto setup` for managed `yt-dlp` and `ffmpeg` provisioning in CLI-only and repair scenarios.
- Added CLI GitHub release update commands: `update check`, `update download`, and conservative `update apply`.
- Added release checksum manifest publishing so CLI downloads can verify release assets when checksum metadata is available.
- Desktop startup now attempts one managed binary repair before showing the missing-component exit dialog.
- Refreshed Flucto branding with a new `🌊`-inspired wave-download logo across app icons, favicon, manifest assets, and social preview imagery.

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

Flucto uses GitHub Actions and semantic-release for automated CI/CD:

- **Automatic Versioning**: Semantic versioning based on Conventional Commit types
- **Generated Release Notes**: `feat`, `fix`, and breaking-change commits become GitHub Release notes and `CHANGELOG.md` entries
- **Multi-Platform Builds**: Windows, macOS, and Linux binaries built automatically
- **Auto-Release**: New GitHub releases created on push to main/master branch

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
