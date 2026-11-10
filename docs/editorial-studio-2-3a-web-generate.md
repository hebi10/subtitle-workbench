# Editorial Studio 2.0 · 3-A 웹 생성 화면

## 범위
- 기존 `panel-generate` 내 파일 선택 → API 연결 → 언어 설정 → 생성 버튼 → 실제 진행/미리보기 순서를 유지한다.
- 새 `generate-preflight`는 시작 버튼 직전에 파일·연결·언어 준비 내용을 실제 입력 상태로 표시한다.
- 파일 준비는 선택 여부와 실제 길이 판독 여부를 구분한다. API 입력 상태는 접속 성공을 뜻하지 않으므로 언제나 '실제 연결 미검증'으로 안내한다.
- 직접 연결과 Worker 연결은 기존 API 키·URL 정책 및 연결 검증 로직에 따른다. 키·URL을 준비 상태 카드에 출력하지 않는다.
- 번역 토글·원문/번역 언어 및 사용자 정의 언어 변경 시 텍스트가 즉시 갱신되도록 연결한다. 비어 있는 사용자 정의 언어는 그대로 입력 필요로 표시한다.
- 시작 버튼의 기존 활성 조건, 오류 안내, 작업 취소·재시도, FFmpeg 및 API 데이터 처리, 배치 작업, 현재 페이지 수명 보관·내보내기 계약은 변경하지 않는다.
- 기존 라이트·다크 시맨틱 토큰, 0px 모서리, 그림자 없는 반응형 UI를 사용한다. 761~1180px에서 요약을 3열로 표시한다.

## 변경 파일
- index.html
- styles.css
- src/app.js
- src/ui-state.js
- tests/ui-state.test.mjs
- tests/markup.test.mjs

## 검증 조건
- node --test tests/run-tests.mjs 및 기존 Web/Android 통합 CI, 브라우저 UI 캡처 통과
- 320/390/800/1280px 및 라이트/다크, 파일 미선택/길이 실패/API 키 누락/Worker URL 누락/번역 끔/사용자 정의 번역 언어 빈 값
- 실제 Worker 연결 성공이나 API 과금, 실제 영상 전사 성공으로 오인하지 않는다.
- Android Native 기존 변경과 분리한 PR로 검증하고 CI 통과 후 [skip-play] Squash 병합. Play AAB, 서명/트랙/스토어 자료는 변경하지 않는다.

## 다음 단계
3-B — 웹 자막 편집 화면 리디자인.
