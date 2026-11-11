# STORE-05 — UI-09-H Android 실화면 8장 및 Google Play 등록 검증

기준일: 2026-11-11 (Asia/Seoul)
앱: 해비 자막 (`com.haebi.subtitle`)
기준 Android 원본: UI-09-H PR #52, commit `ede57b4d0c7c6b63d1a0c6e0a679fab1ce13c917`, GitHub Actions #42987366716.
Drive 원본 60장과 provenance: https://drive.google.com/file/d/1QhG0SS-B6yB8hBdAUKSIRWaLxnMSYloU/view

## 최신 8장 변경
기존 스토어 8장(Android 5-A source `a0116043`)을 UI-09-H Android 15 API35 에뮬레이터 화면 8장으로 교체한다.
원본 60장 모두 파일 존재·1080x2400·SHA-256/크기 검증 통과. 새 8장은 1080x1920, 원본 화면을 균일 축소하여 678x1507로 배치, 잘림/가짜 UI/가짜 인식 결과 없음. 화면 외부에 간결한 제목·설명만 배치했다.
UI-09-H 캡처는 40초 합성 영상·27개 자막·작업 상태 fixture와 실제 Native 초기 준비 화면이다. 유료 인식, 실마이크 정확도, Vosk 실제 모델 설치/전사 수행 근거가 아니다.
화면 순서: 새 작업 / 작업 기록 / 영상 연결 결과 / 27개 자막 편집 / 연결 설정 / 온디바이스 마이크 / GPT 실시간 / Vosk 로컬 AI.
최신 파일 SHA-256 및 원본 SHA는 `assets/play-store/ko-KR/capture-provenance-store05.json`와 `manifest.json`에 기록했다. 기존 `capture-provenance-5b.json`은 이력으로 유지한다.

## 기존 Play 등록 이력과 구분
Google Drive STORE-04 읽기 전용 2차(2026-11-11 04:08 UTC)는 Play 등록 이미지 5장, GitHub 8장 및 로컬 icon/graphic·fullDescription 불일치를 보고했다.
보다 나중의 STORE-03 등록 결과(04:25 UTC)는 Play API `api_committed_and_verified`, 전화 스크린샷 8장, 기존 icon/featureGraphic/listing text 보존으로 기록됐다.
과거 등록 성공은 UI-09-H 최신 이미지의 게시 성공을 의미하지 않는다. Alpha 비공개 트랙의 실제 게시 및 테스터 설치 상태도 증명하지 않는다.

## 등록 안전 범위
GitHub PR의 신규 파일 8개·manifest·회귀 테스트·정확한 STORE-05 라우트만 변경한다. Icon 512x512/feature 1024x500, 사용자 앱 코드, API/SQLite, 서명/AAB, versionCode, 스토어 문구, internal/alpha 트랙을 변경하지 않는다.
검증 완료 뒤 정확한 squash 제목 `store: STORE-05 trusted screenshot registration [listing-only]`로 main 병합하면 기존 신뢰 워크플로가 `listing` 모드로 8개 스크린샷만 1회 업데이트한다. 본 검증 전에는 Play API 쓰기 시도하지 않는다.
`scripts/release/listing.py apply --phone-only`는 이미지 이외 등록정보 보존, 새 Edit commit, fresh Play API SHA-256 재조회 또는 미변경 no-op을 확인한다. 실패·403 발생 시 반복하지 않는다.
Play API 등록 성공은 Play Console 실제 심사·노출·테스터 설치 성공과 별개다.

## Drive 보관
최신 8개 PNG 및 SHA 매니페스트/ZIP/미리보기: https://drive.google.com/drive/folders/1g8K1DoqeSONJJcO6Mh0al9LQLJGEAuOb
원본 ZIP: https://drive.google.com/file/d/1qoWdiF47vI3g4cma8TINk0Top9ptw5sE/view

## 최종 판정
현재 상태: Android 원본·로컬 이미지 8장 검증 완료, 최신 PNG를 GitHub PR로 검수·병합할 예정. 새 이미지 Play 반영 결과는 해당 workflow 종료 후 별도 기록해야 한다.
