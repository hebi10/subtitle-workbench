# SW-FIX-11 — 최종 QA 체크리스트 및 실행 근거

기준 main 2778a9b87d9931fb748dd914ba39db6a62a98be2. SW-FIX-09 병합 전이므로 최종 실행을 하지 않는다.

| 구분 | 검증 방법 | 완료 조건 |
|---|---|---|
| 소스 통합 | #89 및 이번 QA 보강 병합 | 동결 main 동일 SHA |
| 웹/Android 기본 | Verify web and Android + OPS-08 | 최신 main CI 성공, 미해결 리뷰 없음 |
| 기기 기능 | Android Emulator Smoke, API35 | 기존 전체 화면/테마/160% 글꼴/키/오프라인/작업 승인 성공 |
| 데이터 보존 | 추가 JobStore/MediaChunks 기기 테스트 | 원본·기존 자막·SQLite 이전·취소 검증 통과 |
| 프로세스 종료 | seed/verify 및 seed-paid/verify-paid | 저장된 구간 유지, 불확실한 유료 단계 자동 재요청 차단 |
| 트랜잭션 종료 | uncommitted 마커 확인 후 테스트 앱 force-stop 및 verify | 커밋 전 변경 롤백, 이전 체크포인트 유지 |
| 장시간 | 180분 합성 MP4, 26구간 | 모든 구간 완료 마커·단일 기기 테스트 성공 |
| 스토어 | store-assets-review.yml | 동일 성공 QA run의 실제 PNG 8장/원본 SHA 및 시각 검수 |
| 광고/결제 | monetization-readiness 및 실제 운영 확인 | 운영 ID·HTTPS 검증·Integrity·Play 상품·테스트 구매 상태 |
| 심사 서버 | 운영 연결 및 review-relay probe | 실제 HTTPS/인증/모델 접근·심사 안내, 승인 범위의 실동작 |
| 실물 기기 | 사용자 테스트 | 폴드/태블릿·키보드·TalkBack·오디오/배터리·발열 |
| 배포 | 별도 승인 | SW-FIX-12 및 Play 게시 검증 |

실제 API 청구/3시간 전체 음성인식 및 물리 기기 검증을 합성 영상/브라우저 fixture 통과로 대체하지 않는다. 운영 검증과 신규 이미지 시각 검수는 미완료. 스토어 업로드 없음.

최종 실행 URL: https://github.com/hebi10/subtitle-workbench/actions/workflows/android-emulator-smoke.yml
스토어 검토 URL: https://github.com/hebi10/subtitle-workbench/actions/workflows/store-assets-review.yml
운영 연결 확인 URL: https://github.com/hebi10/subtitle-workbench/actions/workflows/monetization-readiness.yml
