# RELEASE-03 — Google Play 비공개 테스트 alpha 기존 버전 승격

2026-11-12. 패키지: `com.haebi.subtitle`. 승인된 목표는 새로운 AAB 빌드 없이 **이미 내부 테스트에 성공적으로 등록된 versionCode 23**을 동일 `alpha` 트랙에 승격하는 것입니다.

## 선행 배포 증빙
- 기준 내부 테스트 소스 SHA: `fd6bc488d5cc127699cd8c44428e881ccd749e05`.
- RELEASE-02 내부 테스트 GitHub Actions: https://github.com/hebi10/subtitle-workbench/actions/runs/43136756766
- `play-release.json`: `package=com.haebi.subtitle`, `track=internal`, `versionCode=23`, `releaseStatus=completed`, `status=api_committed_and_verified`. 내부 테스트 AAB 23 아티팩트도 검증함.
- RELEASE-01-FIX 스토어 등록정보 복구: https://github.com/hebi10/subtitle-workbench/actions/runs/43134772498

## GitHub 실행 방식
한 번만 실행하는 정확한 커밋 제목:
`release: RELEASE-03 promote verified internal 23 to closed alpha [promote-existing-23]`

검증된 `main`의 `Verify web and Android` push 성공 시 기존 `Play internal release`에서 `mode=promote`, `target=alpha`, `promotion_code=23`을 지정합니다. 기존 완료 상태의 internal 릴리스만 조회하고 `alpha`에 같은 AAB 버전을 연결합니다. 새로운 AAB 빌드, 서명, 버전 할당 및 internal PUT은 실행하지 않습니다. 기존 source SHA 검증, 웹·Android·Android 15 기기 게이트, 기존 WIF 인증, Play Edit validate/commit 및 fresh readback을 사용합니다.

## 출시 차단 사전 확인의 한계
현재 연결된 브라우저에서는 Play Console의 화면·미완료 설정·앱 콘텐츠·테스터·심사 상태를 조회할 수 없으므로 이를 해소 완료라고 주장할 수 없습니다. 이전 `alpha` 승격 오류는 `validate_edit HTTP 400 (status=INVALID_ARGUMENT)`였습니다. 이번 시도에서 동일 오류가 나오면 재시도하지 않고 Play Console의 출시 개요/앱 콘텐츠/비공개 테스트 설정을 확인해야 합니다.

## 사용자가 직접 확인할 내용
1. CI 실행: https://github.com/hebi10/subtitle-workbench/actions/workflows/verify.yml
2. Play release: https://github.com/hebi10/subtitle-workbench/actions/workflows/play-internal.yml
3. 두 번째 workflow의 `Promote verified internal version to closed alpha`가 실제 `success`인지 확인. `skipped`이면 배포 성공이 아닙니다.
4. `play-internal-report-<run-id>`의 `play-promotion.json`이 `track=alpha`, `versionCode=23`, `releaseStatus=completed`, `status=api_committed_and_verified`인지 확인.
5. Play Console `비공개 테스트 > 출시`의 심사·게시 상태, 테스터/국가/앱 콘텐츠·앱 액세스 확인. 실제 테스터의 가입·설치 여부도 별도 확인.
6. `alpha`가 실질적으로 게시되었다고 판정하려면 Play Console 검토 상태와 테스터 기기의 설치를 반드시 확인.

## 실패 대응
Play Edit 유효성 검증이 HTTP 400 등으로 실패하면 새 버전을 재빌드하지 말고, 실패한 Play Actions 링크와 Play Console 오류 요약을 제공받아 정확한 차단 원인을 수정합니다. 사용자 승인 없는 무검증 재승격이나 추가 AAB 제출은 진행하지 않습니다.
