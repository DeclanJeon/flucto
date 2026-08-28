# Flucto 작업지시서 (2026-08)

> 설계 근거: [docs/improvement-design-2026-08.md](./improvement-design-2026-08.md)
> 각 작업은 독립 브랜치 + PR 단위. 커밋 컨벤션은 [COMMIT_CONVENTIONS.md](../COMMIT_CONVENTIONS.md) 준수.
> 공통 검증: `npm run lint && npm test && npm run build` — 이것이 통과하지 못하면 리뷰 요청 금지.

## 구현 상태 (2026-08-29 업데이트)

| 작업 | 상태 | 비고 |
|------|------|------|
| 1. 데스크탑 yt-dlp 자동 갱신 | ✅ 구현 완료 | `binaryRefresh.ts` 신규, `getBinaryPath` 마커 우선, `tests/binaryRefresh.test.mjs` 6건 |
| 2. CLI npm 배포 | ✅ 코드 완료 / npm publish 활성화는 운영 작업 | `private:false` + `files` + `prepack`, postinstall 소프트 폴백, 첫 실행 자동 프로비저닝, `NPM_TOKEN` 시크릿 등록 필요 |
| 3. 데스크탑 쿠키/프록시 설정 | ✅ 구현 완료 | `TranscriptNetworkSettings` 타입, `pick-cookies-file` IPC, TranscriptSettings 고급 섹션 |
| 4. 언어 폴백 팬아웃 제한 | ✅ 구현 완료 | 후보 3개 상한 + RATE_LIMITED 조기 중단 + 시도 언어 메시지 |
| 5. 마크다운 저장 중복 제거 | ✅ 구현 완료 | `markdownFile.ts` 단일 구현 (transcriptMarkdown에서 re-export 유지) |
| 6. 잔여 결함 정리 | ✅ 구현 완료 | pending/extracting 진행, 렌더러 try/catch, 언어 유효성 힌트(연동 선택), 배치 요약 반환 |
| 7. CLI 업데이터 실질화 | ✅ 구현 완료 | npm 모드 자동 적용, source 모드 git 안내, `installMode` 표시 |

남은 운영 작업: npm 토큰 발급·시크릿 등록 후 실배포 검증.
lint 잔여 오류는 2026-08-29에 전부 해결 (`npm run lint` 0 문제, `dist-electron`/`release` 빌드 산출물은 eslint 제외로 변경).

---

## 작업 1: 데스크탑 앱 yt-dlp 자동 갱신

| 항목 | 내용 |
|------|------|
| 우선순위 | **P0** |
| 분기명 | `feat/desktop-binary-refresh` |
| 커밋 타입 | `feat(main)` |
| 담당 | (지정) |
| 예상 규모 | 1~2일 |

### 목표
패키지 데스크탑 앱에서 yt-dlp가 24시간 주기로 자가 갱신되어 YouTube 추출기 변화에 대응한다.

### 배경
`setupUtilities`는 바이너리 부재 시에만 호출됨(`src/main/index.ts:192` 유일 호출 지점). 설치 폴더 `Resources/bin/yt-dlp`는 릴리스 시점에 고정되어, 시간이 지나면 YouTube→MD가 깨져도 스스로 회복 불가.

### 구현 단계

1. **`src/main/services/binaryRefresh.ts` 신규 작성**
   - `checkAndRefreshBinaries(options?: { binDir?: string; now?: number }): Promise<BinaryRefreshResult>`
   - 재사용: `getManagedBinDir`(`binaryInstaller.ts:71`), `fetchLatestYtDlpVersion`(`binaryInstaller.ts:138`), `provisionUtility`, `versionFor`, `normalizeYtDlpVersion` — `binaryInstaller.ts`에서 export 해서 사용 (미export 항목은 export 추가).
   - 마커 파일 `<binDir>/managed.json`: `{ managed: ["yt-dlp"], ytDlpVersion: string, lastCheckedAt: ISO string, updatedAt: ISO string }`
   - 분기: `lastCheckedAt` 24시간 미경과 → 즉시 반환 / 로컬 `--version` == GitHub latest → 마커만 갱신 / 상이 → 다운로드 후 마커 갱신.
   - **모든 예외를 내부에서 삼키고** `BinaryRefreshResult { refreshed: boolean; skipped: boolean; version: string | null; error?: string }` 반환. 이 모듈은 throw하지 않는다.
