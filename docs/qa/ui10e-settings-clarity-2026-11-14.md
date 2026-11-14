# UI-10-E — 설정·연결·요금·데이터 안내 개선

기준 main `795a281d7bcb3d981eb9f16124940381aeb88630`. Google Drive UI-10 (030/031) 설정 화면 05.
최소 변경: 저장된 연결과 확인된 연결을 구분하고, 테스트 서버로의 미저장 전환·작업 실행 중 변경 차단 안내를 화면 상태에 따라 표시합니다.
저장된 기본값과 미저장 편집값의 적용 범위를 분명히 하고, 데이터 전송·OpenAI 요금·클라우드 비보관·사용자 직접 이어하기 설명을 실제 동작과 맞춥니다.
Android Keystore/SecretStore/CloudAccess 구현, 키 삭제 확인, 개인 API/테스트 서버 전환, 모델 기본값, Native Bridge, DB, Play 동결 워크플로는 수정하지 않습니다.
검증: 기존 settings WebView 회귀 및 신규 정적 테스트, 암호/코드 비노출, 320/390/800px, 160% 글꼴, API 미설정/확인 실패/연결 저장/실행 중 잠금. 실제 유료 API의 요청 검증은 별도 승인이 필요합니다.
완료 기준: 동일 HEAD CI/Android15/OPS-07/GitGuardian success → PR SHA 고정 병합 → main 재검증. [skip-play].
