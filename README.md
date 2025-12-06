# Flucto

> **Flowing Speed. Flawless Video.** Experience the ultimate YouTube Downloader powered by Electron & React.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)

**Flucto**는 현대적인 디자인과 강력한 엔지니어링 원칙(KISS, DRY, SOLID)을 기반으로 구축된 고성능 미디어 다운로더입니다. `yt-dlp`의 강력한 성능과 `FFmpeg`의 미디어 처리 능력을 세련된 UI로 경험해보세요.

## ✨ 주요 기능

- **🎨 Immersive UI**: Apple 스타일의 몰입형 다크 모드 디자인 및 부드러운 애니메이션 (`framer-motion`)
- **📋 Smart Queue**: 다중 비디오 대기열 관리 및 일괄 다운로드
- **🎥 High Quality**: 4K+ 고화질 비디오 및 고음질 MP3 추출 지원
- **🌐 Cross Platform**: Windows, macOS, Linux 완벽 지원
- **🔒 Safety First**: 바이너리 무결성 검사 및 안전한 샌드박스 환경
- **♿ WCAG Compliant**: 완전한 접근성 지원 및 스크린 리더 호환
- **📊 Real-time Progress**: 실시간 다운로드 진행 상황 모니터링

## 🛠 기술 스택

- **Frontend**: React 19, TypeScript, TailwindCSS, Framer Motion
- **Backend**: Electron, Node.js
- **Core Engine**: yt-dlp, FFmpeg
- **Utilities**: Winston (Logging), Dotenv (Config)

## 🚀 설치 및 실행

### 필수 요구사항
- Node.js 18+
- FFmpeg 및 yt-dlp 바이너리 (자동 다운로드 지원)

### 개발 환경 설정

1. **레포지토리 클론 및 의존성 설치**
   ```bash
   git clone https://github.com/your-repo/flucto.git
   cd flucto
   npm install
   ```

2. **바이너리 자동 설정**
   ```bash
   npm run postinstall
   ```

3. **개발 서버 실행**
   ```bash
   npm run dev
   ```

## 📦 빌드 및 패키징

운영체제별 실행 파일(Installer)을 생성합니다.

```bash
# Windows (exe)
npm run dist

# macOS (dmg)
npm run dist

# Linux (AppImage)
npm run dist
```

> **중요**: 빌드 전 `bin/` 폴더에 필수 바이너리가 포함되어 있는지 확인하세요.

## 🏗 아키텍처 및 원칙

본 프로젝트는 다음 소프트웨어 엔지니어링 원칙을 준수하여 작성되었습니다.

- **SOLID**: 단일 책임 원칙(SRP)을 준수한 컴포넌트 및 Hook 분리 (`useDownloadMonitor`)
- **DRY**: 중복 로직 제거 및 유틸리티화 (`createYtDlpArgs`)
- **KISS**: 직관적인 UX와 명확한 코드 구조 유지
- **Operational Excellence**: Winston 기반의 구조화된 로깅 및 시스템 헬스 체크

### 프로젝트 구조

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

## 🔧 설정

### 환경 변수

루트 디렉토리에 `.env` 파일 생성:

```env
# Development Settings
NODE_ENV=development

# Download Settings
DEFAULT_DOWNLOAD_DIR=           # Custom download directory
ALLOW_4K=false                # Enable 4K downloads

# Logging Settings
LOG_LEVEL=debug                # Logging verbosity
```

### 바이너리 설정

애플리케이션은 필수 바이너리를 자동으로 감지하고 검증합니다:

- `yt-dlp`: YouTube 다운로드 핵심 기능
- `ffmpeg`: 오디오/비디오 처리 및 포맷 변환

바이너리는 프로덕션 빌드 시 자동으로 포함됩니다.

## 🎨 디자인 시스템

### 컬러 팔레트
- **Primary**: Blue gradient (`#3B82F6` to `#8B5CF6`)
- **Background**: Deep dark (`#0D0D0D`)
- **Surface**: Glass morphism with backdrop blur
- **Text**: White with gray variants

### 타이포그래피
- **Headings**: Bold, tight tracking, large scale
- **Body**: System font stack, light weight
- **UI**: Medium weight, optimized legibility

### 애니메이션
- **Page Load**: Smooth fade-up with easing
- **Interactions**: Subtle scale and color transitions
- **Layout**: AnimatedPresence for smooth enter/exit

## 🔒 보안 및 개인정보

- **No Tracking**: 분석이나 원격 측정 없음
- **Local Processing**: 모든 작업이 로컬에서 수행됨
- **Secure Downloads**: 검증된 바이너리 의존성
- **Privacy Focused**: 데이터 수집이나 공유 없음

## 🐛 문제 해결

### 일반적인 문제

1. **"Missing required binaries"**
   - `npm run postinstall` 실행하여 바이너리 재설치
   - FFmpeg이 시스템 PATH에 있는지 확인

2. **"Download failed"**
   - YouTube URL이 올바른지 확인
   - 인터넷 연결 상태 확인
   - 다른 비디오 포맷으로 시도

3. **성능 문제**
   - 대역폭을 사용하는 다른 애플리케이션 닫기
   - 동시 다운로드 수 줄이기
   - 사용 가능한 디스크 공간 확인

### 로그

애플리케이션 로그는 다음 위치에 저장됩니다:
- **Windows**: `%APPDATA%/flucto/logs/`
- **macOS**: `~/Library/Logs/flucto/`
- **Linux**: `~/.config/flucto/logs/`

## 🤝 기여

1. 레포지토리 포크
2. 기능 브랜치 생성 (`git checkout -b feature/amazing-feature`)
3. 변경사항 커밋 (`git commit -m 'Add amazing feature'`)
4. 브랜치에 푸시 (`git push origin feature/amazing-feature`)
5. Pull Request 열기

### 개발 가이드라인
- TypeScript 최적 사례 준수
- WCAG 2.1 AA 준수 유지
- 모든 지원 플랫폼에서 테스트
- 새로운 기능에 대한 문서 업데이트

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 라이선스가 부여됩니다 - [LICENSE](LICENSE) 파일을 참조하세요.

## 🙏 감사의 말

- **yt-dlp** - 강력한 YouTube 다운로더
- **FFmpeg** - 멀티미디어 처리
- **Electron** - 크로스 플랫폼 데스크톱 프레임워크
- **React** - UI 라이브러리
- **Tailwind CSS** - 유틸리티 우선 CSS 프레임워크
- **Framer Motion** - 프로덕션 준비 모션 라이브러리

## 📞 지원

- 📧 이메일: support@flucto.app
- 🐛 이슈: [GitHub Issues](https://github.com/your-username/flucto-downloader/issues)
- 📖 문서: [Wiki](https://github.com/your-username/flucto-downloader/wiki)

---

**Made with ❤️ by the Flucto Team**
