# ADS-BILLING-PREFLIGHT — 자막라인 코드·AAB 24 사전 감사

확인일: 2026-11-17 (KST) · 대상: `hebi10/subtitle-workbench` · Play 변경: **없음**

## 확인된 기준선

- main SHA: `3c1c73fbef524fe33a19a992bf547f7ab6484ee6` (광고·구독 PR #75 병합).
- 앱 패키지: `com.haebi.subtitle`; versionName `0.10.0`; AAB versionCode **24**.
- 서명 AAB 원본 2건: [실행 #43843911795](https://github.com/hebi10/subtitle-workbench/actions/runs/43843911795) 및 [#43841807507](https://github.com/hebi10/subtitle-workbench/actions/runs/43841807507).
- 서명 AAB ZIP 아티팩트 ID: `14213454421`, `14214299156`; 압축 해제된 두 `app-release.aab`는 SHA-256 **`e123edbf5ea50e6d5954e0496a7e5c0ad4a96c0633955841c65ccf26b7aed31a`**로 동일.
- 두 빌드 모두 original upload key 서명검증 성공. **Play 제출 단계는 skipped**: 이 실행들로 내부 테스트 24 게시를 주장할 수 없음.
- `main`의 [Verify web and Android](https://github.com/hebi10/subtitle-workbench/actions/runs/43839804646)와 [OPS-08](https://github.com/hebi10/subtitle-workbench/actions/runs/43839804516) 성공.

## 실제 AAB 리소스·Manifest 감사

| 항목 | 실제 확인 | 결론 |
| --- | --- | --- |
| 운영 AdMob 앱 ID | AAB Manifest에 실 운영값 포함 | 빌드 반영됨. Console 운영 승인 상태는 별도 |
| 운영 배너 단위 ID | AAB `base/resources.pb`에 실 운영값 포함 | 빌드 반영됨. 광고 노출/UMP 결과는 별도 |
| `subtitle_billing_verifier_url` | 기본 문자열 `""` | **미설정** |
| `subtitle_billing_cloud_project` | 기본 문자열 `"0"` | **미설정** |
| `com.google.android.gms.permission.AD_ID` | 최종 AAB Manifest에 포함 | 과거 광고 ID 미사용 선언 재검토 필요 |
| `android.permission.ACCESS_ADSERVICES_AD_ID` | 최종 AAB Manifest에 포함 | 새 개인정보·광고 신고 확인 필요 |
| `com.android.vending.BILLING` | 최종 AAB Manifest에 포함 | 실제 구독 상품 활성/테스트 구매는 미검증 |

AAB 24는 검증 서버 주소와 Play Integrity 프로젝트 번호가 빠져 있어 결제 운영 준비가 완료되지 않음. 기존 Java 구독 검증기는 두 값이 없으면 구매 시작을 차단하며, 15분 제한 권한만 반환. 서버 코드는 실제 Google Play API 확인을 요구하고, 외부 연동 성공은 오프라인 CI로 대체할 수 없음.

## 이번 코드 보강

- `scripts/ops04/internal.py`: 이미 승인된 서명 AAB를 받아 해시·서명·package/version을 검사한 다음, 동일한 **AAB 내부 컴파일 리소스**의 AdMob 앱·배너 ID, Billing HTTPS origin, Play Integrity 프로젝트 번호를 검사. 비어 있거나 테스트 ID이면 실패 종료.
- `scripts/ops04/test_internal.py`: 정상 샘플, 서버 URL 비어 있음/HTTP, 프로젝트 번호 0 또는 범위 초과, 테스트 배너 또는 리소스 누락, 배포 검증 단계 연결 확인.
- 이 게이트는 `OPS-04`의 기존 check/publish에만 적용. **일반 개발용 빌드와 기존 Play 트랙을 변경하지 않음**.
- 검사 통과는 AAB 안의 설정 존재 여부까지만 증명. HTTPS 엔드포인트가 실제 배포·정상 작동하는지, 구독 상품이 활성인지, Play Console 정책이 통과했는지는 별도 증빙 필요.

## 스토어 선언 자료와 배포 차단 사항

- `docs/play-store/declarations-ko.md`는 2026-11-08 이전 광고 없는 빌드의 이력입니다. 광고 SDK 없음·광고 ID 사용 안 함·광고 없음·Billing 없음 등의 과거 내용을 현행 상태로 재사용하면 안 됩니다.
- Google Play Console에서 광고 포함, 광고 ID, 데이터 보안, 스토어 페이지 및 심사 앱 액세스 정보를 **최신 빌드 기준**으로 직접 검토·수정해야 합니다.
- `subtitle_remove_ads` 상품 및 `monthly`/`yearly` 요금제 실제 등록·활성화·라이선스 구매/복원/취소/만료 검증은 확인되지 않음.
- 기존 비공개 테스트 alpha는 `HTTP 400 INVALID_ARGUMENT`로 실패한 이력이 있으며 Play Console 실제 상세 오류를 확인하기 전 승격 재시도 금지.
- Review relay 독립 HTTPS 서비스 실제 배포 및 심사자 접근 성공 여부도 별도 운영 확인이 필요.

## Work 및 실기기 후속

1. GPT Work: AdMob·UMP 콘솔 운영 상태, 구독 검증 서버 HTTPS·Play Integrity Cloud 번호, Play Developer API 권한, GitHub **변수** 구성 점검. 키·토큰·서비스 계정 값은 문서/이슈/로그로 옮기지 않음.
2. GPT Work: Play Console에서 구독 상품·한국 요금제·라이선스 테스터·필수 정책 신고 점검. 실제 등록 상태와 출처를 남김.
3. 현재 대화: 설정 완료된 정확한 main의 새 서명 AAB 빌드 및 `OPS-04 check` 검증. 새 AAB가 기존 SHA와 다르다는 사실과 버전 사용 이력 확인.
4. 실기기: 구독 구매·복원·해지·만료, 광고 표시/숨김, UMP, 마이크·Vosk·실제 유료 전사·복구, 60분 장시간 작업 확인.
5. 모든 개발·QA 완료 후 **별도 사용자 승인**을 받아 OPS-04 publish, 이후 Console·테스터 설치 재확인. 비공개 테스트 승격 또한 별도 승인.

이 문서는 2026-11-17의 사전 감사 기록이며 Google Play 등록정보, 트랙, 서버 배포, 구독 상품 또는 GitHub 운영 변수·Secrets를 변경하지 않습니다.
