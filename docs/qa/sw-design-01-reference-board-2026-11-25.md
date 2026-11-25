# SW-DESIGN-01 — 자막라인 화면 시안 적용

기준 main 73c8ebb6d45e90776fe02cecaab30d84251f141d. 디자인 입력: 2026-11-25 자막라인 UI/UX 전체 시안 (17개 화면). UI/UX 기획서: https://docs.google.com/document/d/1KjIajtorVrprmHt40JTfVObkb-MAgiH5/edit . 실제 이전 Android 화면: https://github.com/hebi10/subtitle-workbench/actions/runs/45528082756 및 https://github.com/hebi10/subtitle-workbench/actions/runs/45526929054.

## 구현 기준
- A01/A01-F/A01-P: 간결한 상단, 세 가지 입력 방식과 파일·자막 선택 행, 준비 작업/비용 및 연결 정보를 유지. 실제 생성은 준비·연결 조건 충족 시에만 가능.
- A02: 실제 상태 필터 4종과 기존 준비/일시정지/검색/정렬 필터 공존. 카드 아이콘·실제 진행률·작업별 버튼. 허위 썸네일 없음.
- A03: 실제 작업 결과 최대 세 개 바로 선택 및 전체 선택, 현재 결과 상세, 영상 유무와 파일 저장 분리.
- A04/A04-P/A04-R/A04-S: 간결한 설정 행과 기존 설정 상세, 저장·암호화·연결 확인·실제 구독 상품 상태 유지.
- A05: 파일과 선택 자막 편집 필드가 먼저 나오도록 상단 간격 압축. 기존 저장/검색/필터/분할/병합/실행 취소 및 별도 Native 영상 미리보기 유지.
- A06: 흑백 시스템 테마의 영상 미리보기 툴바와 기존 Media3 플레이어. 별도의 표시 모드 토글이나 가짜 플레이어 추가 없음.
- A07/A08: 원형 마이크 픽토그램을 실제 시작 버튼에 적용하고, 언어/준비/결과 단계와 권한·요금 안내 유지. 원형 픽토그램 외 카드 모서리 직각.
- A09: 공통 Native 여백/타이포그래피를 압축, 실제 Vosk 언어 모델/용량/설치/파일 조건 유지.
- W01~W03: 1280px 이상 좌측 작업 탭, 기존 세 가지 작업 패널과 브라우저 로컬 자동 저장/비용/번역 복구 유지. 좁은 화면은 상단 탭.
- 실제 모델명/파일명/키 상태/광고 구독/저장 결과를 사용. 시안의 Whisper medium 1.5GB, 우선 처리 혜택, 허위 연결/응답시간, 삭제 동작, 프리미엄 기능 등 비현행 요소는 구현하지 않음.
- 흑백 토큰, 승인된 로고, API/SQLite/Keystore/Native Bridge/미디어 처리/Play 정책 보존. 실제 시스템 글꼴 및 접근성 48dp/52dp 기준 유지.

## 검증
기존 Verify web and Android, UI-09-A real Android state baseline 및 browser fixture 실행을 확인한다. 이전 화면과 PR의 실제 Android 캡처를 동일한 화면 상태에서 1:1 비교한다. 완성된 영상/실물 기기/실제 유료 API 검증과 별도로 표시한다. Google Play 또는 운영 서버 배포 없음.
