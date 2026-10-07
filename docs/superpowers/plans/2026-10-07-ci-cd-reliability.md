# CI/CD Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR 및 브랜치 변경을 검증하고, 검증된 멀티 OS 패키지를 npm/GitHub에 배포하며, 태그 생성 후 실패한 배포를 동일 버전으로 복구한다.

**Architecture:** 독립적인 재사용 CI workflow를 정상 release workflow의 선행조건으로 사용한다. 버전 예측은 npm 인증과 분리하고, 실제 publishing에만 OIDC 권한을 부여한다. 수동 복구 job은 기존 run의 빌드 결과와 기존 태그를 검증한 뒤 누락된 npm/GitHub publication을 완료한다. 실패 시 자동 재발행하지 않는다.

**Tech Stack:** GitHub Actions, Node.js 24, npm lockfile, TypeScript, Electron Builder, semantic-release 25, npm OIDC, Node test runner.

**Spec:** 이 문서의 수락 기준 및 2026-10-07 CI/CD 점검 결과. 별도의 제품 동작 변경은 없다.

## Global Constraints

- npm으로 통일한다. 저장소 설치는 `npm ci`; pnpm latest 활성화 및 npm에서 지원하지 않는 `.npmrc` 설정을 제거한다.
- Linux, Windows, macOS에서 기존 회귀 테스트를 실행한다. 테스트를 skip하거나 production 동작을 Windows에서 다르게 만들어 통과시키지 않는다.
- 새 검증은 실제 동작/경계/오류를 검사한다. workflow 소스 문자열 일치 검사는 삭제한다.
- user 작업은 보존한다. 초기 구현 단계에서는 커밋, push 및 실제 publication을 수행하지 않는다. 이후 사용자의 “남은 단계를 진행해” 지시로 commit/push, CI 통합 및 기존 버전 복구 실행이 승인되었다. 기존 태그는 삭제·이동하지 않는다.
- npm Trusted Publisher 등록은 계정 소유자의 외부 운영 선행조건이다. 토큰을 요청하거나 OIDC를 우회하는 fallback을 추가하지 않는다.
- native 프로세스 fixture 문제는 테스트 경계에서 해결한다. updater asset fixture는 실행 플랫폼과 일치해야 한다.
- artifacts는 14일 보관하며 누락된 필수 산출물은 실패로 처리한다.
- 이전 실패 run도 기존 artifact 이름으로 복구 가능해야 한다. source run의 원본 application code를 최신 branch code로 대체하지 않는다.

## Review Focus

- 수동 실행 시 push-only 선행 job이 skipped되어도 복구 job은 독립 실행된다.
- 잘못된 run, 버전, 태그, 만료된/불완전한 artifacts는 publication 전에 거부한다.
- npm 조회나 GitHub API 인증/네트워크 실패를 '미배포'로 오인하지 않는다.
- 이미 성공한 npm publication을 반복하지 않으며, 이미 있는 GitHub Release는 draft 또는 불완전한 asset 상태를 명시적으로 처리한다.
- source run의 빌드 커밋과 태그의 application code가 일치해야 한다. 버전/changelog용 release commit만 허용한다.

## Baseline Evidence

- 최신 run `37566325425`: prepare에서 OIDC exchange 404 / ENONPMTOKEN으로 실패.
- source run `37508545685`: 3개 OS 빌드 성공, npm publish E403 실패.
- `v1.17.0` 태그 존재, GitHub Release 없음, npm latest는 `1.16.4`.
- 해당 태그 이후 commit은 chore 1건이며 commit-analyzer 결과는 no release.
- 로컬 build/typecheck/CLI help 성공. lint 1건, tests 77개 중 7개 실패.

## Task 1: 독립 CI 및 결정적 설치

**Files:** Create `.github/workflows/ci.yml`; Modify `package.json`, `package-lock.json`; Remove `.npmrc`.

