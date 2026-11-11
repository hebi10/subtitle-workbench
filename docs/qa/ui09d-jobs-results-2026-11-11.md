# UI-09-D — 작업 관리·결과 확인

기준일: 2026-11-11
저장소: https://github.com/hebi10/subtitle-workbench
기준: UI-09-A 실제 Android 15 상태 캡처 + Editorial Studio 2.0 초기 기획·기존 2-B/2-C 구현.

## 작업 목표와 변화
- 기존 2-B의 상태별 주 동작(생성 시작, 일시정지, 이어하기, 자막 편집/보기, API 설정)을 유지하면서 완료 카드의 4개 동일 수준 버튼을 구분한다.
- 완료 카드의 주요 버튼: 자막 편집, 결과 보기. 보조 구획: SRT 저장, 기록 삭제 및 삭제 확인/취소. 삭제 확인·원본 영상 보존 정책은 그대로다.
- 결과 화면에서 선택 작업의 원본 영상 URI 연결 여부를 독립적으로 표시한다. 미연결은 영상 미리보기만 비활성화, 자막 편집/검토/SRT·VTT·JSON 저장은 유지한다.
- 연결됨은 실제 플레이어 재생 성공을 보증하지 않고 Android Native 미리보기 진입 경로임을 명시한다.
- 결과의 주요 동작을 자막 편집(부분 결과일 때는 자막 보기) 우선으로 놓고, 기존 SRT 기본/VTT·JSON 보조 저장, 완료·취소·실패 피드백, 결과 선택 변경 시 이전 피드백 초기화를 유지한다.
- 신규 전사·번역, 영상 플레이어 또는 새로운 라이브러리는 추가하지 않는다.

## 변경 범위
- android/web/index.html — 결과 영상 연결 상태 안내 및 우선 행동 순서
- android/web/app.js — 완료 작업 보조 버튼 구획, 연결 상태 동기화 및 주요 행동의 표시 클래스
- android/web/styles.css — 완료 작업 하단 보조 구획과 결과 연결 안내의 흑백 스타일, 48px 버튼·320~800px 반응형
- android/tests/editorial-2-2c-results.test.mjs — 완료/일시정지 작업, 미디어 연결/미연결, Native preview, SRT 저장, 모바일·테마 회귀
- docs/qa/ui09d-jobs-results-2026-11-11.md — 구현 및 검증 기록

## 기존 정책 보존
- 4개/페이지의 작업 페이지, 정확한 처리 진행률·오류/준비·일시정지 상태, 작업 정렬, 네이티브 함수의 호출 인수와 저장된 데이터 유지.
- SRT/VTT/JSON 실제 저장 요청과 MIME/파일명, 파일 저장 성공·취소·실패의 구분, 결과 변경 시 저장 알림 초기화, 영상 URI가 없으면 미리보기 비활성화.
- 삭제는 완료 작업만, 별도 확인 후에만 실행하며 원본 미디어는 삭제하지 않는다. 임의 데이터 생성·유료 API 호출은 없다.
- 안드로이드 서명, AAB, Play 트랙, Google Play 이미지/등록 정보, API 키와 Secret을 수정하지 않는다.

## 검증 게이트
1. Verify web and Android: 웹 테스트/Playwright, Android JVM/Lint/APK
2. Android Emulator Smoke: Android 15 API35 기기에서 라이트·다크/폰트 100/160% 실제 WebView·Native
3. 320/390/800px 및 390×480 키보드 크기, 4탭 상호 이동, 작업 삭제 확인/취소, 비디오 미연결 SRT, 부분 결과/완료, SRT/VTT/JSON 저장 테스트
4. Playwright 캡처는 Android 실제 캡처와 출처 구분 후 Drive 저장
5. 최종 PR SHA에서 CI 성공, 시각검수, 저장 위치 확인 후 [skip-play] 병합. 별도 Play 업로드 금지.

## 자료
UI-09 계획 문서: https://docs.google.com/document/d/173tB-fnTHztgRHDsjAVV1MAgir74aSxrNUUznhm7HNg/edit
UI-09-A Android 원본: https://drive.google.com/drive/folders/1B9IlL9Orxc6bS6ty6ZzY9SwCsrsI44Jv
후속: UI-09-F — 설정·네이티브 인식 3종 정보 밀도 개선.
