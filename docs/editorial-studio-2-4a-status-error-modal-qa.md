# Editorial Studio 2.0 · 4-A 공통 상태·오류·모달 통합 QA

## 범위
- 기존 웹 생성 → 결과 편집 → SRT/VTT/JSON 내보내기와 Android WebView·Native Activity의 상태·오류·재시도·중단·확인 절차를 연결 검증한다.
- 웹 브라우저의 '현재 탭 메모리'와 Android 기기의 JobStore/SQLite 저장 정책은 구분한다. 새로운 자동 저장·서버 동기화·비용이 드는 API 기능은 추가하지 않는다.
- 실제 모델 인식, 외부 서비스 과금, 물리 Android TalkBack·키보드/IME는 자동 테스트에 포함시키지 않는다.

## 테스트 시나리오 및 판정
| 흐름 | 검증 | 합격 조건 |
| --- | --- | --- |
| Web: 입력 준비·진행 | 미설정/실행/파일별 진행·잠금 | 필수 입력 전 시작 불가, 진행률은 실제 값, 중복 실행 불가 |
| Web: 401 오류 | 2개 배치 중 둘째 파일 실패 | 오류 role=alert와 API 키 수정 안내, 앞선 완료 결과 다운로드 보존, 작업 UI 잠금 해제 |
| Web: 취소 | 중간 API 요청 중단 | 즉시 '중단 요청됨', 취소 후 중단 상태, 이후 배치 미실행, 오류 알림으로 오표시 안 함 |
| Web: 번역만 재시도 | 전사 성공·번역 실패 | 원문 체크포인트 및 결과 ID 유지, 재시도는 전사 반복 없이 번역만 처리 |
| Web: 작업 전환·편집 | 다중 파일·Undo/Redo | 현재 결과와 SRT/VTT/JSON 이름, 자막 변경 이력 보존(현재 탭 기준) |
| Web: 내보내기 오류 | 다운로드 링크·Blob 생성 실패 | 실제 저장 성공 추측 금지, 재시도 시 기존 편집 결과 보존 |
| Android: 작업 상태 | 준비·대기·진행·일시정지·오류·완료 | 데이터에서 유래한 상태, 오류 후 이어하기·연결 설정 행동만 활성화 |
| Android: 저장 실패 | 완료 자막 편집·기기 저장 실패 | 저장 실패 안내, 입력 유지, 화면 이탈 차단, 재시도 성공 후만 기기에 저장됨 표시 |
| Android: 알림 접근성 | 공지·오류·닫기 | 일반 공지는 role=status, 오류는 role=alert, 닫으면 status로 초기화 |
| Android: API 키 삭제 확인 | 확인 창 열기·취소 | 취소에 포커스 이동, 취소 후 요청 버튼 복귀, 승인 없이는 Native clearKey 미호출 |
| Android: 완료 작업 삭제 | 확인·취소·확인 완료 | 확인 버튼으로 포커스 이동 및 취소 후 복귀, 취소 중 deleteJob 미호출, 확인 시 대상 기록만 삭제·원본 유지 안내 |
| Android: 내보내기 취소 | OS 저장 창에서 취소/성공 응답 | 취소를 성공으로 표시하지 않으며 실제 Native 응답의 저장 여부에만 의존 |

## 수정 내역
- `android/web/app.js`: 공통 `message()`에서 오류와 일반 공지의 ARIA 역할을 구분. 버튼이 교체되는 '기록 삭제 → 삭제 확인'과 '취소 → 기록 삭제'에서 키보드 포커스를 실제 새 버튼으로 복귀시키는 `focusJobAction()`을 추가. API 키/작업 데이터 저장 및 삭제 호출 경로는 그대로.
- `tests/browser-workflow.mjs`: 401 오류 알림·안내·작업 잠금 해제, 취소 즉시/완료 상태·정상 취소의 오류 오표시 금지 검증.
- `android/tests/editorial-2-4a-integrated-status.test.mjs`: 원래 Android Mock Native Bridge를 통한 오류 공지/삭제 확인·포커스/기기 저장 실패 및 복구/내보내기 취소·정상 저장, 프레임 없이 실제 Chromium 캡처 및 회귀.
- 기존 2-A~3-C, 구 4-A 시각 테스트, Android Emulator Smoke를 그대로 유지한다.

## 접근성·데이터 보존
- 네이티브 확인 절차는 기존 인라인 확인 UI를 유지하며 새로운 브라우저 `confirm()`이나 실효성 없는 별도 다이얼로그를 도입하지 않는다.
- 위험한 명령의 실행은 실제 확인 버튼을 선택했을 때만 수행하고, 취소는 어떤 Native 삭제 호출도 하지 않는다.
- 기존 API 키는 Android Keystore에 저장되며 테스트에서 인증값은 전달/노출되지 않는다. 테스트는 Mock API/Android Bridge만 사용한다.
- Web 다운로드 클릭은 요청으로만 표현하며 OS 성공을 가정하지 않는다. 편집·내보내기 동작과 원본 파일은 유지한다.

## 검증·출시 게이트
- PR HEAD의 Node 단위·Mock browser-workflow·Playwright 4-A Android·기존 2-A~3-C 전체 회귀 통과.
- Android JVM·Lint·debug APK 및 Android 15 Emulator Smoke 성공.
- 기존 `output/editorial-4a/*.png`의 390px 확인창/저장 실패 캡처 확인, 에뮬레이터 캡처에 외부 시스템 오류 팝업 없음.
- CI 실패 시 원인 수정 후 **새 HEAD에서 재검증**. 성공한 해당 SHA만 `[skip-play]` Squash 병합.
- Google Play AAB/트랙·서명·스토어 등록정보는 변경하지 않음. 병합 후 main CI·GitHub Pages 배포와 실제 Play 게시를 구분.

## 다음 단계
4-B — 라이트·다크·반응형·접근성 종합 검수.
