# UI-10-B — 모바일 자막 편집 입력·저장 동선 개선

2026-11-12 (KST) / 상태: 구현 코드 및 회귀 테스트 작성, 최종 CI 검증·안전 병합 보류.

## 기준선·관계

- 기준 `main`: `61f3ddfadfece76eea0480bf2cbe4620fae3786f`.
- 선행 PR #56 (UI-10-A): https://github.com/hebi10/subtitle-workbench/pull/56
- UI-10-A Actions #43158109624, #43158109651: completed/success.
- UI-10-A Android15 Actions #43158109570: 2026-11-12 확인 시 in_progress. 추가 반복 조회하지 않음. 검증 성공 증거가 없으므로 #56 main 병합도 보류.
- UI-10-B는 별도 브랜치의 Draft PR로 진행하고 현재 main 병합·Play 배포를 하지 않음.

기획: https://drive.google.com/file/d/1K5gs58BmwRiJlCBV2mCdxa1tpOuBi0hI/view
실제 Android 캡처: https://drive.google.com/file/d/1Mk_ikyQXIyh_v8LuU9kPhrdhtl6ZBdjj/view
기획-실제 로드맵: https://docs.google.com/document/d/18mvFjZBHDty1MGcDbOedviBF92s7sOFfkXFPkgm_pkw/edit

## 구현 항목

1. `editorView`에서 고정 저장 상태(`editorFeedback`) 바로 다음에 선택 자막 편집 영역(`editor-primary-workspace`)을 배치. 기존 선택 자막 탐색 3개 버튼(이전, 다음, 여기부터 재생)은 입력란 바로 위로 이동.
2. 기존 `cueList`를 상단으로 이동. 선택된 자막이 이미 목록 첫 카드가 되는 `renderCues()` 기능을 그대로 재사용하고 시간·원문·번역·화자 입력을 보조 설명 이전에 노출.
3. 별도 중복 요약(`editorCueContext`)은 실제 입력란 아래의 접힌 상세 참고 섹션으로 이동. 검색·검수·위치 이동·Undo/Redo를 담은 `editorTools`도 기존처럼 기본 접힘으로 유지.
4. 선택 카드의 여백·버튼 높이·모바일 320px 2열 탐색, 글꼴 100/160%를 고려한 배치를 국소 CSS로 보정. 기존 중성 회색·차콜, 각진 테두리·평면 아이콘 사용.
5. 편집·시간 정렬·저장·일시정지/작업 복구·Native 미리보기·파일 저장·Keystore·API 호출 코드는 변경하지 않음.

## 회귀 보호

- 유지 ID: `saveStatus`, `retrySave`, `editorFeedback`, `prevPage`, `nextPage`, `pageInfo`, `prevCue`, `nextCue`, `previewSelectedCue`, `editorCueContext`, `editorTools`, `cueList`, `cueSearch`, `cueFilter`, `undo`, `redo`, 시간 입력 및 12개/페이지.
- 기존 `saveTimer=650ms`, Native Bridge `saveCues`/ `preview`, 저장 실패 재시도·이동 차단, IME 입력 드래프트, 검색/필터·Undo/Redo·분할/병합, 읽기 전용·영상 미연결 상태 유지.
- 레이아웃 구조 변경에 따라 기존 `editorial-2-2d-editor.test.mjs`의 정적 순서 및 펼침 토글 기대값만 현재 명세로 수정함. 기존 기능 기대값·Native payload/assertion은 유지.
- `editorial-ui10b-editor-priority.test.mjs`: 선택 자막이 요약/검색 이전에 있는지, 저장·미리보기 Native 호출, 320/390/800px × 라이트/다크, 390×480 키보드 크기의 가로 넘침·48px 조작·각진 스타일을 검증.
- CI 캡처 위치: `output/editorial-2-2d/ui10b-active-390-light.png`, `ui10b-active-390-dark.png`. 이 자료는 Chromium + mock Native Bridge 캡처이며 실제 Android 에뮬레이터 화면으로 표시하지 않음.

## 병합 및 다음 단계

- PR #56 Android15 검사 성공을 확인한 다음, #56을 안전 병합할 것. 그 시점의 `main`에 UI-10-B 브랜치를 업데이트/리베이스하고 최신 UI-10-B HEAD의 필수 웹·Android·API35 검증을 확인.
- 코드 변경과 PR 생성만으로 UI-10-B QA 완료 또는 출시 완료로 표기하지 않음.
- CI 실패 시 수정하고 새 HEAD로 검증. 성공 시 안전 병합 후 `UI-10-C — 작업 관리 상태·검색 탐색` 계획으로 진행.
- Play 내부/비공개 테스트 배포 및 스토어 이미지 변경은 UI-10-I에서 별도 승인. 이번 브랜치와 PR 제목에 `[skip-play]` 적용.
