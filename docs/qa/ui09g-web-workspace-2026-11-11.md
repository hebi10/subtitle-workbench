# UI-09-G — 웹 생성·편집·내보내기 3탭 보완

기준일: 2026-11-11
프로젝트: hebi10/subtitle-workbench
기준: Google Drive Editorial Studio 2.0 UI-09 기획·실제 Android 15 기준 캡처.

## 핵심 변경
- **생성**: 파일/길이/API 연결 준비·진행·오류의 실제 상태에서 다음 행동을 파생해 표시. 원래 생성 버튼과 키·Worker 보안 계약 불변.
- **편집**: 자막 없음/검색결과 없음/자막 검수 개수와 원본 영상 연결 여부를 알림. 기존 영상 대조, 선택 자막/시간·원문·번역·화자, 검색·편집 이력/싱크 기능 유지.
- **내보내기**: 자막 없음/번역 부분 결과(원문 보존)/번역 실패/Blob 준비 오류/준비 완료 안내. SRT 기본·VTT/JSON 보조와 브라우저 다운로드 요청-실제 저장의 차이를 명시.
- **반응형**: 모바일 760px 이하의 상태 메시지 간격·높이 및 영상 미리보기 최대 높이 220px. 무채색, 반경/그림자 없는 기존 디자인 유지.

## 변경 파일
index.html, styles.css, src/app.js, android/tests/editorial-4a-web.test.mjs, android/tests/editorial-2-3c-web-export.test.mjs, docs/qa/ui09g-web-workspace-2026-11-11.md.

## 검증·보존
기존 파일/자막·작업 결과 및 브라우저 Blob/MIME/다운로드·키 보관/삭제·실패 재시도 로직 불변. 320·390·800·1280px, 라이트/다크, 자막 미연결, 필터 결과 없음, 번역 대기·오류 및 SRT/VTT/JSON 요청/재시도. Node/Playwright + Android JVM/Lint/APK + Android15(API35) 에뮬레이터 CI와 실제 화면 캡처를 최종 PR SHA에 매칭한다. Google Play 신규 AAB/리스트/트랙은 건드리지 않으며 CI 통과 뒤 [skip-play] Squash 병합한다.

다음: UI-09-H — 전체 통합 QA. 물리 기기/유료 API 인식 품질은 별도.

## 390px 실제 화면 시각 검수 후속
기존 CI 생성 390px 세 탭 캡처를 대조하여, 생성 안내는 파일 선택 뒤에 두고 편집/내보내기 안내는 긴 미디어·결과 목록보다 먼저 보이도록 DOM 위치를 조정했습니다. 또한 361~760px에서는 내보내기 요약을 2열로 배치해 단일 열로 길게 늘어나는 문제를 줄였습니다. 360px 이하의 한 열 구성과 전체 자막·다운로드 기능은 유지합니다.
