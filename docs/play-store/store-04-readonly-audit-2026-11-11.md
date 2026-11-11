# STORE-04 — Google Play 스토어 반영 및 심사 상태 검증

기준일: 2026-11-11 (Asia/Seoul)
패키지: `com.haebi.subtitle`
검증 범위: **Play API의 등록정보·이미지·내부/비공개 테스트 트랙 읽기**, GitHub Actions 증거 확인 및 Console 심사 상태 안내.

## 선행 현황
- STORE-02 실제 Android 캡처 8장은 `main`에 반영되어 GitHub CI/에뮬레이터 검증을 통과했습니다.
- STORE-03 [실행 #42953423343](https://github.com/hebi10/subtitle-workbench/actions/runs/42953423343): 이미지 파일 8장 검사 및 WIF 인증 통과, Play `validate_edit`에서 `HTTP 403 PERMISSION_DENIED`, **Edit commit 미실행**.
- [권한 확인 Issue #42](https://github.com/hebi10/subtitle-workbench/issues/42): 서비스 계정에 앱 스토어 등록정보 관리 권한을 확인해야 할 수 있습니다. 사용자의 Play Console 실제 권한 부여는 확인되지 않았습니다.

## STORE-04 읽기 전용 경로
1. 원본 출처가 검증된 `main` 및 두 GitHub CI job의 성공을 확인합니다.
2. **정확한 병합 커밋 제목** `qa: STORE-04 read-only Play listing audit [audit-only]` 또는 승인된 기존 신뢰 워크플로의 **수동 audit 모드**에서만 실행합니다.
3. 기존 WIF 인증 환경 `google-play`을 그대로 사용하며, 새 키/Secret을 만들거나 공개하지 않습니다.
4. Google Play Editor API에 임시 Edit 세션을 생성하고 GET으로 한국어 등록정보·아이콘·대표 그래픽·휴대전화 스크린샷 8개의 SHA-256, 내부 및 alpha 트랙을 조회합니다.
5. Edit **commit/validate, 이미지 POST/DELETE, AAB 업로드, 트랙 PUT/승격은 하지 않습니다**. 임시 Edit는 삭제합니다.
6. 저장소 `manifest.json`의 이미지 해시 및 `listing-ko.json` 설명값과 실제 Play API 반환값을 비교해 `output/play-store-audit.json`으로 남깁니다.
7. `versionCode 22`가 내부 트랙에 `completed`로 확인되는지 구분합니다. 비공개 alpha 트랙이 비어 있으면 이를 그대로 기록합니다.

## 구분하여 보고할 상태
- **GitHub 자산 준비**: 파일·해시·CI 통과 여부
- **Play API 저장 이미지**: `matchesRepositoryAssets` 및 개수
- **Play 내부/비공개 트랙**: 등록된 versionCode와 API release status
- **Google 심사·게시 상태**: Play Developer API Edit 조회로 증명할 수 없으므로 **Play Console → 게시 개요**에서 실측 필요
- **테스터 실제 노출/설치**: 별도 테스터 계정에서 검증 필요

Google 공식 문서:
- https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/list
- https://support.google.com/googleplay/android-developer/answer/9859751

## 안전 원칙
- STORE-03 권한 오류가 아직 해결되지 않았을 수 있으므로 업로드 재시도는 하지 않습니다.
- Play API 읽기조차 HTTP 403이면 `audit_failed`로 기록하고, 스토어 반영을 주장하지 않습니다.
- Google Play Console의 심사, 정책 검토 및 게시 승인 상태는 이 API에서 제공하지 않습니다.