2. **`src/main/utils.ts` `getBinaryPath` 수정**
   - `'yt-dlp'` 조회 시: 관리 디렉터리에 `managed.json`이 있고 관리 디렉터리 yt-dlp가 실행 가능하면 → 기존 후보 목록보다 우선 반환.
   - ffmpeg 및 마커 부재 시 기존 동작 유지. `managed.json` 파싱 실패는 무시(폴백).
3. **`src/main/index.ts` 배선**
   - `checkSystemHealth()` 성공 경로에서 `checkAndRefreshBinaries().then(r => logger.info(...)).catch(() => {})` — await 금지(기동 지연 방지).
4. **테스트 `tests/binaryRefresh.test.mjs` 신규**
   - 마커 스로틀 동작(now 주입으로 24h 경과/미경과), 로컬=latest 스킵, stale 시 갱신 호출 순서, 마커 파싱 실패 폴백. GitHub fetch는 모듈 의존성 주입 또는 global fetch 스터브.
   - 기존 `tests/electron-stub-loader.mjs` 경계 유지 — binaryRefresh는 electron import 금지.

### 완료 기준 (Acceptance)
- [ ] 바이너리가 존재하는 상태에서 앱 기동 시, GitHub latest와 다르면 관리 디렉터리에 새 yt-dlp가 다운로드되고 `managed.json`이 갱신된다.
- [ ] 갱신 후 `getBinaryPath('yt-dlp')`가 관리 디렉터리 경로를 반환한다.
- [ ] GitHub API 실패·다운로드 실패 시 앱이 정상 기동되고 에러 로그만 남는다.
- [ ] 24시간 내 재기동 시 GitHub API를 호출하지 않는다.
- [ ] `npm test` 전부 통과.

### 검증 방법
1. `FLUCTO_BIN_DIR=/tmp/flucto-test-bin` 환경에서 dev 실행, 마커의 `lastCheckedAt`을 임의로 과거로 조작 → 기동 후 갱신 로그 확인.
2. `dist:linux` AppImage를 빌드해 인터넷 연결 상태에서 기동, `~/.local/share/flucto/bin` 확인.

---

## 작업 2: CLI npm 배포 가능화

| 항목 | 내용 |
|------|------|
| 우선순위 | **P0** |
| 분기명 | `feat/npm-cli-distribution` |
| 커밋 타입 | `feat(cli)` / `build:` 혼합 |
| 예상 규모 | 1~2일 (+운영 작업 별도) |

### 목표
`npm i -g flucto && flucto transcript <URL>`이 동작한다. 설치 시 100MB 바이너리 다운로드를 강제하지 않는다.

### 구현 단계

1. **`package.json`**
   - `"private": false`
   - `"files": ["dist-electron/", "README.md", "CHANGELOG.md"]`
   - `"prepack": "npm run build:electron"`
   - `yt-dlp-exec` 삭제. `react`, `react-dom`, `react-hook-form`, `react-router-dom`, `framer-motion`, `lucide-react`, `tailwind-merge`, `clsx`, `@tailwindcss/postcss`, `@supabase/supabase-js`, `dotenv` → devDependencies 이동.
   - 유지: `adm-zip`(binaryInstaller), `electron-store`, `electron-updater`(데스크탑 런타임), `axios`(postinstall). `execa`는 `src/main/spawn.ts` 확인 후 미사용이면 제거.
   - `npm pack --dry-run`으로 tarball 검수: `dist-electron/cli/**` 포함, 렌더러 소스 미포함 확인.
2. **`scripts/setup-binaries.mjs` 소프트 폴백**
   - 최종 catch에서 `process.exit(1)` 제거 → warn + `flucto setup` 안내 후 정상 종료.
   - `process.env.CI === 'true'` 또는 `FLUCTO_SKIP_BINARIES=1`이면 다운로드 자체를 스킵.
   - 데스크탑 빌드 워크플로우는 env 미설정(기본 다운로드 수행)임을 확인.
