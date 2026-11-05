# Flucto CLI 작업 안내

먼저 현재 `flucto --help`로 사용 가능한 명령을 확인한다. 아래는 1.19.0 이상에서 확인한 검색·미디어·자막 명령이며 신규 스킬 설치 명령은 이 번들이 포함된 릴리스가 필요하다.

## 검색 및 메타데이터

```bash
flucto search "제품 촬영" --platform youtube --limit 5 --json
flucto search "제품 촬영" --platform instagram --limit 5 --json
flucto info "https://www.youtube.com/watch?v=VIDEO_ID" --json
flucto languages "https://www.youtube.com/watch?v=VIDEO_ID" --json
```

실행 전 placeholder가 아닌 실제 검색어/URL로 바꾼다. 지원 검색 사이트는 youtube, twitter(X), instagram, reddit, threads, tiktok, vimeo, bilibili, dailymotion, nicovideo, ok, vkvideo다. `--platform all`은 광범위 검색이 명시된 경우만 사용한다. 검색 결과의 `sources`와 개별 오류, index/native 출처를 보존한다. 실패한 소스를 0건 검색 결과로 바꾸지 않는다.

제공되는 게시일이 없는 결과는 기간 조건을 검증한 것으로 세지 않는다. 검색 시점은 게시 시점이 아니다. 언어·지역을 CLI가 지원하는 서버 필터라고 지어내지 않는다.

## 선택한 미디어 저장

```bash
flucto download "https://www.youtube.com/watch?v=VIDEO_ID" --format mp4 --output-dir ./research/media --json
flucto download "https://www.youtube.com/watch?v=VIDEO_ID" --format mp3 --output-dir ./research/audio --json
```

`success: true`와 반환된 `filePath`를 확인하고 파일 존재·크기를 검사한다. 다운로드 실패는 권한·원본 삭제·세션·플랫폼 접근 문제일 수 있으며 다른 서비스를 몰래 사용하지 않는다. 다운로드 권한과 목적 범위를 지킨다.

## 자막 기반 Markdown

```bash
flucto md "https://www.youtube.com/watch?v=VIDEO_ID" --language auto --output-dir ./research/notes --json
flucto md "https://www.youtube.com/watch?v=VIDEO_ID" --language ko --stdout
flucto channel to-md "@CHANNEL" --limit 10 --concurrency 1 --language auto --out ./research/channel --json
```

`md`는 자막을 수집·정리하는 명령이다. 사용자가 한 URL을 줬으면 채널 전체를 수집하지 않는다. 채널 결과는 개별 성공/실패와 실제 파일 수를 보고한다. 파일 저장에는 `--stdout`을 사용하지 않는다. stdout 출력만 했으면 파일을 저장했다고 하지 않는다.

자막이 없는 경우 원본 내용을 읽은 것처럼 요약하지 않는다. 접근 가능한 설명/메타데이터를 별도의 검색 노트로 저장하거나 사용자가 자막을 제공하도록 제안할 수 있으나, 자막 전문으로 표시하면 안 된다.

## 검색 결과 Markdown 목록

CLI의 검색 결과는 JSON이다. 에이전트가 요청된 `.md` 파일을 호스트의 파일 쓰기 도구로 만들 수 있다. 최소 항목은 조회 시각, 검색어·플랫폼, 실제 URL·제목, 알려진 게시일/작성자, retrieval 경로, 실패 소스와 미검증 사항이다. 없는 필드는 unknown으로 남긴다. 이 작업은 영상 자막 변환과 다르다.

## 에이전트 스킬 설치

```bash
flucto skill install --agent all --skill flucto-media-research --if-missing --json
flucto skill install --agent pi --skill flucto-media-research --dry-run --json
```

`all`은 `~/.agents/skills/`와 `~/.claude/skills/`에 설치하며 Pi는 공유 `.agents` 사본을 발견한다. `--if-missing`은 기존 폴더/심볼릭 링크를 변경하지 않는다. 변경된 사본의 업그레이드는 사용자가 내용을 확인한 뒤에만 `--force`로 백업 후 교체한다. `--force`와 `--if-missing`은 함께 쓰지 않는다. 이름을 생략한 기존 `skill install`은 검색 전용 searching-social-media의 기존 동작을 유지한다.

Pi는 `/reload`, 다른 호스트는 각자의 새로고침 또는 새 세션을 사용한다. 스킬은 실행 권한·인증·도구를 새로 제공하는 플러그인이 아니다.
