# UI-10-I — 자막라인 스토어 자산 및 출시 전 검증

- 대상: `hebi10/subtitle-workbench`, Android `com.haebi.subtitle`.
- UI-10-H PR #73 병합된 `main`: `63cf896d60dbda377174c6c323a6c8ce5ef1b4a9`.
- 원본 Android 15/API35 Pixel 6 실화면: `b57afccc2850f35cb675a837ff0d5437edad0936`, GitHub Actions #43562836588.
- 캡처와 현재 `main`의 앱 화면 소스(`android/app/src/main`, `android/web`, `src`, `index.html`)가 Git diff 기준 일치함을 이미지 생성 작업 #43816017919에서 검증.
- 새 스토어 산출물: `assets/play-store/ko-KR/`의 1080×1920 Android 실제 화면 8장, 자막라인 512×512 아이콘, 1024×500 대표 그래픽.
- 이미지마다 실제 PNG SHA-256, 원본 캡처 경로·해시, 소스 및 동등한 main SHA를 `manifest.json`과 `capture-provenance-ui10.json`에 기록.
- 이미지의 자막 편집 화면은 실제 Android 에뮬레이터 캡처이며, 실제 마이크 인식이나 유료 모델 성능을 입증하지 않음.
- 캡처 레이아웃에는 원본 화면을 자르거나 재구성하지 않고, 앱 화면 밖에만 설명을 배치.
- 이미지 생성 코드: `scripts/ui10i/build_store_assets.py`. 실제 바이너리는 검증용 브랜치에만 커밋.
- 사전 검증: `python3 scripts/release/ui10i_preflight.py --capture-sha 63cf896d60dbda377174c6c323a6c8ce5ef1b4a9 --require-assets-ready`.
- 위험 통제: 기존 서명/패키지/데이터 저장 구조 및 Native 브리지 수정 없음. 자동 Google Play 업로드 없음.
- 병합 이후 최신 `main` CI·보안 정책 감사, 수동 서명 빌드, 동일 AAB 내부 테스트 게시·Play readback은 서로 독립적인 단계.

**내부 테스트·Google Play 업로드 및 비공개 승격 완료를 이 문서만으로 주장하지 않습니다.** 이미지 자동생성 워크플로의 일회성 실행 성공은 Play 등록정보 변경 승인이 아닙니다.
