# CLI가 없는 경우 공식 설치

공식 원본: https://github.com/DeclanJeon/flucto . 이 절차는 Flucto 설치가 승인된 작업에서만 실행한다. 기존 PATH에 정상 CLI가 있으면 재설치하지 않는다. root/sudo, 임의의 GitHub 미러·다운로드 사이트, 인증 쿠키 추출은 사용하지 않는다.

## GitHub Releases 설치 번들 (Node.js가 없어도 가능)

1. 공식 latest release의 자산에서 `Flucto-<version>-cli-setup.zip`과 `checksums-sha256.txt`를 같은 임시 작업 폴더로 다운로드한다. `gh`가 있으면 다음 명령을 사용할 수 있다. 없으면 호스트의 HTTPS 다운로드 도구로 같은 공식 release 자산을 받는다. 바이너리·브라우저를 추가 설치해 검색을 우회하지 않는다.

```bash
gh release download --repo DeclanJeon/flucto --pattern 'Flucto-*-cli-setup.zip' --pattern checksums-sha256.txt --dir ./flucto-setup-download
```

2. 다운로드한 ZIP의 SHA-256을 `checksums-sha256.txt`에 있는 **같은 파일명** 항목과 비교한다. macOS는 `shasum -a 256`, Linux는 `sha256sum`, Windows는 `Get-FileHash -Algorithm SHA256`을 사용할 수 있다. 항목이 없거나 해시가 다르면 실행하지 않는다. 원격 파일명·체크섬 텍스트를 셸 명령으로 실행하지 않는다.
3. ZIP을 새 디렉터리에 압축 해제한다. macOS/Linux는 그 디렉터리에서 `bash install.sh`, Windows는 `install.cmd`를 실행한다. 설치기는 사용자 범위의 private Node.js 24와 Flucto CLI, yt-dlp/FFmpeg를 준비하므로 시스템 Node/Python 설치가 필수는 아니다. 네트워크·호스트 정책상 불가능하면 중단하고 원인을 보고한다.
4. 설치기 출력에 표시된 실제 명령 경로로 `flucto --version` 및 `flucto --help`를 확인한다. PATH 갱신 전이면 그 실행 파일을 직접 사용한다. 설치가 성공했다는 메시지만으로 요청된 검색·저장도 성공했다고 하지 않는다.

공식 CLI 설치 번들의 내부 Node 다운로드는 nodejs.org의 SHA256을 검증한다. 이 절차에서 별도 유료 서비스·API key·로그인을 추가하지 않는다. `flucto setup`이 실패하면 반복 설치하지 말고 반환된 누락 바이너리와 환경 제약을 확인한다.

## 이미 Node/npm을 사용하는 환경

공식 GitHub 저장소의 README가 안내하는 npm 배포를 선택할 수 있다. 패키지의 repository가 `DeclanJeon/flucto`를 가리키는지 확인하고 승인된 환경에서 `npm install --global flucto`를 사용한다. 전역 설치 권한이 없으면 sudo 대신 위 사용자 범위 번들을 사용한다.

새 스킬 번들이 포함된 버전의 전역 npm/CLI 번들 설치는 `flucto-media-research`를 공유 `.agents/skills` 및 `.claude/skills`에 자동 등록한다. 기존 대상은 보존한다. `FLUCTO_SKIP_AGENT_SKILLS=1`을 선택하면 자동 등록하지 않는다. npm 직접 설치에서는 `--ignore-scripts`나 lifecycle-script 허용 정책으로 훅이 차단될 수도 있으며 이 경우 수동 등록한다. ZIP 설치기는 npm 훅과 별개로 직접 등록하므로 제외하려면 `FLUCTO_SKIP_AGENT_SKILLS=1`을 사용한다. 로컬 소스의 개발용 `npm install`은 사용자 에이전트 홈을 변경하지 않는다.

설치된 릴리스가 아직 스킬 설치 명령을 제공하지 않더라도 현재 로드한 이 스킬에서 `search`, `download`, `md`를 직접 사용할 수 있다. 최신 저장소 코드가 존재한다는 이유만으로 이미 발행된 구버전에 새 설치 기능이 있다고 말하지 않는다.

## 설치 후

스킬 자동 등록 경고나 충돌이 있으면 CLI 설치 성공과 구분해서 보고한다. 지원하는 버전에서는 다음 명령으로 명시적 등록을 재시도한다.

```bash
flucto skill install --agent all --skill flucto-media-research --if-missing
```

에이전트를 새로고침하거나 새 세션을 열어야 새 스킬을 발견할 수 있다. 기존 사용자 스킬·프로필·로그인 정보를 조용히 덮어쓰지 않는다.
