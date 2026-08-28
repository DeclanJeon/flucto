# Flucto 개선 설계 문서 (2026-08)

> 작성일: 2026-08-28 · 기준 버전: v1.14.0 (commit `4c26dba`)
> 검토 범위: YouTube→Markdown 파이프라인, CLI/데스크탑 분리, 바이너리 라이프사이클, 배포 체계
> 실행 문서: [docs/work-orders-2026-08.md](./work-orders-2026-08.md)

---

## 1. 배경 및 현황 진단

### 1.1 확인된 사실 (근거 요약)

| # | 사실 | 근거 |
|---|------|------|
| A | 패키지 데스크탑 앱에서 `setupUtilities`는 바이너리가 **없을 때만** 호출됨 → 설치 폴더의 yt-dlp가 평생 갱신되지 않음 | `src/main/index.ts:192`가 유일한 호출 지점 |
| B | CLI 런타임은 electron/electron-store/electron-updater에 도달하지 않음 (전 임포트 그래프 추적 완료) | `src/cli/index.ts:24-36` |
| C | npm 배포 불가: `private: true`, `files` 필드 없음, `dist-electron/`는 gitignore된 빌드产物 | `package.json:5,13-16`, `.gitignore:16` |
| D | postinstall이 yt-dlp+ffmpeg 약 100MB를 강제 다운로드, 실패 시 exit 1 → global install이 죽음 | `scripts/setup-binaries.mjs:285-288` |
| E | 렌더러 전용 의존성(react, framer-motion, tailwind 등)이 `dependencies`에 존재, `yt-dlp-exec`은 임포트 없는 죽은 의존성 | `package.json` dependencies |
| F | 데스크탑은 자막 추출 시 network 옵션(쿠키/프록시)을 전달하지 않음 → bot-check 시 대응 불가 | `src/main/transcript/transcriptHandlers.ts:51-58` |
| G | 요청 언어 자막 부재 시 모든 수동+자동 트랙을 순회하며 yt-dlp 반복 호출 | `src/main/transcript/captionExtractor.ts:111-144` |
| H | CLI `md` 명령과 데스크탑이 서로 다른 마크다운 포맷터 사용, `saveMarkdownFile`이 2곳에 복제 | `src/main/services/markdownPipeline.ts:104-120` vs `transcriptMarkdown.ts:67-83` |
| I | `pending`/`extracting` 진행 단계가 선언만 되고 발행되지 않음 (10%→75% 사이 무표시) | `src/shared/types.ts:64`, `transcriptMarkdown.ts` |
| J | CLI 자체 업데이터는 데스크탑 인스톨러만 가리키며 `applied: false`만 반환 | `src/main/services/cliUpdater.ts:146-151` |
| K | 데스크탑 인스톨러가 CLI 코드를 asar에 싣지만 실행 명령으로 노출하지 않음 | `electron-builder.json5:11-15` |
| L | `get-transcript-languages`는 프리로드에 노출됐으나 렌더러가 호출하지 않음 | `src/preload/index.ts:43` |

### 1.2 개선 목표

1. **신뢰성**: 데스크탑 앱의 YouTube→MD가 yt-dlp 추출기 변화에 자가 치유되어야 한다.
2. **배포**: `npm i -g flucto` 한 줄로 CLI-only 사용자가 설치·사용·갱신까지 완결해야 한다.
3. **동등성**: CLI가 제공하는 우회 수단(쿠키/프록시)을 데스크탑 UI로도 제공한다.
4. **정합성**: CLI와 데스크탑이 같은 기능에 대해 같은 코드 경로와 같은 결과물을 제공한다.

### 1.3 설계 원칙

- **기존 코드 최대 재사용**: 갱신 로직(`binaryInstaller.ts:273-299`), 네트워크 옵션(`captionNetwork.ts`), on-demand 설치(`flucto setup`)은 이미 구현돼 있다. 새 로직보다 배선이 본 작업이다.
- **CLI의 electron 무결성 유지**: `src/cli`에서 도달 가능한 모듈은 electron import 금지. `tests/electron-stub-loader.mjs`가 이 경계를 검증하므로, 신규 테스트에서도 이 구조를 유지한다.
- **소프트 폴백**: 네트워크 작업(갱신, 다운로드)의 실패가 앱 기동/설치/기존 기능을 절대 막지 않도록 한다.

