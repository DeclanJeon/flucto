# 🚀 Flucto Downloader

<p align="center">
  Flowing Speed. Flawless Video. The privacy-first media downloader for desktop.
</p>

<p align="center">
  <a href="https://github.com/yourusername/flucto/releases"><img src="https://img.shields.io/github/v/release/yourusername/flucto?style=flat&color=5865F2&label=Download&logo=github" alt="Download"></a>
  <a href="#"><img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-007ACC?style=flat&logo=linux&logoColor=white" alt="Platform"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-10B981?style=flat" alt="License"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-100%25-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

> Flucto is an open-source, modern desktop application designed to make downloading video and audio effortless. Built with the latest web technologies, it bridges the gap between powerful CLI tools and beautiful UX.

- ✨ **Stunning UI**: Apple-inspired dark mode with glassmorphism & smooth animations
- 🌍 **Universal Support**: Downloads from YouTube, Twitter (X), Reddit, Bilibili, Instagram
- 📦 **Batch Processing**: Import `.txt` lists to download huge queues automatically
- ⚡ **Auto-Setup**: Automatically fetches and configures `yt-dlp` and `ffmpeg` binaries
- 🔒 **Privacy First**: No tracking, local processing, and proxied thumbnail loading
- 🎵 **Format Choice**: High-quality video (MP4) or audio extraction (MP3) support
- 🛡️ **Type Safe**: Built with 100% TypeScript for stability and reliability

<p align="center">
  <img src="https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExMmZiM2g1MmJiZHk0am8xcXkxMXBrb3I2OWxrMXJ2a3BuczAxN3NwbSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/arv0uz1yGEtdL8Xkqq/giphy.gif" width="100%" alt="Flucto Screenshot" />
</p>

- [Report Bug](https://github.com/yourusername/flucto/issues)

## Key Features

- **Smart Media Engine:** Flucto intelligently parses URLs to support single videos and playlists. It handles complex platforms like Bilibili and Twitter using specialized headers and User-Agents.
- **Batch Queue System:** Supports loading hundreds of URLs via text files. Perfect for archiving channels or downloading curated lists.
- **Zero Configuration:** Unlike other GUI wrappers, Flucto includes a `setup-binaries` script that automatically downloads the correct version of `yt-dlp` and `ffmpeg` for your OS upon installation.
- **Performance Focused:** Built on **Vite** and **React 19**, offering a snappy experience compared to traditional Electron apps.
- **Network Resilience:** Implements auto-retry logic with exponential backoff for unstable connections or API rate limits.

## 📦 CI/CD & Automated Releases

Flucto uses GitHub Actions for automated CI/CD:

- **Automatic Versioning**: Semantic versioning based on commit messages
- **Multi-Platform Builds**: Windows, macOS, and Linux binaries built automatically
- **Auto-Release**: New GitHub releases created on push to main/master branch

### Commit Conventions

Follow [Conventional Commits](./COMMIT_CONVENTIONS.md) to trigger automatic releases:

```bash
# Feature release
git commit -m "feat: add new feature"

# Bug fix
git commit -m "fix: resolve download issue"

# Breaking change
git commit -m "feat!: redesign API"
```

See [COMMIT_CONVENTIONS.md](./COMMIT_CONVENTIONS.md) for full guidelines.

## How to get started (Development)

1. **Clone the repository** to your local machine.
   ```bash
   git clone https://github.com/yourusername/flucto.git
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

4. **Start the development server** - This runs both the Vite renderer and the Electron main process concurrently.

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