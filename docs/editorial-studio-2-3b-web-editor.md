# Editorial Studio 2.0 · 3-B 웹 자막 편집 화면

## 범위와 목표
- 기존 웹 `panel-edit`의 자막 입력·영상 대조를 '영상/자막 미리보기 → 선택 자막 요약·탐색 → 상세 입력·검수 목록' 순서로 재정렬한다.
- PC에서는 영상 플레이어를 왼쪽, 편집 작업을 오른쪽의 두 열로 표시한다. 1180px 이하에서는 실제 DOM 순서대로 영상 위, 자막 편집 아래에 표시한다.
- 현행 `videoPreview`와 `mediaPlayer`는 생성·편집에서 하나의 DOM 인스턴스를 이동하여 공유한다. 미디어 없는 자막 입력도 허용한다.

## 구현
- `editorCueContext`: 현재 선택 자막 번호, 원문·번역, 시작/종료, 화자 안내. 내용은 사용자의 실제 자막과 입력값만 반영하며 오류 상태/번역 실패를 가장하지 않는다.
- `editorPrevCue`, `editorNextCue`: 현재 검색/검수 필터에 표시된 자막만 탐색한다. 첫/마지막에는 해당 버튼을 비활성화한다.
- `editorFocusCue`: 선택한 자막의 원문 입력란으로 스크롤·포커스 이동. 탐색 자체는 강제로 소프트 키보드를 열지 않는다.
- 실제 자막 입력란 포커스나 클릭으로 현재 선택 자막을 변경하되 입력 요소를 교체하지 않는다. 원문·번역 입력 중 선택 자막 요약만 즉시 갱신하고, 기존 change 시점 데이터 적용·Undo/Redo·내보내기 계약은 보존한다.
- 선택 자막과 영상 재생 시점의 활성 자막은 서로 독립된 강조 방식이다. 시간 순으로 정렬된 기존 인덱스와 검색·필터·결과 전환 시 선택 상태를 조정한다.
- 빈 결과와 필터 0건에서는 선택 요약을 숨기고 이동 버튼을 비활성화한다.
- 명시적 안내: 수정 사항은 현재 페이지 동안만 유지되며, 닫기 전에 내보내기로 파일 저장해야 한다.

## 보존
- 기존 HTML ID/이벤트: editorSearch, editorStatusFilter, editorGlobalOffset, applyGlobalOffset, mergeShortSubtitles, undoEdit, redoEdit, editorBody, subtitleFile, attachMediaFile, videoPreview, subtitleDisplayMode, subtitleSyncReset, 자막별 time/speaker/original/translated, split/merge/shift/seek 모두 유지.
- 새 프레임워크/의존성, 원격 API·데이터 계약, 로컬 파일·키 보관 동작, 실제 클라우드 자동 저장, MP4 영상 합성 기능을 추가하지 않는다.
- 기존 라이트·다크 토큰, 기본 48px 터치 크기, 전체 테두리, 0px 반경, 그림자 없는 UI.

## 변경 파일
- index.html
- styles.css
- src/app.js
- tests/markup.test.mjs
- android/tests/editorial-2-3b-web-editor.test.mjs
- docs/editorial-studio-2-3b-web-editor.md

## 검증
- 웹 단위/브라우저 워크플로/Android CI 및 Playwright UI 회귀 테스트.
- 320/390/800/1280px 및 라이트·다크에서 가로 넘침, 390px+ 실제 캡처, 파일 없는 자막/검색 결과 0건/선택 이동/IME 포커스/결과 전환 검증.
- 실제 유료 API 요청·FFmpeg 처리·Play 스토어 업로드 없이 Mock Browser 회귀로 검증. PR HEAD CI 성공과 이미지 검수 이후에만 [skip-play] Squash 병합.
- Google Play 내부/비공개 테스트 트랙, 서명, 등록정보는 변경하지 않는다.

## 다음 단계
3-C — 웹 내보내기 화면 리디자인. SRT 기본, VTT/JSON 보조·파일 다운로드 상태 정리.