---

## 2. 작업 스트림(WP) 설계

### WP-1. 데스크탑 앱 yt-dlp 자동 갱신 (P0)

#### 문제
yt-dlp는 YouTube UI/서명 변화에 수 주 단위로 대응 릴리스를 내는 소프트웨어다. 패키지 앱의 `Resources/bin/yt-dlp`는 릴리스 시점에 고정되고, 갱신 코드(`binaryInstaller.ts`의 staleness 비교)는 바이너리가 **부재**할 때만 실행되므로 사실상 사코드다. 앱 재설치 전까지 YouTube→MD 성공률이 시간에 비례해 하락한다.

#### 핵심 설계 과제: "어디에 갱신하고, 어떻게 그게 쓰이게 만들 것인가"

패키지 앱에서 `getBinaryPath`(`src/main/utils.ts:17-37`)는 후보를 `process.resourcesPath/bin` → `app/bin` → `app.asar.unpacked/bin` → `appPath/bin` → 관리 디렉터리(`getManagedBinDir`) 순으로 탐색한다. 설치 폴더의 바이너리가 존재하는 한 관리 디렉터리는 도달하지 못한다. 갱신 바이너리를 관리 디렉터리에 내려도 **설치 폴더 바이너리가 항상 이긴다**는 문제가 남는다.

#### 설계: 관리 디렉터리 선호 마커 + 기동 시 비동기 갱신

1. **신규 모듈 `src/main/services/binaryRefresh.ts`**
   - `checkAndRefreshBinaries(options): Promise<BinaryRefreshResult>`
   - 동작: 관리 디렉터리(`getManagedBinDir()`)의 yt-dlp `--version`과 GitHub latest(`fetchLatestYtDlpVersion` 재사용) 비교 → 불일치 시 관리 디렉터리에 다운로드 → 성공 시 마커 파일 기록.
   - 마커: `<managedBinDir>/managed.json` — `{ "managed": ["yt-dlp"], "ytDlpVersion": "2026.08.20", "updatedAt": ISO }`
   - 실패 시에도 앱은 계속 기동되며 로그만 남긴다(`onStatus` → `logger.info`).
   - 스로틀: 마커의 `lastCheckedAt` 기준 24시간 미경과 시 GitHub API 호출 자체를 생략(오프라인/레이트리밋 대응). `UpdateSettings.checkInterval`을 재사용하지 않고 독립 상수로 시작(바이너리 갱신 주기와 앱 업데이트 주기는 성격이 다름).

2. **`getBinaryPath` 해상도 변경 (`src/main/utils.ts`)**
   - yt-dlp에 한해: 관리 디렉터리에 `managed.json` 마커가 있고 yt-dlp가 존재하면 → 설치 폴더 후보보다 **우선** 반환.
   - ffmpeg는 갱신 대상이 아니므로 기존 순서 유지.
   - 이로써 "설치 폴더는 초기 폴백, 관리 디렉터리는 살아있는 최신본" 계층이 성립한다.

3. **기동 배선 (`src/main/index.ts`)**
   - `checkSystemHealth()` 통과 후(즉, 바이너리가 존재할 때만) `checkAndRefreshBinaries()`를 **await 하지 않고** 실행. 창이 뜬 뒤 백그라운드로 갱신된다.
   - 기존 수리 분기(`index.ts:187-210`)는 그대로 유지 — 존재하지 않을 때의 경로와 존재하지만 낡을 때의 경로가 분리된다.

4. **관찰성**
   - 갱신 성공/실패를 `logger`로 기록하고, 성공 시 렌더러에 `binaries:refreshed` 이벤트(신규 IPC, preload 노출)를 보내 선택적으로 토스트 표시. v1에서는 로그만으로 충분하다.

#### 데이터 흐름

```
app ready → health ok → checkAndRefreshBinaries() (fire-and-forget)
  ├─ managed.json.lastCheckedAt < 24h? → skip
  ├─ local yt-dlp --version == GitHub latest? → touch marker, done
  └─ stale → download to managedBinDir → chmod → managed.json 갱신
                                          ↓
다음 getBinaryPath('yt-dlp') 호출부터 관리 디렉터리 우선 반환 (마커 존재 시)
```

