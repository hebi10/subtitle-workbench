# 해비 자막 · Android

Android 8.0(API 26) 이상용 앱입니다. 기존 브라우저 앱과 별도로 빌드하며 자막 편집·SRT/VTT/JSON 처리 모듈을 공유합니다.

## 사용 흐름

1. 앱을 설치하고 **설정 → API 키 암호화 저장**을 누릅니다. 키는 기기 Keystore로 암호화하며 백업 대상에서 제외합니다.
2. 원본/번역 언어를 선택하고 **영상 선택 · 생성**을 누릅니다. 파일 선택은 Android 문서 선택기를 사용합니다. 알림을 허용하면 앱 밖에서도 진행 상태를 확인할 수 있습니다.
3. 한 번에 7분씩 오디오를 추출하고 음성 인식·번역합니다. 150분 영상은 22구간입니다. 전체 영상은 JavaScript 메모리에 올리지 않습니다.
4. **일시정지 / 이어하기**를 사용할 수 있습니다. 완료된 구간과 음성 인식 결과는 SQLite에 저장됩니다. 번역 도중 실패하면 저장된 번역 배치 다음부터 이어합니다.
5. 완료된 자막은 편집, 실행 취소/다시 실행, 시간 수정, 분할/합치기, 영상 미리보기, SRT/VTT/JSON 저장이 가능합니다. 진행 중 결과는 조회와 부분 내보내기를 지원합니다.

추출된 오디오와 자막 텍스트는 OpenAI API로 전송되며 API 요금이 별도로 발생합니다. 키를 앱이나 소스에 포함해 배포하지 마세요.

## 앱 종료와 복구

- 화면을 닫거나 최근 앱에서 제거해도 foreground service가 작업을 계속할 수 있습니다. 제조사의 절전 정책에 따라 중단될 수 있습니다.
- 프로세스가 종료되면 원본 URI와 구간별 체크포인트로 복구합니다. 시스템이 서비스 재시작을 허용하면 자동 재개하고, 그렇지 않으면 앱을 다시 열어 재개합니다.
- Android 설정의 **강제 중지**와 재부팅 후에는 앱을 열어야 합니다. 사용자가 일시정지한 작업과 오류 작업은 **이어하기**로 재개합니다.
- 원본을 이동/삭제하거나 접근 권한을 취소하면 이어하기와 재생을 할 수 없습니다. 문서 제공자가 URI 영구 권한을 지원해야 합니다.
- API 응답을 받은 직후 저장 전에 강제 종료되면 진행 중인 요청 하나가 다시 전송될 수 있습니다. 완료 저장된 구간은 건너뜁니다.
- Android 15의 foreground service 시간 한도(일반적으로 유형별 24시간 중 6시간)에 도달하면 중지하고 상태를 보관합니다. 제한을 우회하지 않습니다.
- 고정 7분 분할과 0.5초 겹침을 사용합니다. 웹의 무음 탐색 분할과 경계 선택 방식은 다르며, 인식 결과가 완전히 동일함을 보장하지 않습니다.

## 빌드

JDK 17 또는 21, Android SDK Platform 35 / Build Tools 35.0.0이 필요합니다. `android/`를 Android Studio에서 열거나 다음 명령을 실행합니다.

```powershell
$env:JAVA_HOME = '설치한 JDK 경로'
$env:ANDROID_HOME = '설치한 Android SDK 경로'
Set-Location android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
```

Gradle Wrapper 8.11.1은 배포 파일의 SHA-256을 검증합니다. SDK 설치/라이선스는 Android Studio 또는 공식 Android CLI에서 설정하세요. `local.properties`, 빌드 결과, 키스토어는 Git 추적에서 제외되어 있습니다.

결과: `app/build/outputs/apk/debug/app-debug.apk`. 개발용 서명 APK이며 Play Store 배포용 서명/등록은 포함하지 않습니다.

Windows 사용자/프로젝트 경로에 한글이 있으면 Gradle 테스트 실행기의 클래스 경로 오류가 발생할 수 있습니다. 이 프로젝트에서는 다음 보조 스크립트로 영문 경로에 소스만 복사해 검증했습니다. 원본은 이동하거나 삭제하지 않으며 빌드 사본은 결과 검토를 위해 남깁니다.

```powershell
# 프로젝트 루트에서 실행
.\scripts\build-android.ps1 -SdkPath 'SDK 경로' -JavaHome 'JDK 경로'
# 기기 테스트도 실행하려면 -DeviceTests 추가
```

보조 스크립트 결과는 `output/android/haebi-subtitles-debug.apk`입니다.

## 검증

```powershell
# 기존 웹 회귀 테스트: 프로젝트 루트
npm test

# Android JVM / lint / APK
Set-Location android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug

# USB 디버깅 기기 또는 실행된 에뮬레이터 필요 (실제 API 호출 없음)
.\gradlew.bat connectedDebugAndroidTest
```

단위 테스트는 150분 구간 계획, 경계 겹침, 타임스탬프 정규화 및 번역 응답을 확인합니다. 기기 테스트는 SQLite 재생성 후 저장 상태, 암호화 키 저장, 네이티브 오디오 추출/취소/무음 파일과 150분 합성 MP4의 끝부분 추출을 확인합니다. 실제 API 호출 및 장편 영화의 처리 성능 검증은 별도입니다. 이번 작업의 [검증 결과](../docs/android-verification.md)를 참고하세요.

장편 실기기 확인 절차:

1. 150분 이상의 로컬 영상을 선택하고 2개 이상의 구간 처리를 기다립니다.
2. 원문·번역 구간 수를 확인하고 앱을 최근 앱에서 제거합니다. 알림/재실행 후 진행이 유지되는지 확인합니다.
3. 설정에서 앱을 강제 중지한 후 다시 실행합니다. 저장된 구간이 반복되지 않고 다음 구간에서 진행되는지 확인합니다.
4. 네트워크를 끊었다 복구하고 이어하기를 눌러 원문 인식이 유지되는지 확인합니다.
5. 최종 SRT/VTT를 플레이어에서 열어 마지막 타임스탬프와 구간 경계의 누락·중복을 확인합니다.

이 절차의 실제 기기/API 검증 없이 150분 영상의 속도·품질·중단 복구를 검증 완료로 간주하지 마세요.

## 구성

- `web/`: 모바일 화면, 공유 JS 편집 모듈 사용. `mock-bridge.js`는 APK에 포함되지 않는 브라우저 테스트 전용입니다.
- `MainActivity`: 내부 HTTPS origin 전용 메시지 브리지, SAF 파일 선택/저장.
- `MediaChunks`, `ChunkPlan`: 원본 URI에서 AAC 오디오 구간을 스트리밍 추출.
- `JobStore`, `JobService`: 트랜잭션 체크포인트와 foreground service.
- `OpenAiClient`, `Transcript`: 제한된 파일/응답 크기, 취소 가능한 API 요청과 번역 검증.
- `SecretStore`: Android Keystore AES-GCM 암호화.
- `PreviewActivity`: Media3 네이티브 영상 및 자막 재생.

참고: [Android foreground service 변경 사항](https://developer.android.com/develop/background-work/services/fgs/changes), [Media3 Transformer](https://developer.android.com/media/media3/transformer/getting-started), [OpenAI 음성 인식](https://developers.openai.com/api/docs/guides/speech-to-text).
