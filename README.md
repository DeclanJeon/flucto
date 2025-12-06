# Flucto

> **Flowing Speed. Flawless Video.** Experience the ultimate YouTube Downloader powered by Electron & React.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)
![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)

**Flucto** is a high-performance media downloader built with modern design and powerful engineering principles (KISS, DRY, SOLID). Experience the power of `yt-dlp` and `FFmpeg` media processing capabilities with a sophisticated UI.

## ✨ Features

- **🎨 Immersive UI**: Apple-style immersive dark mode design with smooth animations (`framer-motion`)
- **📋 Smart Queue**: Multi-video queue management and batch downloads
- **🎥 High Quality**: 4K+ high-quality video and high-quality MP3 extraction support
- **🌐 Cross Platform**: Full support for Windows, macOS, Linux
- **🔒 Safety First**: Binary integrity checks and secure sandbox environment
- **♿ WCAG Compliant**: Full accessibility support and screen reader compatibility
- **📊 Real-time Progress**: Real-time download progress monitoring

## 🛠 Tech Stack

- **Frontend**: React 19, TypeScript, TailwindCSS, Framer Motion
- **Backend**: Electron, Node.js
- **Core Engine**: yt-dlp, FFmpeg
- **Utilities**: Winston (Logging), Dotenv (Config)

## 🚀 Installation & Usage

### Prerequisites
- Node.js 18+
- FFmpeg and yt-dlp binaries (auto-download supported)

### Development Setup

1. **Clone repository and install dependencies**
   ```bash
   git clone https://github.com/your-username/flucto-downloader.git
   cd flucto-downloader
   npm install
   ```

2. **Automatic binary setup**
   ```bash
   npm run postinstall
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

## 📦 Build & Packaging

Generate platform-specific executable installers:

```bash
# Windows (exe)
npm run dist

# macOS (dmg)
npm run dist

# Linux (AppImage)
npm run dist
```

> **Important**: Ensure required binaries are included in the `bin/` folder before building.

## 🏗 Architecture & Principles

This project follows these software engineering principles:

- **SOLID**: Component and Hook separation following Single Responsibility Principle (SRP) (`useDownloadMonitor`)
- **DRY**: Elimination of duplicate logic and utilities (`createYtDlpArgs`)
- **KISS**: Intuitive UX and clear code structure
- **Operational Excellence**: Winston-based structured logging and system health checks

### Project Structure

```
flucto-downloader/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.ts          # Main entry point
│   │   ├── config.ts         # Central configuration
│   │   ├── logger.ts         # Winston logging setup
│   │   └── utils.ts          # Binary utilities and health checks
│   ├── preload/              # Preload scripts
│   │   └── index.ts         # API bridge between main and renderer
│   ├── renderer/             # React frontend
│   │   ├── src/
│   │   │   ├── components/   # React components
│   │   │   ├── hooks/       # Custom React hooks
│   │   │   └── App.tsx      # Main application component
│   └── shared/              # Shared types
│       └── types.ts          # TypeScript definitions
├── bin/                     # Binary dependencies
├── scripts/                 # Build and setup scripts
├── public/                  # Static assets
└── dist/                    # Build output
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Development Settings
NODE_ENV=development

# Download Settings
DEFAULT_DOWNLOAD_DIR=           # Custom download directory
ALLOW_4K=false                # Enable 4K downloads

# Logging Settings
LOG_LEVEL=debug                # Logging verbosity
```

### Binary Configuration

The application automatically detects and validates required binaries:

- `yt-dlp`: Core YouTube download functionality
- `ffmpeg`: Audio/video processing and format conversion

Binaries are automatically included in production builds.

## 🎨 Design System

### Color Palette
- **Primary**: Blue gradient (`#3B82F6` to `#8B5CF6`)
- **Background**: Deep dark (`#0D0D0D`)
- **Surface**: Glass morphism with backdrop blur
- **Text**: White with gray variants

### Typography
- **Headings**: Bold, tight tracking, large scale
- **Body**: System font stack, light weight
- **UI**: Medium weight, optimized legibility

### Animations
- **Page Load**: Smooth fade-up with easing
- **Interactions**: Subtle scale and color transitions
- **Layout**: AnimatedPresence for smooth enter/exit

## 🔒 Security & Privacy

- **No Tracking**: No analytics or telemetry
- **Local Processing**: All operations performed locally
- **Secure Downloads**: Verified binary dependencies
- **Privacy Focused**: No data collection or sharing

## 🐛 Troubleshooting

### Common Issues

1. **"Missing required binaries"**
   - Run `npm run postinstall` to reinstall binaries
   - Check if FFmpeg is in system PATH

2. **"Download failed"**
   - Verify YouTube URL is correct
   - Check internet connection
   - Try different video format

3. **Performance Issues**
   - Close other applications using bandwidth
   - Reduce number of concurrent downloads
   - Check available disk space

### Logs

Application logs are stored in the following locations:
- **Windows**: `%APPDATA%/flucto/logs/`
- **macOS**: `~/Library/Logs/flucto/`
- **Linux**: `~/.config/flucto/logs/`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript best practices
- Maintain WCAG 2.1 AA compliance
- Test on all supported platforms
- Update documentation for new features

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **yt-dlp** - Powerful YouTube downloader
- **FFmpeg** - Multimedia processing
- **Electron** - Cross-platform desktop framework
- **React** - UI library
- **Tailwind CSS** - Utility-first CSS framework
- **Framer Motion** - Production-ready motion library

## 📞 Support

- 📧 Email: support@flucto.app
- 🐛 Issues: [GitHub Issues](https://github.com/your-username/flucto-downloader/issues)
- � Documentation: [Wiki](https://github.com/your-username/flucto-downloader/wiki)

---

**Made with ❤️ by the Flucto Team**