3. **CLI 첫 실행 자동 프로비저닝 (`src/cli/index.ts`)**
   - 명령 실행 전 바이너리 확인 실패 시 `setupUtilities({ onStatus })` 실행 후 재확인 → 재실패 시 기존 에러 출력에 `run: flucto setup` 문구 추가.
   - `setup` 명령에 `--yt-dlp-only` 플래그 추가(ffmpeg 생략 — YouTube→MD 전용 유저).
4. **릴리스 배선**
   - `.github/workflows/release.yml` Semantic Release step env에 `NPM_TOKEN: ${{ secrets.NPM_TOKEN }}` 추가.
   - **운영 작업(코드 외)**: npm 계정/토큰 발급, 저장소 시크릿 등록, 2FA 설정. 첫 publish는 수동 검증 후 활성화.

### 완료 기준
- [ ] `npm pack --dry-run` 결과 tarball에 `dist-electron/cli/index.js`가 포함된다.
- [ ] tarball에서 `npm i -g <tarball>` 후 `flucto --help`가 동작한다(바이너리 다운로드 없이).
- [ ] `flucto transcript <URL>` 첫 실행에서 yt-dlp가 자동 다운로드되고 변환 성공한다.
- [ ] 네트워크 차단 환경에서 `npm i -g <tarball>`이 실패하지 않는다(exit 0, 경고 출력).
- [ ] `npm run dist:linux`가 여전히 정상 빌드된다(의존성 이동 회귀 확인).
- [ ] `npm test` 통과 (`tests/cli.test.mjs` 포함).

### 검증 방법
1. `npm pack && npm i -g ./flucto-*.tgz && flucto transcript "https://www.youtube.com/watch?v=dQw4w9WgXcQ"`
2. `FLUCTO_SKIP_BINARIES=1 npm i -g ./flucto-*.tgz` — 경고만 출력하고 성공.

---

## 작업 3: 데스크탑 쿠키/프록시 설정 UI

| 항목 | 내용 |
|------|------|
| 우선순위 | **P1** |
| 분기명 | `feat/desktop-network-settings` |
| 커밋 타입 | `feat(renderer)` + `feat(main)` |
| 예상 규모 | 1일 |

### 목표
YouTube bot-check 상황에서 데스크탑 유저가 cookies.txt/프록시를 지정해 우회할 수 있다. CLI(`cli/index.ts:74-79`)와 동등한 수준의 우회 수단 제공.

### 구현 단계

1. **타입** (`src/shared/types.ts`)
   - `TranscriptNetworkSettings { cookiesPath: string | null; cookiesFromBrowser: string | null; proxy: string | null; impersonate: string | null }`
   - `TranscriptSettings.network: TranscriptNetworkSettings | null` 추가.
2. **설정 검증** (`src/main/services/settingsDefaults.ts`)
   - `defaultTranscriptSettings`에 `network: null`. `isTranscriptSettings`에 network 필드 검증 추가. `getStoredTranscriptSettings`의 정규화가 신규 필드를 보존하는지 확인.
3. **배선** (`src/main/transcript/transcriptHandlers.ts`)
   - deps에 `network: resolveCaptionNetworkOptions(stored.network ?? {})` 추가 — `captionNetwork.ts:29-58`의 병합 로직 재사용(UI 값 우선, env 폴백). `transcriptMarkdown.ts`의 deps 전달 경로 확인(이미 `network` 필드 존재, `transcriptMarkdown.ts:17,106`).
4. **IPC** (`src/main/handlers.ts` + `src/preload/index.ts`)
   - `pick-cookies-file` 핸들러: `dialog.showOpenDialog` 확장자 `.txt`, 단일 선택, 경로 반환.
   - preload에 `pickCookiesFile(): Promise<string | null>` 노출.
5. **UI** (`src/renderer/src/components/TranscriptSettings.tsx`)
   - "고급 네트워크" 접이식 섹션: [파일 선택] 버튼(선택 시 경로 표시 + 지우기), 브라우저 드롭다운(미설정/chrome/firefox/edge/brave...), 프록시 입력, impersonate 입력(선택).
   - 힌트 문구: "브라우저 직접 추출은 플랫폼에 따라 실패할 수 있습니다. cookies.txt 사용을 권장합니다."
