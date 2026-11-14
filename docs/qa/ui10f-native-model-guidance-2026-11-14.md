# UI-10-F — Native OS/GPT/Vosk 3종 상태 정합성

기준 main `795a281d7bcb3d981eb9f16124940381aeb88630`. Drive UI-10-F1~F3 3개 화면.
F1: OS SpeechRecognizer 실제 사용 가능과 설치된 언어 모델 구분. 시스템 다운로드 요청을 Whisper/Vosk 파일 설치처럼 표시하지 않음. OS/언어/마이크 권한 거부 안전 동작 유지.
F2: RealtimeTranscriptionProtocol.MODEL gpt-live-transcribe, 단일 세션 최대 5분, 개인 API 청구와 시험 서버 공유 한도 구분. 사용자가 시작하기 전 전송되지 않으며 유료 테스트를 실행하지 않음.
F3: Vosk 모델 크기 설명 87/42/50MB 통일(카탈로그 approximateMegabytes 기준), SHA-256 설치 검증, 로컬 처리 및 중단은 일시정지가 아님을 명시.
기존 URL·SHA 값/라이선스, 인식·SQLite 저장·연결·서명·NativeDesignSystem, 온디바이스 모델 정책은 변경하지 않음. 신규 정적 회귀와 Android JVM/Lint, API35 Emulator Smoke, OPS QA 후만 병합.
실기기/유료 API/Vosk 다운로드 실측은 별도 승인 및 QA 남음. [skip-play].
