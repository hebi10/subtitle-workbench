# Editorial Studio 4-A — 웹 생성·편집·내보내기

## 목표
확정된 1-A 라이트·다크 색상, 1-B 브랜드·아이콘, 2-A 공통 컴포넌트를 웹 버전의 전문 자막 작업 공간에 적용한다.
Vanilla JavaScript + 기존 CSS 구조를 유지하며 React 등 신규 의존성은 추가하지 않는다.

## 화면별 개선
### 01 생성 / 02 처리
- 왼쪽 영상·오디오 파일 선택, API/Worker 연결, 원본·번역 언어, 자막 생성 실행, 고급 옵션을 유지한다.
- 기존 긴 설정 패널 하단에 있던 실제 #generatePlayerMount/#mediaPlayer DOM을 오른쪽 .generate-main의 맨 위 미리보기 카드로 이동한다. 기능별 id, script state, 미디어 동기화는 유지한다.
- 처리 상태, 진행률·단계별 로그와 생성 자막 미리보기는 영상 아래 별도 영역으로 보존한다.
- 빈 상태에서도 미리보기·빠른 시작 안내가 표시되고, 실제 파일 선택 시 동일 player mount를 사용한다.

### 03 편집
- 검색·검수 필터와 전체 시간 싱크·짧은 자막 병합 도구를 서로 다른 그룹으로 구분한다.
- 영상 참조 패널을 별도 영역으로 표기해 목록 편집과 미리보기를 명확하게 나눈다.
- 자막 표는 중첩된 세로 스크롤 없이 문서 본문을 스크롤한다. desktop/tablet/mobile 반응형 유지.
- 기존 자막 검색·필터·타임코드, 화자, 원문·번역, Undo/Redo, split/merge, 자막 시간 싱크, 영상 동기화 이벤트와 DOM id 보존.

### 04 내보내기
- 주요 작업: SRT/VTT/JSON 다운로드 링크를 먼저 표시. 다운로드 파일 영역과 각 형식의 용도 설명을 별도 2열 또는 모바일 1열로 그룹화한다.
- 현재 결과 개수, 빈 결과에서 파일 가져오기·생성 이동, 번역 실패/재시도, ffmpeg 로그 등 기존 상태와 동작 유지.
- 다운로드에 대한 데이터 지속성을 혼동하지 않도록 현재 작업 결과는 파일로 내려받아야 보존된다고 안내한다.

## 변경 파일
- index.html: 화면 배치 및 정보 제목/설명, DOM ID 유지.
- styles.css: editorial token 재사용, #panel-generate/edit/export 전용 스타일, 320/390/1280 라이트·다크 반응형.
- android/tests/editorial-4a-web.test.mjs: 브라우저 실 렌더링의 3탭, 스크롤, 플레이어 마운트, SRT 파일 가져오기 및 export 동작 회귀.
- .github/workflows/verify.yml: UI QA PNG 아티팩트 유지.

## 검증
- 웹 기본/생성/편집/내보내기 상태 320/390/1280px, 라이트·다크, DOM 구조와 탭 이동, 가로 넘침.
- 기존 tests/browser-workflow.html에 있는 결정론적 mock FFmpeg/API를 통한 복수 파일 결과, 분할/Undo/Redo, 결과 교체, SRT·VTT·JSON 다운로드 및 원본 보존 회귀.
- Android WebView와 네이티브 마이크·클라우드·저장 기능은 수정하지 않음. 전체 CI 및 Android 에뮬레이터 기존 테스트는 그대로 수행.
- PR 최종 검증 통과 후 main 병합, 병합 main 재검증 및 기존 Play internal 자동 배포 실행 확인. 비공개 테스트 트랙 승격 및 Play Listing 업로드는 4-A 범위 밖.

## 후속
5-A 웹·Android 라이트·다크/접근성/반응형 전체 QA, 5-B 실제 최신 빌드 화면 기반 Play Store 이미지 최종 교체.
