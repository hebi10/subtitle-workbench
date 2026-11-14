# BRAND-01 — 자막라인 사용자 표시명 변경

선택일: 2026-11-12. 앱 표시명은 '자막라인'으로 결정했습니다. 기존 개인 닉네임 기반 '해비 자막'을 새 표시명으로 교체합니다.

## 변경 범위
- AndroidManifest.xml의 런처 표시 이름
- Android WebView와 웹 HTML의 title·h1 및 영어 기능 설명 SUBTITLE WORKSPACE
- Android 온디바이스·GPT 실시간·Vosk Native 화면 제목
- 개인정보처리방침의 앱 이름·앱 데이터 삭제 경로
- Google Play ko-KR listing JSON의 앱 제목과 전체 설명 (로컬 초안, API 미적용)
- 현재 README, 브랜드 표시 회귀 테스트, 향후 스토어 이미지 생성 스크립트

## 유지 대상
- com.haebi.subtitle 패키지명·서명키·AAB·SQLite·Keystore·Native Bridge·API 인증·자막 SRT/VTT/JSON 포맷
- GitHub 저장소 hebi10/subtitle-workbench와 기존 테스트 링크
- 기존 로고·아이콘·스토어 PNG의 바이트와 자산 SHA. assets/brand/canonical.json은 11월 11일 승인된 구 브랜드 이미지 마스터의 역사적 기준선으로 보존
- 이전 LineTempo 디자인 가안은 참고 자료로만 보존. 새 이름 자막라인에 자동 적용하지 않음

## 안전한 적용 순서
1. UI-10-A PR #56, UI-10-B PR #57의 선행 CI·안전 병합 검토
2. BRAND-01 PR 최신 HEAD의 웹·Android·API35 CI 및 라이트/다크·글꼴 확대 상태 검수
3. [skip-play]를 유지한 명칭 전용 PR 병합. 이 시점 Google Play 코드·메타데이터 배포 없음
4. BRAND-02에서 자막라인 신규 브랜드 아이콘·워드마크와 최신 실제 화면 스토어 이미지 8장 제작·SHA 검증
5. BRAND-03에서 새 signed AAB 및 Play 제목·설명·이미지 적용, API readback과 실제 설치 확인

## 제약
공개 웹에서는 정확한 자막라인 이름의 주요 자막 앱을 확인하지 못했지만, 이름의 독점 사용 가능성을 보장하지 않습니다. KIPRIS·도메인 구매와 무관하게 앱 표시명 변경을 우선 진행합니다.
본 PR은 코드 작성·검증 초안이며 CI 성공·main 병합·Play 게시 완료를 뜻하지 않습니다.
