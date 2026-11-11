# UI-09-H — 전체 화면·기능 통합 QA

기준: 2026-11-11
프로젝트: hebi10/subtitle-workbench

## 범위와 근거
- Google Drive의 Editorial Studio 2.0 UI-09 차이 분석과 UI-09-A 실제 Android 상태별 QA를 통합 검증 기준으로 사용.
- UI-09-C 새 작업, UI-09-D 작업 관리·결과, UI-09-E 자막 편집, UI-09-F 설정/Native 3종, UI-09-G 웹 3탭을 동일 GitHub 커밋에서 회귀 점검.
- 앱 사용자 파일, 비밀키, 인증·전사·번역·SQLite·Native Bridge·Android 서명·AAB·Play Console 트랙은 수정하지 않음.

## 브라우저 검증 매트릭스
1. 웹: 생성/편집/내보내기 3탭 × 320/360/390/432/800/1280px × 라이트/다크 = 36가지. 실제 픽셀 너비·탐색 버튼 48px, 넘침, 키보드 단축 뷰포트의 편집 포커스, SRT Blob 다운로드 바이트 확인.
2. Android WebView 모의: 새 작업/작업/결과/편집/설정 5화면 × 6개 폭 × 라이트/다크 = 60가지 + 390×480 짧은 화면 1회. 오류·진행·일시정지·완료를 fixture로 주입하며 유료 API를 사용하지 않음.
3. 비디오 미연결 자막 가져오기 후 SRT/VTT/JSON 요청/취소, 편집 가능 여부, 결과 미리보기 비활성화와 기록 보존을 확인.
4. Node/Playwright 전체 회귀, Android JVM·Lint·debug APK, API35 실제 Android 에뮬레이터 계측 결과를 동일 PR SHA로 검증.
5. 출력: output/ui09h/web-matrix.json, webview-mock-matrix.json, 390/1280px 캡처. 브라우저 WebView mock은 실제 Android 캡처가 아님.

## 실제 Android 60장 상태별 캡처
기존 UI-09-A 안전 워크플로를 이 PR에 한해 재실행하도록 트리거를 추가. Android15(API35) Pixel 6 에뮬레이터: 라이트·다크 × 폰트 100/160%. WebView 12상태 48장, Native 3화면 12장.
테스트용 40초 320×180 합성 영상, 27개/15개 자막, 준비/일시정지/오류/모의 진행 상태 사용. 실제 전사 워커·마이크·네트워크 과금 호출 없음. 실험 데이터만 고유 ID로 삭제. 캡처/상태 매니페스트를 SHA-256 및 Git commit에 연결.

## 안전·완료 판정
- Verify web and Android, Android Emulator Smoke, UI-09-A real Android state baseline을 동일 HEAD에서 성공 판정.
- 웹·Android 실제 원본 캡처의 출처·수량·테마/폰트·글자/버튼 가독성을 검수하고 Google Drive에 원본/매니페스트 업로드.
- 오류 발견 시 수정 후 최종 HEAD의 모든 검증 재실행. 성공 후에만 [skip-play] main 병합. 기기 서명/Google Play 실제 이미지 등록 없음.
- 검증 제외: 물리적 스마트폰 TalkBack·IME, 실제 음성/유료 API 인식 품질, Vosk 모델 설치·속도, API29/36 전체 에뮬레이터 계측, Play 심사/테스터 설치. API35 성공을 다른 기기의 성공으로 과장하지 않음.

## 다음 단계
UI-09-B 브랜드 최종 정합성 확인 이후 STORE-05 실제 화면 기반 스토어 이미지/등록·배포 상태 최종 검증.

## 첫 CI 발견 및 테스트 상태 보정
첫 PR HEAD 151126d8c의 Verify web and Android #42985911745에서 Android 빌드/Lint/APK, 정적 계약과 Android WebView 모의 61환경 테스트는 통과했다. 신규 웹 단축 키보드 테스트 1건에서 편집 입력란 노출을 기다리다가 Timeout이 발생했다. 기존 fixture가 테스트 종료 시 검색/필터를 남겼는데 신규 테스트가 반드시 표시되는 자막을 선택하지 않은 QA 준비 문제이다. 앱 코드나 실제 편집 기능의 결함으로 판단하지 않는다. 기존 3-B 편집 회귀와 동일하게 완료 fixture first.mp4를 명시적으로 선택하고 검색·필터를 초기화하도록 수정했다. 모든 필수 CI 및 실제 Android 60장 재캡처는 최종 HEAD에서 다시 실행·확인한다.
