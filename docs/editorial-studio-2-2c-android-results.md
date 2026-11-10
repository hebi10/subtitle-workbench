# Editorial Studio 2.0 · 2-C Android 결과 확인·내보내기 화면

## 목표
기존 Android `resultsView` 한 화면에서 선택한 결과를 이해하고 일부 자막을 검수한 뒤 SRT/VTT/JSON 파일로 안전하게 저장할 수 있도록 재구성한다. 기존 Native 영상 미리보기, 작업 선택, 자막 편집과 읽기 전용 부분 결과, 저장/취소/API 연결 계약을 유지한다.

## UI 정보 구조
1. 제목 `결과 확인`, 기존 `resultJobSelector` 선택기.
2. 파일명, 실제 작업 상태 배지(`resultStateBadge`), 자막 수·길이(`resultMeta`)와 상태 피드백(`resultStatus`).
3. `영상 미리보기`(기존 Native player)와 `자막 편집/자막 보기`. 연결 영상이 없으면 미리보기 버튼 비활성화 및 기존 안내 유지. 결과 불러오는 동안 이전 영상 미리보기·편집·다운로드를 사용하지 못하도록 기존 `loading` 게이트 유지.
4. 접을 수 있는 `resultCueDetails`: 실제 저장 자막 중 처음 최대 3개만 타임코드와 원문/번역의 실제 내용으로 표시. 데이터를 임의 생성하거나 영상에 오버레이하지 않는다. 자막이 없거나 불러오는 중이면 숨김. 사용자가 펼친 상태에서 폴링되더라도 버튼 선택/포커스 흐름을 무너뜨리지 않도록 구조 유지.
5. `exportSection`: SRT 기본 저장(모바일에서 한 줄 전체), VTT·JSON 보조 저장(2열), 형식 설명 상세. 기존 `data-export` 및 API MIME/파일명 방식 보존.
6. `resultExportStatus`: 현재 결과에서 실행한 내보내기 **진행/실제 저장 성공/사용자 취소/오류**를 구분. 성공은 Native export의 실제 결과가 성공일 때만 표시. 사용자 취소는 성공으로 표시하지 않음. 실패 안내는 메시지와 함께 재시도가 가능하고 오류 상태가 다음 성공 후 해제됨. 다른 결과 선택 시 이전 작업의 저장 메시지 초기화.

## 변경 파일
- `android/web/index.html`: 상태 배지, 자막 미리보기 details, 저장 피드백 p 추가; 기존 버튼 ID·섹션 ID 보존.
- `android/web/app.js`: 실제 결과 cue 3건 렌더링, 작업 상태·부분 결과 표시, 내보내기 반환값을 성공/취소로 구분하고 현재 결과 저장 상태만 갱신.
- `android/web/styles.css`: `#resultsView` 한정 무채색·평면 0px 모서리 스타일, SRT 우선 버튼, 320~800px 반응형.
- `android/tests/editorial-2-2c-results.test.mjs`: 기존 Native Bridge mock을 사용하는 실 렌더링/상태/내보내기 3형식/취소/실패/부분 결과/가로 넘침 검증, PNG 증빙.
- `.github/workflows/verify.yml`: `output/editorial-2-2c/*.png` CI 아티팩트 보관.

## 유지해야 할 기능 계약
- `resultJobSelector` 변경은 기존 `loadCurrentJob`와 미저장 편집 `flushSave`를 거침.
- `resultPreview`는 실제 원본 URI가 있을 때 Native preview 사용, 파일 자체를 렌더링하는 새 플레이어를 도입하지 않음.
- SRT/VTT/JSON 포맷·MIME·실제 파일명·Android 저장 계약, 완료/부분 결과 동작 보존.
- 원본 영상 삭제·데이터 이전·SQLite 구조·API/요금/비밀 정보 설정은 변경하지 않음.
- 완료 전 부분 결과는 여전히 조회만 가능하지만 저장된 cue가 있다면 내보내기 가능.
- UI에 기존 앱에 없는 MP4 하드 자막 합성·클라우드 업로드·공유·계정 기능을 추가하지 않음.

## QA
- Android 320/390/800px, 라이트/다크, 160% 폰트/하단 메뉴, 긴 파일명·자막, 부분 결과·빈 결과·원본 영상 없음.
- 결과 선택 변경 중 과거 결과를 편집·내보내기하지 못하도록 비활성화 확인, 저장 완료·취소·에러·재시도 및 포커스 흐름 검증.
- 기본 SRT 버튼 첫 화면 노출, 스토어 이미지 자동화 변경 없음.
- Web·Android 단위/Lint/Playwright, Android 15 Emulator Smoke, PR 화면 캡처 검증 전 병합 금지.
- `[skip-play]` Squash 병합으로 Google Play 새로운 내부 테스트 업로드 회피, 기존 배포 상태는 별도 검증.

## 다음 단계
`2-D — Android 자막 편집 화면 리디자인`: 영상 미리보기와 자막의 맥락 연결, 편집/시간 조정/Undo·Redo 및 저장 상태·키보드 가시성 개선.
