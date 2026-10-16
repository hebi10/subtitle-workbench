# Subtitle Workbench

영상·오디오에서 자막을 생성하고 번역·편집하는 웹 및 Android 도구입니다. OpenAI API로 음성 인식과 번역을 수행하고 `SRT`, `VTT`, `JSON` 파일을 내보냅니다.

웹에서는 `ffmpeg.wasm`, Android에서는 Media3로 오디오를 추출합니다. Android 앱은 구간별 진행 상태를 기기에 저장하여 중단된 작업을 이어갈 수 있습니다.

이 앱은 서비스 운영자의 OpenAI API 키를 제공하지 않습니다. Worker 프록시 모드와 브라우저 직접 호출 모드 모두에서 각 사용자가 자신의 OpenAI API 키를 입력해야 합니다.

## Android 앱

`android/`에 Android 8.0 이상용 앱을 제공합니다. 최대 3시간 영상, 7분 단위 네이티브 오디오 추출, 상세 진행 표시와 기기 내 체크포인트 저장을 지원합니다. 180분 영상은 26구간으로 처리하며, 강제 중지 후에는 앱을 다시 열어 저장된 진행에서 이어합니다. 사용자 API 키를 암호화해 저장하고 `gpt-6-luna`를 번역 기본 모델로 사용합니다. [설치·빌드·검증 안내](android/README.md)를 참고하세요.

## 로컬 실행

```bash
npm start
```

출력된 로컬 URL을 브라우저에서 엽니다. 포트가 사용 중이면 개발 서버가 다음 포트를 선택하므로, Worker의 로컬 `ALLOWED_ORIGINS`도 실제 출력된 Origin과 일치시켜야 합니다.

## 사용 순서

1. 영상 또는 오디오 파일을 선택합니다.
2. 기본값이자 권장 방식인 `Worker 프록시 사용`을 선택하고 자신의 OpenAI API 키와 배포된 Worker URL을 입력합니다.
3. 필요하면 `브라우저 직접 호출`로 전환할 수 있습니다. 이 모드도 자신의 OpenAI API 키가 필요하며, OpenAI의 브라우저 CORS 정책에 따라 요청이 거부될 수 있습니다. 직접 호출이 실패하면 Worker 모드를 사용합니다.
4. 기본적으로 API 키는 현재 페이지 메모리에서만 사용됩니다. 선택적으로 이 기기에 암호화해 저장할 수 있습니다.
5. `자막 생성 시작`을 누르고, 완료 후 `SRT`, `VTT`, `JSON` 파일을 다운로드합니다.

## 여러 파일 처리와 편집

- 여러 파일을 선택하면 순서대로 처리합니다. 완료된 파일은 상단 `작업 결과`에 남으며, 결과를 선택해 편집하거나 각각 다운로드할 수 있습니다.
- 결과, 싱크 보정, 실행 취소 이력은 파일별로 현재 페이지 메모리에 유지됩니다. 새로고침하거나 페이지를 닫기 전에 필요한 결과를 다운로드하세요. 영상이나 자막 결과를 브라우저 저장소에 영구 저장하지는 않습니다.
- 편집 탭에서도 영상을 보면서 자막을 수정할 수 있습니다. 텍스트·시간 변경과 병합·분할은 `실행 취소`와 `다시 실행`으로 최대 50단계까지 되돌릴 수 있습니다.
- 번역 여부와 대상 언어는 기본 설정에서 선택합니다. 번역을 끄면 원문 자막을 생성합니다.
- 파일 처리에 실패하면 남은 파일은 시작하지 않고 완료·실패·미처리 수를 표시합니다. 이미 완료된 결과는 그대로 유지됩니다.
- 인증·설정 오류는 바로 중단합니다. 요청 제한·서버 오류·네트워크 오류는 짧은 대기 후 최대 3회 요청하며, 오류가 계속되면 중단합니다. 번역 응답 누락이나 형식 오류에만 자막 묶음을 나누는 재처리를 적용합니다.
- `중단`은 활성 API 요청과 FFmpeg 작업을 취소합니다. 작업 정리가 끝난 뒤 다시 실행할 수 있습니다.

## 검증

