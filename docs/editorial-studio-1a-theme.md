# Editorial Studio · 1-A 컬러 및 시스템 테마

## 적용 범위
- 디자인 기준: [0-A 현재 화면 분석](https://docs.google.com/document/d/1Blem4C3j67HOrFOEsWpmrV8LP6prLjbcRKlalwyh6RE/edit)
- 웹: styles.css의 시맨틱 색상 토큰과 prefers-color-scheme 감지
- Android WebView: android/web/styles.css의 동일 팔레트, index.html의 light/dark color-scheme 허용
- Android 네이티브: NativeDesignSystem의 Configuration.UI_MODE_NIGHT_YES 판별, 마이크 3개 Activity와 로컬 모델 화면, values-night / values-night-v27 테마 리소스
- 제외: 전사·번역·파일 처리·보안·API 설정 로직, 새 테마 토글 UI, 아이콘·레이아웃 전면 교체

## 확정 팔레트

| 시맨틱 역할 | 라이트 | 다크 |
| --- | --- | --- |
| Canvas | #F5F5F5 | #141414 |
| Surface | #FFFFFF | #242424 |
| SurfaceAlt | #F0F0F0 | #303030 |
| Ink | #171717 | #F2F2F2 |
| Muted | #626262 | #ADADAD |
| Border | #D8D8D8 | #414141 |
| OnAction | #FFFFFF | #171717 |

1-A는 OS/브라우저의 라이트·다크 설정을 자동 추적한다. 앱 내부의 별도 선택 토글은 추가하지 않았다. 상태 색상(오류·경고)만 별도 팔레트를 사용한다.

## 검증 지침
1. GitHub Actions 'Verify web and Android': npm test, android/tests/*.test.mjs, Android testDebugUnitTest, lintDebug, assembleDebug/AndroidTest.
2. 'Android Emulator Smoke': Native 화면과 WebView 로딩을 확인한다. 실물 다크 모드 전환 중 작업 유지 여부는 실기기 QA에서 별도 확인한다.
3. 에뮬레이터 Playwright 테스트에서 웹·WebView의 light → dark → light 변경 직후 바탕/패널/본문/활성 버튼 색상 및 입력 미소실을 검증한다.
4. 소형 320px, 일반 390px, 확대 폰트 160%, 키보드 노출·화면 회전은 이후 5-A에서 검증한다.
5. 실제 AAB 업로드·Play 테스트 트랙 배포는 이 PR에 포함되지 않는다.

## 후속 개발
1-B 앱 아이콘·워드마크, 2-A 공통 컴포넌트, 3-A~3-C Android 화면, 4-A 웹 편집 화면, 5-A 전체 QA 순서로 진행한다.