6. **테스트**: `isTranscriptSettings` 신규 필드 검증 케이스를 기존 테스트에 추가.

### 완료 기준
- [ ] 설정에 cookies.txt를 지정하면 자막 추출 시 yt-dlp에 `--cookies`가 전달된다(로그로 확인).
- [ ] 설정 해제(null) 시 기존 env 폴백 동작이 그대로 유지된다.
- [ ] 프록시 지정 변환이 `RATE_LIMITED` 회피로 이어지는 실제 케이스 1건 검증.
- [ ] 기존 `npm test` 통과.

---

## 작업 4: 자막 언어 폴백 팬아웃 제한

| 항목 | 내용 |
|------|------|
| 우선순위 | **P1** |
| 분기명 | `fix/caption-fallback-fanout` |
| 커밋 타입 | `fix(transcript)` |
| 예상 규모 | 0.5일 |

### 목표
요청 언어 자막 부재 시 yt-dlp 재호출이 최대 3회로 제한되고, rate-limit 중에는 언어를 순회하지 않는다.

### 구현 단계
1. **`src/main/transcript/captionExtractor.ts`**
   - `resolveCaptionLanguageCandidates`(`:111-144`)가 반환하는 폴백 후보를 실존 트랙 기준 최대 3개로 절단 (요청 → 기반 → `-orig` → 첫 수동 → 첫 자동 순 유지).
2. **rate-limit 조기 중단**
   - 언어별 다운로드 루프(`:460-494` 부근)에서 재시도 소진 후에도 `RATE_LIMITED`면 `break`가 아니라 **전체 루프 탈출 후 실패 반환** (현재는 다음 언어로 continue).
3. **실패 메시지 개선**
   - 모든 후보 실패 시 `message`에 시도한 언어 목록과 마지막 오류 코드를 포함.
4. **테스트** (`tests/transcript.test.mjs` 확장)
   - 후보 절단 케이스(수동+자동 다수 존재), RATE_LIMITED 조기 탈출 케이스.

### 완료 기준
- [ ] 20개 자막 트랙이 있는 영상에서 요청 언어 부재 시 yt-dlp 호출이 3회를 초과하지 않는다.
- [ ] RATE_LIMITED 발생 시 즉시 실패 반환(추가 호출 없음).
- [ ] 기존 정상 경로(요청 언어 존재) 동작 불변.

---

## 작업 5: 마크다운 저장 로직 중복 제거

| 항목 | 내용 |
|------|------|
| 우선순위 | **P2** |
| 분기명 | `refactor/markdown-file-save` |
| 커밋 타입 | `refactor(main)` |
| 예상 규모 | 0.5일 |

### 구현 단계
1. `src/main/services/markdownFile.ts` 신규 — `transcriptMarkdown.ts:67-83`의 `saveMarkdownFile`(wx 플래그 + 충돌 접미사)을 이동, 양쪽(`transcriptMarkdown.ts`, `markdownPipeline.ts:104-120`)이 import.
2. 저장 동작 불변 확인: 파일명 패턴 `제목_YYYYMMDD.md`, 충돌 시 `-2`~`-1001` 접미사.
3. `tests/transcript.test.mjs`에 파일 저장 단위 테스트 보강(충돌 접미사 케이스).

### 완료 기준
- [ ] `saveMarkdownFile`의 구현이 저장소에 1곳만 존재한다(`grep -rn "wx" src/main/services/`).
- [ ] 데스크탑/CLI 모두 파일 저장 동작 불변, 전 테스트 통과.

### 비고
CLI `md`와 데스크탑의 **포맷** 통일은 설계 문서 WP-5 2단계(별도 이슈)로 유보 — 본 작업에서 착수하지 않는다.

---

## 작업 6: 잔여 결함 정리

| 항목 | 내용 |
|------|------|
| 우선순위 | **P2** |
| 분기명 | `fix/transcript-polish` |
| 커밋 타입 | `fix(main)` / `fix(renderer)` |
| 예상 규모 | 1일 |

