# Android 검증 결과

검증일: 2026-10-16

## 0.2.0 — 3시간 영상·진행률·API 설정·이어하기

현재 설치 파일은 `output/android/haebi-subtitles-debug.apk`이며, versionCode 2 / versionName 0.2.0이다.

- 크기: **5,060,412 bytes**.
- SHA-256: `d63a5f5ad00294925ad641c417f07e0e119e6a5201602e4457379cd3b7517b76`.
- 개발용 APK v2 서명 검증 성공. mock 브리지와 테스트 fixture는 APK 웹 에셋에서 제외됨.
- 최종 빌드 사본과 현재 소스·공유 모듈 39개 파일의 해시 일치를 확인함.

| 확인 항목 | 결과 |
| --- | --- |
| 기존 `npm test` | 228개 통과, 실패 0 |
| Android `testDebugUnitTest` | 30개 통과: 설정 3, 구간 7, API 14, 자막 5, 파일 선택 복원 1 |
| `lintDebug` | 오류 0, 경고 13. 기존 경고 12개와 여유 공간 검사에 `StorageManager` 사용을 고려하라는 권고 1개. 새 경고는 현재의 보수적인 64MiB 여유 공간 확인에 해당함 |
| `assembleDebug`, `assembleDebugAndroidTest` | 최종 소스로 성공 |
| Android UI / Edge headless | 통합 테스트 1개 통과(14.0초). 320/390/800px, 준비 후 명시적 시작, 진행률, 키 확인·삭제, 모델 선택 재개, 시간/번호 이동, 필터, 저장 실패, 폴링 중 버튼 포커스·중복 재개 방지 |
| Android 15/API 35 x86_64 에뮬레이터 | 22개 통과(449.688초): 저장소 10, 미디어 6, 3시간 영상 1, 프로세스 복구 1, 재개 승인 2, 키 저장·삭제 2 |
| 180분 합성 AVC/AAC MP4 | 전체 **26개 구간을 순차 추출**. 모든 출력이 AAC 24kHz mono, 길이 오차 ±200ms 이내, 파일별 8MiB 미만. 마지막 약 5분 구간 포함 |
| 마지막 보완 후 관련 재검증 | 화면 종료 후 늦은 시작 가드와 안내 문구를 보완한 최종 APK를 업데이트 설치하고 장시간 추출 외 21개 테스트 재실행 통과(5.192초). 장시간 추출 코드와 테스트 파일은 앞선 실행과 해시 동일 |
| SQLite v1 → v2 | 기존 설정·자막·3시간 초과 작업을 보존. 신규 영상만 180분 포함/초과 경계 검사 |
| 별도 프로세스 복구 | `seed` → `am force-stop` → `verify` 통과. 26구간 중 완료 1구간, 인식 저장 2구간, 번역 저장 1구간과 진행률 5% 유지 |
| 저장 도중 프로세스 종료 | 미커밋 트랜잭션 마커에서 종료 후 `verify` 통과. 미완료 구간 변경은 롤백되고 이전 체크포인트 유지 |
| 실제 앱 화면 | 최종 APK 설치·시작, 최대 3시간/기본 모델 표시, 설정 이동과 API 키 입력 화면, 하단 시스템 영역 확인 |

장시간 추출 및 최종 재검증 로그는 `output/android-improvements/device-tests.log`, `final-device-tests.log`에 있다. 화면 증거는 `output/android-improvements/device-{jobs,settings}.png`와 `output/android-improvements-ui/`에 있다.

저장 도중 종료 검증은 다음 명령을 실행하고 약 10초 후 `uncommitted-transaction-ready` 마커를 확인하여, 이번 작업의 에뮬레이터 안 테스트 앱만 `am force-stop com.haebi.subtitle`로 종료했다.

```text
adb -s emulator-5556 shell am instrument -w -e class com.haebi.subtitle.ProcessRecoveryDeviceTest -e phase interrupt-write com.haebi.subtitle.test/androidx.test.runner.AndroidJUnitRunner
```

이 명령의 `Process crashed`는 의도한 종료 결과다. 이어서 같은 테스트의 `phase=verify`를 새 프로세스로 실행하여 1개 테스트 통과를 확인했다. 멈춘 빌드를 강제 중단한 사례는 없다.

실제 사용자 API 키로 유료 음성 인식·번역을 실행하지 않았다. `gpt-6-luna` 요청 형식·오류 처리와 모델 접근 확인은 모의 HTTP 연결로 검증했다. 따라서 계정별 모델 접근, 실제 3시간 영상의 인식·번역 품질과 처리 속도, 실물 휴대폰의 발열·배터리·제조사 절전 정책은 미검증이다. 합성 영상 전체 추출 시험은 이 범위를 대신하지 않는다. 강제 중지·재부팅 후에는 앱을 다시 열어야 하며, 원본 파일 접근 권한과 네트워크가 필요하다.

아래는 이전 0.1 버전의 검증 기록이며, 설치 파일 크기·해시·테스트 수는 당시 기준이다.

