# AI·에이전트에 요청해서 Flucto 사용하기

Flucto는 `flucto-media-research` Agent Skill을 번들로 제공한다. 지원하는 AI 에이전트에게 자연어로 요청하면 스킬이 Flucto CLI 명령을 선택해 공개 영상 자료를 찾고, 요청된 미디어나 자막 Markdown을 저장한다. Flucto 자체에 LLM이나 무인 크롤링 데몬이 내장된 것은 아니다.

## 설치와 발견

스킬이 포함된 새 버전의 **전역 npm 설치와 GitHub Releases CLI 설치 번들**은 다음 위치에 스킬을 자동 등록한다.

| 대상 | 위치 |
|---|---|
| Pi·Codex 공유 | `~/.agents/skills/flucto-media-research/` |
| Claude Code | `~/.claude/skills/flucto-media-research/` |

기존 폴더나 심볼릭 링크는 보존하며 자동으로 덮어쓰지 않는다. 등록 실패는 경고와 수동 재시도 명령으로 기록하고 CLI 설치 자체는 유지한다. npm은 성공한 lifecycle hook 출력을 숨길 수 있으므로 등록 진단을 보려면 `--foreground-scripts` 또는 아래 명시적 등록 명령을 사용한다. 다른 스킬·에이전트 설정·인증은 변경하지 않는다.

- 자동 등록 제외: 설치 전에 `FLUCTO_SKIP_AGENT_SKILLS=1`.
- npm 직접 설치는 `--ignore-scripts` 또는 lifecycle-script 허용 정책에 따라 훅이 실행되지 않을 수 있다. 이 경우 명시적 등록 명령을 사용한다. ZIP의 셸/PowerShell 설치기는 npm 훅 비활성화와 별개로 직접 등록하며, 제외하려면 위 환경 변수를 사용한다.
- 개발용 소스 디렉터리의 로컬 `npm install`은 사용자 에이전트 홈에 쓰지 않는다.
- CLI 번들의 `--no-profile`/`-NoProfile`은 PATH만 제어한다. 에이전트 스킬 등록을 제외하려면 위 환경 변수를 별도로 사용한다.
- 배포 전 저장소 변경이 이미 발행된 구버전 설치 번들에 반영되는 것은 아니다.
- Pi는 `/reload`, 다른 호스트는 해당 새로고침 규칙이나 새 세션을 사용한다. 모든 AI가 항상 스킬을 자동 선택한다는 보장은 없다.

명시적으로 등록하거나 경로를 확인할 수도 있다.

```bash
flucto skill install --agent all --skill flucto-media-research --dry-run --json
flucto skill install --agent all --skill flucto-media-research --if-missing --json
flucto skill install --agent pi --skill flucto-media-research --if-missing
```

`--agent pi`는 `~/.pi/agent/skills/`에만 설치한다. 공유 사본이 이미 있으면 중복 설치 대신 기존 위치를 사용한다. `--force`는 사용자가 기존 내용을 확인하고 교체를 승인했을 때만 사용한다. 기존 대상은 옆의 `.backup-<timestamp>`으로 보존한 뒤 교체한다. `--if-missing`과 `--force`는 함께 쓰지 않는다. 스킬 제거는 선택한 스킬 디렉터리만 삭제한다.

## 자연어 요청 예시

```text
유튜브에서 제품 촬영 레퍼런스를 5개 찾아줘.
인스타그램에서 미니멀 데스크 영상 자료를 찾아서 링크 목록을 md로 저장해줘.
방금 찾은 결과 중 이 두 개를 ./research/media에 MP4로 내려받아줘.
이 유튜브 영상의 자막 내용을 Markdown 파일로 저장해줘: <실제 영상 URL>
이 채널의 영상 10개를 자막 md로 저장해줘: <채널 URL 또는 @handle>
```

스킬 이름·CLI 문법을 사용자가 먼저 말할 필요는 없다. 호스트가 지원하면 `/skill:flucto-media-research ...`처럼 명시적으로 호출할 수도 있다.

에이전트는 CLI를 먼저 확인한다. 없고 설치가 승인된 작업이면 스킬의 `references/install.md`에 따라 공식 Flucto 릴리스 ZIP·체크섬을 검증한 뒤 사용자 범위 설치기를 실행한다. 호스트 권한이 없으면 설치 실패/추가 승인을 보고하며, 기존 설치를 조용히 업데이트하거나 브라우저·계정을 추가하지 않는다.

## 무엇을 저장하는가

| 요청 | 결과 | 포함하지 않는 것 |
|---|---|---|
| 자료 검색 | 실제 URL과 출처·불확실성 | 자동 미디어 다운로드, 시청/청취 주장 |
| 검색 결과 md | 제목·URL·관측된 메타데이터·검색 범위·실패 소스 | 원본 영상 전문/자막으로 위장 |
| MP4/MP3 저장 | 요청된 선택 URL의 파일 | 비공개/DRM/접근 제한 우회 |
| 내용 md | 제공되는 caption/subtitle을 정리한 파일 | 자막 없는 영상의 발명, 몰래 STT/번역/유료 API 호출 |

CLI 직접 사용 예시는 다음과 같다.

```bash
flucto search "제품 촬영" --platform youtube --limit 5 --json
flucto download "<선택한 실제 URL>" --format mp4 --output-dir ./research/media --json
flucto md "<실제 영상 URL>" --language auto --output-dir ./research/notes --json
```

검색은 기본 YouTube 최대 10개로 범위를 표시하며, 사용자가 정한 플랫폼·수량·기간·언어를 보존한다. 여러 사이트의 일부 실패를 전체 성공이나 0건으로 바꾸지 않는다. SNS 전체 텍스트·이미지·댓글·비공개 게시물 검색은 제공하지 않는다. 다운로드·자막 가용성은 사이트·원본·세션에 따라 다르다.

## 검증·전달

실행 후 JSON의 성공 여부·개별 오류·실제 filePath와 파일 크기를 확인한다. stdout으로만 변환한 결과는 저장했다고 하지 않는다. 에이전트 채팅에서 파일을 전달하려면 해당 호스트의 첨부 도구를 사용해야 하며, 로컬 경로만 적으면 사용자에게 다운로드가 전달된 것은 아니다.

기존 `searching-social-media`는 [별도 검색 전용 어댑터](social-search-skill-guide.md)로 유지한다. 그 스킬은 다운로드/자막 수집을 하지 않고 명시적 설치 동작도 그대로다. 검색부터 저장까지의 새 흐름을 원하면 `flucto-media-research`를 선택한다.
