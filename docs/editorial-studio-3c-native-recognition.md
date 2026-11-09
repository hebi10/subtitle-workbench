# Subtitle Workbench · Editorial Studio 3-C

## 범위
Android 네이티브 화면 3개에 Editorial Studio의 1-A 라이트·다크, 2-A 공통 컴포넌트, 3-B 정보 위계를 적용한다.
- OnDeviceRecognitionActivity: OS 온디바이스 마이크
- CloudLiveRecognitionActivity: 사용자/테스트 서버 GPT 실시간 마이크
- OfflineVoskActivity: 다운로드형 Vosk 모델·파일 전사

## 구조
- 공통 헤더: 영문 기능 분류 / 한국어 화면 제목 / 핵심 동작·과금 설명
- 3개 평면형 그룹: 준비/연결 → 녹음·처리 → 인식/저장 결과
- Vosk: 언어 모델 → 파일 선택 → 전사·저장
- 상태 카드: 음성 인식·다운로드 메시지, 저장할 자막은 중립 회색 명도차로 구별. 텍스트는 유지하며 단색 배지·1px 경계선·0 모서리 반경, 그림자 없음
- 공통 버튼: 네이티브 disabled/primary/secondary를 유지, 높이는 52dp 최소값 + 내용 맞춤으로 작은 화면에서 한글이 잘리지 않음
- 접근성: 섹션 제목 heading (API 28+), 인식 언어 spinner label, 상태 업데이트 live region, 큰 텍스트 확대 대응

## 기존 기능·고지 보존
- OS 음성 인식: Android 12/13 지원 확인/모델 다운로드, 마이크 권한, 확정 결과 저장; 추정 타임코드 및 임시 문장 저장 안 함 고지 유지
- GPT: 사용자 클릭 후 마이크 전송, 개인 API 사용료/테스트 서버 전송 대상, 정확한 타임코드 미보장, 5분 제한·화면 이탈 시 중단 고지 유지
- Vosk: 모델 다운로드·삭제 확인, 선택 파일 최대 60분, 취소, 모델 용량·라이선스·WER 고지, 로컬 저장. 음성을 OpenAI로 전송하지 않음
- SQLite, 인식·네트워크·암호화·녹음·오디오 처리·API 요금 로직과 Android bridge 호출은 변경하지 않음

## 변경 소스
- NativeDesignSystem.java — header, section, statusPanel, transcriptPanel 4종 공통 컴포넌트
- OnDeviceRecognitionActivity.java, CloudLiveRecognitionActivity.java, OfflineVoskActivity.java — buildView/createView 내부 UI 그룹화와 버튼 자동 높이
- EditorialNativeScreensDeviceTest.java — Android 15 네이티브 화면·disabled 상태·섹션·라이트/다크 실기기형 캡처
- android-emulator-smoke.yml, play-gates.yml — 네이티브 QA와 다운로드 가능한 캡처 증빙

## QA / 출시
1. Gradle JVM unit, Android Lint/debug/AndroidTest assemble
2. Android 15 emulator instrumentation: 기존 기능·저장·모델·복구 테스트 + 신규 3화면 테스트
3. Android 15 시스템 라이트/다크 각각 전체 스크린샷 확보 및 로딩·버튼 잘림 검수
4. PR 전체 CI 성공 후 main squash 병합, main 재검증 및 자동 Play internal upload readback
5. 비공개 트랙 승격/스토어 등록정보 변경은 3-C 범위가 아니며, 실제 새 스크린샷은 5-B 최종 스토어 QA 후 교체
