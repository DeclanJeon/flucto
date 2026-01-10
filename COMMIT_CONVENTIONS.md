# Conventional Commits

이 프로젝트는 [Conventional Commits](https://www.conventionalcommits.org/) 사양을 따릅니다. 이를 통해 자동으로 버전 관리와 CHANGELOG 생성이 됩니다.

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Type

- **feat**: 새로운 기능
- **fix**: 버그 수정
- **docs**: 문서만 변경
- **style**: 코드 형식, 세미콜론 누락 등 (코드 변경 없음)
- **refactor**: 코드 리팩토링 (새로운 기능이나 버그 수정이 아님)
- **perf**: 성능 향상
- **test**: 테스트 추가 또는 수정
- **build**: 빌드 시스템 또는 외부 의존성 변경
- **ci**: CI 구성 파일 및 스크립트 변경
- **chore**: 기타 변경사항

## Examples

### Feature (새 기능)
```bash
git commit -m "feat(downloader): YouTube 동영상 다운로드 기능 추가"
```

### Bug Fix (버그 수정)
```bash
git commit -m "fix(ui): 다운로드 중 진행률이 표시되지 않는 문제 수정"
```

### Breaking Change (주요 변경)
```bash
git commit -m "feat(core): 다운로드 API 재설계

BREAKING CHANGE: download() 함수 인자 구조가 변경되었습니다."
```

### Documentation (문서)
```bash
git commit -m "docs: README.md에 사용 가이드 추가"
```

## 자동 버전 관리 규칙

- **feat**: MINOR 버전 증가 (예: 1.0.0 → 1.1.0)
- **fix**: PATCH 버전 증가 (예: 1.0.0 → 1.0.1)
- **BREAKING CHANGE**: MAJOR 버전 증가 (예: 1.0.0 → 2.0.0)
- 그 외 타입: 버전 변화 없음

## 주의사항

- Commit 메시지는 한국어로 작성해도 됩니다
- `[skip ci]`를 메시지에 포함하면 CI/CD가 스킵됩니다
- main/master 브랜치로 push될 때 자동으로 release가 생성됩니다