**Interfaces:** CI는 `workflow_call`과 PR/개발 브랜치 push로 실행된다. 기본 브랜치 push에서는 Release workflow의 checks job이 동일 CI를 호출한다. 검증 명령은 `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

- [x] Node 24 / ubuntu-latest, windows-latest, macos-latest matrix와 contents:read 권한을 구성한다.
- [x] `typecheck` script를 `tsc -b --pretty false`로 추가한다.
- [x] 불필요한 pnpm 설치와 `.npmrc`를 제거한다. 필요한 release YAML parser는 직접 devDependency로 선언한다.
- [x] `npm ci`로 clean dependency install 후 위 네 명령과 CLI help를 실행한다.

## Task 2: 정상 릴리스와 고정 버전 복구

**Files:** Modify `.github/workflows/release.yml`; Create release helper script(s) under `scripts/`; Replace `tests/release-config.test.mjs` with behavioral release recovery tests.

**Interfaces:** push → checks → prepare → OS builds → publish. workflow_dispatch 입력은 필수 `source_run_id`, `release_version`; 별도 recover job은 skipped push jobs에 의존하지 않는다. 복구 script는 같은 이름의 기존 OS artifacts를 소비한다.

- [x] prepare를 commit-analyzer/release-notes-generator만 실행하는 dry-run으로 바꿔 npm 인증 실패와 분리한다.
- [x] 정상 publish 직전에 CLI를 미리 compile하여 package bin metadata가 생성된 파일을 참조하게 한다.
- [x] 실제 publish/recover에만 id-token:write를 부여하고, OIDC-capable npm CLI를 설치한다.
- [x] cross-run artifact download에 github-token 및 actions:read를 설정한다. 14일 retention과 누락 artifact 오류를 지정한다.
- [x] 기존 자동 dispatch retry job과 사용되지 않는 release_retry 입력을 제거한다. 실패/취소 후 사용자가 동일 버전을 수동 복구한다.
- [x] source run의 workflow/event/branch/build 성공과 태그 ancestry 및 source 변경 범위를 검증한다.
- [x] 필수 OS/architecture installers, updater manifests 및 blockmaps의 버전/파일 참조를 검증한다. checksums는 실제 파일에서 생성한다.
- [x] source/tag checkout으로 npm package를 build하고 정확한 버전만 publish한다. npm에 이미 존재하는 버전은 재발행하지 않는다. HTTP 404만 미배포로 취급한다.
- [x] GitHub Release는 동일 태그를 사용하며 기존 태그를 생성/삭제하지 않는다. 업로드를 draft 상태에서 완료하고 publication을 마무리한다.
- [x] wrong source/version/missing assets/API error/partial publication 경계에 대한 behavior tests를 작성한다. 전체 검증은 통합 후 수행한다.

## Task 3: Windows fixture 및 lint 수정

**Files:** Modify `tests/binaryRefresh.test.mjs`, `tests/cli.test.mjs`, `src/main/search/reddit.ts`; Create test helper under `tests/` if needed.

**Interfaces:** production API/asset 선택 동작은 변경하지 않는다. 테스트 helper는 외부 executable 경계만 대체하고 실제 refresh marker 및 setup/update 결과를 검증한다.

- [x] binary fixture가 Windows에서 빈 exe나 POSIX shell script를 실행하지 않도록 수정한다.
- [x] updater fixture에 Windows/macOS/Linux의 호환 asset을 제공하고 checksum 누락 오류를 실제 선택 asset에서 검사한다.
- [x] exact status copy 검사처럼 incidental wording 검사는 제거한다.
- [x] 미사용 JsonObject 타입을 제거한다.
- [x] 통합 후 `npm test` 전체가 0 failure인지 확인한다.

## Task 4: 운영 안내 및 복구 절차

**Files:** Modify `README.md`, `COMMIT_CONVENTIONS.md`, `CHANGELOG.md`, 이 작업지시서.

- [x] CI trigger, checks, Node/npm 버전, OIDC 권한 및 수동 복구 절차를 문서화한다.
- [x] npm Trusted Publisher 설정값을 문서화한다: GitHub Actions / DeclanJeon / flucto / release.yml / Environment empty / direct npm publish allowed. 실제 등록은 아래 외부 운영 단계로 남는다.
- [x] 1.17.0 복구는 source_run_id=37508545685 및 release_version=1.17.0 사용. artifact 만료 전 실행이 필요함을 명시한다.
- [x] artifact 만료 시 latest source가 아니라 원본 version tag/source로 3개 OS 패키지를 다시 만들어 검증해야 한다. 태그 삭제를 복구 방식으로 권장하지 않는다.
- [x] 과거 npm 토큰 설계 문서는 역사적 문서로 유지하며 현재 README 운영 절차를 명시한다.

## Acceptance / Verification

- [x] npm ci, lint, typecheck, tests, build 모두 성공.
- [x] built CLI --help 및 --version 정상 실행.
- [x] workflow YAML lint 성공.
- [x] release helper 검증: 실제 source run/tag read-only smoke, 실제 태그 소스 npm pack, fixture 기반 잘못된 버전/누락 artifact 거부 및 정상 manifest/checksum 생성.
- [x] recovery behavior tests에서 네트워크 오류와 부분 publication을 구분한다.
- [x] 실제 npm/GitHub publication은 수행하지 않는다. 따라서 production 성공 여부는 npm 설정 등록 및 변경 push 후 Actions에서 별도 확인한다.

## External Operations — 계정 소유자 실행

1. npm flucto package의 Trusted Publisher 설정을 등록/수정한다. UI의 실제 설정은 이 세션에서 인증되어 있지 않다.
2. 검증된 변경을 commit/push한다.
3. source artifacts가 유효하면 고정 버전 수동 복구를 실행한다. 만료되면 동일 태그의 패키지를 재생성한다.
4. npm `flucto@1.17.0`, GitHub `v1.17.0`, 모든 OS assets/update manifests/checksums를 확인한다.

## Execution Results

### Implemented

- 초기 작업 브랜치: `fix/ci-cd-reliability`. 초기 구현·검증 단계에서는 commit/push 및 publication을 수행하지 않았다. 후속 운영 결과는 아래 별도 절에 기록한다.
- `.github/workflows/ci.yml`에 재사용 3-OS 검증을 추가하고, `release.yml`을 push 검증·정상 배포·독립 수동 복구로 분리했다.
- `scripts/release-tools.mjs`에 버전 예측, source/tag 검증, installer/manifest/hash 검증 및 부분 publication 복구를 구현했다. 소스 문자열 테스트는 동작 기반 `tests/release-tools.test.mjs`로 교체했다.
- review에서 발견한 세 경계 오류를 회귀 테스트와 함께 수정했다: AppImage의 embedded blockmap 허용, 성공한 Checks로 실패한 Build를 덮어쓰지 않는 정확한 job 이름 검사, 크기가 같아도 digest가 다른 기존 asset 재업로드.
- 복구 npm publish child에만 원본 태그의 `GITHUB_SHA`/`GITHUB_REF`를 전달한다. 실제 제어 workflow의 ref/SHA 및 OIDC 자격 정보는 변경하지 않는다.
- Windows executable fixture는 실제 Node child process에서 버전 응답을 생성한다. production API는 변경하지 않았고, updater fixture에는 플랫폼별 installer와 checksum을 제공했다.
- README, commit conventions, Unreleased changelog에 현재 운영 절차를 반영했다.

### Observed Verification

| 검증 | 결과 |
| --- | --- |
| `npm ci` | clean install 성공 |
| `npm run lint` | 성공 |
| `npm run typecheck` | 성공 |
| `npm test` | 109/109 pass, 0 failure, 0 skip |
| `npm run build` | 성공 |
| built CLI `--help`, `--version` | 정상 실행, 버전 `1.17.0` |
| actionlint 1.7.12 | 두 workflow 모두 exit 0 |
| `node scripts/release-tools.mjs prepare` | npm 인증 없이 실행; 작업 브랜치에서는 `has_release=false` |
| `node scripts/release-tools.mjs source 37508545685 1.17.0` | GitHub 실제 run/build 결과와 기존 태그 검증 성공; source SHA `23e122745103a781d01bcf2c279c3c1ec3ea21d0` |
| 격리된 `v1.17.0` checkout의 `npm ci --ignore-scripts` 및 `npm pack` | 실제 prepack compile 성공; `flucto-1.17.0.tgz`에 151개 파일 및 CLI bin 포함; 원본 CLI `--version`도 `1.17.0` |
| npm provenance smoke | 복구 helper와 설치된 npm의 실제 provenance 생성기를 실행해 원본 태그 소스와 제어 workflow ref의 분리를 확인; 서명 및 publish 경계는 차단 |

세 review 회귀 시나리오는 수정 전 실패 / 수정 후 성공을 확인했다. 전체 테스트는 최종 통합 상태에서 다시 통과했다.

### Initial Verification Limits

- npm 계정은 이 세션에서 미인증(`npm whoami` → `ENEEDAUTH`)이다. Trusted Publisher UI 등록 및 실제 OIDC token exchange는 확인하지 못했다.
- 새 workflow의 Linux/macOS runner 실행과 실제 installer packaging/publication은 GitHub Actions에서 검증해야 한다. 로컬 통합 실행 환경은 Windows였다.
- 기존 source run artifacts는 각각 **2026-10-07 18:07–18:09 UTC**에 만료된다. 이번 14일 retention 변경은 기존 artifacts의 만료를 연장하지 않는다.
- 변경 push 및 npm 설정 등록 후, 기존 artifacts가 유효할 때만 README의 고정 버전 수동 복구를 실행한다. 만료된 경우 원본 태그 소스의 3-OS 산출물을 재생성·검증하기 전에는 복구를 진행하지 않는다.
- 실 npm 게시와 GitHub Release 생성·업로드는 수행하지 않았다. 운영 완료 여부는 외부 운영 단계 1–4의 실제 결과로 판단한다.

### Follow-up Operations — 2026-10-07

- 사용자 승인 후 commit `00a2d9680d98bb4cb5f6dd98a6d0619b56443048`을 push하고 [PR #1](https://github.com/DeclanJeon/flucto/pull/1)을 생성했다.
- branch push 및 PR의 Linux/Windows/macOS CI 총 6개 job이 성공했다. PR을 `master`에 squash merge했다: `7f8a62fd993cdc4f9a2b7a17e326095f3379cf26`.
- [기본 브랜치 Release run 37577178444](https://github.com/DeclanJeon/flucto/actions/runs/37577178444)의 3-OS checks 및 prepare가 모두 성공했다. `ci:` commit은 새 버전을 만들지 않아 build/publish는 정상적으로 skipped되었다.
- [첫 복구 run 37577211277](https://github.com/DeclanJeon/flucto/actions/runs/37577211277)은 source/tag 검증과 원본 3-OS artifact 다운로드를 완료했지만, Linux 파일명 검사에서 publication 전에 실패했다.
- 원본 build 로그의 실제 파일명은 `Flucto-1.17.0-x86_64.AppImage` 및 `Flucto-1.17.0-amd64.deb`이다. Electron Builder는 x64 target의 `${arch}`를 형식별로 변환한다. 검증기와 fixture의 잘못된 공통 `x64` 가정을 수정했다.
- 실제 이름을 반영한 기존 acceptance test가 수정 전 실패하는 것을 확인했다. 수정 후 실제 verify CLI는 fixture 기반 16개 산출물을 검증하고 checksum manifest를 생성했다.
- Linux 이름 수정 후 lint/typecheck/109개 전체 테스트/build/compiled CLI 버전 확인이 모두 성공했다. 동일 acceptance test는 실패 전/통과 후 회귀 증거를 갖는다.
- npm 설정 페이지는 계정 로그인이 필요했다. 제출된 로그인은 `username or password was invalid`를 반환했다. 계정 로그인·Trusted Publisher UI 설정을 우회하지 않으며, 현재 설정의 유효성은 실제 OIDC 복구 결과로 확인한다.
- [PR #2](https://github.com/DeclanJeon/flucto/pull/2)도 branch/PR 3-OS CI 총 6개 job 성공 후 merge했다: `38164dfa598154dde77c08032ef7fc3098dab3cf`. [기본 브랜치 run 37578032904](https://github.com/DeclanJeon/flucto/actions/runs/37578032904)의 checks 및 prepare도 성공했다.
- [두 번째 복구 run 37578036243](https://github.com/DeclanJeon/flucto/actions/runs/37578036243)은 실제 3-OS 산출물 및 checksum 총 **17개 release files**를 검증했다. 원본 `v1.17.0` checkout의 prepack compile과 151개 파일을 포함한 npm tarball 생성도 성공했다.
- 실제 `npm publish`는 `ENEEDAUTH`로 거부되었다. npm CLI 11.17.0 및 id-token:write가 적용된 실행에서도 게시 자격을 얻지 못했다. 오류만으로 npm UI의 특정 설정값을 단정하지 않는다.
- 게시 시도 후 npm latest는 `1.16.4`, `flucto@1.17.0` 조회는 E404, GitHub `v1.17.0` Release는 없음으로 확인했다. 기존 tag commit은 `a65d485743163df199dab7686442260b14dd9a30`으로 유지되었다.

### Current Blocker / Account Owner Action

1. [npm flucto 설정](https://www.npmjs.com/package/flucto/access)에 계정 소유자로 로그인한다. 비밀번호·OTP·토큰을 채팅에 제공하지 않는다.
2. Settings → Trusted publishing에서 GitHub Actions / Organization or user `DeclanJeon` / Repository `flucto` / Workflow filename **`release.yml`** / Environment name 비움을 확인·저장한다.
3. Allowed actions에서 **direct `npm publish` 허용**을 명시적으로 선택한다. 신규 설정의 기본 `npm stage publish` 허용만으로는 현재 workflow의 직접 게시를 승인하지 않는다. [공식 설정 안내](https://docs.npmjs.com/trusted-publishers/).
4. 설정 완료 후 artifacts가 만료되기 전에 같은 source/version으로 workflow_dispatch를 다시 실행한다. `37508545685` / `1.17.0`을 유지하며 태그를 삭제·이동하거나 토큰 fallback을 추가하지 않는다.

코드 통합 및 3-OS CI는 완료되었다. npm 계정 설정과 실제 publication 완료는 외부 인증 선행조건 때문에 아직 미완료다.

### Trusted Publisher Registration Follow-up

- 계정 소유자가 Trusted Publisher 등록을 완료했다고 알린 후 [복구 run 37581486264](https://github.com/DeclanJeon/flucto/actions/runs/37581486264)을 실행했다.
- 원본 산출물 17개 검증 및 npm pack은 성공했다. 이번에는 OIDC 게시 인증이 진행되었고 provenance 서명이 transparency log에 기록되었다.
- 실제 npm PUT은 **E403: OIDC permission denied for this action**으로 거부되었다. 이전 ENEEDAUTH와 구분한다. 현재 확인할 계정 설정은 Trusted Publisher의 **Allowed actions → direct npm publish 허용**이다.
- 실행 후 npm latest는 `1.16.4`이며 GitHub `v1.17.0` Release는 아직 없다. 등록 성공을 publication 성공으로 취급하지 않는다.
- 계정 소유자가 직접 게시 권한을 확인·저장하면 동일 source/version으로 복구를 이어간다. staged-publish나 npm token으로 우회하지 않는다.
