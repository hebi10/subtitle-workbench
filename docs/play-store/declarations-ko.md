# Play Console 선언안

기준일: 2026-11-08. 대상: `com.haebi.subtitle`, 해비 자막 Android 소스. 이 문서는 입력 근거와 확인한 Console 저장 상태, 남은 결정을 기록한다. 초안 저장·검토 준비·심사·배포 완료를 구분한다. 실제 업로드 AAB의 Manifest·의존성이 달라지면 다시 점검한다.

## Console 확인 상태

2026-11-08 확인 기록이다. 내부 테스트 배포는 완료되지 않았다.

| 항목 | 확인 상태 |
| --- | --- |
| 한국어 스토어 등록정보 | 아이콘 1개·대표 그래픽 1개·휴대전화 스크린샷 5개, 검토 준비 상태 |
| 개인정보처리방침 | 공개 URL의 HTTP 200 응답 확인 |
| 앱 설정 | 9/12 완료. 앱 액세스(로그인)·타깃 연령·데이터 보안은 미완료 |
| 타깃 연령·데이터 보안 | 타깃 연령은 18세 이상을 권장하지만 앱 액세스 단계가 막혀 저장하지 않음. 데이터 보안은 아래 5개 유형의 초안만 저장 |
| 콘텐츠·계정 선언 | IARC 응답 및 Google 한국 등급 3+ 저장. 광고 ID 사용은 아니요로 저장. 판매자 여부는 기존 계정의 예 응답을 상속해 저장 |
| 내부 테스터 | 기존 `본인`(1명) 명단을 선택·저장. 설치·배포 가능 상태를 뜻하지 않음 |
| 앱 서명 | 현재 Google 관리 앱 서명키가 존재함. 이전 앱 서명키의 `처음 사용 날짜`가 2026-11-05로 표시됨. 개발자의 비공개 업로드키를 확보했다는 뜻은 아님 |
| GitHub 배포 환경 | `google-play` 환경은 `main` 1개 브랜치·태그 0개만 허용. Secrets·Variables 없음 |
| 검증·자동 배포 | 검증된 앱 소스 커밋 `5f1e4d06ba563356571218bba8d7a9453361c818`의 CI 성공. 이전 자동 배포는 서명 설정 5개 누락으로 실패했으며 AAB 빌드·Play 업로드는 실행되지 않음 |

## 등록정보

