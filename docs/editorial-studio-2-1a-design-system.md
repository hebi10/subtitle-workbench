# Editorial Studio 2.0 · 1-A 공통 디자인 시스템 보강

## 범위
0-A 상태별 화면 대조에 따라 기존 Editorial Studio 1-A/2-A 팔레트, HTML/JS 이벤트, Android Native Bridge를 바꾸지 않고 화면에서 재사용할 수 있는 의미 기반 스타일을 보강한다.

### 새 공통 토큰
- 간격: `--es2-space-{1,2,3,4,6,8}` = 4/8/12/16/24/32px
- 글자: `--es2-title-size`, `--es2-section-size`, `--es2-body-size`, `--es2-caption-size`
- 상태: `--es2-status-{ready,running,paused,completed,error}` 및 오류 경계색
- 색상은 기존 `--es-*` 시맨틱 팔레트 참조. 신규 보라색, 그림자, 라운드, 애니메이션 없음

### CSS 패턴
- `.es2-section-title`, `.es2-supporting-text`, `.es2-timecode`
- `.es2-action-row` — 주요/보조 버튼 구성
- `.es2-state-panel[data-state]` — 상태 텍스트가 기본이며 색상만으로 상태를 전달하지 않음
- `.es2-empty-state`, `.es2-progress`, `.es2-detail-toggle`

이번 단계는 **선택적으로 사용하는 공통 시스템**을 마련하는 작업이다. 기존 카드/버튼과 마이그레이션할 때 상태 데이터를 연결하며, 존재하지 않는 데이터로 성공·오류 상태를 꾸미지 않는다. 기존 화면 구조와 DOM ID를 변경하지 않는다.

### Native
- `NativeDesignSystem`의 DP/SP 공통 상수와 52dp 버튼 높이를 명문화한다.
- `statusPanel(view, state, density)`를 선택적으로 지원. 기본 버전은 기존 Live Region을 보존한다.
- 상태 문구는 화면에서 명확히 제공해야 하며, 현재 3개 음성 인식 Activity의 네트워크·모델/마이크 코드는 수정하지 않는다.

## 검증
- `android/tests/editorial-2-1a-tokens.test.mjs`: 동일 토큰/패턴, 숫자 타임코드, 포커스, Native 상태 처리 계약
- 기존 `editorial-components.test.mjs` 및 모든 Web/Android regression
- Android Lint, JVM unit, debug APK, Android 15 에뮬레이터와 시스템 글꼴 160% 확인
- 실제 화면에 클래스가 적용되는 1-B/2-A 단계에서 변경 전후 화면 캡처 재확인

## 다음
1-B 탐색·최초 사용 안내: Android 4개 하단 메뉴를 유지한 채 첫 실행·작업 유형 진입 문구, API 연결 상태의 정보 밀도를 검토한다. 이어서 2-A 새 자막 작업 화면부터 신규 공통 패턴을 실제 UI에 적용한다.

## 배포 안전
UI 기초 변경으로 새로운 AAB 배포를 수행하지 않는다. 이 PR을 병합할 때에는 `[skip-play]` 커밋 마커를 사용해 기존 자동 내부 테스트 업로드를 건너뛰고, 반드시 main의 웹·Android 검증을 통과한다. 현재 Google Play internal versionCode 21 재업로드 금지.
