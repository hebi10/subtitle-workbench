# SW-FIX-10 — 브랜드·스토어 자료 현행화 및 검토 게이트

기준 main 950980ff71970d4bf0cfeb8bc0ac02d5818ab448. 표시명 자막라인 및 com.haebi.subtitle 유지. 최종 통합 후 노트/화면을 다시 검토한다.

## 현재 자료

- `listing-ko.json`: 로컬 초안. 기존 자막 가져오기·작업 복구·재요청 비용 및 개인 API와 앱 구독의 구분을 보강.
- `release-notes-ko.txt`: 병합 완료된 SW-FIX-04~07의 Android 변경 중심으로 갱신. 웹 IndexedDB를 Android 기능으로 소개하지 않는다. 배포 전 최종 버전의 실제 변경 범위 확인.
- 브랜드 원본 `assets/brand/canonical.json`은 승인 당시 자산의 역사적 기준. 새 브랜드 승인이나 로고 교체 없음.
- `assets/play-store/ko-KR/manifest.json`의 8장은 2026-11-14 UI-10-I 실제 Android 에뮬레이터 화면에서 작성. 원본 run 43562836588, source b57afccc2850f35cb675a837ff0d5437edad0936, 당시 동등 main 63cf896d60dbda377174c6c323a6c8ce5ef1b4a9. 이후 UI 변경이 있으므로 최신 이미지로 간주하지 않는다.
- `Capture Play Store screenshots`는 Chromium+Native fixture의 실제 HTML 렌더링이며 실제 Android 네이티브 캡처나 유료 인식 성능 증거가 아니다. 해당 이미지로 공식 Android 화면을 대체하지 않는다.

## 최종 QA 재사용

1. #88~89 및 모든 개발 PR 병합 후 최종 main SHA를 동결한다.
2. 동일 SHA의 **Android Emulator Smoke** 전체 검증을 1회 실행한다. 성공한 main run ID 및 subtitle-emulator-integration 산출물을 확보한다.
3. [스토어 이미지 검토 워크플로](https://github.com/hebi10/subtitle-workbench/actions/workflows/store-assets-review.yml)를 main에서 실행한다. expected_main_sha와 capture_run_id를 입력한다. 성공한 동일 SHA의 실제 Android QA만 사용하며, PNG 8장·아이콘·대표 그래픽·SHA 및 원본 경로를 검토 artifact에 생성한다. 기존 추적 이미지·브랜드를 변경하지 않고 Play 접근/업로드·서명 빌드를 수행하지 않는다.
4. 실제 생성 산출물의 화면·문구·텍스트 잘림·개인정보·광고 및 유료 연결 표시를 시각 검수한다. 승인된 검토 이미지의 변경만 별도 PR로 반영하고 동일 UI 소스인지 확인한다.
5. 실제 Play 등록은 별도 승인 및 readback으로 확인한다. 비공개 테스트 오류, AdMob·구독·심사 서버 운영 확인은 SW-FIX-01~03의 미완료 게이트로 유지한다.

이번 PR은 설명·검토 자동화 및 출처 검증 보강이다. 실제 최종 SHA 캡처, 신규 PNG 교체, 스토어 게시, 운영 결제 검증은 수행하지 않았다.