`npm test`로 자막 처리, API 오류·취소, FFmpeg 수명 주기, 배치 실행, 편집 이력의 자동화 테스트를 실행합니다.

로컬 서버에서 `/tests/browser-workflow.html`을 열면 브라우저 통합 회귀 테스트를 실행할 수 있습니다. 실제 앱 화면과 모듈을 사용하며 미디어 처리와 API 응답은 테스트용으로 대체하므로 외부 API를 호출하지 않습니다. 이 검증은 실제 영상 코덱, CDN 로딩, API 품질·비용 검증을 대신하지 않습니다.

## 데이터 흐름

- 영상 입력의 원본 영상 파일은 브라우저 안에서 처리되고, 여기서 추출한 음성이 전사를 위해 전송됩니다. 오디오 입력은 브라우저에서 변환·분할되며, 변환된 전체 음성 내용이 전사를 위해 OpenAI로 직접 또는 Worker를 거쳐 전송됩니다.
- 브라우저에서 추출하고 분할한 음성은 전사를 위해 전송됩니다.
- 전사된 자막 텍스트는 번역을 위해 전송됩니다.
- Worker 모드에서는 음성과 자막 텍스트 및 사용자의 API 키가 배포된 Worker를 거쳐 OpenAI로 전달됩니다. 브라우저 직접 모드에서는 브라우저가 이를 OpenAI로 직접 전송합니다.

## API 키 보관

`이 기기에 암호화해 저장`은 기본적으로 선택되어 있지 않습니다. 선택하지 않으면 API 키는 현재 페이지 메모리에서만 사용되며 새로고침하거나 페이지를 닫으면 사라집니다.

암호화 저장을 선택하면 브라우저가 로컬 암호로 `PBKDF2-SHA-256` 키를 파생하고 `AES-GCM`으로 API 키를 암호화합니다. `localStorage`의 암호화 자격 증명 레코드에는 `version`, `ciphertext`, `salt`, `iv`만 저장됩니다. 연결 방식과 Worker URL 같은 비밀이 아닌 설정은 별도 레코드에 저장됩니다.

복호화된 API 키는 잠금을 해제한 현재 페이지의 메모리에만 존재합니다. 로컬 암호는 저장되지 않으며 운영자도 복구할 수 없습니다. 로컬 암호를 잊으면 저장된 키를 삭제하고 다시 저장해야 합니다. 브라우저 사이트 데이터나 로컬 저장소를 삭제하면 암호화 레코드도 삭제됩니다.

## 공개 배포

정적 앱과 Worker는 서로 다른 배포 대상입니다. 정적 앱 파일을 정적 호스팅에 배포한 뒤, `worker/openai-proxy-worker.js`를 Cloudflare Worker로 별도 배포하고 그 URL을 앱에 입력합니다.

정적 앱에는 다음 파일과 폴더가 필요합니다.

```txt
index.html
styles.css
src/
vendor/
favicon.ico
favicon.png
```

`tests/`, `docs/`, `dev-server.mjs`, `package.json`, `worker/`는 정적 앱 실행 파일이 아닙니다. `worker/`를 정적 앱에 함께 올리는 것으로 Worker가 배포되지는 않습니다.

운영 환경에서는 정적 앱과 Worker를 모두 HTTPS로 제공해야 합니다. 로컬 개발의 `http://127.0.0.1` 또는 `http://localhost` 예외를 운영 설정에 그대로 사용하지 마세요.

### Worker 환경 설정

Worker에는 운영자 키를 포함한 `OPENAI_API_KEY`를 절대 변수나 secret으로 구성하지 마세요. Worker는 브라우저에서 받은 사용자의 `Authorization` 헤더를 `https://api.openai.com/v1/audio/transcriptions`와 `https://api.openai.com/v1/responses` 두 고정 경로에만 전달합니다. 그 밖의 요청 헤더는 전달하지 않고, 요청의 `Content-Type`만 함께 전달합니다.

필수·선택 설정은 다음과 같습니다.

