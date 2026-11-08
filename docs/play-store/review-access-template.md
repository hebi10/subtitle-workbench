# 테스트 서버 심사 접근 안내

이 파일은 Console 입력용 템플릿이다. 실제 서버 주소나 코드가 설정되었다는 의미가 아니며 그대로 제출하지 않는다. 접근 코드는 서버 환경과 Google Play의 비공개 로그인 세부정보에만 보관한다. OpenAI 키는 서버 환경에만 두고 이 문서, Console, APK, 로그에 입력하지 않는다.

## 제출 전 조건

1. 실제 공개 HTTPS origin에 서버를 배포하고 전용 OpenAI 키와 별도의 고엔트로피 접근 코드를 설정한다.
2. 앱에서 개인 키 없이 파일 전사·번역·실시간 마이크를 실제로 실행한다. 로컬 테스트용 업스트림 fixture 성공은 이 검증을 대신하지 않는다.
3. 서버 한도와 가용성을 점검한다. 기본 실시간 한도는 하루 600초의 예약량으로 최대 5분 세션 2회만 허용하며 실패한 세션도 예약량을 되돌리지 않는다. 심사 중 재사용 가능한 접근을 유지할 충분한 할당량과 모니터링이 필요하다. 단순히 일일 한도가 있다는 이유만으로 “항상 접근 가능”을 보증하지 않는다.
4. 승인받은 실제 미디어로 전송·응답·일시정지·이어하기·완료 및 서비스 종료를 촬영하고 접근 가능한 영상 링크를 준비한다. 비밀값과 개인정보를 촬영하지 않는다.
5. 서버 주소와 운영 로그 설정을 공개 개인정보처리방침 및 데이터 보안 응답에 반영한다.

## Console 입력안

앱에 제한된 부분이 있나요: 예. 세부정보 이름은 `Cloud test access`로 지정한다. 앱 자체 사용자 이름이나 비밀번호는 없으므로 해당 칸은 비우고, 다음 안내에 서버 주소와 접근 코드를 정확히 채운다. 최종 안내는 영문 500자 제한을 다시 확인한다.

```text
Settings > OpenAI API connection > Test server.
Server: <HTTPS_ORIGIN>
Access code: <ACCESS_CODE>
Save and check connection. Use Video selection for file transcription/translation, or GPT live microphone for real-time transcription. These use real OpenAI processing via the test server. No personal API key, signup or purchase is required. Keep default models.
```

안내의 버튼 영문은 한국어 앱에서 설정 → OpenAI API 연결 → 테스트 서버 연결, 연결 저장, 연결 확인, 영상 선택, GPT 실시간 마이크 자막에 해당한다. 안내 문구는 실제 최신 UI와 대조한 뒤 제출한다. 서버 배포·실제 동작·할당량 검증이 끝나기 전에는 전체 기능 접근 확인란을 선택하지 않는다.
