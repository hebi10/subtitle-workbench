# UI-09-A — 실제 화면·상태별 QA 기준선

기준: 2026-11-11 · 패키지 com.haebi.subtitle · 작업 브랜치 qa/ui09a-state-matrix-20261111

## 목적과 이전 한계

기존 5-A 캡처는 영상이 없는 1개 SRT 자막을 중심으로 만들어졌다. 이번 단계는 제품의 UI 코드를 수정하지 않고 다양한 사용자 상황을 실제 Android 15 에뮬레이터에서 재현하여 UI-09-C~H의 기준 화면을 확보한다.

## 데이터 출처

- 영상 연결: GitHub Actions에서 ffmpeg testsrc2로 생성한 40초 MPEG-4 합성 영상이다. Android MediaStore에 실제 재생 가능한 동영상으로 저장하고 Android MediaMetadataRetriever에서 36초 이상의 길이를 확인한다. 사용자의 개인 영상은 사용하지 않는다.
- 자막: 27개 자막(원문·번역·화자 A/B)과 별도의 15개 SRT-only 작업을 Android JobStore에 테스트 전용으로 저장한다. 자막 12개 단위 페이지·검색/이동·영상 미리보기 활성화 여부를 확인한다.
- 준비/일시정지/오류: Android JobStore에 별도로 넣는 QA 상태 기록이다. 실제 API 오류나 완료된 유료 처리로 주장하지 않는다.
- 진행 화면: 앱 실행 후 상태를 running으로 변경하는 **UI용 시뮬레이션**이다. 실제 음성 인식 워커 실행·네트워크 전송·처리율 검증이 아니다. 파일명 seeded-running-status-no-worker로 표시한다.
- 네이티브: 온디바이스·GPT 실시간·Vosk Activity 화면의 초기 상태만 캡처한다. 실제 마이크 사용, GPT 과금 요청, Vosk 모델 설치는 수행하지 않는다.
- Chromium: 웹 생성·편집·내보내기, Android 스타일 jobs/editor 화면을 기존 Playwright로 렌더링한 모의 데이터 기반 브라우저 캡처이다. Android 에뮬레이터 원본과 분리한다.

## 대상 화면과 환경

Android 15 API35 Pixel 6 · 라이트/다크 2종 × 글꼴 100/160% 2종.

Android WebView 스크린샷 12상태: 새 작업 빈 화면, 작업 목록 빈 화면, 완료·준비·오류·일시정지 목록 첫 페이지, 두 번째 페이지, 실제 테스트 영상 연결 결과, 자막 27개 편집, 두 번째 자막 페이지, 영상 미연결 결과, 영상 미연결 편집, 설정 접힘, 설정 펼침, 가상 진행 상태.

예상 결과는 WebView 48장 + Native 12장 = **실제 Android 캡처 60장**. 실제 성공 여부는 전용 CI 결과에 따라 결정한다.

## 검증 범위 및 후속 연결

- 새 작업: 파일·마이크·Vosk 진입/연결 필요 조건 → UI-09-C.
- 작업 목록: 진행·준비·일시정지·완료·오류·긴 파일명·페이지 → UI-09-D.
- 결과/편집: 영상 연결 여부, SRT/VTT/JSON, 자막 27/15개, 타임코드, 페이지 → UI-09-D/E.
- 설정 및 Native: 연결·비용·모델·접기/펼치기 → UI-09-F.
- 웹 3탭: Chromium에서 모바일·데스크톱 및 테마별 화면 → UI-09-G.
- 공통: 가로 넘침·하단 메뉴 48dp·글꼴 확대·접근성 상태 → UI-09-H.

## 자동화 및 안전 게이트

1. GitHub PR Verify web and Android 웹·Android 단위, Lint, debug APK CI.
2. 전용 .github/workflows/ui09a-state-baseline.yml의 Android 계측 4환경 테스트. 실제 Android 캡처 60장과 로그·PNG SHA-256 매니페스트 생성.
3. Chromium 캡처는 별도 아티팩트와 별도 매니페스트로 관리한다. 실화면과 브라우저 모의를 혼합하거나 출처를 바꾸지 않는다.
4. 캡처 누락·예상 DOM 상태 불일치·영상 재생 가능성 검증 실패·가로 넘침 발생 시 실패 처리한다.
5. QA용 Android 작업 행과 MediaStore 테스트 영상을 해당 ID만 삭제한다. 다른 데이터는 변경하지 않는다.
6. 최종 검수 후 Google Drive 07_SubtitleWorkbench_자막편집/04_검증_및_보완에 Android/Web 아티팩트를 따로 백업한다.
7. 이번 PR은 기존 앱 실행 코드·SQLite 정책·Secret·서명·API 연결·AAB·Google Play 테스트 트랙/스토어 등록정보를 변경하지 않는다. main 병합은 [skip-play]로 진행한다.

## 별도 실기기 검증 항목

실제 사용자 휴대폰의 TalkBack·IME·회전, 마이크 권한, 유료 API 전사·번역 정확도, 모델 다운로드와 Vosk 성능, 실제 오류/중단 후 복구 및 전 구간 처리율, Play Console 심사·테스터 설치는 이번 결과로 완료 판정하지 않는다.

## 기준 자료

- UI-09 계획 Google Docs: https://docs.google.com/document/d/173tB-fnTHztgRHDsjAVV1MAgir74aSxrNUUznhm7HNg/edit
- 5-A 이전 실제 Android 원본: https://drive.google.com/file/d/14yapYoaAGrhDgqnekf2v27KyF_y4XUzv/view
- STORE-02 8장: https://drive.google.com/file/d/1xihMfCBol91CIZUV7_KotcNUzQOMOkAG/view
