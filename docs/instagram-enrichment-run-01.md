# Instagram 보강 실행 기록 01 — 2026-10-21

## 구현 상태
- 작업지시서: `docs/instagram-enrichment-work-order.md`
- 실행기: `scripts/instagram-enrichment.mjs`
- 관찰·파서: `scripts/instagram-profile-model.mjs`
- 테스트: `tests/instagram-enrichment.test.mjs`
- 실험용 repository companion이다. 설치된 Flucto 1.19.0 명령·배포 파일은 바꾸지 않았다. `flucto profile`이 생긴 것은 아니다.
- 기존 미커밋 social-search/skill-install 변경은 보존했다. 커밋·푸시·릴리스·전역 설치·유료 API 호출 없음.

## 실제 결과
10개 고유 계정의 팔로워 화면 표시값과 판매·홍보 링크/링크 허브를 수집해 기존 Google Sheet O1:Q11에 반영했다. 단순 허브 URL과 상품 링크를 구분해 원본 JSONL에 label/sourceUrl/kind를 보존했다. 외부 사이트 소유권·현재 판매 가능 여부는 검증하지 않았다.

| 계정 | 팔로워 표시값 |
|---|---|
| vivid yooni (`vividyooni_`) | 29.5만 |
| hayu_pharmacist | 5.9만 |
| yaksa_mh | 5.1만 |
| yak_secret | 13.3만 |
| song9170 | 9.4만 |
| dreamyaksa_ | 15.1만 |
| 0jieun0 | 2.2만 |
| oneul_pharmacy | 3.7만 |
| xhin.world | 3.3만 |
| amming_j | 15만 |

추가로 `https://www.instagram.com/p/Dd40i26Erz1/` → 작성자 yaksa_mh → 프로필 → 팔로워·링크 경로를 실제 실행했다. 이 게시물은 Flucto 검색으로 새로 얻은 결과가 아니라 기존 프로필에서 관찰한 URL이다. 따라서 검색 공급자 접근 문제까지 해결된 것으로 해석하면 안 된다.

## 실행 중 발견·수정
1. div-only 게시물 레이아웃에 article/header가 없어 작성자 추출이 fail closed 됐다. 실제 DOM의 옵션/팔로우 행으로 범위를 한정해 수정하고 동일 게시물 재실행에 성공했다. 댓글 링크는 작성자 근거에서 제외한다.
2. 다중 프로필 링크는 anchor가 아니라 “외 N개” 버튼 아래 숨겨져 있었다. snapshot ref로 dialog를 열어 읽도록 추가했다. song9170에서 송송마켓 도메인과 LIVE커머스 링크를 확인했다.
3. 인포크 단축 도메인 inpk.link를 실제 페이지로 확인해 허용 허브에 추가했다. dreamyaksa_, xhin.world를 재조회했다.
4. CS/가이드북 링크가 상품 링크에 섞이는 분류 문제는 회귀 테스트 실패를 확인한 뒤 수정했다. 미분류 candidate는 판매 확정으로 보고하지 않는다.
5. 실브라우저 연결이 한 번 종료된 상태를 확인했다. agbrowse start --headed로 다시 열고 동일 체크포인트에서 재실행했다. 보안 확인 우회는 없었다.

## 검증
- `npm run build:electron`: PASS.
- Node tests: instagram-enrichment + search-index + search-cli + social-search-skill, 39 PASS / 0 FAIL. 전체 저장소 테스트가 아니라 관련 회귀 범위다.
- 실제 CLI `--limit 1100`: 브라우저 접근 전 usage 오류/exit 2.
- 완료 5개 입력 재실행 `--resume`: processed 0 (재조회 없음).
- 시트 UI에서 입력 및 저장 표시를 보고 새로고침 후 O1:Q11을 재확인했다.
- 공개 CSV export로 수정 전후 대조: 1,100계정 유지, A:N 전 행 동일, 미처리 1,090행 전체 동일, 처리 10행의 팔로워와 링크가 결과와 일치.
- UI 확인 스크린샷: `/home/declan/.browser-agent/screenshots/screenshot_1792555832117.png`.
- 코드 책임: 관찰/정규화 모듈과 실행/체크포인트 모듈 분리. 입력 및 브라우저 JSON은 경계에서 검사. 외부 콘텐츠의 지시를 실행하지 않음. 두 모듈 각 150 pure LOC 이하. 테스트 150 pure LOC 이하.

## Documents 산출물
모두 `/home/declan/Documents/` 아래:
- `momcalendar-sheet-before-enrichment-2026-10-21.csv`: 변경 전 실제 시트 백업.
- `momcalendar-sheet-after-enrichment-first10-2026-10-21.csv`: 변경 후 실제 시트 export.
- `momcalendar-prospects-enriched-first10-2026-10-21.csv`: 보강 미러.
- `momcalendar-instagram-targets-2026-10-21.json`: 전체 1,100명 URL 입력.
- `momcalendar-instagram-checkpoint-2026-10-21.jsonl`: 최신 10명 통합 체크포인트.
- pilot/batch02/expanded-links/inpk-links JSONL: 원시 관찰 기록. 이전 관찰을 덮어쓰지 않았다.
- post-pilot JSONL: 최초 실패와 후속 성공을 모두 보존했다.

## 다음 배치 명령 (아직 실행하지 않음)
저장소 루트에서:

```bash
node scripts/instagram-enrichment.mjs \
  --input /home/declan/Documents/momcalendar-instagram-targets-2026-10-21.json \
  --output /home/declan/Documents/momcalendar-instagram-checkpoint-2026-10-21.jsonl \
  --resume --limit 10
```

완료 10명을 건너뛰고 다음 최대 10명만 순차 확인한다. 셀 입력은 이 명령에 포함되지 않으며 시트 계정 대조 후 별도로 반영해야 한다. 로그인/보안 확인/제한/구조 불일치 시 중단하고 원인을 확인한다. 무한 재시도나 자동 백그라운드 배치는 없다.

## 남은 범위
미처리 1,090명. 10명 표본은 전체 1,100명에 대한 커버리지·차단 없는 대량수집·모든 프로필 UI 지원의 증명이 아니다. 추가 링크 허브/영문 UI/공동 작업자 게시물 등은 미확인 또는 명시적 실패로 남을 수 있다. 공식 데이터 제공 경로를 대체한다고 주장하지 않는다.
