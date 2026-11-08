# Play 테스트 배포

대상 저장소는 `hebi10/subtitle-workbench`, 패키지는 `com.haebi.subtitle`이다. 신규 AAB 업로드는 `internal`만 허용한다. 비공개 테스트는 사용자의 명시적 배포 지시에 따라 기존 내부 버전 하나를 `alpha`로 승격한다. 프로덕션, 공개 테스트(`beta`), 임의 트랙 업로드는 지원하지 않는다.

## 실행 모드

| Actions 워크플로 | 모드 | 결과 |
| --- | --- | --- |
| Play internal release | `check` | 정확한 main 소스의 기존 CI 성공을 확인하고 웹·Publisher·Android·기기 검증을 실행한다. 서명·Play 인증·업로드 없음 |
| Play internal release | `build` | 동일 검증 후 서명된 AAB를 산출물로 보관한다. Play API 호출 없음 |
| Play internal release | `deploy` | 동일 검증 후 Play에서 버전 할당 → 서명 빌드 → internal 제출 → 새 edit에서 재조회 |
| Play closed promotion | `check` | main CI·기기 검증과 versionCode 형식 검증만 실행한다. Play 버전 존재 여부를 조회하거나 변경하지 않는다 |
| Play closed promotion | `promote` | 정확한 완료 상태의 internal versionCode를 alpha로 승격한다. 재빌드·AAB 재업로드 없음 |
| Play Korean store listing | `check` | main CI와 한국어 문구·이미지 파일을 검증한다. Play 호출 없음 |
| Play Korean store listing | `apply` | 검토된 한국어 문구·명시된 이미지 유형을 교체하고 commit 후 문구·이미지 SHA-256을 재조회한다 |

수동 실행은 `main`에서만 허용한다. `check`가 수동 실행의 기본값이다. `Verify web and Android`의 main push 실행이 성공하면 `internal`의 `deploy`가 자동 실행된다. 인증이나 서명이 없으면 실제 배포 작업은 실패한다. 누락을 성공이나 배포 완료로 표시하지 않는다.

기본 앱 버전은 `0.9.1 (10)`이다. 빌드 전용 versionCode는 수동 입력값을 사용한다. 배포에서는 입력 versionCode를 무시하고 Play의 모든 현재 bundles, apks와 모든 tracks의 releases(초안 포함)를 조회한 최댓값 + 1을 사용한다. 최소값은 10이다. Gradle은 `-PversionCode=...` 또는 `ANDROID_VERSION_CODE`로 이를 받는다. 업로드 직전 같은 버전이 사용되었는지 다시 조회하고, 충돌하면 업로드 전에 실패한다. 외부 Console 편집으로 경합이 생긴 경우 새 버전을 할당하여 다시 빌드한다.

## 인증 설정

모든 Play 편집 워크플로는 `google-play` 환경을 사용한다. 이 환경의 배포 허용 브랜치를 `main`으로 제한한다. 저장소 및 환경의 변수·Secrets에는 아래 이름을 사용한다.

| 종류 | 이름 | 용도 |
| --- | --- | --- |
| Variable | `PLAY_WORKLOAD_IDENTITY_PROVIDER` | WIF provider 전체 경로 |
| Variable | `PLAY_SERVICE_ACCOUNT` | Play 권한을 부여한 서비스 계정 이메일 |
| Secret | `PLAY_SERVICE_ACCOUNT_JSON` | WIF를 사용하지 않을 때만 사용하는 기존 JSON 인증 대안 |
| Secret | `ANDROID_UPLOAD_KEYSTORE_B64` | 이 앱 업로드키 저장소의 Base64 |
| Secret | `ANDROID_KEYSTORE_PASSWORD` | 키 저장소 비밀번호 |
| Secret | `ANDROID_KEY_ALIAS` | 업로드키 alias |
| Secret | `ANDROID_KEY_PASSWORD` | 키 비밀번호 |
| Variable | `ANDROID_UPLOAD_CERT_SHA256` | 이 앱의 확인된 업로드 인증서 SHA-256, 콜론 유무 허용 |

