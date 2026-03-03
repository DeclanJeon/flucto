# [1.1.0](https://github.com/DeclanJeon/flucto/compare/v1.0.12...v1.1.0) (2026-03-03)


### Bug Fixes

* add missing handlers.js import in index.ts ([5ca4a3e](https://github.com/DeclanJeon/flucto/commit/5ca4a3e69e496593df17884f56bc426676d29184))
* API guard 추가 및 브라우저 환경 호환성 개선 ([a4578b7](https://github.com/DeclanJeon/flucto/commit/a4578b740c2a0dabfb0275cec144eae0cc13b3aa))
* App.tsx 구문 에러 수정 (Routes 래핑터링) ([45f49c8](https://github.com/DeclanJeon/flucto/commit/45f49c854578c905372fcef0f2214c3b7c746278))
* correct API path in renderer components ([34c6bfc](https://github.com/DeclanJeon/flucto/commit/34c6bfc8672974f1054a733e4f7fe375b2af2cba))
* improve error logging in handlers ([7ccb4d8](https://github.com/DeclanJeon/flucto/commit/7ccb4d8c4b1fa7198ec95965ea49cec42211ea88))
* LSP 에러 수정 (useCallback, 접근성 개선) ([38ab51b](https://github.com/DeclanJeon/flucto/commit/38ab51b74bb1c2a4ba7a4aa8520e876cd268d8da))
* macOS 릴리즈 빌드에서 pnpm 경로 보장 ([b02fbaf](https://github.com/DeclanJeon/flucto/commit/b02fbaf51ac84ea89fd01f39ec5b7cc86238cfd5))
* MainDownloader 리뷰 버튼 라우팅 수정 (/posts → /reviews) ([7c35b5f](https://github.com/DeclanJeon/flucto/commit/7c35b5f9d60a43db059bda0861d051c0fdedb272))
* remove corrupted line ID tags from source files ([b138d63](https://github.com/DeclanJeon/flucto/commit/b138d63d65690cf2ae3532c1f739101310c998ad))
* 리뷰 작성/삭제 권한과 postId 처리 보강 ([63c7203](https://github.com/DeclanJeon/flucto/commit/63c72035930ce68e17076f52a71336ed0ccc4811))
* 리뷰 화면에서 프로필 이미지 출력 제거 ([51b40ac](https://github.com/DeclanJeon/flucto/commit/51b40acabc01455cdb598113a6331c562ebb07e8))
* 입력 필드 텍스트 입력 문제 해결 ([8306236](https://github.com/DeclanJeon/flucto/commit/83062366a405c5e25af921cdba9c708dc60effdf))


### Features

* implement post/review system with routing ([de4070d](https://github.com/DeclanJeon/flucto/commit/de4070d50d23b9cb65c5abc75efa313ecbfc032d))
* integrate Supabase database ([b05f6a7](https://github.com/DeclanJeon/flucto/commit/b05f6a78fba76f4af0a14fe9b391afb8ba1d0f54))
* translate review UI to Korean ([488e3b2](https://github.com/DeclanJeon/flucto/commit/488e3b2a542fe70cb238103e288938aa950c69b9))

## [1.0.12](https://github.com/DeclanJeon/flucto/compare/v1.0.11...v1.0.12) (2026-03-02)


### Bug Fixes

* App.tsx 파일 손상 복구 ([db4f23e](https://github.com/DeclanJeon/flucto/commit/db4f23e46d45fd841ca928258d3803f24e0302c9))
* CI에서 npm ci 대신 npm install 사용 ([7e1d02d](https://github.com/DeclanJeon/flucto/commit/7e1d02d10169f12200aca1316bf57b16023f3fcd))
* electron을 devDependencies로 이동 및 author 필드 추가 ([c134681](https://github.com/DeclanJeon/flucto/commit/c13468112c2f88c2cfe2940152828ceeec2cd052))
* main/preload index.ts 파일 손상 복구 ([ebc5ee1](https://github.com/DeclanJeon/flucto/commit/ebc5ee1cb4802c5db290f95091b9f3c9c610b907))
* package.json 의존성 수정 - electron을 devDependencies로 이동 ([3db5037](https://github.com/DeclanJeon/flucto/commit/3db503706a2257de6443e0440759fc75f93783c0))
* YouTube 403 오류 해결 및 쿠키 지원 추가 ([d4383a7](https://github.com/DeclanJeon/flucto/commit/d4383a7e895780b8219562e83590d03153a71314))

## [1.0.11](https://github.com/DeclanJeon/flucto/compare/v1.0.10...v1.0.11) (2026-01-23)


### Bug Fixes

* **main:** remove restrict-filenames and enforce utf-8 encoding ([f1ead06](https://github.com/DeclanJeon/flucto/commit/f1ead0617e83c4b3e67fb13f1496b4eef1d2ec56))

## [1.0.10](https://github.com/DeclanJeon/flucto/compare/v1.0.9...v1.0.10) (2026-01-23)


### Bug Fixes

* **main:** resolve yt-dlp 403 error and filename encoding ([cfeec85](https://github.com/DeclanJeon/flucto/commit/cfeec85d2d61e28dcc799531b8fdaba15158944c))

## [1.0.9](https://github.com/DeclanJeon/flucto/compare/v1.0.8...v1.0.9) (2026-01-23)


### Bug Fixes

* **build:** include bin directory in package ([880b815](https://github.com/DeclanJeon/flucto/commit/880b8153a32275ec790f40576a4dd4c6c516c82d))

## [1.0.8](https://github.com/DeclanJeon/flucto/compare/v1.0.7...v1.0.8) (2026-01-23)


### Bug Fixes

* re-trigger release build ([c63d529](https://github.com/DeclanJeon/flucto/commit/c63d52971c8446423b805a48050bd555369dbfdc))

## [1.0.4](https://github.com/DeclanJeon/flucto/compare/v1.0.3...v1.0.4) (2026-01-10)


### Bug Fixes

* add extraResources to include binaries in electron build ([662844e](https://github.com/DeclanJeon/flucto/commit/662844e67f94731e8b88c78d7b37e37849af64cd))

## [1.0.3](https://github.com/DeclanJeon/flucto/compare/v1.0.2...v1.0.3) (2026-01-10)


### Bug Fixes

* CI 빌드 에러 수정 - package-lock.json gitignore 제거 및 추가 ([9ee905b](https://github.com/DeclanJeon/flucto/commit/9ee905b27c63d8fd0c1f5db823e03cb7b0a2f850))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
