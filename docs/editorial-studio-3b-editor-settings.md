# Subtitle Workbench · Editorial Studio 3-B

## 작업 범위
Android WebView의 자막 편집(editorView) 및 설정(settingsView) 화면을 개선한다. 이전 1-A 색상·1-B 브랜드·2-A 공통 컴포넌트·3-A 파일/작업/결과 화면은 유지하며, 기존 데이터·API·Android bridge 호출을 변경하지 않는다.

## 자막 편집 UI
- 저장 상태, 저장 실패 재시도, 이전/다음 자막 페이지 기능을 기존 고정 하단 패널에서 자막 목록 위의 compact sticky 도구막대로 이동했다.
- 본문과 자막 목록은 하나의 문서 스크롤을 공유하며 cueList에 독립 overflow를 적용하지 않는다.
- 저장 실패 상태의 전체 메시지는 자동으로 잘라내지 않고 화면에 표시한다.
- 선택 자막이 sticky 도구막대 아래로 가려지지 않도록 현재 도구막대 높이를 측정해 scroll margin-top에 반영한다.
- 자막 12개/페이지, 원문·번역·화자·타임코드, 검색·검수 필터, 점프·재생·분할/병합·Undo/Redo 및 자동 저장 동작은 변경하지 않았다.
- 중요: Android WebView의 하단 내비게이션은 유지하되 그 위에 중복된 고정 패널을 두지 않는다.

## 설정 화면 UI
- 현재 연결(개인 API 또는 테스트 서버)과 다음 영상에 적용될 저장된 음성 인식 모델·언어를 읽기 전용 요약 2개로 표시한다.
- 연결·기본 설정·데이터/비용·개인정보 항목을 01~04로 구분해 탐색하기 쉽게 했다.
- 개인 API/테스트 서버 연결 폼, 암호화 저장·삭제 확인, 기본 언어·모델 옵션, 데이터 전송·비용 및 개인정보처리방침을 보존했다.
- 요약에는 비밀번호·접근 코드·API 키를 출력하지 않는다. 기존 코드가 화면 이동 및 접힘 시 민감 입력을 초기화하는 동작도 유지한다.

## 수정 파일
- android/web/index.html: 편집 피드백의 DOM 위치 이동, 공통 아이콘, 설정 현재 상태 요약 및 그룹 번호.
- android/web/styles.css: editorView/settingsView에만 적용되는 레이아웃 및 라이트·다크 반응형.
- android/web/app.js: editor sticky 실측 높이 CSS 변수, 설정 요약의 파생 표현만 추가.
- android/tests/editorial-3b-editor-settings.test.mjs: 320/390/800px, 라이트/다크, 깊은 자막 편집·저장 실패 및 재시도·연결 모드/보안 입력 유지 등 검증.
- .github/workflows/verify.yml: output/editorial-3b 캡처 포함.

## 기존 기능/동작 보존
자막 저장/복구, API 연결·삭제·비용 안내, Native postMessage 계약, 비밀키 처리, 1-A~3-A 화면, Google Play 배포 자동화는 변경하지 않는다.

## 완료 게이트
1. Verify web and Android / Playwright WebView / Android JVM & Lint / Emulator Smoke / Play Store screenshots 전체 통과.
2. 390/800px 라이트·다크 editor/settings 변경 전후 캡처를 Drive에 보관한다.
3. 필수 CI 통과한 PR만 main에 병합하고 main에서 다시 검증한다.
4. 기존 Play 내부 테스트 자동 배포는 게시 전 API readback까지 확인한다. 비공개 테스트 및 스토어 Listing 교체는 제외한다.

## 후속 작업
3-C 네이티브 마이크 화면 통일, 4-A 웹 편집, 5-A 종합 QA, 5-B Google Play 등록 이미지 갱신.
