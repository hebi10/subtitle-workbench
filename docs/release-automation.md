# Subtitle Workbench · Android CI / Google Play

- PR 및 main push: `verify.yml`에서 웹 테스트와 Android 단위 테스트, lint, debug APK 및 Android 기기 테스트 APK 컴파일를 검사합니다.
- main push: `verify.yml`이 모두 성공한 뒤에만 `play-internal.yml`을 시작합니다. **비밀값 5개가 모두 설정된 경우에만** 검증된 커밋의 서명된 AAB를 Google Play 내부 테스트 트랙으로 업로드합니다.
- 선택적 비공개 테스트: Actions → Publish signed Android AAB to Google Play → Run workflow → `alpha` 선택.
- 출시용 코드는 현재 `android/app/build.gradle`의 versionCode를 **매 업로드마다 증가**시켜야 합니다.
- 새 패키지 `com.haebi.subtitle`는 Play Console에서 최초 등록, 사용자·권한 및 API 액세스 연결이 필요합니다.

## GitHub Actions Secrets (개발자 본인이 등록)

| Secret | 목적 |
|---|---|
| `ANDROID_UPLOAD_KEYSTORE_B64` | 기존 업로드용 JKS 키스토어를 Base64 인코딩한 값 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 암호 |
| `ANDROID_KEY_ALIAS` | 업로드키 별칭 |
| `ANDROID_KEY_PASSWORD` | 업로드키 암호 |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play Android Publisher 권한이 부여된 서비스 계정 JSON |

실제 인증 정보나 JKS를 소스 코드·PR·로그에 포함하지 마세요. 기존 Play 앱의 서명키가 있다면 기존 키를 재사용해야 합니다. 계정의 업로드키가 다르면 Play Console에서 재설정을 승인받아야 합니다.

APK는 검증 워크플로의 아티팩트이며 개발용 서명입니다. Play 배포용으로는 서명된 `.aab`를 사용합니다. 앱 변경 없이 workflow를 다시 실행해도 동일 `versionCode`를 중복 업로드할 수 없습니다.