## 0.1 검증 이력

## 설치 파일

- `output/android/haebi-subtitles-debug.apk` (5,042,252 bytes)
- SHA-256: `ca4a94e71989961273c8aa4b2fb3d79c79335c1c88ce5802638de71f0e932da4`
- 개발용 APK 서명 검증: `apksigner verify --verbose` 성공, v2 서명.
- 테스트 fixture/mock bridge는 앱 APK의 웹 에셋에 포함되지 않음을 확인.
- 배포/스토어 업로드/실제 사용자 기기 설치는 수행하지 않음.

## 실행 결과

| 확인 항목 | 결과 |
| --- | --- |
| 기존 `npm test` | 228개 통과 |
| Android UI mock 브리지 / Edge headless | 1개 통합 테스트 통과. 320/390/800px, 편집·자동저장·실패 복구·내보내기·설정 복원·뒤로가기 확인 |
| Android `testDebugUnitTest` | 17개 통과 |
| `lintDebug` | 오류 0, 경고 12. 의존성 새 버전, 구버전에서 무시되는 속성, JavaScript 활성화 및 문자열 리소스 관련 |
| `assembleDebug`, `assembleDebugAndroidTest` | 성공 |
| Android 15/API 35 x86_64 에뮬레이터 | 네이티브 테스트 14개 통과(27.9초). 실제 코덱 추출/취소, SQLite 재생성, 대용량 텍스트, Keystore 포함 |
| 150분 합성 MP4 | AVC/AAC 2개 트랙, 150분 길이, 22개 구간 확인. 마지막 약 180.5초를 AAC 24kHz mono로 실제 추출, 길이 오차 ±200ms 이내 |
| 별도 프로세스 복구 | seed → force-stop → verify: 저장된 완료 구간 및 번역 전 인식 결과 유지 |
| 저장 도중 프로세스 종료 | 열린 SQLite 트랜잭션 중 force-stop → verify: 커밋 전 변경은 롤백, 이전 체크포인트 유지 |
| 실제 앱 화면 | 에뮬레이터 설치·시작 및 화면 확인. 하단 시스템 영역 겹침 수정 후 재확인 |

단위 테스트 구성: 구간 계획 6, API 전송/재시도/취소 5, 자막 정규화/번역 응답 5, 파일 선택 payload 복원 1.

에뮬레이터 테스트 구성: 저장소 5, 미디어 6, 150분 합성 영상 1, 프로세스 복구 1, 키 암호화 1. 추가 프로세스 종료 시나리오는 `ProcessRecoveryDeviceTest`를 별도 실행했다.

## 중단을 의도적으로 발생시킨 검증

명령: `adb -s emulator-5556 shell am instrument -w -e class com.haebi.subtitle.ProcessRecoveryDeviceTest -e phase interrupt-write com.haebi.subtitle.test/androidx.test.runner.AndroidJUnitRunner`

약 10초 후 `uncommitted-transaction-ready` 마커를 확인하고, 이번 작업에서 생성한 에뮬레이터의 테스트 앱만 `am force-stop com.haebi.subtitle`로 종료했다. 이 실행의 `Process crashed`는 저장 도중 종료 상황을 만들기 위한 예상 결과다. 이어서 동일 테스트의 `phase=verify`를 새 프로세스로 실행하여 이전 체크포인트 유지와 미완료 구간의 롤백을 확인했다(1 test 통과).

## 환경 문제와 해결

Windows 한글 경로에서 Gradle 테스트 실행기의 클래스 검색과 Android 도구 경로 문제가 발생했다. 소스와 Gradle 캐시를 영문 경로에서 빌드하여 해결했으며, 재현 가능한 `scripts/build-android.ps1`를 제공한다. 원본 프로젝트를 이동하거나 삭제하지 않았다.

## 아직 확인하지 않은 범위

- 실제 150분 영화/강의 전체의 OpenAI 음성 인식·번역: 사용자 API 키와 유료 호출 없이 검증하지 않았다.
- 실물 휴대폰의 발열, 배터리, 제조사 절전 정책, 처리 속도와 개별 코덱 호환성.
- 합성 영상 검사는 장시간 타임스탬프와 끝부분 추출을 검증하며 실제 음성 인식 품질이나 전체 150분 처리 완료 시험을 대신하지 않는다.
- Android의 강제 중지·재부팅 후에는 앱을 다시 열어야 한다. 네트워크와 API 사용 가능 상태, 원본 파일 접근 권한이 필요하다.
- API 응답을 받고 저장하기 전 프로세스가 종료되거나 네트워크 응답이 유실되면 해당 요청이 중복될 수 있다.

이 검증을 수행한 시점에는 폴더가 Git 저장소가 아니어서 커밋·푸시를 수행하지 않았다. 이후 저장소 초기화와 공개 업로드는 별도 요청에 따라 진행되며, 현재 상태는 Git 이력에서 확인할 수 있다. 앱 배포나 스토어 업로드는 이 검증에 포함되지 않는다.
