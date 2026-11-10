# Editorial Studio 2.0 · 2-E Android 설정 화면 리디자인

## 목표
Android WebView의 `settingsView`에서 연결 상태와 다음 영상 기본값을 먼저 확인하고, 필요한 설정으로 직접 진입할 수 있도록 정보 위계를 정리한다. 기존 개인 API/테스트 서버 전환, Android Keystore 암호화, 키 삭제 확인, 언어·모델 설정 저장, 데이터 안내·개인정보처리방침은 그대로 유지한다.

## 변경된 화면
1. 상단 설정 요약 2개: 기존 `settingsConnectionSummary`/`settingsDefaultsOverview`를 유지하며 각각 연결 상태 배지·짧은 도움말·`연결 설정`/`기본값 수정` 버튼을 추가한다. 추가 버튼은 새 API 호출이 아니라 기존 `openSettings('apiSettings'|'defaultSettings')`를 사용한다.
2. 연결 상태는 실제 `connection.hasKey`, `checkingConnection`, `connectionError`, 확인된 모델 `keyCheck` 등 기존 데이터로만 표시한다. 검사 중·저장 필요·연결 확인 실패·인증/모델 확인됨·저장됐지만 검사 안 됨을 텍스트+배지로 구분한다. 인증 확인은 결제 상태·잔액·모든 모델 접근 보장이 아니라는 현재 정책을 유지한다.
3. 다음 영상 기본값은 `savedSettings`만 표시하고, 현재 입력값이 아직 저장되지 않았다면 '미적용' 도움말을 제공한다. 기존 작업에는 이전 기본값이 소급 적용되지 않는다.
4. 연결 그룹: 기존 cloudMode, 개인 API 키, 테스트 서버 주소·접근 코드, 삭제/취소 확인, 모델 접근 검사를 동일한 DOM ID·폼·이벤트로 유지한다. 비밀값을 배지·요약·로그에 출력하지 않는다. 화면 이탈 및 연결 방식 변경 시 민감 입력 초기화 유지.
5. 기본 설정 그룹: 원본 언어, 번역 여부/목적어, 음성 인식·번역 모델, 고급 옵션, 저장/취소 및 모델/종료 안내 보존.
6. 데이터·비용 그룹은 **전송 데이터, 요금 및 사용량, 작업 이어하기, 원본 파일**의 4개 제목으로 문장을 분류. 기존 안내 문구·요금/전송/원본 보존 정책을 삭제하지 않는다.
7. 스타일: 기존 블랙·화이트·회색 및 0px 모서리, 무그림자·무그라데이션. 320px 이하는 요약 카드를 1열, 390~800px은 2열, 좁은 화면의 터치 버튼 최소 48px. 오류 상태에만 의미색을 사용하고 나머지는 무채색으로 유지.

## 구현 파일
- `android/web/index.html`: 설정 상단 개요에 상태·버튼, 비용/데이터 4개 세부 항목 추가.
- `android/web/app.js`: 기존 `syncConnection`에서 파생 UI만 갱신하고 바로가기 이벤트를 기존 설정 경로에 연결. Native Bridge·보관 형식·설정 변경 호출 불변.
- `android/web/styles.css`: `#settingsView` 범위 상태 카드·버튼/콘텐츠·반응형 스타일.
- `android/tests/editorial-2-2e-settings.test.mjs`: 상태/인증 확인 성공·실패/unsaved 설정·민감 입력 비노출/선택 폼 접근·반응형 화면 검증.
- `.github/workflows/verify.yml`: `output/editorial-2-2e/*.png` 캡처 아티팩트 보존.

## QA 및 완료 기준
- 실제 개인 API/테스트 서버 `hasKey` 상태·연결 확인/오류·모델 접근 불일치·실행 중 작업의 연결 변경 제한과 버튼 상태 검증.
- 연결 요약에 API 키·테스트 접근 코드·비밀번호 등이 노출되지 않음. 키 삭제 확인 시 자막 유지, 테스트 연결 삭제 시 개인 API 키 독립 유지.
- 기본 설정 미저장 상태가 기존 `savedSettings` 요약을 바꾸지 않음. 저장/변경 취소 후 올바른 요약 갱신.
- 320/390/800px, 라이트·다크 및 Android 글꼴 100/160%, 키보드/하단 메뉴 가시성, 가로 넘침 0건.
- 기존 WebView·Playwright, Android JVM/Lint/debug APK, Android 15 실제 에뮬레이터 성공. 설정 양 모드/빈·완료·오류 상태 캡처 대조.
- 기존 PR에 포함된 결과·편집/저장·초기 안내의 기능 회귀 없음.

## 병합·배포
CI/에뮬레이터 최종 HEAD 전체 성공 후 Squash `main` 병합, 병합 커밋에 `[skip-play]` 적용해 Google Play 기존 internal versionCode 21을 재업로드하지 않는다. Google Play 실제 심사/게시 상태는 별도 검증한다.

## 다음
`2-F — Android 네이티브 음성 인식 3종 디자인 정리`: 온디바이스 마이크, GPT 실시간 마이크, Vosk의 준비 → 진행 → 결과 흐름과 접근성 정리.
