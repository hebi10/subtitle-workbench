# Subtitle Workbench · Editorial Studio 1-B
## 브랜드 심볼
- 브랜드명: 해비 자막 / SUBTITLE WORKBENCH
- 디자인: 자막 프레임 내부에 2열 자막과 재생 표시를 결합한 단색 심볼. 기존 HB 임시 로고 대체.
- 출처: 2026-11-09 image_gen 브랜드 시안의 자막 심볼을 래스터 이미지로 추출·정규화. SVG 직접 작성 없음.
- 색상: 로고 흑백(#171717, #FFFFFF), 배경은 1-A 라이트·다크 토큰 사용. 그림자와 그라데이션 없음.
- 워드마크: 실제 화면은 글자 '해비 자막'을 HTML 텍스트로 유지해 가독성과 접근성을 보존.

## 리소스
- assets/brand/editorial-mark-white.png / editorial-mark-dark.png — 투명 256px 심볼
- assets/brand/editorial-wordmark-dark.png / editorial-wordmark-light.png — 가로형 1040×200
- favicon.png 64px, favicon.ico 여러 크기, apple-touch-icon.png 180px
- Android: @mipmap/ic_launcher 적응형 아이콘, @mipmap/ic_launcher_round, monochrome 테마 아이콘; 전경 432px
- Google Play: assets/play-store/ko-KR/icon.png(512×512) 및 feature-graphic.png(1024×500)
- android/web/editorial-mark-white.png: 웹 로고와 동일한 바이트의 Android WebView 패키지 리소스

## 적용 범위
- index.html과 android/web/index.html의 HB 임시 문자 로고 교체
- styles.css, android/web/styles.css의 로고 이미지 정렬과 시스템 다크 모드 반전
- android/app/build.gradle의 syncWebAssets에 PNG 포함
- AndroidManifest.xml의 런처 참조 교체. 네이티브 API 키/전사/번역/작업 데이터 미변경.
- 캡처 및 브라우저 회귀 테스트 서버가 새 PNG를 실제 제공하도록 라우팅 보강
- Play Store manifest.json의 아이콘·그래픽 sha256과 생성 출처 갱신

## 검증 기준
- Android resource linking / debug build / emulator startup
- 웹과 WebView 로고 깨짐·CSP 차단·좁은 폭 320~390px, 라이트·다크 확인
- 신규 editorial-brand.test.mjs와 기존 UI·Play Listing 자동 테스트 통과
- PR 병합 후 main 검증 통과, 내부 테스트 자동 릴리스 실행 여부 구분
- Play Store 실제 스토어 등록정보 적용은 별도 workflow_dispatch listing apply로 수행
- 기존 Play Store용 실제 UI 스크린샷 5개는 5-B 전체 최신 화면 QA 이후 교체
