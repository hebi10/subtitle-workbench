# Editorial Studio 2.0 · 2-D Android 자막 편집 화면

## 목표
기존 Android WebView `editorView`에 현재 선택 자막의 시간·문구를 간결하게 표시하고, 해당 시간부터 **기존 Android Native 미리보기**를 실행하며, 검색/필터에 맞춘 이전·다음 자막 이동을 제공한다. 실제 영상은 지금처럼 별도 Android 미리보기에서 열리므로 **WebView 안에 인라인 재생되는 영상으로 오해하지 않도록 안내**한다.

## 개선 사항
1. 상단 편집 도구(`preview`, `jumpToExport`, `undo`, `redo`), 하단 네비게이션 4개, 페이지 저장 피드백 `editorFeedback` 및 자막 목록 `cueList`는 유지한다.
2. `editorCueContext` (기본 펼침, 사용자 접기 가능): 현재 자막 `N/전체`, 시간 코드, 화자, 번역 또는 원문 미리보기, 번역이 있는 경우 원문 요약. 데이터는 `history.present[selectedIndex]`에서만 생성한다.
3. `prevCue`, `nextCue`: 실제 검색/검수 필터가 반환하는 자막 순서대로 이동하고 12개/페이지 경계를 넘어갈 수 있다. 버튼은 경계에서 비활성화한다. 기존 자막 카드의 편집 기능을 삭제하거나 가상 페이지를 추가하지 않는다.
4. `previewSelectedCue`: 현재 자막 `start`에 1000을 곱한 밀리초를 기존 `previewAt`에 전달한다. `previewAt`의 편집 자동 저장 `flushSave`을 먼저 통과하므로 저장 실패 시 이전 데이터로 미리보기하지 않는다. 영상 URI 없으면 버튼은 비활성화하고 안내를 제공한다.
5. 입력 중에는 기존 편집 폼 DOM을 재생성하지 않는다. 원문/번역/화자 변경 시 별도 텍스트 요약만 갱신해 한글 조합 입력과 포커스를 유지한다.
6. 320~800px 및 라이트/다크 반응형: 평면형 블랙·화이트·그레이, border-radius 0, shadow none. 현재 자막 컨텍스트를 접으면 작은 화면에서 입력 공간 확보. 입력 필드 최소 높이·포커스·타임코드 가독성 개선.
7. 자막 12개/페이지, 검색·필터·번호/시간 점프, 타임코드·원문·번역·화자 편집, 분할·병합, Undo/Redo, 자동 저장 및 실패 재시도, readonly 부분 결과와 Native Bridge의 동작을 그대로 보존한다.

## 변경 파일
- `android/web/index.html`: 접이식 현재 자막/미디어 참조 패널, 이전/다음·여기부터 재생 버튼
- `android/web/app.js`: 선택 자막 요약 동기화, 필터 순서 탐색, Native 미리보기 시작 위치 연결, 기존 입력·저장 루틴 재사용
- `android/web/styles.css`: editorView 범위 내 패널·선택 카드·텍스트 입력·버튼 및 320~800px 반응형
- `android/tests/editorial-2-2d-editor.test.mjs`: 선택 자막/시간·미리보기 호출·페이지·필터·원문/번역 입력/Undo·Redo·미디어 없음·기기 키보드 축소·라이트/다크 캡처
- `.github/workflows/verify.yml`: `output/editorial-2-2d/*.png` 증빙 보관

## QA
- 편집 진입 직후 실제 cue 1/27, 타임코드, 번역/원문 확인; 자막 이동 후 실제 현재 인덱스/선택 카드 일치.
- `previewSelectedCue`이 해당 시점부터 Native 미리보기 시작, 저장 실패 시 재생 차단. 미디어 URI 없는 자막 파일에서는 비활성화.
- 검색/검수 조건·12개/페이지 경계, 번호/시각 점프, 읽기 전용, 모델에 따른 자막 시간 정확도 경고, 편집 데이터 보존.
- 저장 중·저장 성공·저장 실패/재시도 상태와 에디터 sticky 도구막대 유지. 390×480 키보드 축소 레이아웃, 160% 시스템 글꼴·실제 기기 테스트는 자동 브라우저 시뮬레이션과 구별.
- 초기 데이터/화자/분할/병합, 320/390/800px 라이트·다크 오버플로 확인; Playwright·Android Lint/JVM·APK·Android 15 Emulator Smoke 통과.

## 병합·배포 안전
최종 PR SHA의 CI 전체 통과와 실화면 캡처 검수 후 `[skip-play]` Squash로 `main` 병합. 이 변경으로 새 Google Play AAB 업로드, 스토어 이미지 변경 또는 `alpha` 승격을 수행하지 않는다. 개인 API 키/테스트 코드·서명·SQLite 변경 없음.

## 다음 단계
`2-E — Android 설정 화면`: 개인 API/테스트 서버·언어/모델·데이터/비용의 정보 위계 및 라이트·다크 접근성 개선.