- `ALLOWED_ORIGINS` — 필수. 쉼표로 구분한 정확한 Origin 허용 목록입니다. 각 값은 `scheme://host[:port]` 형식이어야 하며 경로나 와일드카드 `*`를 넣지 않습니다. 공백은 제거되어 비교되지만 명시적으로 쓰지 않는 편이 안전합니다.
- `MAX_REQUEST_BYTES` — 선택. 양의 정수 바이트 값이며 생략하거나 유효하지 않으면 기본값 `26214400`을 사용합니다.
- `RATE_LIMITER` — 선택적 코드 바인딩이지만 운영 배포에서는 Cloudflare Rate Limiting 규칙 또는 호환되는 `RATE_LIMITER.limit({ key: origin })` 바인딩 중 하나를 반드시 구성해야 합니다. rate limit이 없는 배포는 접근이 엄격히 통제된 로컬 개발에서만 허용합니다.

운영 예시:

```dotenv
ALLOWED_ORIGINS=https://subtitles.example.com
MAX_REQUEST_BYTES=26214400
```

로컬 개발 전용 예시:

```dotenv
ALLOWED_ORIGINS=http://127.0.0.1:4173,http://localhost:4173
MAX_REQUEST_BYTES=26214400
```

운영 정적 앱의 Origin이 여러 개라면 정확한 값만 쉼표로 추가합니다.

```dotenv
ALLOWED_ORIGINS=https://subtitles.example.com,https://www.subtitles.example.com
```

### 정적 호스팅 보안 헤더

아래는 현재 앱 리소스에 맞춘 응답 헤더 예시입니다. 호스팅 서비스의 전역 헤더 설정에 적용하세요.

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob: https://unpkg.com; worker-src 'self' blob:; connect-src 'self' https://unpkg.com https://api.openai.com https://YOUR-WORKER-ORIGIN.example; media-src 'self' blob:; img-src 'self' data: blob:; style-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Resource-Policy: same-origin
```

`https://YOUR-WORKER-ORIGIN.example`은 설명용 자리표시자입니다. 반드시 실제 배포된 Worker의 정확한 Origin(예: `https://subtitle-proxy.example.workers.dev`)으로 교체하고 경로는 넣지 마세요. Worker 모드를 제공하지 않을 때만 이 항목을 제거할 수 있습니다. 브라우저 직접 모드를 제공하지 않을 때만 `https://api.openai.com`을 제거할 수 있습니다.

현재 코드는 `unpkg.com`의 고정 버전 `@ffmpeg/ffmpeg@0.12.10`, `@ffmpeg/util@0.12.2`, `@ffmpeg/core@0.12.6`을 불러옵니다. 따라서 `script-src`와 `connect-src`의 `https://unpkg.com`, `script-src`의 `blob:`, `worker-src`의 `blob:`, WebAssembly 실행을 위한 `'wasm-unsafe-eval'`, 미리보기·생성 파일을 위한 `media-src blob:`이 필요합니다. CDN이나 FFmpeg 로딩 방식을 바꾸면 CSP도 함께 갱신해야 합니다.

## 운영 점검표

- 모든 사용자가 두 연결 모드 모두에서 자신의 OpenAI API 키를 입력하는지 확인합니다.
- Worker 변수와 secret에 `OPENAI_API_KEY`가 없는지 확인합니다.
- `ALLOWED_ORIGINS`가 실제 정적 앱의 HTTPS Origin과 정확히 일치하며 와일드카드가 없는지 확인합니다.
- Cloudflare Rate Limiting 또는 `RATE_LIMITER` 바인딩이 활성화되어 있는지 확인합니다.
- 정적 앱과 Worker가 HTTPS이고 위 CSP, COOP, COEP, CORP 헤더가 적용되는지 확인합니다.
- 로컬 암호 분실 시 복구할 수 없고 브라우저 저장소 삭제 시 암호화 레코드도 삭제된다는 점을 사용자에게 안내합니다.

## 주의

- 브라우저 직접 호출은 OpenAI의 브라우저 CORS 정책에 따라 실패할 수 있으며 동작이 보장되지 않습니다.
- API 키, 로컬 암호, `.env`, `.dev.vars` 파일을 공개 파일이나 로그에 넣지 마세요.
- 긴 영상은 브라우저 CPU와 메모리를 많이 사용합니다.