WIF 변수 두 개가 모두 있으면 JSON보다 WIF를 우선한다. WIF가 일부만 설정되면 JSON으로 우회하지 않고 실패한다. 계정에는 이 앱의 테스트 트랙 배포와 필요한 스토어 정보 관리 권한만 부여한다. WIF 신뢰 조건은 이 저장소와 허용한 main 배포 워크플로·환경으로 제한한다. JSON 대안에서 OAuth access token을 발급하려면 해당 서비스 계정 자신에 대한 `roles/iam.serviceAccountTokenCreator` 권한도 Google 인증 액션의 공식 설정에 맞춰 부여한다. Workflow에는 ID token 쓰기 권한이 인증 작업에만 있고, 인증 토큰은 환경 변수로 해당 Python 프로세스에 전달한다. 인증 파일은 checkout에 만들지 않는다.

다른 앱의 서명키를 재사용하거나 복사하지 않는다. 기존 앱에 이미 연결된 업로드 인증서가 있으면 반드시 그 인증서를 사용한다. 첫 AAB가 아직 등록되지 않아 업로드 인증서가 확정되지 않은 경우에는 승인된 이 앱 전용 첫 업로드 인증서를 설정한다. 자동으로 새 키를 만들거나 기존 인증서를 교체하는 코드는 없다. 인증서 지문은 keystore를 읽었을 때와 서명된 AAB를 검사할 때 모두 확인한다. Gradle release 빌드도 서명 정보와 지문이 없으면 중단한다.

## 소스·검증·직렬화

`source.py`는 같은 저장소의 성공한 main push 또는 수동 main 실행만 받아들인다. 완전한 40자리 SHA를 고정하고 해당 커밋이 현재 원격 main의 HEAD와 같은지, `origin/main`에 포함되는지 확인한다. 검증·빌드 대기 중 main이 갱신되었으면 실제 업로드 직전에도 이를 재조회하여 오래된 소스의 배포를 실패 처리한다. 새 main의 CI 성공 후 다시 실행해야 한다. 이 SHA에 대한 `Verify web and Android` 실행에서 `Web unit and UI tests`, `Android unit, lint and debug APK` 작업이 실제로 성공했는지도 GitHub API로 확인한다. PR 실행이나 건너뛴 작업은 배포의 CI 근거가 될 수 없다.

신규 배포와 비공개 승격은 이후 `play-gates.yml`에서 같은 SHA를 다시 checkout하여 다음을 수행한다.

- Node 전체 단위 테스트, Python release 단위 테스트
- Chromium 기반 WebView UI 회귀 테스트
- Android unit tests, lint, debug APK 및 instrumentation 빌드
- Android 15 에뮬레이터에서 네이티브 화면·오프라인 인식·SecretStore·중단 후 복구 검증

이 검증 작업에 배포 Secrets를 전달하지 않는다. 검증이 끝난 뒤 서명·인증 작업을 실행한다. `play-internal.yml`, `play-promote.yml`, `play-listing.yml`은 모두 `play-com-haebi-subtitle` concurrency 그룹과 `cancel-in-progress: false`를 사용한다. 동일 앱의 API edit을 직렬 처리한다. Console에서 수동으로 편집할 때에도 자동 작업과 겹치지 않도록 한다.

## 초기 등록 및 게시 상태

아직 Console에 AAB가 한 번도 업로드되지 않은 앱은 Edits API로 초기화할 수 없다. `release_status=draft`도 이 제한을 우회하지 않는다. 최초 등록 순서는 다음과 같다.

1. main의 필수 CI가 성공한 뒤 `Play internal release`를 `mode=build`, `version_code=10`으로 실행한다.
2. 서명 검증이 끝난 AAB 산출물을 받아 Play Console에서 최초 AAB를 업로드하고 Play 앱 서명 등록을 완료한다. 이 단계에서 사용한 업로드 인증서를 이후에도 유지한다.
3. Console의 필수 앱 설정과 내부 테스트 초안·게시 상태를 확인한다. 이후의 `mode=deploy`부터 API로 버전 할당·업로드를 수행한다. 최초 10이 등록되었다면 다음 할당은 최소 11이다.

최초 Console 업로드 전 자동 deploy가 실행되면 API 오류로 실패할 수 있으며, 배포 완료로 간주하지 않는다. Console 업로드 이후에도 초기 설정 때문에 완료 릴리스를 거절하는 경우에만 수동 `deploy`에서 `release_status=draft`를 명시한다. 이 경우 초안 제출이며 테스터 배포 완료가 아니다. `changes_not_sent_for_review`는 변경을 검토 대기 상태로 두어야 할 때만 명시한다. API 오류에 따라 초안이나 검토 대기 상태로 자동 우회하지 않는다.

