# Subtitle Workbench · Editorial Studio 3-A

## 범위와 확정 기준
Android WebView의 영상 추가·작업·결과 세 화면만 재배치한다. 디자인 콘셉트 Editorial Studio, 1-A 색상 토큰/시스템 라이트·다크, 1-B 브랜드, 2-A 공통 컴포넌트 12종을 유지한다. Native bridge 및 JSON 계약, 작업 정렬/저장/삭제/일시정지/이어하기/편집/내보내기 처리는 변경하지 않는다.

## 화면별 개선
### 영상 추가
- 파일 기반 자막 생성과 마이크 입력을 명확한 독립 그룹으로 구분한다.
- 파일 선택과 자막 가져오기 바로 아래에 개인 API/테스트 서버 연결 상태·설정 버튼을 표시해 생성 불가 이유를 쉽게 알 수 있게 한다.
- 기본 모델·언어 설정, 로컬 Vosk 모델 진입, 파일 준비 화면은 파일 그룹 내에 유지한다.
- 마이크 입력 2종(온디바이스·GPT 실시간)과 전송·비용 안내는 별도 그룹에 배치한다. Vosk 다운로드/사용 조건, 과금 안내 문구는 보존한다.

### 작업
- 동적 요약: 전체·진행·준비·일시정지·완료·오류 개수를 실제 작업 배열에서 계산해 표시한다.
- 카드 상단을 파일명 → 상태·길이·구간 정보로 통일하고, 진행률은 기존 저장 결과 기준 수치 그대로 사용한다.
- 완료 작업은 '자막 편집', 일시정지 작업은 '이어하기', 준비 작업은 '생성 시작'을 기본 버튼으로 강조한다.
- 기록 삭제 확인·취소/원본 보존, 일시정지, 결과·SRT 저장 및 진행 상세는 기존 분기를 유지한다.
- 목록은 기존 4개/페이지, 기존 우선순위 및 실시간 갱신 구조를 유지한다.

### 결과
- 선택한 작업 요약(파일명·상태·자막 수·길이), 영상 미리보기/자막 편집, SRT·VTT·JSON 내보내기를 시각적 그룹으로 분리한다.
- 기존 resultJobSelector, resultName, resultMeta, resultStatus, exportSection, data-export 계약은 보존한다.
- 기존 renderResults가 editResult.textContent 전체를 교체해 2-A 편집 아이콘을 지우던 문제를 수정한다. 버튼 레이블만 갱신하고 아이콘은 유지한다.
- 미완료 작업의 읽기 전용 조회와 부분 결과 내보내기는 기존대로 동작한다.

## 변경 파일
- android/web/index.html: 세 화면 섹션 그룹화, 접근성 제목, 작업 상태 요약, 결과 레이블 분리
- android/web/styles.css: 세 화면만 대상으로 정보 밀도·여백·행동 우선순위·반응형 보정
- android/web/app.js: 작업 상태 요약 계산, 카드 헤더 및 행동 강조, 아이콘 유지. 자막 생성/저장/복구 로직 미변경
- android/tests/editorial-3a-flow.test.mjs: 파일·작업·결과 기능 및 UI 회귀, 320/390/800px, 라이트·다크, 첫 화면 버튼·스크롤·입력 상태 확인
- .github/workflows/verify.yml: QA 캡처 아티팩트 포함

## 검증/완료 게이트
1. npm test, Android WebView Playwright, Android lint/unit/debug build, Android 15 emulator.
2. 기존 'tabs-regressions'의 390px 문서 높이 1100px 이하 및 주요 버튼 첫 화면 노출 조건 유지.
3. 라이트·다크 390/800px 최신 캡처 비교. 실제 실기기 QA는 5-A에서 추가 점검.
4. PR 전체 CI 성공 시 main 병합, 병합 버전 재검증, 기존 GitHub Actions 내부 테스트 자동 배포의 API readback 확인.
5. Play Store 스크린샷/스토어 등록정보 직접 교체와 비공개 테스트 승격은 이번 단계에서 수행하지 않는다.

## GitHub
https://github.com/hebi10/subtitle-workbench
