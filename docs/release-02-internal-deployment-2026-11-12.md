# RELEASE-02 — 최신 AAB 내부 테스트 배포

- 앱: 해비 자막 / Subtitle Workbench
- GitHub: https://github.com/hebi10/subtitle-workbench
- 패키지: `com.haebi.subtitle`
- 실행 승인: 2026-11-12
- 시작 기준선: `main` `2c78860ef47f04d7e596286496384f1dde3d47f2`
- 이전 Play API 확인: internal `versionCode=22` / `completed` / `api_committed_and_verified`.
- RELEASE-01-FIX: 등록정보 전체 설명·아이콘·대표 그래픽 갱신 및 API 재조회 완료 (#43134772498).

## 이번 실행

이 문서만 추가하는 `main` 커밋 제목에 `[deploy-internal]`을 지정하여 기존 신뢰된 배포 파이프라인을 실행한다. **앱 코드, 서명 정보, 스토어 이미지, 제품 기능을 변경하지 않는다.**

1. `Verify web and Android`의 정확한 `main` push 커밋 전체 테스트.
2. 성공 시 `Play internal release`가 같은 SHA에 대해 웹·Publisher·Android·Android 15 계측을 재검증.
3. 기존 업로드 인증서 지문과 서명을 점검하고, Play의 모든 사용 버전보다 큰 신규 `versionCode`를 안전하게 할당하여 signed AAB 생성.
4. Google Play **internal** 트랙에 제출하고 별도 Play Edit에서 `completed`와 정확한 새 버전 코드를 재조회.
5. 보고서 `play-release.json` 및 `play-allocation.json`, signed AAB 아티팩트 저장. `api_committed_and_verified`인 경우에만 Play API 등록 완료 판정.

**비공개 테스트 `alpha` 자동 승격은 이번 단계에서 금지**. `[deploy-closed]` 마커를 사용하지 않으며 Play Console 앱 설정·심사/테스터 차단 항목을 추정하여 변경하지 않는다.

## 사용자가 직접 확인할 항목

- [Verify web and Android 워크플로](https://github.com/hebi10/subtitle-workbench/actions/workflows/verify.yml)에서 이 커밋의 실행이 `success`인지 확인.
- [Play internal release 워크플로](https://github.com/hebi10/subtitle-workbench/actions/workflows/play-internal.yml)에서 같은 커밋의 실행이 `success`인지 확인.
- 실행 요약의 `Submit internal release and require fresh Play API readback` 단계가 **success**인지 확인. `skipped`이면 배포 성공 아님.
- `play-internal-report-<run-id>` 아티팩트 안의 `play-release.json`에서 `track=internal`, `releaseStatus=completed`, `status=api_committed_and_verified`, 신규 `versionCode` 확인.
- [Play 내부 테스트 링크](https://play.google.com/apps/internaltest/4701628928119663504)에서 테스터 설치·업데이트 실제 확인.
- Google Play Console의 앱 설정, 앱 콘텐츠, 검토/게시, `alpha` 테스터·국가 및 심사용 테스트 서버 접근 정보는 별도로 확인. API 커밋과 실제 테스터 설치 가능 상태는 다르다.

## 실패 시

- 원본 업로드키 또는 Play 인증 검증에 실패하면 새 키를 생성하거나 보호된 인증값을 출력하지 않는다.
- 원격 `main`이 바뀌면 기존 소스 릴리스를 중단한다.
- Play API `validate_edit`·`commit_edit`·재조회가 실패하면 신규 AAB 중복 업로드를 시도하지 않고 최신 Play 상태를 먼저 확인한다.
- 오류/검증 결과를 공유받은 다음 단계에서만 수정·재배포 여부 판단.

## 다음 단계

`RELEASE-03 — Play Console 필수 설정·비공개 테스트 alpha 정확 버전 승격 및 테스터 설치 검증`.