#### 트레이드오프
- GitHub API 미호출 판정이 24h 스로틀 하나뿐 → 서버 부하 미미, 실패해도 다음 기동에 재시도되므로 충분.
- 설치 폴더 yt-dlp를 삭제하지 않는다(권한/서명 문제 회피). 다만 디스크 이중 점유(~30MB)가 생김 — 수용.

---

### WP-2. CLI npm 배포 가능화 (P0)

#### 문제
CLI 코드는 완성도가 높지만 배포 수단이 저장소 클론+`npm link`뿐이다. `private: true`, gitignore된 빌드 산출물, 강제 postinstall 다운로드 3겹의 장벽이 있다.

#### 설계: 하나의 패키지, 선별적 tarball

별도 `@flucto/cli` 패키지 분리는 서비스 레이어 공유(이 프로젝트의 설계 강점)를 깨뜨린다. **단일 패키지에서 tarball 내용을 선별**하는 방식을 채택한다.

1. **`package.json` 변경**
   - `"private": false`
   - `"files": ["dist-electron/", "README.md", "CHANGELOG.md"]` — 렌더러 소스/설정은 tarball에서 제외
   - `"prepack": "npm run build:electron"` — publish 직전 CLI 포함 컴파일 보장
   - `"bin"` 유지 (`flucto`, `fl` → `dist-electron/cli/index.js`)

2. **의존성 재배치**
   - `dependencies`(런타임 최소): `adm-zip`(`binaryInstaller.ts`가 `createRequire`로 사용), `execa` 제외 — `spawn.ts`가 child_process를 직접 쓰므로 확인 후 제거, `axios`는 postinstall 전용이면 dev로 이동 가능하나 `setup-binaries.mjs`가 사용하므로 일단 유지
   - `devDependencies`로 이동: `react`, `react-dom`, `react-hook-form`, `react-router-dom`, `framer-motion`, `lucide-react`, `tailwind-merge`, `clsx`, `@tailwindcss/postcss`, `@supabase/supabase-js`(main/supabase.ts는 데스크탑 전용 경로), `dotenv`
   - `electron-store`, `electron-updater`도 런타임에는 데스크탑만 사용하지만 electron-builder 패키징 시 필요 → **dependencies 유지**(electron-builder는 devDeps와 deps 모두 참조하나, 명시적 유지가 안전)
   - `yt-dlp-exec` **삭제** (임포트 0건 확인)
   - `electron`은 devDependencies 유지 (CLI 런타임 미사용 확인됨)

3. **postinstall 소프트 폴백 (`scripts/setup-binaries.mjs`)**
   - 스킵 조건: `CI=true`, `FLUCTO_SKIP_BINARIES=1`, 전역 설치 여부 감지(불가하므로 아래 폴백으로 흡수)
   - **모든 실패 경로에서 exit 1 금지** → `console.warn` + "첫 실행 시 `flucto setup`을 실행하세요" 안내 후 exit 0
   - 다운로드 성공 시 기존 동작 유지(소스 개발 환경 경험 보존)
   - 단, 데스크탑 빌드(`npm run dist`) 전에는 반드시 바이너리가 있어야 하므로 release workflow의 빌드 단계에서 `FLUCTO_SKIP_BINARIES`를 설정하지 않는다(기본값 = 다운로드 수행).

4. **첫 실행 경험 (CLI)**
   - `src/cli/index.ts`의 명령 실행 전 `resolveCliBinaries` 실패 시: 현재 에러 대신 자동으로 `setupUtilities({ onStatus })` 호출 후 재시도 → 재실패 시 "run `flucto setup`" 안내. 이미 `flucto setup`이 구현돼 있으므로 자동 프로비저닝이 자연스러운 확장.
   - 100MB ffmpeg 다운로드가 부담되는 유저를 위해 `--yt-dlp-only` 옵션 추가(YouTube→MD만 쓰는 유저 케이스).

5. **릴리스 배선**
   - `.releaserc.json`의 `@semantic-release/npm`이 publish를 수행하려면 `NPM_TOKEN` 필요 → `release.yml` Semantic Release step env에 추가, 저장소 시크릿 등록 (운영 작업).
   - npm provenance(`NPM_CONFIG_PROVENANCE=true`) 권장.

#### 배포 후 유저 경험
```
npm i -g flucto          # 수 초, 바이너리 다운로드 없음
flucto transcript <URL>  # 첫 실행 시 yt-dlp 자동 프로비저닝 (~30MB)
```

