# 자막라인 Play Console 현행 제출 초안 (SW-FIX-02)

기준일 2026-11-24 KST. 패키지 `com.haebi.subtitle`, 기준 main `670cb27525bd4d1c1c376a2f99dc9be1ab805cdb`. 이 문서는 코드 및 기존 AAB 감사에 근거한 제출 초안이다. Console에서 저장·검토·게시되었다는 증빙은 아니다. 비공개 테스트 승격 오류는 실제 Console 상세 원인 확인 전 재시도하지 않는다.

- 과거 2026-11-08 신고·Console 확인 이력: [보존 기록](declarations-ko-2026-11-08-archive.md). 당시 광고 없음/광고 ID 미사용/구독 없음 응답은 현행 빌드에 사용하지 않는다.
- 2026-11-17 AAB 24 감사: [ADS-BILLING-PREFLIGHT](../qa/ads-billing-preflight-2026-11-17.md). 운영 광고 ID는 포함되었고 구독 검증 HTTPS 및 Play Integrity 프로젝트 번호는 당시 미설정이었다. 새 AAB의 설정과 병합 Manifest는 별도 검증한다.
- 내부 23은 과거 API commit/readback 확인. [비공개 승격 실패 실행](https://github.com/hebi10/subtitle-workbench/actions/runs/43139034004)은 edits.validate HTTP 400 INVALID_ARGUMENT. 앱 콘텐츠, 액세스, 트랙/검토 등 가능한 원인은 아직 확인되지 않았다.

## 등록정보와 필수 선언

| Console 항목 | 제출 초안/검토 근거 |
| --- | --- |
| 앱 이름 | 자막라인. Manifest와 listing-ko.json 일치 |
| 광고 포함 | 예. 새 작업 화면에서 동의 조건에 따른 AdMob 배너 제공 |
| 광고 ID | 예로 검토. AAB 24 최종 Manifest에 AD_ID 및 ACCESS_ADSERVICES_AD_ID 포함. 새 AAB에서도 병합 Manifest와 SDK 설정 확인 |
| 구독 | subtitle_remove_ads, monthly/yearly. 현지 가격은 Play 표시값. Google Play 상품 활성화·검증 서버·테스트 구매 확인 전 운영 완료 아님 |
| 개인정보처리방침 | https://hebi10.github.io/subtitle-workbench/privacy-policy.html — 최신 광고·구독 고지 공개 여부를 확인 |
| 앱 액세스 | 제한된 기능 있음. 클라우드 테스트 서버의 실동작 확인 후 [심사 접근 안내](review-access-template.md)를 실제 정보로 작성. 심사자에게 개인 키·유료 계정 요구 금지 |
| 콘텐츠 등급/타깃 연령 | 이전 광고 없는 버전 응답을 그대로 사용하지 않음. 현재 광고와 생성 기능 기준으로 재검토. 최종 대상 연령은 소유자 확정 |
| 앱 카테고리 | 동영상 플레이어/편집기 검토. 뉴스·정부·건강·금융 서비스 기능 없음 |
| AI 관련 선언 | 전사·번역 기능을 실제 정책 질문과 대조. AI 미사용으로 선언하지 않음 |
| 판매자 정보 | 실제 계정·사업자 정보 확인. 코드로 추정하지 않음 |

## 데이터 보안 제출 근거

기기 밖으로 전송되는 정보와 SDK의 자동 수집도 포함한다. 로컬 작업 경로가 존재한다고 앱 전체에 수집 없음으로 응답하지 않는다. 표는 검토 항목이며 Google의 수집/공유 예외, 동의 및 실제 운영 로그, 최종 SDK 버전, 서비스 제공자의 처리 조건을 확인해 Console 응답을 확정한다.

| 데이터 유형 | 관련 기능/처리 | 목적 및 검토 |
| --- | --- | --- |
| 음성/사운드 녹음, 기타 오디오, 음악 파일(해당 입력 시) | 개인 클라우드 또는 테스트 서버 경유 OpenAI | 선택적 클라우드 앱 기능. 외부 보관 조건 때문에 일시 처리로 일괄 단정하지 않음 |
| 기타 사용자 제작 콘텐츠 | 자막 텍스트의 클라우드 번역 | 선택적 앱 기능. 원본 영상 화상·파일명·URI 전송과 구분 |
| 사용자 ID/인증 정보 분류 검토 | 개인 API 인증, 테스트 접근 코드 | 인증에 필요. API 키를 Google 사용자 ID 유형으로 분류할지는 실제 질문에 맞춰 검토 |
| 대략적 위치 | 광고 SDK의 IP 기반 위치 추정 가능 | 광고/분석/부정 사용 방지. 앱 자체 위치 권한 미사용과 구분 |
| 앱 상호작용 | Google Mobile Ads SDK의 앱 실행·탭 등 | 광고/분석/부정 사용 방지 |
| 진단 정보 | Google Mobile Ads SDK의 앱/SDK 성능 정보 | 광고/분석/부정 사용 방지 |
| 기기 또는 기타 ID | 광고 ID, 앱 세트 ID 등 광고 SDK 식별자 및 Play Integrity 관련 처리 | 광고/분석/부정 사용 방지 및 구독 검증. 동의·SDK 구성·실제 수신자 기준 확인 |
| 구매 내역/구독 상태 | Play Billing 구매 토큰, Integrity 검증 토큰을 독립 HTTPS 검증 서버로 전송; Play Developer API 조회 | 광고 제거 권한 확인·부정 사용 방지. 개발자 결제수단 수집과 구분. 실제 로그·보관 및 Google의 데이터 유형/공유 예외 확인 |

광고 SDK의 공식 [데이터 공개 안내](https://developers.google.com/admob/android/privacy/play-data-disclosure?hl=ko)는 현재 최신 SDK 버전을 설명한다. 저장소는 25.0.0을 사용하므로 실제 탑재 버전과 UMP/광고 설정, 선택 기능 여부를 대조한 뒤 응답을 확정한다. 광고 SDK의 자동 수집·공유 가능성을 누락하지 않는다. OpenAI 및 테스트 서버·모델 호스팅·Google 처리와 구독 서버의 운영 로그까지 확인한다.

- 전송 중 암호화: 앱의 HTTPS/WSS, 광고 SDK TLS. 실제 운영 HTTPS와 외부 저장소의 별도 처리 확인.
- 계정 생성: 앱 자체 계정 없음. 외부 OpenAI 계정은 별도.
- 삭제 요청: 기기 저장 데이터 삭제 기능과 외부 서비스 삭제 절차를 구분. 서버의 집계 카운터와 결제 로그의 실제 보관/삭제 절차 확인.
- 독립 보안 검토: 제3자 인증 증빙 없음.
- 원본 영상·음성 및 자막의 로컬 저장은 기존 정책과 동일. 원본 삭제하지 않음.
- [데이터 보안 공식 기준](https://support.google.com/googleplay/android-developer/answer/10787469?hl=ko), [공개 개인정보처리방침 소스](../privacy-policy.html).

## 권한 및 포그라운드 서비스

| 권한/유형 | 실제 용도 |
| --- | --- |
| RECORD_AUDIO | 사용자가 시작한 온디바이스/GPT 마이크 자막. 화면 이탈 중지 |
| INTERNET, ACCESS_NETWORK_STATE | 클라우드 전사·번역, 모델 다운로드, 연결 확인, 광고/구독 |
| POST_NOTIFICATIONS | 진행 상태 및 일시정지 |
| FOREGROUND_SERVICE, FOREGROUND_SERVICE_DATA_SYNC / dataSync | 추출 오디오·번역 텍스트 요청 및 응답, 진행 저장 |
| FOREGROUND_SERVICE_MEDIA_PROCESSING / mediaProcessing | 구간 오디오 추출·변환 |
| WAKE_LOCK | 처리 중 제한적인 실행 유지 |
| AD_ID, ACCESS_ADSERVICES_AD_ID | AAB 24 병합 Manifest에 확인된 광고 관련 권한 |
| BILLING | Play 구독 |
| 전체 사진/영상/저장소·연락처·위치 | 앱 직접 권한 없음. 파일 선택기 기반; 광고 SDK IP 추정은 별도 |
| microphone FGS/전체화면 인텐트 | 사용하지 않음 |

FGS 설명 초안: 사용자가 영상·음성 파일을 선택하고 생성 시작 또는 이어하기를 누르면 작업을 시작합니다. mediaProcessing은 음성을 추출·변환하며 dataSync는 선택한 연결에서 추출 오디오·번역 자막을 전송하고 결과를 받습니다. 앱 및 알림에서 진행 확인과 일시정지가 가능하고 완료한 구간은 저장합니다. 중단되면 자막 생성이 지연되거나 현재 구간을 다시 처리할 수 있으며 작업 완료·실패·시스템 타임아웃 시 서비스를 정리합니다.

실제 FGS 시연은 파일 선택→생성 시작→추출/전송→백그라운드 알림→일시정지/이어하기→결과/서비스 종료를 촬영한다. 토큰·개인 미디어·알림은 가린다. 에뮬레이터 fixture를 실제 유료 전사 증거로 제출하지 않는다. [FGS 공식 안내](https://support.google.com/googleplay/android-developer/answer/13392821?hl=ko).

## 비공개 테스트 차단 조사 순서

1. Play Console 자막라인 선택. 대시보드, 게시 개요 및 비공개 테스트 alpha의 출시/오류 상세를 조회하고 정확한 차단 메시지를 기록한다. 기존 alpha 및 internal 릴리스를 삭제하거나 덮어쓰지 않는다.
2. 최신 AAB Manifest·SDK 기준으로 광고 포함, 광고 ID, 데이터 보안, 개인정보처리방침, 앱 액세스, 타깃 연령·콘텐츠 등급, FGS를 점검한다. 실제 심사 접근과 시연 영상이 확보된 경우에만 해당 항목을 제출한다.
3. alpha 국가·테스터/그룹·피드백 주소 및 게시/검토 상태를 확인한다. 계정의 테스트 요건을 실제 Console 기준으로 확인한다.
4. 운영 설정과 전체 개발/QA 완료 후 승인된 internal에 새 검증 AAB를 배포한다. 실제 게시 상태와 테스터 설치를 확인한다.
5. 비공개 테스트는 별도 승인 후 해당 internal의 동일 versionCode만 승격한다. 실패한 23을 임의 재승격하지 않는다. Play validate·commit·fresh readback, Console 게시, 설치를 각각 검증한다.

[앱 액세스 공식 안내](https://support.google.com/googleplay/android-developer/answer/9859455?hl=ko). 이 문서 변경은 Console 설정 수정·심사 제출·배포 승인 또는 해결 증거가 아니다.
