# Editorial Studio 2.0 · 4-B 라이트·다크·반응형·접근성 종합 QA

## 기준선
- main: `06f5d0a280c7150b4129b24fd15dcff39d6df27a` (4-A PR #36 병합)
- 4-A 병합 이후 `Verify web and Android #42784602003` 및 GitHub Pages 빌드 성공
- 사용자 설정대로 기존 Android WebView/Native, HTML·CSS·JavaScript를 유지. 신규 UI 라이브러리, 원격 API, 클라우드 동기화 또는 데이터 계약 변경 없음

## 적용 항목
1. **실제 Android 글꼴 확대**: 기존 `EditorialFullWebViewDeviceTest`는 Android 15에서 100%/160% 글꼴을 설정하고 WebView의 `textZoom`과 모든 화면을 확인한다. 이 단계에서 네비게이션 네 버튼의 터치 높이 48px 이상과 텍스트 잘림 없음(`scrollWidth/Height` 확인)을 추가한다.
2. **모바일 탐색**: 320~480px에서 OS 큰 글씨로 네비게이션 텍스트가 잘리지 않도록 정상 줄바꿈을 허용한다. 하단 고정 메뉴 높이에 맞춰 콘텐츠 끝·스크롤 여유를 둔다. 기존 액션/선택/데이터 동작은 변경하지 않는다.
3. **웹·WebView 반응형**: 새 Playwright 테스트는 320, 360, 390, 432, 800, 1280px × 라이트/다크, 생성·편집·내보내기 및 Android 영상·작업·결과·편집·설정 화면을 순회한다.
4. **콘텐츠 길이 및 IME**: 긴 한글 파일명과 자막, 390×480px 키보드 크기 축소 시 입력 포커스, 저장 상태, 결과 내보내기 및 고정 메뉴를 점검한다. 브라우저의 짧은 뷰포트는 실제 Android IME 그 자체가 아니므로 구분한다.
5. **접근성/대비**: 기본·보조 텍스트 WCAG AA 4.5:1 이상(기존 디자인 토큰), 선택된 탭·하단 메뉴 ARIA 상태, 오류·저장 라이브 리전, 키보드 Enter/방향키, 48px 이상 탐색 영역, 시각적 포커스 링 검증.
6. **모션·꾸밈**: reduced-motion 환경에서 깨진 애니메이션/장식 없이 기존 라이트·다크 단색/전체 테두리/0px 반경/그림자 없음 유지.

## 변경 파일
- `android/web/styles.css`: 480px 이하 하단 메뉴 큰 글자 줄바꿈과 문서 바닥 여백
- `android/app/src/androidTest/java/com/haebi/subtitle/EditorialFullWebViewDeviceTest.java`: WebView 실제 100/160% 탐색 버튼 가시성·터치 목표 높이 단언
- `android/tests/editorial-2-4b-responsive-a11y.test.mjs`: 웹+Android WebView 6개 폭 × 라이트·다크, 초점·키보드·짧은 창 및 실제 Chromium 화면 캡처
- `docs/editorial-studio-2-4b-responsive-a11y-qa.md`: 결과와 재검증 기록

## 합격 판정
- Node·Playwright 회귀 전체 성공, Android 단위/Lint/debug APK·Android 15 Emulator Smoke 모두 PR 최종 SHA에서 성공해야 한다.
- `output/editorial-4b` 스크린샷으로 테마/배치/입력 화면 직접 검수.
- Android 시스템 글꼴 확대 실제 계측이 수행된 실행 기록 확인. 사용자가 가진 실제 스마트폰의 IME/힌트/화면 낭독기는 이 클라우드의 에뮬레이터 시험과 다르므로 자동화 검증만으로 실기기 인증 완료라고 하지 않는다.
- 프로덕션 API 음성 품질, 유료 요청, 실제 저장/삭제·Google Play 배포 작업은 대상 아님.
- 검증 통과 후에만 `[skip-play]` squash PR 병합. Play 내부/비공개 테스트 업로드·트랙 승격·서명·스토어 자료 변경 금지.

## 후속 단계
5-A — 최신 화면 캡처·초기 시안 대조.
