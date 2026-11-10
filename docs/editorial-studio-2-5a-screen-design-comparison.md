# Editorial Studio 2.0 · 5-A 최신 전체 화면/초기 기획 시안 대조

기준일: 2026-11-10 (Asia/Seoul)  
기준 main: `54cf6f57d609145e06f6d24a5da3f0a32e3d3034` (4-B 완료)  
최초 기획: [Editorial Studio 기획서 (2026-11-09)](https://docs.google.com/document/d/18IZetXPpfd96RhzPEBY7p9Pgvqd4KkvtskgSxUQEy48/edit)  
구현 로드맵: [Editorial Studio 2.0 명세서](https://docs.google.com/document/d/13uUy1_TvjpiQebwaaNAi7igZOuB-iRiZmZz7-bOOqT4/edit)

## 비교 증빙과 출처

| 구분 | 기준/최신 자료 | 데이터 출처 |
|---|---|---|
| 11/09 원안 | [디자인 마스터 기획서](https://docs.google.com/document/d/18IZetXPpfd96RhzPEBY7p9Pgvqd4KkvtskgSxUQEy48/edit), [구형 전체 5-A 검수 기록](https://docs.google.com/document/d/1-kaZtd5ntQiNj2i_7_rUQ-oGc-bmjAAt-JQYIZDfJWU/edit) | 기획 명세 + 당시 실측 캡처 |
| 11/09 Android | [글꼴 160% 라이트/다크 비교](https://drive.google.com/file/d/1RhhH-Vhnc_JZcN5AL43Wa0jMbCCHzejl/view), [네이티브 3종](https://drive.google.com/file/d/1Mb6LTajTGNoLlhmr_xdOAzOYgapxL3Gb/view) | Android 15 에뮬레이터 |
| 11/09 웹 | [1280px 생성·편집·내보내기 비교](https://drive.google.com/file/d/1zbc2jCndSd8HH-7K4KWFlt1s8wNN3ykP/view) | Chromium 캡처 |
| 11/10 최신 웹/Android WebView | [화면·반응형 QA 원본 ZIP](https://drive.google.com/file/d/1lR5CpmGexEXp2niHWS_dOIKkOruY-r-i/view) | PR #37 Verify #42787016455, artifact #13748119957: 157개 파일(스크린샷/지표 포함) |
| 11/10 실제 Android | [Android 15 WebView/네이티브 실측 ZIP](https://drive.google.com/file/d/1MeAgeqzAOpQdqSq7c54E0ibCb0-wC46U/view) | PR #37 Emulator #42787016682, artifact #13749889272: OS 글꼴 100/160, 라이트·다크, native 3종 |
| 11/10 스토어용 참고 | [브라우저 브리지 기반 5화면 ZIP](https://drive.google.com/file/d/1N6QuWOwZwseVSloZN8pQaosr0rUhL6_J/view) | PR #37 capture #42787016407, artifact #13750585013. 실제 Android 시스템 화면 아님 |

원안은 **기능·정보 구조를 설명하는 기획서**이므로, 구현 화면을 초기의 임의 이미지 픽셀과 똑같이 재현했는지가 아니라 작업 동선/주요 계층/색상/대비/플랫폼별 특성의 일치를 우선 판정한다.

## 영역별 대조

| 화면 | 초기 기획 | 11/10 실제 관찰 | 판정 |
|---|---|---|---|
| Android 영상 추가 `videoView` | 영상·음성 선택 우선, 마이크/오프라인 AI 별도 진입, 키 필요 조건 노출 | 파일 선택·가져오기, 개인 API 연결 정보, 이후 마이크·오프라인 진입. 160%에서 일부 버튼/제목 단어가 한글 한 음절 단위로 줄바꿈 | **부분 보정** |
| Android 작업 `jobsView` | 상태·파일명·진행률/이어하기 우선, 고급 정보 접기 | 완료 작업 카드·후속 행동·상태 표시·4건 페이징, 160%도 탐색 가능 | **일치** |
| Android 결과 `resultsView` | 결과·자막 수/상태 → 미리 확인 → 편집 → SRT 기본·VTT/JSON | 데이터 기반 결과 요약, 자막 미리보기 접기, SRT를 대표 실행으로 분리 | **일치** |
| Android 편집 `editorView` | 현재 자막의 시간·원문·번역·화자, 이전/다음, 저장 상태, 검색 | 현재 자막 문맥·저장 피드백과 탐색, 자막 입력/Undo·Redo, 영상은 별도 네이티브 미리보기 | **플랫폼 대응** |
| Android 설정 `settingsView` | 연결 방식·기본값·모델·전송 정보, 키 보호 | 연결/다음 영상 상태 요약, 접이식 설정, 키 삭제 확인, 글꼴 160%에서 2열 카드 길어지지만 가로 넘침 없음 | **일치** |
| Native 온디바이스 | 언어/OS 준비 → 인식 → 저장 | 언어 지원·모델 요청과 단계형 버튼 표시. OS 모델 품질 실측은 별도 | **구조 일치** |
| Native GPT 실시간 | 비용·전송/연결 → 인식 → 저장 | 요금·전송 안내와 단계별 버튼, 비연결 시 시작 비활성 상태 | **구조 일치** |
| Native Vosk | 설치 모델·용량·라이선스 → 로컬 인식/저장 | 모델 미설치·약 87MB·라이선스·다운로드·파일 전사 단계 표시 | **구조 일치** |
| 웹 생성 `panel-generate` | 좌 입력·설정/우 영상·진행, 모바일 단일열 | 1280px 좌 도구·우 프리뷰/진행, 모바일 순차 구조와 연결 조건 | **일치** |
| 웹 편집 `panel-edit` | 영상과 자막 편집 동시 대조, 모바일 상하 | PC **왼쪽** 미디어·오른쪽 선택 자막/입력 (3-B 선택), 모바일 미디어 먼저; 재생 위치와 선택 자막 구분 | **의도적 배치 차이** |
| 웹 내보내기 `panel-export` | 결과 선택·SRT 기본·VTT/JSON 보조, 오류/미완료 안내 | 결과 요약과 SRT 대표 버튼, 다른 포맷 보조, 원문 보존·다운로드 요청/실제 저장 구분 | **일치** |

### 발견된 실제 결함 및 처리

**P1 · Android 160% 한국어 단어 분할**  
Android 15 화면 확대에서 `자막 불러오기`, `내 API로 자막 생성`, `API 연결 설정`이 일부 음절 단위로 끊겨 읽기 불편했다. 클릭 타깃이나 화면 외부 절단 문제는 아니지만 초기 디자인의 한국어 가독성 요구와 차이 있다.

- `android/web/styles.css`의 **파일 카드 안에서만** 버튼·제목에 `word-break: keep-all; overflow-wrap: anywhere;`를 적용한다. 단어 단위 줄바꿈을 우선하고 실제 공간 부족 때만 안전하게 글자를 감싼다.
- CSS 보정 이외 레이아웃/네이티브 음성 인식/보안/미디어 처리에는 손대지 않는다.
- `android/tests/editorial-2-5a-screen-design-parity.test.mjs`에서 화면 구조·핵심 ID·SRT/VTT/JSON 계약과 Android Chromium 320/390/800px 라이트·다크 단어 분할 설정·넘침·터치 영역을 확인한다.
- 실제 Android 15 글꼴 160% 다크 캡처에서 문구가 단어 단위로 읽히는지 추가 육안 검수한다.

### 이번 단계에서 결함으로 단정하지 않은 사항

- 초기 웹 화면 설명의 '영상 플레이어 오른쪽'과 현 PC 편집 '미디어 왼쪽'은 **3-B 단계에서 의도적으로 변경한 정보 배치**이며, 동시 대조 요구는 충족한다.
- Android 편집은 영상 파일을 분리된 Native 미리보기로 표시한다. 웹과 동일한 인라인 플레이어가 없다는 사실만으로 영상 미리보기 기능 누락이라고 판정하지 않는다.
- 글꼴 160%에서 설정 요약 카드가 길고 첫 화면의 정보 밀도가 높아지는 것은 사용자 설정을 반영한 결과다. 가로 넘침/기능 가림이 확인되지 않은 한 임의로 글자를 줄이지 않는다.
- Native 인식 화면은 모델 다운로드, 마이크 인식·과금 요청을 수행하지 않은 UI 계측 결과이다. 실제 ASR 품질/권한/TalkBack 검증을 통과한 것으로 표기하지 않는다.
- Play 스토어 스크린샷 파일 중 WebView 5장에는 **Mock Native Bridge**가 사용된다. 실제 Google Play Console 테스터 노출/게시 여부 및 Android 시스템 실화면과 구분한다.

## 전체 QA·릴리스 게이트

1. PR SHA에서 웹·Android JVM/Lint/APK 빌드 및 Playwright UI 회귀를 통과한다.
2. Android 15 Emulator Smoke의 실제 WebView 라이트/다크·fontScale 100/160와 Native 3종 캡처를 확인한다.
3. 캡처 원본/기록과 Drive 문서 링크가 일치해야 한다.
4. 파일 생성·미디어 인식·API/키/사용자 데이터 저장 정책은 변경하지 않는다.
5. 검증 성공 시 `[skip-play]` squash `main` 병합. Google Play AAB 업로드/트랙 승격/스토어 등록정보 변경은 이번 단계에서 하지 않는다.

## 후속 작업

**5-B — 통합 CI·PR 병합·테스트 배포 검증**. 기존 signed AAB/versionCode 충돌과 Play internal/closed API·Console 상태·테스터 설치 가능 여부를 구분하여 승인된 범위 안에서 검증한다.
