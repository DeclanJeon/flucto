# Flucto SNS 검색 에이전트 스킬 안내

Flucto CLI에 포함된 `searching-social-media`는 Pi, Codex, Claude 에이전트가 Flucto의 **영상 게시물 검색**을 근거·범위와 함께 수행하도록 돕는 선택 설치형 Agent Skill입니다. 데스크톱 앱이나 CLI를 설치했다고 에이전트 홈에 자동으로 파일을 쓰지는 않습니다. 아래 설치 명령을 직접 실행해야 합니다.

## 1. 준비

- Flucto CLI가 설치되어 PATH에서 `flucto`로 실행되어야 합니다. [CLI 설치](../README.md#install-from-github-releases)를 먼저 진행하고 새 터미널에서 확인합니다.
- Python 3.10 이상이 PATH에 있어야 합니다. 이 어댑터는 Python 표준 라이브러리만 사용합니다.
- 현재 번들 어댑터는 **Flucto 1.19.0 응답 계약에 고정**되어 있습니다. 검색 전에 버전을 확인하며, 모르는 버전은 차단합니다. Flucto의 계약이 확인된 업데이트를 설치해야 새 버전에서 쓸 수 있습니다.
- 일부 공개 색인 경로는 로컬 Chrome/Chromium을 요구할 수 있습니다. 자동 설치하거나 로그인 브라우저 프로필을 읽지 않습니다.

```bash
flucto --version
python3 --version   # Windows: py -3 --version
flucto skill install --agent pi --dry-run
```

마지막 명령은 대상 경로만 출력하며 파일을 쓰지 않습니다.

## 2. 에이전트에 스킬 설치

선호하는 에이전트 하나를 지정합니다.

```bash
flucto skill install --agent pi
flucto skill install --agent codex
flucto skill install --agent claude
```

`--agent all`은 Codex의 `~/.agents/skills/` 위치와 Claude Code 위치에 설치합니다. Pi도 표준 `~/.agents/skills/`를 검색하므로 이 한 부를 함께 사용해 이름 충돌을 피합니다. 모든 에이전트가 항상 이 스킬을 자동 선택한다는 뜻은 아니며, 해당 에이전트를 재시작/새로고침한 뒤 이름을 확인하고 필요하면 명시적으로 불러옵니다.

| 대상 | 설치 경로 |
|---|---|
| Pi (`--agent pi`) | `~/.pi/agent/skills/searching-social-media/` |
| Codex (`--agent codex`) 또는 `--agent all`의 공유 위치 | `~/.agents/skills/searching-social-media/` (Pi도 검색) |
| Claude Code | `~/.claude/skills/searching-social-media/` |

기존 대상이 있으면 기본적으로 거부합니다. 내용을 살펴본 뒤 교체를 승인할 때만 `--force`를 사용하십시오. 기존 스킬 디렉터리는 동일 위치 옆의 `*.backup-<timestamp>`으로 이동하고 새 번들 사본으로 교체합니다. 다른 스킬이나 설정은 수정하지 않습니다.

```bash
flucto skill install --agent pi --force
```

설치는 Flucto 패키지 안의 스킬 파일을 복사합니다. 검색 호출·쿠키 접근·다운로드·자막 수집·브라우저 설치는 하지 않습니다. 설치된 스킬을 제거하려면 해당 에이전트의 `searching-social-media` 디렉터리만 직접 삭제하십시오. 업그레이드 때도 새 설치를 명시적으로 수행하고 기존 대상을 검토한 뒤 `--force`를 선택해야 합니다. 백업은 안전 확인 후 직접 정리합니다.

Pi에서는 실행 중인 대화에서 `/reload`를 실행합니다. Codex/Claude는 새 세션에서 검색하거나 해당 에이전트의 스킬 새로고침 규칙을 따릅니다. 직접 호출 예:

```text
/skill:searching-social-media 제품 촬영 레퍼런스 후보를 유튜브에서 5개 찾아줘
```

## 3. 검색 사용법

에이전트에게 주제, 검색 목적(일반/레퍼런스/수요 근거), 플랫폼, 언어·지역 조사 의도, 기간, 후보 수, 제외 조건을 알려줍니다. 생략된 플랫폼은 범위를 넓히지 않고 **YouTube만, 최대 10개 후보**로 명시합니다. 실제 검색은 에이전트의 작업 요청에 따라 실행되며 설치만으로 네트워크 호출이 발생하지 않습니다.

스킬 경로에서 직접 사용하려면 설치된 스킬 디렉터리에서 실행합니다.

```bash
python3 scripts/social_search.py --query "제품 촬영" --platform youtube --mode reference --plan
python3 scripts/social_search.py --query "제품 촬영" --platform youtube --mode reference --limit 5
python3 scripts/social_search.py --query "제품 촬영" --platform youtube --platform instagram --limit 6 --max-calls 2 --format md
```

- `--plan`은 버전 확인이나 네트워크 호출 없이 의도한 범위만 출력합니다.
- 실제 검색은 기본 stdout JSON 보고서를 출력합니다. Markdown 표는 `--format md`; 새 파일 저장은 `--output report.json`처럼 명시할 때만 합니다. 기존 파일을 덮어쓰지 않습니다.
- 기본 호출 상한은 네트워크 CLI 6회, 호출당 30초, 전체 120초이며 재시도하지 않습니다. 후보 수/플랫폼을 늘리면 상한이 적용됩니다. `all`은 기본이 아니며 선언된 사이트들에 각각 호출합니다.
- `--since` / `--until`은 게시일 기준 사후 필터입니다. 게시일 미상은 기간 조건을 만족한 것으로 세지 않습니다. 언어·지역은 검색 조사 의도이지 Flucto 서버 필터가 아닙니다.
- `flucto search` 결과는 Flucto 검색 계약을 따릅니다. 이 스킬은 실패한 플랫폼을 “검색 결과 없음”으로 바꾸지 않고 부분 실패로 보존합니다.

## 4. 확인 범위와 한계

- 대상은 공개적으로 검색되는 **영상 게시물 후보**입니다. SNS 전체 텍스트·이미지·댓글·비공개 게시물을 훑지 않습니다.
- 실제 네트워크 동작은 플랫폼, 익명 접근, 공개 색인, CAPTCHA/403, 로그인 장벽과 브라우저 유무에 달려 있습니다. 한 플랫폼의 실패는 나머지 플랫폼의 성공을 무효화하지 않지만, 전체 성공으로 포장하지도 않습니다.
- 검색 결과/제목/제공자 순서는 영상 시청, 사실 확인, 저작권 허가, 전 플랫폼 인기도, 수요 판정이나 성과 예측을 뜻하지 않습니다.
- Flucto `info`의 `view_count`는 좋아요로 대체될 수 있어 조회수 검증값으로 다루지 않습니다. Reddit 검색 수치는 점수/추천 수일 수 있으며 조회수가 아닙니다. 누락값과 실제 0을 구분합니다.
- 수요에 근거한 주제 선택은 별도 `topic-demand-selection` 책임입니다. 실제 영상 분석은 영상 접근과 별도 요청이 있어야 합니다. 스킬은 다운로드, transcript, 채널 수집, 로그인/쿠키 추출, 정기 모니터링 또는 게시를 하지 않습니다.
- 에이전트 스킬은 안내 및 로컬 검색 어댑터입니다. 앱의 검색 UI와 동일한 사용자 표면도 아니고, Flucto CLI의 검색 기능을 대체하지 않습니다.

## 5. 문제 해결

- `unsupported Flucto version`: `flucto --version` 확인. 자동 업데이트를 수행하지 말고 검증된 Flucto 버전으로 업데이트하거나 해당 어댑터 갱신을 기다립니다.
- `flucto executable not found` 또는 Python 누락: CLI/Python 설치 후 새 셸에서 `PATH`를 확인합니다.
- `partial`/exit 3: JSON의 각 `runs`, `sources`, `error`를 검토합니다. 실패한 플랫폼을 무검색/0건으로 해석하지 않습니다.
- 설치 충돌: 먼저 대상 스킬을 검토합니다. 사용자가 교체하기로 결정했을 때만 `--force`; 자동 병합은 하지 않습니다.
- Pi가 스킬을 못 찾음: 설치 경로, `SKILL.md` 존재 여부, 활성 세션의 `/reload`를 확인합니다.