`publisher.py`는 validate와 commit 이후 새 edit을 열고 지정된 track, versionCode, release status를 재조회한다. 재조회 실패는 commit 후에도 작업 실패로 기록한다. 이때 이미 업로드가 반영됐을 수 있으므로 Console에서 현재 상태를 확인한 다음 재실행한다. API의 `completed`는 심사·게시·테스터 설치 가능 상태를 모두 증명하지 않는다. 보고서는 `api_committed_and_verified`와 `availability: requires_console_check`를 구분한다.

스토어 등록은 `docs/play-store/listing-ko.json`의 `language`, `title`, `shortDescription`, `fullDescription` 및 `assets/play-store/ko-KR/manifest.json`의 `images`를 사용한다. 이미지 경로는 manifest 디렉터리 안의 상대 경로여야 한다. 명시적으로 교체하는 유형은 `icon`, `featureGraphic`, `phoneScreenshots` 세 개뿐이다. 이미지 삭제와 교체는 아직 commit되지 않은 edit 안에서 이루어진다. 기본 apply는 검토 전송을 보류한다. API로 처리할 수 없는 개인정보처리방침 URL·데이터 보안·콘텐츠 등급·테스터·국가·심사 및 게시 상태는 Console에서 별도로 확인한다.

## 로컬 검증

```bash
python3 -m unittest discover -s scripts/release/tests -v
npm test
python3 scripts/release/listing.py check
```

신규 배포와 승격을 직접 실행해야 하는 경우 아래 명령의 토큰은 셸 기록·출력에 작성하지 않고 안전하게 `PLAY_ACCESS_TOKEN` 환경 변수로 전달한다. 배포된 GitHub 워크플로 사용을 우선한다.

```bash
python3 scripts/release/publisher.py allocate
python3 scripts/release/publisher.py --report output/play-release.json deploy --bundle android/app/build/outputs/bundle/release/app-release.aab --version-code 10
python3 scripts/release/publisher.py --report output/play-promotion.json promote --version-code 10 --track alpha
```

보고서에는 패키지·트랙·버전·API 확인 상태만 포함한다. API 응답 본문, 토큰, keystore, 비밀번호, JSON 인증은 출력하거나 산출물에 포함하지 않는다. 서명키 임시 파일은 항상 제거하고 AAB와 공개 상태 보고서만 별도 산출물로 보관한다.

## Gradle 배포본 다운로드

2026-11-08 CI에서 Gradle 8.11.1 다운로드가 GitHub 배포 URL의 HTTP 504로 반복 실패했다. `services.gradle.org`와 `downloads.gradle.org`가 모두 같은 GitHub 파일로 이동하므로 단순한 두 도메인 간 교체로는 해결되지 않았다. Wrapper는 [JetBrains Kotlin 공식 저장소에서 사용하는 캐시 경로](https://github.com/JetBrains/kotlin/blob/master/gradle/wrapper/gradle-wrapper.properties)인 `https://cache-redirector.jetbrains.com/services.gradle.org/distributions/gradle-8.11.1-bin.zip`을 사용한다. 확인 시 이 주소는 JetBrains의 `artifacts-caching-proxy.aws.intellij.net`으로 이동했고, 최종 응답은 HTTP 200, `x-artifact-caching-proxy: HIT`, 크기 136,920,070바이트였다.

Gradle 버전은 8.11.1을 유지한다. [Gradle 공식 배포 체크섬](https://gradle.org/release-checksums/) 및 [Kotlin v2.1.20의 동일 버전 설정](https://github.com/JetBrains/kotlin/blob/v2.1.20/gradle/wrapper/gradle-wrapper.properties)과 일치하는 기존 `distributionSha256Sum`도 그대로 유지한다. Wrapper가 다운로드한 전체 ZIP의 SHA-256을 검증하므로 다른 파일이나 손상된 파일은 설치할 수 없다. TLS와 URL 검증을 끄거나 CI 실패를 성공 처리하는 대체 코드는 없다.
