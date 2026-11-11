# STORE-02 — 최신 Android 실제 화면 8장

기준일: 2026-11-11 (Asia/Seoul)
앱: 해비 자막 (`com.haebi.subtitle`)
원본: [Android 15 에뮬레이터 실제 화면 #42790689154](https://github.com/hebi10/subtitle-workbench/actions/runs/42790689154)
생성: [STORE-02 GitHub Actions #42950303249](https://github.com/hebi10/subtitle-workbench/actions/runs/42950303249)
코드 리뷰: [PR #40](https://github.com/hebi10/subtitle-workbench/pull/40)

## 원본 최신성

원본 실행 커밋은 `a0116043a2187da368c2cae57c6e8976bf023466`이고, 2026-11-10 완료한 Android WebView 5화면 및 Native 3화면이 포함되어 있습니다. STORE-02 생성 워크플로에서 이 원본 실행의 커밋 SHA를 조회한 뒤, 최신 STORE-02 코드의 앱 UI 소스 파일과 Git blob 단위로 일치하는지 검증합니다. 코드가 다르면 결과를 생성하지 않습니다.

## 8장 구성

| 번호 | 파일 | 실제 앱 화면 | 원본 모드 |
|---|---|---|---|
| 01 | 01-video.png | 영상·음성 파일 선택 | WebView 라이트 |
| 02 | 02-jobs.png | 자막 작업 기록 | WebView 다크 |
| 03 | 03-results.png | SRT/VTT/JSON 결과 저장 | WebView 라이트 |
| 04 | 04-editor.png | 자막 시간·원문·번역 편집 | WebView 다크 |
| 05 | 05-settings.png | API 및 언어 설정 | WebView 라이트 |
| 06 | 06-on-device.png | 온디바이스 마이크 | Android Native 라이트 |
| 07 | 07-cloud-live.png | GPT 실시간 마이크 | Android Native 다크 |
| 08 | 08-vosk-local.png | Vosk 오프라인 AI | Android Native 라이트 |

모두 1080×1920 PNG입니다. Android 15 실제 캡처 이미지를 그대로 유지하고 비율을 맞춰 축소했으며, 앱 화면 바깥의 타이틀·설명만 추가했습니다. WebView 5화면의 작업 데이터는 QA용 예시이며 Native 3화면은 실제 녹음·모델 실행 전의 화면입니다. 이미지 합성으로 가짜 앱 UI를 만들지 않았습니다.

## 검증 및 보관

- 검증 원본 및 각 출력 PNG의 SHA-256, 실제 스크린샷의 배치·크기: `assets/play-store/ko-KR/capture-provenance-5b.json`
- Play 이미지 목록 및 산출물 해시: `assets/play-store/ko-KR/manifest.json`
- `scripts/release/listing.py check --phone-only` 및 `android/tests/editorial-5b-store-assets.test.mjs` 검증 통과
- [Google Drive ZIP 백업](https://drive.google.com/file/d/1xihMfCBol91CIZUV7_KotcNUzQOMOkAG/view)
- [프로젝트 Drive 스토어 자료 폴더](https://drive.google.com/drive/folders/1vIp7j7VT5hzUu9LHlayk0iike5Zabbpz)

## 변경하지 않은 항목

앱 아이콘, 대표 그래픽, 스토어 제목·설명, Android 실행 파일, 패키지명, Play 테스트 트랙, 서명·Secret은 변경하지 않았습니다. 생성·파일 무결성 검증은 실제 Google Play 등록 성공을 의미하지 않습니다.

## 다음 단계

**STORE-03 — Google Play 이미지 등록 자동화**: 기존 WIF 허용 경로와 이전 이미지 등록 요청의 HTTP 403을 먼저 분석하고, 이미지 8장만 등록해 Play API 새 edit의 해시와 기존 아이콘·대표 그래픽·설명 불변 여부를 재확인합니다. Console 심사·테스터 노출은 별도 판정합니다.
