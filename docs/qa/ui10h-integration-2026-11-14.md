# UI-10-H — 통합 QA 소스·상태·캡처 매트릭스

기준: E #70, F #71, G #72 코드가 결합된 통합 검증 브랜치. Drive UI-10-H, UI-10-00 기준선.
검증 화면: Android WebView ①새 작업 ②작업 관리(상태·검색·필터·정렬) ③결과(SRT/VTT/JSON 저장 상태) ④자막 편집(자동 저장·부동소수점 시간값) ⑤설정(키/서버/비용) + Native ⑥온디바이스 지원/권한 ⑦GPT 실시간 상태/요금 ⑧Vosk 모델·손상·중단.
웹: 생성·편집·내보내기 3탭, 320/390/800/1280px, 밝음/어두움, 키보드/저장 수명/다운로드 요청과 실제 저장 차이.
데이터: JobStore 원본/이어하기/삭제 확인, Native 브리지·키 마스킹, SRT/VTT/JSON UTF-8, 작업 전환 시 결과 보존.
자동화: Node test + Playwright browser/WebView(기존 ui09h), Android JVM·Lint·debug, Android15 API35 emulator, UI-09-A 실화면 캡처 파이프라인(동일 소스 SHA와 해시), OPS-07/08 및 GitGuardian.
실제 유료 API/마이크/Vosk 다운로드/장시간 열·배터리/TalkBack/실기기 IME는 에뮬레이터 fixture로 증명할 수 없으며 별도 확인 필요.
이미지 주의: assets/play-store/ko-KR/manifest.json 원본은 2026-11-11 UI-09-H 기준으로 새 UI/자막라인 원본으로 간주하지 않음. I 단계에서 신규 실캡처로 교체·SHA 검증, Google Play 업로드는 명시적 별도 승인.
H 최종 승인: E·F·G PR 최신 main 병합 후 **H 코드 변경분만** 새 HEAD에 재적용, 필수 CI 성공/원본 캡처 유효 해시/미해결 리뷰 0건/병합 후 main CI 성공. 실패·진행 중이면 병합 금지. [skip-play].