### 구현 단계 (각각 독립 커밋)
1. **진행 단계 발행** (`src/main/services/transcriptMarkdown.ts`)
   - 메타데이터 조회 완료 후 `extracting(40)` 발행, 대기 진입 시 `pending(5)` 발행. `shared/types.ts:64`의 상태 enum과 `cli/output.ts:188`의 표시가 이미 준비돼 있음.
2. **렌더러 예외 방어** (`src/renderer/src/components/MainDownloader.tsx`)
   - `handleIndividualDownload`(`:419-439`), `handleTranscriptSettingsChange`에 try/catch + 사용자 표시.
3. **언어 유효성 연동**
   - `TranscriptSettings.tsx`에서 언어 선택 시 `getTranscriptLanguages`(프리로드 `index.ts:43`, 미사용 중)를 호출해 해당 URL에 언어가 존재하는지 표시. URL 입력란과 연동이 부자연스러우면 대신 preload/핸들러 쌍을 제거(둘 중 하나는 반드시 수행 — 죽은 코드 방치 금지).
4. **메타데이터 헤더 언어** (`src/main/transcript/markdownFormatter.ts:68-89`)
   - 한국어 하드코딩 라벨(채널/길이/추출일)을 영어(Channel/Duration/Extracted)로 변경. `settings.language === 'ko'`일 때만 한국어 유지.
5. **배치 요약 반환** (`transcriptHandlers.ts:71-84`)
   - `convertMultipleTranscriptsToMarkdown`의 성공/실패 개수를 반환하고, 프리로드 타입과 `MainDownloader.tsx:379-392`의 소비부를 함께 갱신.

### 완료 기준
- [ ] 변환 중 5% → 40% → 75% 진행이 실제로 표시된다.
- [ ] IPC 예외 시 렌더러가 사용자 피드백을 표시한다(콘솔 unhandled rejection 없음).
- [ ] `get-transcript-languages`는 연동되거나 제거된다(중간 상태 없음).
- [ ] 전 테스트 통과, `npm run lint` 경고 0.

---

## 작업 7: CLI 업데이터 실질화

| 항목 | 내용 |
|------|------|
| 우선순위 | **P2** (작업 2의 npm 배포 활성화가 전제) |
| 분기명 | `feat/cli-updater-apply` |
| 커밋 타입 | `feat(cli)` |
| 예상 규모 | 0.5일 |

### 구현 단계
1. `src/main/services/platformAssets.ts` — `detectInstallMode`의 `npm` 모드에 자산 클래스 추가 없이, `cliUpdater.ts`의 apply 분기 확장:
   - `npm` 모드: `npm install -g flucto@latest`를 `spawn`으로 실행(진행 상황 스트리밍), 실패 시 명령어 안내.
   - `source` 모드: `git pull && npm install && npm run build:electron` 안내 문구 출력(자동 실행 없음).
   - `appimage/dmg/exe` 모드는 기존 동작(데스크탑 업데이트 안내) 유지.
2. `flucto update check`에 "현재 설치 모드" 표시 추가.

### 완료 기준
- [ ] npm 글로벌 설치 환경에서 `flucto update apply`가 실제 버전 갱신을 수행한다(또는 명확한 안내를 출력한다).
- [ ] 소스 설치 환경에서 갱신 안내가 출력된다.
- [ ] `tests/cli.test.mjs`에 모드별 분기 테스트 추가.

---

## 실행 순서 제안

```
1주차: 작업 1 (yt-dlp 자동 갱신) ── 데스크탑 신뢰성 최우선
       작업 2 (npm 배포)        ── 병행 가능, 운영 작업(NPM_TOKEN) 조기 착수
2주차: 작업 3 (네트워크 설정 UI)
       작업 4 (폴백 팬아웃)
3주차: 작업 5, 6, 7             ── 리팩터링/마무리
       npm publish 활성화 + 실배포 검증
```

## PR 리뷰 체크리스트 (공통)
- [ ] `src/cli`에서 도달 가능한 신규/수정 모듈에 electron import가 없는가
- [ ] 네트워크 작업 실패가 기동/설치/기존 기능을 막지 않는가
- [ ] 신규 동작에 대응하는 테스트가 `tests/*.test.mjs`에 추가됐는가
- [ ] `npm run lint && npm test && npm run build` 통과하는가
