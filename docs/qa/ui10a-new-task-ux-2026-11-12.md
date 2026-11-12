# UI-10-A — 새 자막 작업 화면 정보 구조·사용성 개선

- 기준 소스: `main` `61f3ddfadfece76eea0480bf2cbe4620fae3786f`
- 구현 범위: `android/web/index.html`, `styles.css`, `app.js` 및 UI 회귀 테스트
- 구현 근거: [Drive 031 시안 정합성](https://docs.google.com/document/d/1R73gzMhZi6cWnrR_8cF9eSjBcOIIlJH-yoDEiXHIRm4/edit) · [Drive 032 구현 명세](https://docs.google.com/document/d/1PnkwPPL3r4cXI4ffz885gqeKuCXGaAY-qxA9pq3DjQk/edit)
- 디자인 기준: [UI-10 기획 PNG](https://drive.google.com/file/d/1gSpUDYgrt6Cm-g4ld-HwTzhUZkdFfr_m/view) / [Android 15 기존 캡처](https://drive.google.com/file/d/18Dm5-C0Uzie90UdqIwnmaacFQseerQ7s/view)

## 구현 차이

1. 첫 방문(`firstRunGuide`)과 재방문(`sourceChoices`)의 상호 배타적 노출은 유지. 첫 방문 안내는 작업 방식 3개를 먼저 표시하고 연결·모델 조건은 접을 수 있는 `details`로 옮겨 첫 행동을 강조.
2. 기존 버튼 `guideFile/Mic/Offline`, `chooseFile/Microphone/Offline`은 Native Bridge를 바꾸지 않고 같은 상세 섹션을 포커스·스크롤. `aria-pressed`와 `source-selected`를 동기화해 선택된 방식의 상태를 시각·접근성으로 전달.
3. 파일 카드의 설명과 API 연결 안내를 줄이고, `connectionSummary`의 저장됨/연결 확인됨/확인 실패 구분 유지. 연결 확인 오류 때는 별도 실패 안내 노출. `pickVideo`가 미연결이면 기존 설정 화면으로 이동.
4. `importSubtitles`는 API 연결 없이 사용 가능하며 `openOnDevice`와 `openOfflineModel` 접근도 개인 API와 독립. GPT 실시간은 별도 연결·요금 안내 유지.
5. 저장된 `prepared` 작업이 한 건 이상일 때만 `준비된 작업` 헤더 노출. 파일명·상태·모델 등의 실제 JobStore 카드 렌더링은 그대로 유지.
6. 기존 테마 토큰·평면 모양·48px 터치 영역을 재사용하며 320px에서 3가지 모드 버튼을 읽기 쉬운 세로 목록으로 정렬.

## 명시적 비변경

- Android `MainActivity`, `JobService`, `JobStore`, `Native Bridge`, 자막 생성·번역·파일 선택·내보내기·서명·Google Play 릴리스 설정 미변경
- `SRT`/`VTT`/`JSON` 데이터 형식·언어 설정·API 인증 및 Keystore 처리 미변경
- 생성 시안의 연결됨/모델 용량/가상 파일/요금/진행률을 실데이터처럼 추가하지 않음
- 새 라이브러리·컴포넌트 프레임워크·애니메이션·그라데이션·장식 그림자 미추가

## 검증 게이트

- `node --test android/tests/editorial-ui10a-new-task.test.mjs`: 정적 검증. `PLAYWRIGHT_MODULE` 환경이 있는 CI에서는 Chromium 실동작 검증도 실행.
- 첫 방문 상태(0 작업·미연결), 재방문(기존 작업 2건·API 저장), 파일 방식 선택의 설정 우회 금지, 무료 마이크·Vosk 진입, 실제 mock file picker로 준비된 작업 생성, 자막 가져오기, 선택 상태 동기화.
- 320/390/800px × 라이트/다크에서 넘침·버튼 최소 48px 및 주요 기능이 접근 가능한지 검증.
- `Verify web and Android`에서는 웹 단위·Playwright, Android JVM/Lint/APK, 보안 검사 확인. 기기 Android 15 계측은 PR Head 동일 SHA 검사 통과 전 병합하지 않음.
- 기존 `output/editorial-2-2a/`에 `ui10a-first-use-light-390.png`, `ui10a-returning-390-light.png`, `ui10a-returning-390-dark.png`를 생성하여 GitHub Actions 캡처 아티팩트에 포함.
- 이 캡처는 Chromium + mock Native Bridge 테스트 이미지이며 실제 Android Emulator PNG라고 표시하지 않음. 최신 Android 15 실화면은 별도 계측 후 Drive에 기록.

## 완료 조건 및 후속

`UI-10-A`는 실제 PR 코드가 존재하는 상태이며 CI/Android 실기기 계측 및 병합·배포 성공은 검사 결과 확인 이전에 단정하지 않음.

CI·캡처/접근성 검수 후 단계 종료. 다음은 `UI-10-B — 모바일 자막 편집 입력·저장 동선 개선`.
