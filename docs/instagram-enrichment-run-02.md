# Instagram 보강 실행 기록 02 — 2026-10-21

## 승인·범위
사용자가 “작업을 진행해보자”라고 승인한 뒤 기존 실행기로 다음 최대 50계정을 순차 조회했다. 완료된 최초 10계정은 resume으로 건너뛰었다. 코드 수정, 설치, 유료 API, 커밋, 푸시, 배포는 수행하지 않았다.

## 실제 실행
저장소 루트에서 아래 명령을 실행했다. 50계정 모두 status=observed, stopped=false로 종료됐다. 차단/로그인/보안 확인은 이번 배치에서 관찰되지 않았다.

```bash
node scripts/instagram-enrichment.mjs \
  --input /home/declan/Documents/momcalendar-instagram-targets-2026-10-21.json \
  --output /home/declan/Documents/momcalendar-instagram-checkpoint-2026-10-21.jsonl \
  --resume --limit 50
```

첫 신규 계정 `yaksa_nam`부터 마지막 `kidikidi_kr`까지 처리했다. 마지막 팔로워 화면 표시값은 17.9만이었다.

## 시트 반영과 검증
- 수정 전 공개 CSV export를 Documents에 별도 백업했다.
- 실제 시트의 D열 계정명과 체크포인트 계정명을 대조한 후 O12:Q61만 agbrowse의 셀 붙여넣기로 수정했다.
- 새로고침 후 O12와 O61을 화면에서 확인하고 저장 표시를 확인했다.
- 수정 후 CSV export와 백업을 대조했다: 1,100계정 유지, 모든 행의 A:N 동일, 최초 10계정 동일, 나머지 미처리 1,040행 전체 동일. 수정한 50행의 팔로워와 판매/홍보 URL이 수집 결과와 일치했다.
- 스크린샷: `/home/declan/.browser-agent/screenshots/screenshot_1792562374973.png`, `/home/declan/.browser-agent/screenshots/screenshot_1792562401759.png`.

## 누적 상태
- 공개 팔로워 표시값 확인 및 시트 반영: 60 / 1,100계정.
- 판매·홍보 URL 또는 링크 허브 반영: 56계정.
- 링크 미확인: 4계정 — ballet_jy, yoga.by.tammy, lavie_rim, urra_story. 일부에는 후보 링크가 있으므로 “자사몰 없음”으로 단정하지 않았다. 프로필 소유권, 실제 거래 가능 여부, 팔로워의 정밀 정수는 검증하지 않았다.
- 미처리: 1,040계정.
- 작업은 종료 상태이며 백그라운드 프로세스는 실행하지 않았다. 다음 실행은 동일 명령으로 완료된 60계정을 건너뛰고 진행할 수 있다.

## 파일
모두 `/home/declan/Documents/` 아래:
- `momcalendar-sheet-before-batch03-2026-10-21.csv`: 이번 수정 전 시트 백업.
- `momcalendar-prospects-enriched-first60-2026-10-21.csv`: 수정 후 실제 시트 CSV export.
- `momcalendar-batch03-summary-2026-10-21.json`: 신규 50계정 요약.
- `momcalendar-instagram-checkpoint-2026-10-21.jsonl`: 원시 근거 60계정 누적. 이전 기록을 삭제하거나 수정하지 않았다.

## 한계
이 배치의 성공은 1,100계정 전수 완료나 차단 없는 대량 실행의 보장이 아니다. 신규 DOM/링크 허브/비공개 계정/호출 제한을 만나면 설계된 중단·검토 절차를 따른다. 이번 턴은 데이터 실행만 수행했으므로 테스트를 재실행했다고 주장하지 않는다.
