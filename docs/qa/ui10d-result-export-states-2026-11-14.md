# UI-10-D — 결과 확인·파일별 저장 상태 정합성

기준 main: `4d8b55829fa9205eab48c0a18e7e2f6779c01be2`, UI-10-C1/C2 완료 후 웹·Android 및 OPS-08 CI Success.
근거: Google Drive UI-10(030) 및 UI-10-00 정정 보고서(031) 결과 확인(03).

## 범위
- Android 결과 화면에서 현재 작업 요약 → 실제 원본 영상 연결 안내 → 편집/Native 미리보기 → 자막 내용 → SRT/VTT/JSON 저장 순서 유지·정돈
- 영상 원본 정보(`uri`) 없음: 미리보기 비활성화, 자막 확인/파일 저장은 계속 가능
- 완료/부분 저장 결과 구별, 자막 0건 시 내보내기 비활성화, 기존 편집 가능 조건 유지
- Native `ACTION_CREATE_DOCUMENT`는 취소 시 null, 파일 쓰기 및 UTF-8 flush 성공 시 true 반환: 명시된 true 또는 `{saved:true}`만 저장 성공 판정
- 미확인/불명확한 Native 응답은 오류 처리. null/false/`{saved:false}`만 취소 판정
- 저장 요청 단위로 SRT/VTT/JSON 상태(준비·저장 위치 선택·성공·취소·실패)를 선택 형식명과 함께 표시
- 동일 화면에서 여러 파일 저장 선택기 동시 실행 금지; 한 건 진행 중에는 나머지 내보내기 버튼 비활성화
- 작업을 바꾸면 이전 작업의 성공/실패 안내를 초기화; 늦게 도착한 이전 작업의 응답이 새 작업의 상태를 덮어쓰지 않음
- 작업 목록 SRT 저장의 기존 Native 처리 및 상태/데이터 보존, 파일명 규칙·SRT/VTT/JSON 텍스트 생성기 불변
- 실재하지 않는 파일 저장 성공·클라우드 저장·영구 보관·자동 공유 표시 금지

## 검증 및 병합 조건
- 기존 Android WebView/Native 파일 선택 취소·실패·성공 회귀, 실제 결과 없는 상태/부분 결과/가져온 SRT(원본 영상 없음)
- 신규 Node/Playwright: SRT/VTT/JSON 응답별 상태, 중복 선택 방지, 비정상 성공 응답 거부, 파일 저장 중 작업 전환 후 stale 상태 격리
- `MainActivity` Native UTF-8 저장 및 취소 분기 정적 계약 검증(현재 Native 구현 유지)
- 320/390/800px 라이트/다크 화면, 클릭 48px, Android 15 API35 계측·캡처
- 최신 HEAD의 Verify web and Android/Android Emulator Smoke/OPS-07/GitGuardian 모두 성공, 리뷰 해소 후만 main 병합
- [skip-play] AAB·Google Play 업로드·등록정보·트랙 변경 금지. Drive 문서는 읽기 전용 유지