| 항목 | 입력안 또는 상태 | 근거 |
| --- | --- | --- |
| 기본 언어 | 한국어 `ko-KR` | `listing-ko.json` |
| 앱 이름 | 해비 자막 | Manifest의 `android:label` |
| 짧은/자세한 설명 | `listing-ko.json` | 현재 Android 구현 기준. API 무료·전 기능 오프라인·인식 정확도 보장 표현 없음 |
| 릴리스 노트 | `release-notes-ko.txt` | 공개할 실제 버전에 맞춰 검토. 과거 버전의 변경 사항을 새 기능으로 중복 소개하지 않음 |
| 개인정보처리방침 | `https://hebi10.github.io/subtitle-workbench/privacy-policy.html` | `docs/privacy-policy.html`, 공개 URL HTTP 200 확인. 정책 공개와 앱 심사·게시 완료는 구분 |
| 공개 지원/개인정보 문의 | `asdlkj0104@gmail.com` | 같은 개발자의 [공개 GalliPick 등록 문서](https://github.com/hebi10/GalliPick/blob/main/docs/play-store/ko-KR-listing.md)에서 이미 게시 동의된 지원 주소임을 작업 담당자가 확인. 비공개 로그인 주소에서 새로 추정하지 않음 |
| 앱/게임 | 앱 | 자막 생성·편집 도구 |
| 카테고리 제안 | 동영상 플레이어/편집기 | 기능에 따른 제안. Console 제공 목록에서 선택 |
| 광고 포함 | 아니요 | `android/app/build.gradle`에 광고 SDK 없음. 앱 소스에 광고 UI·광고 ID 사용 없음 |
| 가격·유료 서비스 | 앱 가격은 소유자 결정. OpenAI 기능은 사용자 본인 API 요금 별도 | Play Billing 구현 없음. API 비용을 앱 무료와 혼동하지 않음 |
| 판매자 유형·사업자 정보·법적 개발자명 | 판매자 여부는 기존 계정의 예 응답을 상속해 저장 | 사업자 정보·법적 개발자명은 코드·공개 닉네임으로 추정하지 않음 |

## 데이터 흐름 근거

| 기능/정보 | 실제 처리와 수신자 | 보관/삭제와 코드 |
| --- | --- | --- |
| 선택한 원본 파일 | Android `ACTION_OPEN_DOCUMENT`로 선택한 URI를 읽음. 클라우드 전사는 영상 화면 대신 추출 오디오를 OpenAI에 보냄. 원래 파일명 대신 업로드명 `chunk.m4a` 사용 | `MainActivity.startPicker/onActivityResult`, `MediaChunks`, `JobService.process`, `OpenAiClient.transcribe` |
| 클라우드 전사 | 오디오·원본 언어·모델 → `https://api.openai.com/v1/audio/transcriptions` | `OpenAiClient`. 추출 임시 파일은 `JobService.process`의 `finally`에서 삭제 시도. 오래된 캐시 정리도 있음 |
| 번역 | 자막 원문·대상 언어·모델 → `https://api.openai.com/v1/responses`, `store:false` | `OpenAiClient.translate`. `store:false`를 무보관 또는 즉시 삭제로 해석하지 않음 |
| GPT 마이크 | 시작 후 PCM16 음성 → `wss://api.openai.com/v1/realtime?intent=transcription`. 최대 5분, 화면 이탈 시 중단 | `RealtimeTranscriptionProtocol`, `LiveTranscriptionClient`, `CloudLiveRecognitionActivity.onStop`. 앱은 원음 파일을 만들지 않음 |
| OpenAI API 키 | OpenAI 요청 인증 헤더로 전송. 키 확인 시 모델 GET 조회. Android 앱은 Worker를 경유하지 않음 | `SecretStore`: Android Keystore AES-256-GCM, 앱 전용 `api_secret` preferences에는 ciphertext/nonce만 저장. `MainActivity` bridge는 키를 JS에 반환하지 않음. 설정의 삭제 기능은 로컬 복사본만 삭제 |
| Vosk 파일 인식 | 사용자가 설치한 Vosk 모델로 기기 내부에서 음성 처리. 인식 입력·결과를 네트워크로 보내지 않음 | `OfflineVoskTranscriber`, `OfflineVoskActivity`. 모델 다운로드/삭제는 `OfflineModelInstaller` |
| Vosk 모델 다운로드 | Hugging Face의 `rhasspy/vosk-models` 및 HTTPS 리디렉션 다운로드 제공망으로 모델 요청, IP 등 연결 정보. 음성·자막·API 키는 모델 다운로드 요청에 첨부하지 않음 | `OfflineModelCatalog`, `OfflineModelInstaller.download/open`. 호스트를 Hugging Face 하나로만 단정하지 않음 |
| OS 온디바이스 마이크 | API 31+ `createOnDeviceSpeechRecognizer`, `EXTRA_PREFER_OFFLINE`. 클라우드 폴백 코드는 없음. 지원 조회/모델 설치는 시스템 제공자가 관리 | `OnDeviceRecognitionActivity`의 지원 확인·다운로드·인식, `onStop`에서 인식 중단. 모든 제조사 서비스의 보관 정책까지 앱이 보장하지 않음 |
| 작업·자막·파일 정보 | 파일 URI/이름/길이, 언어·모델, 결과와 시간, 체크포인트를 기기 SQLite에 보관. 전체 DB 암호화는 없음 | `JobStore.onCreate/writePayload/saveEdited`. 완료 작업만 `deleteCompleted`로 개별 삭제. 준비 취소는 준비 작업만 제거. 미완료 작업까지 일괄 삭제하려면 Android 앱 데이터 삭제 |
| 내보내기 | `ACTION_CREATE_DOCUMENT`의 사용자가 지정한 위치에 SRT/VTT/JSON UTF-8 저장. 외부 저장소가 클라우드 공급자일 수 있음 | `MainActivity.onActivityResult`. 앱 데이터 삭제는 내보낸 파일과 원본 파일을 삭제하지 않음 |
| 백업/분석/광고 | 앱 자동 백업·기기 이전 제외. 자체 분석·광고·원격 충돌보고 SDK 및 계정 서버 없음 | Manifest `allowBackup=false`, `res/xml/data_extraction_rules.xml`, `android/app/build.gradle` 및 Android 소스. Google Play/OS 자체 진단을 앱의 자체 분석으로 설명하지 않음 |

## 데이터 보안 입력안

Google의 수집 기준은 개발자 서버 수신 여부가 아니라 기기 밖 전송 여부다. 로컬 경로가 있어도 OpenAI 전송 때문에 앱 전체에 “수집 없음”을 선택하지 않는다. 아래는 보수적인 제출 초안이며 Console의 실제 분류 문구와 수신자 처리를 맞춰 확인한다.

| Console 질문 | 입력안 | 조건/이유 |
| --- | --- | --- |
| 사용자 데이터 수집/공유 여부 | 예 | OpenAI에 음성·텍스트·키 전송 |
| 전송 중 암호화 | 예 | API HTTPS/WSS, 모델 다운로드 HTTPS만 허용. 외부 파일 저장소의 처리 방식까지 보장하지 않음 |
| 계정 생성 방법 | 앱 내 계정 생성 없음 | 본인의 OpenAI API 키는 외부 서비스 자격 증명이며 해비 자막 회원 가입이 아님 |
| 데이터 삭제 요청 방법 | 선택적 삭제 요청 기능: 아니요 (Console 초안 저장) | 로컬 삭제 절차와 문의 이메일은 제공하지만 개발자가 사용자의 OpenAI 계정 데이터를 대신 삭제할 수 없음 |
| 독립 보안 검토 | 검토받았다는 증거 없음 | 자체 테스트를 제3자 인증/감사로 표기하지 않음 |
| Families 관련 항목 | 소유자의 타깃 연령 결정 후 응답 | 아동 대상 또는 Families 준수라고 임의 선언하지 않음 |

| 데이터 유형 | 수집 | 공유 초안 | 필수/선택 | 일시 처리 | 목적 |
| --- | --- | --- | --- | --- | --- |
| 오디오 파일 → 음성/사운드 녹음 | 예 | 예 | 선택 | 아니요 | 앱 기능: 클라우드 파일·실시간 전사 |
| 오디오 파일 → 기타 오디오 파일 | 예 | 예 | 선택 | 아니요 | 앱 기능: 사용자가 선택한 다양한 오디오의 전사 |
| 오디오 파일 → 음악 파일 | 예(음악 파일을 클라우드 입력으로 선택한 경우) | 예 | 선택 | 아니요 | 앱 기능: 오디오 파일 전사. 앱이 음악 파일을 별도로 차단하지 않음 |
| 앱 활동 → 기타 사용자 제작 콘텐츠 | 예 | 예 | 선택 | 아니요 | 앱 기능: 인식된 자막 원문 번역. 자막의 의미 내용이 전송됨 |
| 개인정보 → 사용자 ID | 예, 보수적으로 OpenAI 계정에 연결된 API 자격 증명 포함 | 예 | 선택 | 아니요 | 앱 기능: 외부 API 인증·모델 접근 조회 |

분류 주의:

- 원본 영상의 화상·사진, 원래 파일명과 URI, 기기 내 불러온 자막 문서 자체는 현재 클라우드 요청에 포함하지 않는다. 로컬 접근만을 이유로 사진/동영상·파일 및 문서 유형에 외부 수집을 표시하지 않는다. 번역 원문은 위의 기타 사용자 제작 콘텐츠로 다룬다. Console이 자막을 문서로 별도 분류하도록 안내하면 해당 유형으로 조정하고 중복·누락을 검토한다.
- 개인정보/사용자 ID의 API 키 분류는 Google이 API 키를 명시한 분류가 아니라 계정 연결 자격 증명에 대한 보수적 해석이다. 이 항목을 누락한 채 “개인정보 전혀 없음”을 홍보하지 않는다.
- 공유 “예”는 실제 OpenAI 전송을 반영한 보수적 초안이다. Google은 사용자 시작·충분한 고지/동의 또는 서비스 제공자 전송 예외를 두지만, 사용자 본인의 OpenAI 계약이 개발자의 수탁 계약과 동일하다고 추정하지 않는다. 파일 전송 안내가 기본적으로 접힌 상세 영역 안에 있으므로 현재 상태에서 고지 예외를 근거 없이 확정하지 않는다. 예외 적용이 확인될 때에만 Console의 공유 응답을 조정한다.
- API 제공자의 전체 보관 행태를 앱 코드가 통제하지 않는다. Realtime·Responses의 보안 로그 보관이 가능하므로 앱 전체의 오디오·텍스트를 일시 처리로 선언하지 않는다. 로컬 원음 파일을 저장하지 않는다는 사실만으로 일시 처리가 되는 것은 아니다.
- IP 등 연결 정보는 API·모델 호스팅에 전달된다. 앱 자체의 광고/설치 ID, 위치 추정·수집 코드는 없다. 제출 시 OpenAI와 모델 호스팅의 실제 처리 고지에서 IP를 식별자 또는 위치로 이용하는지 확인한다. IP 기반 식별/추적 또는 위치 추정이 확인되면 `기기 또는 기타 ID`/`대략적 위치`를 추가한다. 앱 코드만으로 외부 제공자의 모든 네트워크 로그가 없다고 선언하지 않는다.
- 자막·음성의 자유로운 내용에 우연히 포함된 개인정보를 앱이 별도로 추출·분류하는 기능은 없다. 지원 문의 메일의 응대는 앱의 백그라운드 수집과 구분한다.

클라우드 기능을 쓰지 않고 로컬 파일 전사·편집을 사용할 수 있으므로 위 데이터는 선택이다. 개별 클라우드 기능 안에서는 해당 데이터와 API 키가 기능 수행에 필요하다. 광고·마케팅·분석·프로필 개인화·개발자 자체 계정 관리 목적은 구현 근거가 없다.

## 권한 및 포그라운드 서비스

| 권한/유형 | 실제 용도 | Console 입력·검토 |
| --- | --- | --- |
| `RECORD_AUDIO` | 사용자가 시작한 OS 온디바이스/GPT 실시간 마이크 자막 | 마이크 접근을 명시. 시작 전 런타임 요청, 거부 처리, 화면 이탈 중지. 백그라운드 상시 녹음이라고 설명하지 않음 |
| `INTERNET`, `ACCESS_NETWORK_STATE` | 선택한 OpenAI 기능과 Vosk 모델 설치, 연결 상태 확인 | 서버 미전송이라고 선언하지 않음 |
| `POST_NOTIFICATIONS` | 파일 처리 상태·일시정지 알림 | 알림 동의 거부와 Android 포그라운드 서비스 표시 정책을 구분 |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` / `dataSync` | 사용자 시작 파일 작업에서 추출 오디오 업로드·전사/번역 응답 수신·체크포인트 저장 | 네트워크 전송/서버 처리. `JobService` |
| `FOREGROUND_SERVICE_MEDIA_PROCESSING` / `mediaProcessing` | 영상·음성 구간에서 오디오를 네이티브로 추출·변환 | 미디어 변환. Android 15+에서 dataSync와 함께 활성화 |
| `WAKE_LOCK` | 진행 중 파일 작업의 제한 시간 동안 처리 유지 | 작업 끝·실패·타임아웃·서비스 종료 시 해제 |
| 사진/영상 전체, 저장소 전체, 연락처, 위치, 광고 ID | 요청하지 않음 | 파일 선택기 접근. `READ_MEDIA_*`, `MANAGE_EXTERNAL_STORAGE`, `AD_ID`, 위치 권한 없음 |
| 마이크 FGS / 전체화면 인텐트 | 현재 사용하지 않음 | `microphone` FGS나 `USE_FULL_SCREEN_INTENT`를 새로 선언하지 않음 |

FGS 기능 설명 붙여넣기 초안:

> 사용자가 기기에서 영상·오디오를 선택하고 생성 시작 또는 이어하기를 누르면 자막 생성 작업을 시작합니다. mediaProcessing 유형은 파일 구간의 음성을 추출·변환하며 dataSync 유형은 사용자의 OpenAI API 키로 추출 오디오와 번역할 자막을 전송하고 결과를 받습니다. 앱 안과 진행 알림에서 상태를 확인하고 일시정지할 수 있습니다. 작업을 지연하거나 중단하면 사용자가 요청한 자막 생성이 늦어지고 현재 구간을 다시 처리해야 할 수 있습니다. 완료된 구간은 저장해 이어갈 수 있으며 작업 완료·실패·시스템 타임아웃 시 서비스를 정리합니다.

FGS 시연 영상에 필요한 실제 동작:

1. 앱의 파일 선택 → 준비 화면·전송/비용 안내 → 사용자의 생성 시작 동작.
2. 오디오 추출 단계와 처리 진행 표시. 앱을 배경으로 보내도 진행 상태 알림이 보이는 장면.
3. 전사/번역 전송·응답 단계, 앱 또는 알림의 일시정지, 앱에서 이어하기.
4. 완료 후 결과와 서비스 종료 확인. 영상에 키·개인 음성/자막·알림 등 개인정보를 노출하지 않음.

실제 실행 영상의 공개 접근 URL은 별도 확보가 필요하다. 정지 스크린샷을 동영상 요구 충족으로 기록하지 않는다. 모의 브리지 화면을 실제 API 실행 증거로 제출하지 않는다.

## 앱 접근·콘텐츠·소유자 확인

| 항목 | 코드·Console로 확인한 사실 | 남은 결정 또는 확인 상태 |
| --- | --- | --- |
| 앱 액세스 | 앱 자체 로그인 없음. 편집·Vosk 경로는 OpenAI 키 불필요. 클라우드 기능은 유효한 사용자 API 키·모델 접근·과금 계정 필요 | 심사자에게 새 계정 생성이나 개인 유료 계정 사용을 요구할 수 없음. 서비스가 지원하는 반복 사용 가능한 심사용 접근 방법이 필요하며 현재 미확보. 개인 OpenAI API 키를 Console·APK·저장소에 공유·삽입하는 방식은 지원되는 심사 접근 방법으로 사용하지 않음. 앱 액세스 항목은 미완료 |
| 타깃 연령 | 자막 도구라는 기능만으로 법적/사업적 타깃 연령은 확인 불가 | 권장 입력안은 18세 이상. 앱 액세스 단계 미완료로 아직 저장하지 않음 |
| 콘텐츠 등급 | 앱 안 공개 피드·사용자 간 채팅·게시·광고 없음. 사용자가 가져온 미디어/자막을 처리 | IARC 응답과 Google 한국 등급 3+ 저장. 기능·응답 변경 시 다시 확인 |
| 뉴스·정부·건강·금융 | 현재 구현은 자막/미디어 도구이며 해당 서비스 기능 없음 | Console의 질문 범위 확인 후 응답 |
| AI 생성 콘텐츠 | 음성 전사와 텍스트 번역 기능 있음. 자유 채팅·이미지 생성 기능 없음 | 현재 Console 질문/생성형 AI 정책 적용 범위 확인. AI 미사용이라고 표시하지 않음 |
| 테스트 인원·명단 | Console 내부 테스트에서 기존 `본인`(1명) 명단을 선택·저장 | 추가 인원은 소유자가 제공한 명단/그룹만 사용. 임의로 계정 이메일을 테스터로 추가하지 않음 |
| 저작권·허가·법적 동의 | 사용자가 자기 파일을 선택한다는 사실만 확인 | 모든 입력 파일의 권리 보유·전송 동의가 있다고 대신 보증하지 않음 |

## 공식 기준

2026-11-08 확인. 앱의 기능 설명은 위 소스 코드에 근거한다. 아래 문서는 수집 정의·권한 선언·심사 접근·API 키 보호·외부 보관 정책 확인용이다.

- [Google Play 데이터 보안 작성 안내](https://support.google.com/googleplay/android-developer/answer/10787469?hl=ko): 기기 외부 전송, 선택 수집, 공유 예외와 데이터 유형.
- [Google Play 포그라운드 서비스 선언 안내](https://support.google.com/googleplay/android-developer/answer/13392821?hl=ko): 유형별 설명·영향·시연 동영상 요구.
- [Android 포그라운드 서비스 유형](https://developer.android.com/develop/background-work/services/fgs/service-types): dataSync/mediaProcessing의 용도·실행 조건.
- [OpenAI API 데이터 관리](https://developers.openai.com/api/docs/guides/your-data): API별 보관과 사용자 계정 조건. `store:false`와 전체 무보관은 다름.
- [Google Play 검토를 위한 앱 준비](https://support.google.com/googleplay/android-developer/answer/9859455?hl=ko): 제한된 기능에 대한 심사용 앱 액세스 안내.
- [OpenAI API 키 안전 수칙](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety): API 키 공유 미지원, 모바일 앱 내 키 배포·저장소 커밋 금지 안내.
