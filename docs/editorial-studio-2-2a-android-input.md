# Editorial Studio 2.0 · 2-A Android 새 자막 작업 화면

## 구현 범위

Android WebView `videoView` 한 화면을 기존 1-A 공통 토큰 및 1-B 최초 안내의 연속 단계로 재구성한다.

- 상단 제목을 '새 자막 작업'으로 변경하고 입력 목적을 설명한다. 기존 하단 메뉴 '영상 추가' 4분할은 변경하지 않는다.
- 기존 파일 자막 생성 `file-source`를 가장 중요한 카드로 배치. `pickVideo`를 주 행동, `importSubtitles`를 보조 행동으로 구분한다.
- 파일 영역에는 실제 개인 API/테스트 서버 연결 상태·설정 버튼 및 다음 작업 기본값을 정리한다. `connectionCard`에 실제 상태(`missing`/`saved`/`verified`/`error`)만 데이터 속성으로 표시한다. API 인증·키 저장 방식이나 버튼 활성화 조건은 변경하지 않는다.
- 마이크 입력은 별도 `microphone-source`에서 온디바이스(Android 12 이상)와 GPT 실시간을 유지한다. 실제 클릭 전 마이크 접근·네트워크 호출 없음.
- Vosk `local-offline-entry`를 파일 연결 안내에서 분리해 별도 `offline-source`로 옮긴다. 모델 설치/다운로드·실제 인식은 기존 버튼·Native Activity의 사용자가 직접 시작하도록 한다.
- `preparedJobLabel` / `preparedJobs`는 계속 파일 준비 영역에 유지하고 상태·저장·이어하기 데이터 계약은 변경하지 않는다.
- 1-B `firstRunGuide`를 그대로 유지한다. `guideOffline`이 참조하는 `.local-offline-entry`는 그대로 존재한다.

## 디자인 규칙

- 무채색 `--es-*` 및 `--es2-*` 토큰 활용, 평면 카드·0px 반경, 그림자·장식 이미지·그라데이션 없음.
- 사용자 우선순위: 영상·음성 파일 → 연결 상태 및 다음 영상 기본값 → 마이크 → 오프라인 Vosk.
- Android 320/360/390/432/800px, 라이트/다크, 시스템 글꼴 100/160% 대응.
- 폭 360px 이하는 파일 선택/가져오기 버튼을 세로 정렬. 620px 이상에서는 마이크 및 오프라인 설명을 2열로 정렬한다.
- 기존 인식·번역에 따른 비용/전송 안내 문구를 삭제하거나 축소해 오인시키지 않는다.

## 구현 파일

- `android/web/index.html` — 파일 카드·마이크·오프라인 3그룹 배치 및 설명, ID·기능 계약 보존
- `android/web/styles.css` — 입력 화면으로 범위를 제한한 카드/버튼/여백/상태/반응형
- `android/web/app.js` — `connectionCard.dataset.state` 표시만 추가; 네이티브 호출·인식·키/모델 설정 불변
- `android/tests/editorial-2-2a-input.test.mjs` — 기존 ID·순서·Native 호출·실제 DOM 렌더링/키보드·폭/테마 확인
- `.github/workflows/verify.yml` — 2-A 자동 캡처 PNG를 기존 CI 아티팩트에 보관

## 회귀 및 QA

1. API 연결 없음: 파일 선택 비활성 유지, 연결 설정 이동 가능, 오프라인/온디바이스 기능의 경로는 그대로 제공.
2. 연결 있음: 원래의 `pickVideo` → `preparedJobs` 생성·준비 흐름 보존.
3. 마이크 버튼: 사용자가 선택한 때에만 `openOnDevice` 또는 `openCloudLive` 호출.
4. Vosk 상세 펼침: 기존 `openOfflineModel` 작동, 모델 미설치 안내 유지.
5. 1-B 최초 사용: 작업 0건은 안내, 작업 존재 시 숨김, 기존 안내 '오프라인 AI' 버튼은 Vosk 상세로 포커스.
6. 320~800px 가로 넘침 없음, 하단 4분할 메뉴와 파일 선택 버튼이 초기 화면에서 가려지지 않음, 라이트·다크/폰트160/키보드.
7. 웹·Android 유닛/Lint/Playwright/Android 15 Emulator Smoke, Android 캡처와 0-A 기준 대비.
8. 물리 기기 마이크·실제 유료 API 품질은 이번 시각 리디자인의 자동 테스트가 대체하지 않는다.

## 안전한 병합 및 후속

`[skip-play]` Squash 병합으로 기존 내부 테스트 AAB(versionCode=21)를 중복 업로드하지 않는다. UI 기능 회귀/캡처 검증 모두 성공하기 전 병합·스토어 이미지 변경 금지.

다음 단계: `2-B — Android 작업 관리 화면`. 진행·일시정지·완료·오류 상태별 대표 행동 및 정보 위계를 실데이터 기반으로 개선한다.
