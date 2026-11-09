# Editorial Studio · 2-A 공통 컴포넌트 디자인 시스템

## 목적과 범위
1-A 색상 토큰과 1-B 브랜드를 유지하며, 현재 웹/Android WebView/네이티브 화면의 버튼·입력·카드·상태 배지·진행·아이콘을 같은 규격으로 정리한다. 화면 레이아웃 재구성과 저장/인식/API 로직 변경은 3-A~4-A의 별도 범위다.

## 컴포넌트 매트릭스
| 요소 | 공통 규격 | 구현 및 사용 위치 |
|---|---|---|
| Primary Button | 강조 배경, 반전 텍스트, 최소 48px(네이티브 52dp) | 생성/저장/편집/결과 실행 |
| Secondary Button | 표면 배경 + 1px 중성 경계선 | 취소/이동/보조 기능 |
| Destructive Button | 위험 상태 토큰, 텍스트 라벨 | 삭제 확인 및 안전 동선 |
| Disabled | 명확한 비활성 배경/글자, 이벤트 없음 | Web·WebView·Android StateListDrawable |
| Text Field | 1px 강조 경계, 48px, 모바일 16px | 원문/번역/키/서버주소/검색 |
| Select/Checkbox | 동일 포커스 링 및 동작 | 언어/모델/필터 |
| Card | 1px 중성 경계, 반경 0, 그림자 없음 | 작업/결과/설정/상태 |
| Status | 중립·진행·완료·경고·오류를 문구와 함께 | 진행률/작업 배지/오류 |
| Progress | 플랫 7–8px 막대, 수치 기반 | 작업 상태 및 생성 |
| Icon | 18px 단색 CSS 픽토그램, 텍스트 라벨 동반 | 웹 탭/Android 내비게이션/주요 기능 |

## 코드 구조
- **웹:** `styles.css`, `index.html` — --es-control-*/--es-card-*/--es-status-* 역할 토큰을 재사용한다.
- **Android WebView:** `android/web/styles.css`, `android/web/index.html` — 동일 이름/역할/아이콘 클래스. 320px 너비에서는 내비게이션 라벨 가독성을 위해 아이콘을 감출 수 있다.
- **네이티브:** `NativeDesignSystem.java` — 시스템 테마에 맞는 StateListDrawable/ColorStateList로 버튼의 비활성 배경 및 글자를 처리하고, Spinner/상태 카드 공통 규격을 유지한다.
- CSS 아이콘은 `.es-icon--video/jobs/results/settings/add/play/edit/download/mic/refresh/stop/back`를 지원한다. 별도 SVG 파일, 외부 CDN, 폰트 또는 UI 패키지는 없다.

## 접근성·동작 보존
- 모든 주요 버튼/탭에 글자 라벨을 남겨 보조 기술에서 이름이 유지되며, 장식 아이콘은 `aria-hidden="true"`를 사용한다.
- 시스템 라이트/다크 상태의 포커스 표시, disabled, status를 색상만으로 판단하지 않는다.
- 기존 DOM ID, Native bridge의 계약, 저장 전/후 UI 조건, 모달 확인 절차, API·SQLite 동작을 변경하지 않는다.
- 화면 배치·중첩 스크롤 구조·신규 기능 아이콘의 전체 확대 적용은 3-A/3-B/4-A에서 수행한다.

## 검증
- `android/tests/editorial-components.test.mjs`: 320/390/800px Android 및 320/390/1280px 웹, 라이트·다크, 버튼 크기/보더/그림자, 유효한 라벨, 4개 내비게이션, 키 입력 보존, 화면 가로 넘침을 검증한다.
- `EditorialComponentsDeviceTest.java`: 네이티브 기본/보조 버튼 활성·비활성 상태, 52dp/72dp, Spinner 탭용 최소 높이를 에뮬레이터에서 검증한다.
- PR 전체 CI 후 main 병합/재검증 및 내부 테스트 배포를 별도로 확인한다.

## 후속
3-A Android 영상 추가·작업·결과, 3-B 자막 편집/설정, 3-C 네이티브 마이크, 4-A 웹 생성·편집·내보내기, 5-A 최종 시각/접근성 QA.