---

### WP-3. 데스크탑 쿠키/프록시 설정 (P1)

#### 문제
CLI는 `--cookies`/`--proxy`/`--impersonate`로 YouTube bot-check를 우회할 수 있지만, 데스크탑은 `FLUCTO_*` env만 읽고 GUI 실행 시 사실상 설정 불가(`transcriptHandlers.ts:51-58`는 network를 전달하지 않음). 서킷브레이커가 열려도 탈출 수단이 없다.

#### 설계

1. **설정 모델 확장 (`src/shared/types.ts`)**
   ```ts
   export interface TranscriptNetworkSettings {
     cookiesPath: string | null;          // Netscape cookies.txt 파일 경로
     cookiesFromBrowser: string | null;   // 'chrome' | 'firefox' | ...
     proxy: string | null;                // http(s)://... 또는 socks5://...
     impersonate: string | null;          // curl-impersonate 대상 (선택)
   }
   // TranscriptSettings에 `network: TranscriptNetworkSettings | null` 추가
   ```
   - `null` = 미설정(env 폴백 유지). `settingsDefaults.ts`의 default/validator 갱신.

2. **배선** — `transcriptHandlers.ts`의 deps에 `network: resolveCaptionNetworkOptions(storedNetwork ?? {})` 추가. `resolveCaptionNetworkOptions`(`captionNetwork.ts:29-58`)는 이미 overrides > env 우선순위 병합을 구현하고 있어, UI 값이 없을 때 env가 그대로 폴백된다. **기존 함수 시그니처 무변경.**

3. **UI** — `TranscriptSettings.tsx`에 "고급 네트워크" 접이식 섹션: 쿠키 파일 선택(파일 대화상자), 브라우저 선택 드롭다운, 프록시 텍스트 입력. 파일 선택용 신규 IPC `pick-cookies-file`(dialog.showOpenDialog, 확장자 필터 `*.txt`).

4. **보안/주의**
   - 쿠키 파일 경로는 설정에 평문 저장 — 로컬 설정 파일이므로 수용하되 README에 주의 문구.
   - macOS 패키지 앱에서 `--cookies-from-browser`는 키체인 접근 권한 문제로 실패할 수 있음 → UI에 "브라우저에서 추출은 실패할 수 있음, cookies.txt 권장" 힌트 표시.
   - 프록시/impersonate 값 검증은 얕게(문자열 존재 여부) — 실제 유효성은 yt-dlp의 stderr 분류에 맡긴다.

---

### WP-4. 자막 언어 폴백 팬아웃 제한 (P1)

#### 문제
`resolveCaptionLanguageCandidates`(`captionExtractor.ts:111-144`)가 요청 언어 실패 시 모든 수동+자동 트랙을 후보로 넣는다. YouTube 자동번역 트랙은 수십 개에 달해, rate-limit 상황에서 실패가 실패를 부르고 서킷브레이커(5회/60초)가 열려 `SERVICE_UNAVAILABLE`이 된다.

#### 설계
1. **후보 상한**: 폴백 후보를 최대 3개로 제한 — `요청 언어 → 기반 언어 → -orig → 첫 수동 트랙 → 첫 자동 트랙` 중 실존하는 것 순.
2. **RATE_LIMITED 중단**: 특정 언어에서 재시도 소진 후에도 `RATE_LIMITED`면 다음 언어로 넘어가지 않고 즉시 실패 반환(백오프가 이미 45초까지 증가하므로, 다른 언어 재시도는 결과가 같다).
3. **응답에 시도 언어 목록 포함**: `TranscriptMarkdownResponse.availableLanguages`는 이미 존재 — 실패 시 "시도한 언어들"을 `message`에 명시해 UX 개선.

---

### WP-5. 마크다운 파이프라인 중복 제거 (P2)

#### 문제
- `saveMarkdownFile`이 `transcriptMarkdown.ts:67-83`과 `markdownPipeline.ts:104-120`에 동일 복제 — 버그 수정 이중화 위험.
- CLI `md` 명령(MarkdownPipeline, YAML frontmatter+썸네일)과 데스크탑 변환(transcriptMarkdown)이 **다른 포맷**의 마크다운을 낸다.

