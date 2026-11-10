# Editorial Studio 2.0 · 5-B 통합 CI·Google Play 테스트 릴리스 검증

작성일: 2026-11-10 (Asia/Seoul)  
패키지: `com.haebi.subtitle` / `versionName 0.10.0`  
기준 UI 완료 main: `49c6d684913b19205eb3c94e66357e1750b28901`

## 목적과 사용자 승인 범위

2026-11-10 5-A까지 변경된 앱을 실제 Google Play **내부 테스트(internal)** 트랙에서 검증한다. 기존 구성·키·스토어 목록은 유지한다. **비공개 테스트(alpha/closed) 승격과 스토어 이미지·설명 변경은 수행하지 않는다.** 브라우저 기반 검증, GitHub CI, Play API 커밋, Play Console 심사·실제 테스터 설치 가능 여부를 각각 분리 판정한다.

## 선행 확인 사항

| 항목 | 근거 | 확인 내용 |
|---|---|---|
| 5-A 완료 | [PR #38](https://github.com/hebi10/subtitle-workbench/pull/38) | main `49c6d684` 반영, PR 검증 3개 통과 |
| GitHub Pages | [Pages #42791998186](https://github.com/hebi10/subtitle-workbench/actions/runs/42791998186) | 완료·성공 |
| main UI CI | [Verify #42791999549](https://github.com/hebi10/subtitle-workbench/actions/runs/42791999549) | 검증 완료 상태 별도 확인 |
| 기존 Play internal | [release #42591561473](https://github.com/hebi10/subtitle-workbench/actions/runs/42591561473) | versionCode 21의 signed AAB 및 Google Play internal API 커밋·재조회까지 성공. 동일 실행의 alpha 승격은 HTTP 400으로 실패 |
| 직전 성공 배포 | [release #42584606386](https://github.com/hebi10/subtitle-workbench/actions/runs/42584606386) | versionCode 20, internal API 커밋·재조회 성공 |
| 이후 UI 커밋 | [check-only #42789389792](https://github.com/hebi10/subtitle-workbench/actions/runs/42789389792) | `[skip-play]` 감지로 signed AAB 빌드/Play 제출 단계 생략. 성공 표시는 Play 배포 성공 의미 아님 |
| 스토어 화면 등록 | [listing recovery #42587748339](https://github.com/hebi10/subtitle-workbench/actions/runs/42587748339) | 별도 등록이 Play API HTTP 403으로 실패한 기록. 5-B 내부 테스트 빌드에 사진 등록 재시도는 포함하지 않음 |

## 5-B 통합 검증 및 배포 흐름

1. 최종 **PR HEAD**에서 웹 Node/UI, Release Publisher/보안/Relay, Android JVM/Lint/Debug APK와 Android 15 실기반 에뮬레이터가 모두 통과하는지 확인한다.
2. PR squash 병합 시 정확한 커밋 제목에 `[deploy-internal]`을 포함한다. `[skip-play]`, `[deploy-closed]` 또는 특수 스토어 등록 제목을 혼용하지 않는다.
3. 새로운 main SHA의 `Verify web and Android` **push** 완료 성공을 요구한다. 릴리스 `source.py`가 latest main SHA·branch·동일 GitHub 레포·두 CI job 성공을 재확인한다.
4. 기존 `.github/workflows/play-internal.yml`의 `workflow_run` 분기에서 internal deploy를 선택한다. `play-gates.yml`의 Node/Relay/Playwright/Android/Android 15 추가 검증이 전부 성공해야 배포 단계로 이동한다.
5. Play API에서 현재 모든 Bundle·APK·트랙의 사용 `versionCode`를 조회하고 **미사용 다음 정수**를 할당한다. 기존 21을 재업로드하지 않고 실제 할당 값은 `play-allocation.json`의 결과로 확정한다.
6. GitHub 보안 환경 `google-play`의 기존 업로드키와 WIF 인증을 이용해 signed AAB를 생성한다. 기존 업로드 인증서 SHA-256 대조 후 AAB 아티팩트를 보존한다. 시크릿·키 파일은 출력하거나 다운로드·재등록하지 않는다.
7. 내부 테스트 트랙에 상태 `completed`로 등록하고, API edit commit 후 **새 edit에서** `package/track/versionCode/releaseStatus`를 재조회한다. 새 보고서 `play-release.json`에 `api_committed_and_verified`가 있어야 내부 테스트 API 단계 성공으로 판정한다.
8. signed AAB·`play-allocation.json`·`play-release.json`(민감정보 없는 보고서) 및 검증 로그/CI 실행 URL을 기존 프로젝트 Google Drive에 백업하고, 보고서의 실제 결과를 이 문서에 기록한다.
9. Play Console 심사·테스터 계정의 설치 가능 여부는 API fresh readback만으로 증명되지 않는다. 링크/Console 상태가 확인될 때까지 `requires_console_check`로 둔다. closed alpha로 자동 승격하지 않는다.

## 이번 작업의 코드 보정

`android/app/build.gradle`은 `versionName '0.10.0'`인데, 배포 자동화가 내부 트랙 릴리스 표시명을 구버전 `0.9.1 (versionCode)`로 만들고 있었다.

- `scripts/release/publisher.py`의 **Play Console 릴리스 표시 이름만** 앱 `0.10.0`과 일치시키고, 기존 패키지/서명/버전 할당/API/트랙은 유지한다.
- `scripts/release/tests/test_publisher.py`에 Gradle versionName과 릴리스 표시명 일치 검사를 추가해 차후 표시명만 오래된 상태로 남지 않게 한다.

## 결과 판정표

- GitHub PR/main CI: 실제 run URL, SHA, job conclusion 확인
- signed AAB: 빌드/서명 인증서 확인 및 Drive 원본 백업 여부
- Play internal: API `completed` + fresh track readback 여부
- Play closed: 이번 단계에서 승격하지 않음. 기존 alpha API 실패 기록과 분리
- Console/테스터: 별도 설치/화면 검증 필요; 증거 없으면 미확인

## 금지 작업

API 키/Workload Identity 조건/Secrets 값/Google Play 서명 인증서 변경, 동일 versionCode 재업로드, 앱 데이터 초기화, 스토어 이미지·설명 변경, 비공개 테스트/프로덕션 자동 승격, 실사용 모델/API 유료 요청은 시행하지 않는다.

## 이후 절차

내부 테스트 API 등록이 완료되어도 Google Play Console에서 실제 게시·테스터 노출 상태가 확인되지 않으면 완료라고 표시하지 않는다. 별도의 비공개 테스트 배포가 필요한 경우 기존 alpha HTTP 400 조건과 Console 등록 요건을 점검해, 사용자가 별도로 지시한 승격 범위에서 진행한다.

**결과 갱신 항목**: PR #, 검증 SHA, main SHA, Verify run, Play run, 실제 allocated versionCode, upload certificate 검사, fresh readback, Play Console 확인 상태, AAB/보고서 Drive 링크.
