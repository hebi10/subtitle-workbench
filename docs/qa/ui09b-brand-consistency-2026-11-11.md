# UI-09-B — 브랜드·아이콘 최종 정합성 검증

2026-11-11 · hebi10/subtitle-workbench · 기준 main b0c9a586207294927e60cf301186d58304cbc3b5

## 결과 기준
- 기존 Editorial Studio 1-B의 ‘자막 프레임 + 두 줄 자막 + 재생 표식’ 단색 마스터를 현재 확정된 적용본으로 삼는다.
- 11월 11일 연필형 신규 시안은 별도의 승인·교체 기록이 없어 현재 앱에 혼용하지 않는다.
- Google Drive 1-B 브랜드 원본 ZIP 10개를 열어 실제 12개 GitHub 이미지 자산 경로의 Git blob SHA와 크기·SHA-256을 대조했다. 전부 동일 계열·정확한 동일 바이트로 확인됐다.
- 웹과 Android WebView PNG는 동일하며, adaptive foreground와 monochrome도 동일하다. Play icon 512·feature 1024×500은 로컬 manifest SHA와 일치했다.
- Play 48px / favicon 16px 프리뷰에서 프레임과 플레이 표식이 작은 크기에서도 식별됨을 검수했다. Android15 라이트100·다크160 실제 상태별 60장 중 헤더를 직접 대조했고 브랜드·헤더의 가독성과 색상 대비를 확인했다.

## 발견된 자료 불일치
- assets/play-store/ko-KR/generation-prompts.json에는 실제 1-B 프레임 심볼 대신 ‘프레임 없는 삼각형과 자막 막대’를 생성하도록 하는 과거 문구가 남아 있었다.
- 현재 리소스를 이미지 생성으로 재작업하지 않고 프롬프트를 실제 마스터 모양(둥근 사각 내부의 삼각형·자막 바)과 일치하도록 정정한다.
- docs/design-v0.8.md의 HB 로고는 과거 디자인 기획의 설명이며 실제 브랜드 구현 상태가 아니다.

## 코드 검증 및 보존
- assets/brand/canonical.json 신규 추가: 크기·SHA-256·테마 토큰·복제 관계·승인 조건 기록.
- assets/brand/README.md 및 generation-prompts.json의 기준 문구 정정.
- android/tests/editorial-ui09b-brand-consistency.test.mjs 신규 검증: 고정 해시·PNG 규격·Play manifest·런처 XML·파일 사본 일치·색상 토큰·브라우저와 WebView 320/390/800 라이트/다크 로고 로딩·텍스트·가로 넘침.
- .github/workflows/verify.yml 브랜드 로고 시각 캡처 증빙 추가. Google Play AAB·스토어 이미지 PNG·아이콘 원본·비밀키·API·SQLite 등 실제 앱 기능은 불변.

## 최종 확인
- 최종 PR HEAD에서 Verify web and Android/Android Emulator Smoke 성공, 브라우저 및 실제 Android 이미지 시각 검수 후 [skip-play] 병합.
- Google Play Console의 실제 등록 아이콘·대표 이미지·스크린샷 및 심사/테스터 노출 readback은 STORE-05에서 별도 검증한다.
- 추후 연필형 등 새 브랜드 교체는 사용자 승인 후 별도 통합 마스터 변경으로 진행한다.
