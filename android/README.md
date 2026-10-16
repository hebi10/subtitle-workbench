# 해비 자막 · Android

Android 8.0(API 26) 이상용 앱입니다. 새 작업은 최대 3시간(180분) 영상·오디오를 지원합니다. 기존 브라우저 앱과 별도로 빌드하며 자막 편집·SRT/VTT/JSON 처리 모듈을 공유합니다.

## APK 설치

1. **[0.4.0 APK 다운로드](https://github.com/hebi10/subtitle-workbench/releases/download/v0.4.0/haebi-subtitles-0.4.0.apk)**를 누르거나 [GitHub Releases](https://github.com/hebi10/subtitle-workbench/releases/tag/v0.4.0)의 **Assets → haebi-subtitles-0.4.0.apk**를 선택합니다.
2. 휴대폰에서 다운로드한 APK를 열고 Android의 설치 안내를 따릅니다. `Source code (zip)`은 설치 파일이 아닙니다.
3. 앱을 실행한 뒤 **설정 → OpenAI API 연결**에서 본인의 키를 저장합니다. API 사용 요금은 본인 계정에 별도로 청구됩니다.

0.4.0은 개발용 서명으로 제공하는 공개 테스트 버전입니다. 현재 API 35 에뮬레이터에서 설치와 주요 화면 동작을 확인했으며, 실물 휴대폰과 실제 유료 API로 3시간 전체 생성하는 흐름은 별도 검증이 필요합니다. 배포 APK의 SHA-256은 릴리스에 첨부된 `.sha256` 파일과 [검증 기록](../docs/android-verification.md)에서 확인할 수 있습니다.

## 사용 흐름

하단 메뉴는 네 화면으로 나뉩니다. 자막 편집은 결과에서 열며, 편집 화면 끝까지 스크롤하지 않아도 결과 화면에서 미리보기와 저장을 할 수 있습니다.

| 화면 | 하는 일 |
| --- | --- |
| 영상 추가 | 기기의 영상·자막 파일 선택, 준비 작업의 언어·모델 확인 및 생성 시작 |
| 작업 | 진행률 확인, 일시정지·이어하기, 작업 선택. 목록은 한 페이지에 최대 4개 |
| 결과 | 작업별 영상 미리보기, 자막 편집, SRT/VTT/JSON 저장 |
| 설정 | API 연결, 기본 생성 설정, 전송 데이터·비용 안내. 항목별로 펼쳐서 확인 |

1. **설정 → OpenAI 연결**에서 본인의 API 키를 입력하고 암호화 저장합니다. 키는 기기 Keystore로 암호화하며 백업 대상에서 제외합니다. **연결 확인**은 인증과 선택 모델 접근을 확인하며, 유료 음성 인식·번역 요청을 보내지 않습니다. 결제 잔액이나 실제 생성 성공을 보장하는 검사는 아닙니다.
2. 원본/번역 언어와 모델을 **설정 저장**한 뒤 **영상 추가 → 영상 선택**을 누릅니다. 파일 선택 단계에서는 작업을 준비하며, **생성 시작** 후 API 처리를 시작합니다. 새 영상에는 저장한 설정을 사용하며 미저장 초안은 별도로 표시합니다. 길이와 음성 트랙, 최소 64MB의 여유 공간을 확인한 뒤 준비된 작업으로 이동합니다. 생성 전에는 해당 작업의 설정 변경, 다른 영상 선택, 준비 취소가 가능합니다. 파일 선택을 취소하거나 유효하지 않은 영상을 선택하면 기존 준비 작업을 유지합니다. 작업 정보와 전송·요금 안내를 확인하고 **생성 시작**을 누르면 작업 화면으로 이동합니다. 알림을 허용하면 앱 밖에서도 진행 상태를 확인할 수 있습니다.
3. 한 번에 7분씩 오디오를 추출하고 음성 인식·번역합니다. 180분 영상은 26구간이며 마지막 구간은 5분입니다. 전체 영상은 JavaScript 메모리에 올리지 않습니다. 화면과 알림에 저장된 진행률, 현재 단계와 구간을 표시합니다.
4. **일시정지 / 이어하기**를 사용할 수 있습니다. 완료된 구간과 음성 인식 결과는 SQLite에 저장됩니다. 번역 도중 실패하면 저장된 번역 배치 다음부터 이어합니다. 중단된 작업의 모델이 현재 설정과 다르면 **현재 모델로 이어하기**로 남은 번역의 모델만 바꿀 수 있습니다.
5. **결과**에서 작업을 선택해 미리보기·편집·저장을 실행합니다. 완료 카드는 바로 SRT 저장도 지원합니다. 자막 목록에서 선택한 행만 상세 편집을 펼치며 검색·검수 필터·시간/번호 이동은 필요할 때 도구를 펼쳐 사용합니다. 페이지를 바꾸면 첫 자막으로 이동합니다. 실행 취소/다시 실행, 시간 수정, 분할/합치기를 지원합니다. 탭·결과 작업 변경과 미리보기·내보내기는 편집 저장을 기다리며, 실패하면 입력을 유지하고 현재 화면에서 다시 시도할 수 있습니다. 진행 중 결과는 조회와 부분 내보내기를 지원합니다.

추출된 오디오와 자막 텍스트는 OpenAI API로 전송되며 API 요금이 별도로 발생합니다. 키를 앱이나 소스에 포함해 배포하지 마세요.

## 모델과 API 키

- 번역 기본값은 `gpt-6-luna`입니다. 0.1 버전의 전역 기본값 `gpt-5.5`는 한 번 갱신하며, 다른 사용자 지정 모델과 기존 작업에 저장된 모델은 보존합니다. 기존 작업의 모델 변경은 사용자가 명시적으로 선택해야 합니다.
- 음성 인식은 단어·구간 타임스탬프를 제공하는 `whisper-1`을 사용합니다. 공식 종료 예정일은 **2027년 2월 26일**입니다. `gpt-6-luna`는 음성 입력을 지원하지 않습니다. 음성 모델 전환은 자막 시간 정렬 호환성을 검증한 후 별도로 진행해야 합니다. [OpenAI 지원 종료 안내](https://developers.openai.com/api/docs/deprecations), [타임스탬프 안내](https://developers.openai.com/api/docs/guides/speech-to-text).
- 키 저장과 연결 확인은 별도 상태입니다. 키·모델 설정을 바꾸면 이전 연결 확인 결과는 더 이상 표시하지 않습니다.
- 키 교체·삭제는 진행 중인 작업을 일시정지하고 요청이 정리된 뒤 가능합니다. 키를 삭제해도 자막과 작업 기록은 보존됩니다.

## 진행률의 의미

전체 진행률은 영상 구간 길이에 따라 저장된 음성 인식·번역 결과를 반영합니다. 번역하는 작업은 인식과 번역에 각각 절반을 배정합니다. 인식만 하는 작업은 인식 저장량을 사용합니다. 실제 처리 시간의 비율이나 완료 시각 예측은 아닙니다.

현재 단계와 전체 진행률을 기본으로 표시하며, 상세 정보를 펼치면 현재 구간, 번역 묶음, 추출 진행률(측정 가능한 경우), 실행 시간, 마지막 결과 저장 시각을 확인할 수 있습니다. API 응답 대기에는 임의의 퍼센트를 표시하지 않습니다. 일시정지·재실행 후에도 이미 저장된 결과의 진행률은 유지됩니다.

## 앱 종료와 복구

- 화면을 닫거나 최근 앱에서 제거해도 foreground service가 작업을 계속할 수 있습니다. 제조사의 절전 정책에 따라 중단될 수 있습니다.
- 프로세스가 종료되면 원본 URI와 구간별 체크포인트로 복구합니다. 시스템이 서비스 재시작을 허용하면 자동 재개하고, 그렇지 않으면 앱을 다시 열어 재개합니다.
- Android 설정의 **강제 중지**와 재부팅 후에는 앱을 열어야 합니다. 사용자가 일시정지한 작업과 오류 작업은 **이어하기**로 재개합니다.
- 원본을 이동/삭제하거나 접근 권한을 취소하면 이어하기와 재생을 할 수 없습니다. 문서 제공자가 URI 영구 권한을 지원해야 합니다.
- API 응답을 받은 직후 저장 전에 강제 종료되면 진행 중인 요청 하나가 다시 전송될 수 있습니다. 완료 저장된 구간은 건너뜁니다.
- Android 15의 foreground service 시간 한도(일반적으로 유형별 24시간 중 6시간)에 도달하면 중지하고 상태를 보관합니다. 제한을 우회하지 않습니다.
- 고정 7분 분할과 각 구간 앞뒤 0.5초 패딩을 사용합니다. 인접 추출 파일은 총 1초 겹치며, 영상 시작과 끝에서는 범위를 넘지 않습니다. 웹의 무음 탐색 분할과 경계 선택 방식은 다르며, 인식 결과가 완전히 동일함을 보장하지 않습니다.

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

# Android 화면 회귀: 별도 설치된 Playwright 경로를 환경 변수로 지정
$env:PLAYWRIGHT_MODULE = 'Playwright 모듈 경로'
$env:BROWSER_CHANNEL = 'msedge'
node --test android/tests/*.test.mjs

# Android JVM / lint / APK
Set-Location android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug

# USB 디버깅 기기 또는 실행된 에뮬레이터 필요 (실제 API 호출 없음)
.\gradlew.bat connectedDebugAndroidTest
```

단위 테스트는 구간 계획, 경계 겹침, 타임스탬프 정규화, API 요청·오류 분류와 설정 이전을 확인합니다. 기기 테스트는 3시간 길이 경계, 저장 상태·진행률 복구, 기존 DB 이전, 키 저장·삭제와 실제 코덱 추출을 확인합니다. 실행된 범위와 결과는 [검증 기록](../docs/android-verification.md)을 참고하세요. 실제 API 호출 및 장편 영화의 처리 성능 검증은 별도입니다.

장편 실기기 확인 절차:

1. 180분 로컬 영상을 선택하고 2개 이상의 구간 처리를 기다립니다. 180분 초과 파일은 생성 전에 거부되는지 확인합니다.
2. 원문·번역 구간 수를 확인하고 앱을 최근 앱에서 제거합니다. 알림/재실행 후 진행이 유지되는지 확인합니다.
3. 설정에서 앱을 강제 중지한 후 다시 실행합니다. 저장된 구간이 반복되지 않고 다음 구간에서 진행되는지 확인합니다.
4. 네트워크를 끊었다 복구하고 이어하기를 눌러 원문 인식이 유지되는지 확인합니다.
5. 최종 SRT/VTT를 플레이어에서 열어 마지막 타임스탬프와 구간 경계의 누락·중복을 확인합니다.

이 절차의 실제 기기/API 검증 없이 3시간 영상 전체의 속도·음성 인식 품질을 검증 완료로 간주하지 마세요.

## 구성

- `web/`: 모바일 화면, 공유 JS 편집 모듈 사용. `mock-bridge.js`는 APK에 포함되지 않는 브라우저 테스트 전용입니다.
- `MainActivity`: 내부 HTTPS origin 전용 메시지 브리지, SAF 파일 선택/저장.
- `MediaChunks`, `ChunkPlan`: 원본 URI에서 AAC 오디오 구간을 스트리밍 추출.
- `JobStore`, `JobService`: 트랜잭션 체크포인트와 foreground service.
- `OpenAiClient`, `Transcript`: 제한된 파일/응답 크기, 취소 가능한 API 요청과 번역 검증.
- `SecretStore`: Android Keystore AES-GCM 암호화.
- `PreviewActivity`: Media3 네이티브 영상 및 자막 재생.

참고: [Android foreground service 변경 사항](https://developer.android.com/develop/background-work/services/fgs/changes), [Media3 Transformer](https://developer.android.com/media/media3/transformer/getting-started), [OpenAI 음성 인식](https://developers.openai.com/api/docs/guides/speech-to-text).
