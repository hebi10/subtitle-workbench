# STORE-03 — Google Play 실제 화면 8장 등록 자동화

대상: 해비 자막 / `com.haebi.subtitle` / `ko-KR`
기준: STORE-02가 `main`에 반영한 1080×1920 실화면 8장, SHA-256 기록
자료: [STORE-02 Drive 원본 ZIP](https://drive.google.com/file/d/1xihMfCBol91CIZUV7_KotcNUzQOMOkAG/view), [STORE-02 검증 PR #40](https://github.com/hebi10/subtitle-workbench/pull/40)

## 배포 범위 및 보호 조건

- 등록 대상은 `assets/play-store/ko-KR/01-video.png` ~ `08-vosk-local.png`의 **휴대전화 스크린샷 8장만**이다.
- Google Play 한국어 제목, 짧은 설명, 상세 설명, 앱 아이콘, 대표 그래픽, App Bundle, 테스트 트랙/버전 및 출시 상태는 건드리지 않는다.
- 승인된 `main` 커밋 제목 **`store: STORE-03 trusted screenshot registration [listing-only]`**에서만 기존 신뢰된 `.github/workflows/play-internal.yml`의 이미지 전용 모드를 실행한다.
- 신규 WIF 신뢰 관계, IAM, Secret, 업로드 키, 서비스 계정 자격 증명은 생성·변경하지 않는다.
- 성공한 최종 웹·Android CI, Play 재검증 게이트, 이미지 파일 SHA-256과 **8장 수량 확인**, 업로드 직전 `main` SHA 재확인을 요구한다.
- 현재 Play 등록 해시가 입력 8장과 이미 같으면 **변경 없는 성공(no write)**으로 종료한다.
- 필요하면 하나의 Google Play Edit에서 기존 스크린샷만 교체하고 commit한다. 업로드 중 오류가 발생하면 edit를 버리고 commit하지 않는다.
- commit 후 **새 Edit**에서 8장 SHA-256, 한국어 스토어 텍스트, 기존 아이콘 및 대표 그래픽 불변을 확인한다.
- 실제 Google Play Console의 심사·승인·테스터 노출 확인은 Play API 수락과 별도다.

## 이전 오류와 진단

2026-11-09 기존 신뢰된 업로드 경로에서도 이미지 `POST`가 HTTP 403으로 실패했다. WIF 인증 단계는 통과했으며, 출시 AAB의 내부 트랙 업로드도 별도로 통과했으므로 **스토어 수정 권한(Manage store presence)** 누락 가능성이 있다. 다만 원인을 현재 증거로 확정할 수 없으므로 이번 작업에서 이미지 업로드 단계/HTTP 코드/안전한 오류 이유를 분리 기록한다. 인증 값이나 응답 원문은 출력하지 않는다.

공식 문서:
- [Play Console 사용자 및 권한](https://support.google.com/googleplay/android-developer/answer/9844686?hl=ko)
- [Google Play Developer API — 이미지 업로드](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/upload)

같은 403이 발생한다면 Play Console > **사용자 및 권한** > GitHub Actions와 연결된 서비스 계정 > **앱 권한** > **해비 자막** > **스토어 등록정보 관리(Manage store presence)**를 확인한다. 계정 소유자가 권한을 조정해야 할 수 있다. 비밀키 재발급은 요구하지 않는다.

## 실행·검증 항목

1. STORE-03 PR 최종 SHA에서 `Verify web and Android`와 회귀 테스트 통과.
2. PR 승인 후 위의 정확한 커밋 제목으로 **Squash main 병합**.
3. 성공한 `main` 검증의 완료 이벤트가 기존 신뢰된 Play 워크플로를 기동.
4. `source`와 `gates` 통과 → `listing` 모드에서만 Google Play API 인증/업로드.
5. GitHub Actions 보고서 `output/play-listing-store03.json`의 `api_committed_and_verified`(또는 `already_matching_no_write`) 확인. 실패 시 `status: failed`와 안전한 오류 단계 기록. 재시도 전에 실패 원인 확인.
6. 필요시 Console 심사·테스터 스토어 화면을 별도 육안 확인.

주의: 이미지 등록 실패를 AAB 배포 실패로 해석하지 않는다. 새 AAB/versionCode는 생성하지 않는다. 증빙이 없으면 Google Play 게시 완료라고 표기하지 않는다.
