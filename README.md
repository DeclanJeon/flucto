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

> Flucto is an open-source desktop application for creators and curators who want one reliable way to capture media and turn available captions into Markdown notes from YouTube, X, Reddit, Bilibili, and Instagram.

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

## Output Modes

| Mode | What it creates | Best for |
| --- | --- | --- |
| `MP4` | Video files from supported URLs | Archiving videos, clips, playlists, and social media posts |
| `MP3` | Extracted audio files | Podcasts, lectures, music, and offline listening |
| `MD` | Markdown transcript files from available captions/subtitles | Research notes, summaries, quote extraction, and searchable archives |

Markdown conversion is caption-based. If a platform or video does not expose captions/subtitles through `yt-dlp`, Flucto reports the transcript as unavailable instead of silently falling back to speech-to-text. No Python/FastAPI server, Whisper runtime, or external transcription service is embedded.

## Recent Updates

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
