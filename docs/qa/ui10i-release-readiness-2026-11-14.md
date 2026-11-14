# UI-10-I — 최신 스토어 자산·내부 출시 사전 검증

기준: Google Drive UI-10-I와 BRAND-02 QA. 이번 PR은 Google Play 업로드·스토어 문구 변경·AAB 빌드·트랙 승격을 실행하지 않습니다.

현 저장소의 8개 스토어 화면은 UI-09-H 2026-11-11 Android 15 에뮬레이터의 구버전 원본 커밋 ede57b4d0c7c6b63d1a0c6e0a679fab1ce13c917을 사용합니다. 이후 자막라인 브랜드와 UI-10 E/F/G/H가 변경되었으므로 현재 버전 최신 실캡처라고 주장할 수 없습니다. 현재 listing-ko.json은 자막라인인데 capture-provenance-store05.json은 옛 앱명 해비 자막을 기록합니다. 과거 승인된 512x512 아이콘·1024x500 대표 그래픽과 Drive BRAND-02 비공개 STAGING 시안도 새 브랜드 정식 업로드 승인의 근거가 아닙니다.

새 도구 scripts/release/ui10i_preflight.py는 읽기 전용으로 PNG 실제 바이트 SHA-256, 매니페스트, 이미지 크기(아이콘 512x512/대표 1024x500/8화면 1080x1920), Android 원본 source SHA, 출처 JSON, 브랜드 문구를 비교합니다. --capture-sha 매개변수에는 H가 검증한 Android 15 실캡처 소스 커밋을 넣어야 합니다. 현 오래된 캡처는 blocked가 정답이며, 선택형 --require-assets-ready 에서만 종료 상태 2를 반환합니다. 테스트 scripts/release/tests/test_ui10i_preflight.py는 구버전 이미지가 잘못 승인되지 않는지 검증합니다.

최종 I 출시 진입 게이트:
1. E F G H 순차 main 병합 및 최신 main 전체 CI 성공.
2. 동일 최종 소스 SHA의 Android 15 8화면 실캡처 + 실기기/상태별 QA 증빙, 캡처 PNG SHA-256.
3. 자막라인 실제 인앱 화면을 바탕으로 1080x1920 스토어 이미지 8장, 새 아이콘/대표그래픽 최종 디자인 승인.
4. PNG/매니페스트/브랜드 재감사. 기존 mock 이미지/이전 앱명 원본 업로드 금지.
5. 최종 서명 AAB, versionCode, signer와 SHA-256 검증은 별도 승인.
6. Play internal 업로드 명시적 승인 후 Google Play API/Console readback 및 실제 테스터 설치 확인.
7. 이전 closed alpha edits.validate HTTP 400 INVALID_ARGUMENT 해결 및 별도 승격 승인 전 자동 재시도 금지.

현재 GitHub 코드/Drive 기준의 사전 검사일 뿐 실제 Play Console, 앱 설치, 유료 AI/Vosk, 진짜 실기기 동작 테스트는 증명하지 않습니다. AGENTS.md 수동 승인 및 [skip-play] 준수.
