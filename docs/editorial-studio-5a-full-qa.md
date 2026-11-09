# Editorial Studio · 5-A 라이트·다크 전체 화면 및 접근성 QA

## QA 기준
버전: main 92495f091b974e629f5d26c701208b8ed7d9a784 기준. 0-A~4-A의 완성 화면을 대상으로 하며, 5-A는 기능 추가보다 실제 화면·입력·접근성 검증과 국소 보정이 목적이다.

### 화면·환경 매트릭스
- 웹: 생성 / 편집 / 내보내기 3개 탭 × 라이트/다크 × 320/390/1280px (18개 화면 조합)
- Android WebView 테스트 브리지: 영상 추가/작업/결과/자막 편집/설정 5개 화면 × 라이트/다크 × 320/390/800px (30개 조합)
- 실제 Android 15 에뮬레이터 WebView: 5개 화면 + 연결 설정 펼침 × 라이트/다크 × 시스템 글꼴 100%/160% (24개 캡처)
- Android 15 네이티브: 온디바이스 마이크·GPT 실시간·Vosk 3개 화면 × 라이트/다크 (기본 6개); 추가 글꼴 160% 라이트/다크 6개
- Android API 35 에뮬레이터 pixel_6. 보유한 실제 기기에서 실물 사진·유료 API 추론은 이 단계에 포함되지 않는다.

### 검사 대상
1. 라이트/다크 텍스트 대비: WCAG AA 본문 4.5:1 이상 (시맨틱 Ink/Muted + Surface/Canvas).
2. 가로 넘침: 문서 scrollWidth <= viewport + 1.
3. 모바일 하단 고정 메뉴: 화면에 노출되고 입력 필드 위를 가리지 않아야 함. IME 520px 상황은 브라우저 축소 뷰포트로 대체하되 실제 Android keyboard QA와 구분.
4. 자막 편집: 단일 문서 스크롤, 저장 상태/오류 재시도 sticky 막대, SRT·VTT·JSON 내보내기, 필터·타임코드·Undo/Redo 기존 회귀.
5. Native 음성 인식: 권한 요청 전/후 상태 안내, 시작/종료/다운로드/확정 버튼, 화면 이탈 시 종료. 테스트는 실제 음성 전송이나 비용 발생 없이 초기/버튼 상태로 검증.
6. 보안/복구: 저장 전 입력값, 개인 API/테스트 서버 접근 코드 마스킹과 화면 이탈 시 지우기, 작업 일시정지·이어하기, SQLite 보존 기존 테스트.
7. 프레임/타이포: 버튼 최소 48px WebView / 52dp 네이티브, 모서리/그림자 절제, 파일명 긴 줄바꿈, 시스템 글꼴 160%에 대한 WebView textZoom 대응.
8. 화면 캡처 출처: Chromium + 가상 Native bridge의 자료와 실제 Android Emulator UI 캡처를 구분. 사용자의 물리 기기 QA로 오인하지 않는다.

### 개선 사항
- `MainActivity`: Android 사용자 설정의 Configuration.fontScale을 WebSettings.setTextZoom에 적용.
- `android/web/styles.css`: 고정 네비게이션 및 키보드 축소 뷰포트에서 폼 포커스의 scroll-margin/scroll-padding 확보, 360px 이하 내비게이션 줄바꿈 유지.
- QA 자동화: `android/tests/editorial-5a-integrated.test.mjs`, `EditorialFullWebViewDeviceTest.java` 추가.
- `verify.yml`: 웹·Android WebView 캡처 및 측정값 JSON 보존.
- `android-emulator-smoke.yml`: 실제 Android WebView 5개 화면과 설정 펼침을 light/dark, fontScale 100%/160%로 계측 캡처; 네이티브 3개 화면은 font 160% 양 테마 재실행.
- `play-gates.yml`: 신규 WebView 장치 테스트를 릴리스 전 필수 검증에 포함.

### 완료 게이트
- PR 최종 HEAD의 Verify web and Android와 Android Emulator Smoke 전체 성공.
- 누락/잘림/작은 컨트롤 발견 시 수정과 재검증.
- QA 캡처·Android 장치 원본/출처·CI 로그를 Google Drive `04_검증_및_보완/5-A_통합_UIUX_QA_20261109`에 보관.
- PR squash main 병합 → main CI 성공 → 기존 Play internal 배포 readback 및 signed AAB 백업.
- 5-B에서 실제 스토어 등록용 8장/로고/대표 그래픽 최종 교체. 5-A에는 Play 등록정보 변경과 closed track 승격 없음.

### 한계
- 인식 API 실제 과금 테스트·휴대폰 물리 기기 수동 조작·TalkBack 실사용 QA 및 Google Play 테스터 설치 화면 노출은 별도 확인 항목으로 남긴다.