#### 설계 (단계적)
1. **1단계(본 작업)**: 파일 저장 로직을 `src/main/services/markdownFile.ts`로 추출, 양쪽이 import. 출력 포맷 통일은 별도 결정 사항이므로 착수하지 않는다.
2. **2단계(후속 논의)**: 포맷 단일화 방향 결정 — 데스크탑이 MarkdownPipeline(orchestrator 기반)으로 이행하는 것이 아키텍처 리뷰 문서(#9)와 일치하나, 데스크탑 설정(타임스탬프 on/off, 메타데이터 on/off)과 pipeline 고정 동작의 간극이 있어 UI 설정 영향도 분석이 선행돼야 한다. 본 문서에서는 결정 보류, 이슈로 등록.

---

### WP-6. 잔여 결함 정리 (P2)

1. **진행 단계 발행**: `transcriptMarkdown.ts`에서 `analyzing(10)` 직후 메타데이터 조회 완료 시점에 `extracting(40)` 발행, 대기 진입 시 `pending(5)` 발행. 진행률 체감 개선.
2. **렌더러 예외 방어**: `MainDownloader.tsx`의 `handleIndividualDownload`, `handleTranscriptSettingsChange`에 try/catch.
3. **죽은 기능 처리**: `get-transcript-languages`를 언어 설정 UI에 연동(선택 언어가 해당 영상에 존재하는지 사전 확인)하거나 제거. 연동 권장 — 설정에서 "auto" 이외 선택 시 유효성 피드백 제공.
4. **메타데이터 헤더 다국어**: `markdownFormatter.ts:68-89`의 한국어 라벨을 `TranscriptSettings.language` 연동 또는 영어 기본으로 변경. 기존 산출물과의 호환보다 신규 산출물 품질 우선.
5. **배치 결과 요약**: `convert-multiple-transcripts-to-markdown` 핸들러가 성공/실패 개수를 반환하도록 변경(프리로드 타입 갱신 포함).

### WP-7. CLI 업데이터 실질화 (P2)

1. `platformAssets.ts`에 `npm`/`source` 설치 모드용 경로 추가:
   - `npm` 모드: `flucto update`가 `npm i -g flucto@latest` 실행(또는 안내 후 확인받고 exec).
   - `source` 모드: `git pull && npm run build:electron` 안내 출력.
2. 데스크탑 인스톨러의 CLI 노출은 별도 과제(NSIS 심볼릭 링크/AppImage desktop 연동)로 후속 등록 — 본 문서 범위 외.

---

## 3. 마일스톤 및 의존 관계

```
M1 (신뢰성)   WP-1 ──┐
              WP-4 ──┼── 데스크탑 YouTube→MD 안정화
              WP-3 ──┘   (WP-3는 WP-1과 독립, 순서 무관)
M2 (배포)     WP-2 → WP-7 (업데이터는 npm 배포가 전제)
M3 (정합성)   WP-5, WP-6 (독립, 언제든 착수 가능)
```

- WP-2의 npm publish는 운영 작업(NPM_TOKEN 발급)을 포함하므로 코드 완료와 배포 활성화를 분리해 관리한다.
- 전 작업 스트림 공통 회귀선: `npm test`(electron-stub 기반), `npm run lint`, `npm run build` + `dist:linux` 스모크.

## 4. 리스크

| 리스크 | 영향 | 완화 |
|--------|------|------|
| GitHub API rate limit으로 갱신 체크 실패 | 갱신 지연, 기능 저하 없음 | 24h 스로틀 + 실패 무음 처리, `latest/download` 리다이렉트는 API 없이도 동작 |
| 관리 디렉터리 우선 전환으로 구버전 회귀 | 낮음 | 마커에 버전 기록, `flucto setup --force` / 설정 초기화로 설치 폴더 복귀 가능 |
| `private:false` 전환 시 의도치 않은 publish | 배포 사고 | `prepack` 검증 + NPM_TOKEN은 release 환경에만 주입, `files` 화이트리스트로 tarball 최소화 |
| 의존성 이동이 데스크탑 빌드를 깨뜨림 | 빌드 실패 | electron-builder는 deps/devDeps 모두 번들링하므로 영향 없음 — 이동 후 `dist:linux` 스모크로 확인 |
| cookies-from-browser의 플랫폼별 부실 | 유저 혼란 | UI 힌트 + 오류 코드 분류(`AUTH_REQUIRED`) 메시지에 cookies.txt 안내 포함 |
