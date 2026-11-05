# Subtitle Workbench · 0.5.0 범위 및 후속 과제

## 구현 및 테스트 대상
- 음성 파일 인식 모델 선택: whisper-1, gpt-transcribe, gpt-4o-transcribe-diarize
- 시간 정렬: whisper-1 단어/세그먼트, 화자 모델 세그먼트, gpt-transcribe 30초 단위 보수적 추정
- 화자 라벨 데이터 보존, 화자 변경 시 SRT/VTT `>>` 표기, 편집 및 병합 방지
- Android 완료 작업 기록 삭제 확인
- Android API 36, CI 단위 테스트/브라우저 UI 테스트/Android lint와 debug APK 빌드
- Google Play 내부 테스트 자동 배포용 워크플로 (Secrets 없이 업로드 생략)

## 현재 미구현 또는 미검증
1. `gpt-live-transcribe`를 통한 마이크 실시간 스트림은 별도 Realtime API 세션, 통신 및 UI가 필요합니다.
2. 로컬 AI 런타임·모델 자동 다운로드·삭제는 아직 구현하지 않았습니다. 설치 크기, 라이선스, 실행 성능과 기기 호환성 검증이 필요합니다.
3. 기존 화자 모델은 2027-02-26 지원 종료 예정입니다. 모델별 구간 라벨이 다른 구간에서도 동일 인물임을 보증하지 않습니다.
4. `gpt-transcribe`는 단어별 타임스탬프가 없습니다. 구간별 추정 타이밍을 실제 영상과 대조해야 합니다.
5. 실물 Android 기기, 실제 유료 OpenAI API 요청, 3시간 실영상 처리, Google Play 업로드·테스터 설치 검증은 완료되지 않았습니다.
6. `Play Console` 앱 등록, 서명키·서비스 계정 5개 GitHub Secrets, 후속 버전의 `versionCode` 증가는 배포 전제 조건입니다.

관련 공식 API 가이드: https://developers.openai.com/api/docs/guides/speech-to-text
지원 종료 공지: https://developers.openai.com/api/docs/deprecations

## 0.6.0 온디바이스 구현
- API 31+ OS 온디바이스 음성 인식 사용: 실시간 임시 문장 및 최종 문장 표시, 수동 시작·종료, SQLite 결과 저장.
- API 33+ 사용 가능 모델 목록·다운로드 요청; API 34+ 다운로드 진행·완료 결과 수신.
- `gpt-live-transcribe` API 기반 클라우드 실시간 전사와 자체 다운로드형 Whisper 등 로컬 런타임은 별도 구현 항목이며, 이 기능이 이를 대체한다고 주장하지 않습니다.
