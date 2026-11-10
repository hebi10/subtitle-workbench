# Editorial Studio 2.0 · 3-C 웹 내보내기 화면 리디자인

## 목표
웹 `panel-export` 화면에서 현재 작업 결과를 먼저 확인하고 파일 형식별 저장을 명확히 선택하도록 구성한다. SRT·VTT·JSON·번역 실패 로그 JSON의 실제 생성/다운로드 계약은 유지한다.

## 변경 범위
- 내보내기 탭 자체에 `exportResultSelect`를 배치하고 기존 전역 `jobResultSelect` 및 `restoreResult`와 동기화한다. 작업 전환 시 각 결과의 원래 파일명·언어·싱크·편집 내역을 보존한다.
- `exportFileName`, `exportResultStatus`, `exportLanguage`, `exportSyncSummary`에서 실제 선택 결과의 파일명, 자막 수와 번역 실패 건수, 원문/언어 코드, 싱크를 표시한다. 빈 결과는 실제로 비어 있다고 표시하며 원문 보존 상태를 구분한다.
- SRT를 1순위 전체 폭 다운로드 링크로, VTT·JSON을 보조 링크로 배치한다. 번역 실패 로그 JSON은 조건부 부가 링크로 기존 위치/기능을 유지한다.
- 기술적 형식 안내는 `details`로 접고 필요한 경우에만 펼친다. 실제 형식은 SRT/VTT/JSON 그대로 사용한다.
- 다운로드 클릭은 브라우저에 '다운로드 요청'을 보낸 것까지만 알린다. OS 파일 저장 성공을 추측하거나 서버 동기화로 오인시키지 않는다.
- Blob/파일 준비 실패 시 `exportBuildError`를 표시하고 기존 자막 데이터를 유지한다. 사용자가 선택한 '파일 다시 준비'만 기존 `refreshDownloadsForCurrentOffset` 함수를 호출하며 API, 파일 재전사/재번역을 호출하지 않는다.
- 편집 중 새 다운로드 파일이 생성될 때 이전 다운로드 성공/요청 표시를 초기화한다. `URL.revokeObjectURL` 수명 관리 및 내보내기 파일명을 보존한다.
- 파일과 수정 내용이 브라우저의 현재 페이지에만 존재한다는 안내를 항상 표시한다.

## 변경 파일
- `index.html`: 작업 선택, 실제 요약, 저장 피드백, 오류·재시도, 접이식 형식 안내
- `styles.css`: 회색계열 라이트·다크, 0px 모서리, 무그림자, 320/390/800/1280px
- `src/app.js`: 결과 선택/상태/다운로드 링크·오류 피드백 및 재시도
- `src/ui-state.js`: 결과 상태를 표현하는 순수 함수 `getExportSummary`
- `tests/ui-state.test.mjs`, `tests/markup.test.mjs`: 상태·구조 회귀
- `android/tests/editorial-2-3c-web-export.test.mjs`: Playwright로 빈 상태·작업 선택·다운로드·실패 재시도·테마·가로 넘침 및 캡처

## 검증 기준
1. 원본 결과 2개 이상 전환: 기존 `jobResultSelect`와 선택 동기화, 내보내기 이름/언어/자막 수 유지
2. 선택된 작업의 SRT 우선, VTT/JSON 및 조건부 실패 로그 보존, 실제 다운로드 이벤트 검증
3. 일부 번역 실패: 원문 유지 상태와 실패 건수·로그만 표시. 파일 생성 성공을 전체 번역 성공이라고 표시하지 않음
4. Blob 생성 실패를 테스트로 발생시킨 뒤 다운로드 링크가 비활성화되고 편집 내용이 유지되며, 수동 재시도 시 복원
5. 빈 상태, 320/390/800/1280px 라이트·다크, 첫/마지막 작업, 긴 파일명·줄바꿈 및 키보드 접근 검수
6. 기존 Node/WebView UI/Android JVM·Lint·APK 및 Android 15 Emulator Smoke 모두 PR 최종 SHA에서 성공해야 병합

## 안전·배포
- 파일·언어·SRT/VTT/JSON 계약, API 키·Worker 인증, FFmpeg, 오디오 처리, 브라우저 메모리 수명 보존
- 유료 API 호출, Google Play AAB 재업로드·비공개 테스트 승격·서명/트랙/등록정보 변경 없음
- CI와 실제 이미지 확인 후 `[skip-play]` Squash로 `main` 병합. GitHub Pages 배포와 Android Play 게시 상태는 별도 확인

## 다음 단계
4-A — 공통 상태·오류·모달 통합 QA.

## 상태 보정
- 기존 번역 취소 후 원문 체크포인트는 `translationPending=true`이지만 실제 실패 자막 `status=failed` 수가 0일 수 있다. 이때 '번역 실패 n개'라고 단정하지 않고 '번역 완료 전 · 원문 보존'으로 구분한다.
- 실제 실패 자막이 있는 경우에만 기존 번역 실패 요약 및 실패 로그 JSON을 제공한다. 이 검증은 버전별 데이터 계약을 변경하지 않는다.
