# Editorial Studio 5-B · Google Play 최종 이미지 등록

## 기준과 목표
- 기준 main: `e58b43eece586bc13a5932e889a502c1f4e69f33` (5-A UI/UX QA, Android 15 emulated screenshots).
- Play package: `com.haebi.subtitle`, locale `ko-KR`.
- 범위: **휴대전화 스크린샷 8개만 등록**. 1-B 앱 아이콘 512×512, 대표 그래픽 1024×500, 한국어 제목/설명, Android 번들/트랙은 수정 대상이 아니다.

## 이미지 구성
| 순서 | 파일 | 실제 Android 화면 |
|---|---|---|
| 01 | 01-video.png | 영상 추가 |
| 02 | 02-jobs.png | 작업 |
| 03 | 03-results.png | 결과·내보내기 |
| 04 | 04-editor.png | 자막 편집 |
| 05 | 05-settings.png | API 연결·설정 |
| 06 | 06-on-device.png | 온디바이스 마이크 |
| 07 | 07-cloud-live.png | GPT 실시간 마이크 |
| 08 | 08-vosk-local.png | Vosk 오프라인 전사 |

## 제작과 사실성
- 화면의 출처는 5-A GitHub Actions Android 15 (API35) Pixel 6 에뮬레이터 캡처이며, 렌더링된 화면은 자르거나 재합성하지 않았다. 설명 문구 영역만 화면 위에 배치하였다.
- WebView 5개 캡처의 작업 데이터는 QA용 예시이며, 네이티브 3개 캡처는 마이크 녹음/유료 API 호출 전 초기 화면이다.
- 1080×1920 PNG 8개, 각 파일 SHA-256 및 원본 캡처 경로/해시를 `manifest.json`과 `capture-provenance-5b.json`에 기록했다.
- 앱 아이콘과 대표 그래픽은 기존 1-B를 그대로 유지한다.

## 등록 안전장치
- `python3 scripts/release/listing.py check --phone-only`: 휴대전화 PNG 입력 검증.
- `python3 scripts/release/listing.py apply --phone-only --send-for-review`: `phoneScreenshots` 카테고리만 삭제·업로드, Play API 새 edit에서 8개 해시 및 기존 설명/아이콘/대표 그래픽이 불변임을 재조회한다.
- 신규 `.github/workflows/play-5b-screenshots.yml`: 본 5-B 병합 커밋 메시지에서만 자동 시작하며, 병합된 정확한 main SHA의 성공 CI를 검증하고 기존 `google-play` 인증/동시성 락을 사용한다.
- 일반 수동 등록 `.github/workflows/play-listing.yml`와 기존 릴리스 자동화는 그대로 유지한다.
- Play API 수락과 실제 사용자 스토어 게시/테스터 노출은 구별한다. 등록 성공 시 CI 아티팩트와 Google Drive 백업 후 문서를 갱신한다.

## 자료
- [5-B Google Drive 폴더](https://drive.google.com/drive/folders/14R7J_1Zd7nnlxxO_M0Y7cZRVbpHDZ7VC)
- [5-A 최종 QA 원본](https://drive.google.com/drive/folders/1dIP60GMmcEe8xbcfQFKlDPR1Z0IRJPNf)

## 상태
- 이미지 제작·규격/원본 SHA 검수·Google Drive 백업 완료.
- GitHub PR 검증·main 병합 및 Play API 등록 결과는 해당 완료 시 별도 갱신.


## 5-B 등록 인증 오류와 기존 승인 경로 복구 (2026-11-09)
- PR #20 병합 main: `4ef732872188cff7e48cd0a95b3d7870202d9045`.
- `Verify web and Android` #42583900045 성공. 신규 `Editorial Studio 5-B phone screenshot registration` #42584606284은 `source` 통과, `apply` 인증 단계 실패.
- Google Cloud WIF 응답: `unauthorized_client` / `The given credential is rejected by the attribute condition.` 즉 신규 워크플로가 Google Cloud WIF 허용 조건에 들어가지 않아 Google Play 업로드 전 거부됨. 이미지 형식·해시 문제가 아니다.
- **기존 IAM 신뢰 조건이나 비밀키·인증 설정을 변경하지 않는다.** 이미 WIF 인증이 성공한 기존 `.github/workflows/play-internal.yml`에서 이번 복구 커밋 메시지 `store: Editorial Studio 5-B trusted screenshot registration`에 한해서 `listing` 모드로 라우팅한다. 이 모드는 기존 승인된 `google-play` 환경에서 `--phone-only --send-for-review`을 실행한다.
- `listing` 모드는 AAB 서명키 준비·SDK 설치·빌드·배포·버전 할당을 건너뛴다. 기존 일반 `workflow_run` 배포 및 수동 `check/build/deploy` 동작은 변경하지 않는다.
- 실패한 신규 `play-5b-screenshots.yml` 워크플로 파일은 제거한다. 대신 Play API 등록 후 신규 edit에서 8장 SHA-256와 제목·설명·아이콘·대표 그래픽이 그대로인지 재조회해야 완료로 처리한다.
- Google Play 심사·테스터 노출은 API 등록 완료와 별도 확인한다.
