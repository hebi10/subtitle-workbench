# 자막라인 구독 검증

자막라인 Android 앱의 광고 제거 구독을 검증하는 독립 HTTPS 서비스입니다. 심사용 음성 서버와 운영 환경 및 권한을 분리합니다. 자막, 음성, OpenAI 키를 받지 않습니다.

- 패키지 `com.haebi.subtitle`, 상품 `subtitle_remove_ads`
- 대한민국 자동 갱신 기본 요금제 `monthly` 월 1,000원, `yearly` 연 9,900원
- Android 앱은 Play의 현지 표시 가격을 사용합니다.
- Google Play에서 설치한 정상 앱 및 기기의 Play Integrity 결과를 검증하고 Play Developer API에서 구매 상태를 조회합니다.
- 구매·승인 상태 및 만료 시각을 확인한 뒤 최대 15분의 임시 권한을 부여합니다. 취소 후 유효 기간과 결제 유예 기간에는 권한을 유지하며 만료, 보류, 정지, 회수된 구매는 거부합니다. Google Play 계정에서 구매 복원 시 다시 조회합니다.

## 최초 내부 테스트

1. AdMob에서 이 패키지의 앱과 배너 단위를 준비하고 UMP 개인정보 메시지를 설정합니다.
2. GitHub 저장소의 Actions 변수에 `SW_ADMOB_APP_ID`와 `SW_ADMOB_BANNER_ID`를 등록합니다. 기존 서명 빌드 절차로 Billing이 포함된 내부 테스트 번들을 준비합니다.
3. Play Console에서 위 구독 상품과 대한민국 요금제를 등록합니다. 라이선스 테스터 계정을 확인합니다.
4. Google Play Integrity가 연결된 Cloud 프로젝트에서 Play Integrity API와 Google Play Developer API를 사용 설정합니다. 서버 실행 계정에 해당 패키지의 상품 조회, 구독 상태 조회와 구매 확인에 필요한 Play Console 권한을 부여합니다. Google Auth Library의 Application Default Credentials를 구성하며 Android 빌드에는 서버 자격 증명을 넣지 않습니다.
5. 이 디렉터리를 컨테이너 빌드 컨텍스트로 사용합니다. 서비스에 `SUBTITLE_BILLING_ENABLED=true`를 설정하고 HTTPS로 공개합니다. 인입 계층에 요청 본문 로깅을 활성화하면 안 됩니다. 인증이 필요한 요청은 Play Integrity가 검증합니다.
6. Actions 변수 `SW_BILLING_VERIFIER_URL`에 서버 HTTPS origin, `SW_BILLING_CLOUD_PROJECT`에 링크된 Cloud 프로젝트 번호를 설정한 뒤 내부 테스트 빌드에서 두 요금제의 표시 가격, 테스트 구매, 구매 복원, 정지·만료와 취소를 확인합니다.

앱에 검증 서버 설정이 없거나 서버 및 Google Play 조회가 실패하면 앱에서 구매를 시작할 수 없습니다. 구독이 없는 사용자는 광고 동의 상태에 따라 새 자막 작업 화면에서 배너를 볼 수 있습니다.
