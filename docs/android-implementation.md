# Android 구현 설계 및 작업 계획

요청: 기존 자막 도구를 Android 앱으로 제공하고, 150분 영상과 앱 종료 후 이어하기를 지원한다.

## 구조

- `android/`: Java 17, Android SDK 35, minSdk 26의 독립 앱. 기존 웹 앱은 유지한다.
- 사용자 시작형 foreground service에서 Media3로 원본 URI를 읽고 7분 단위 AAC를 추출한다. 전체 영상을 JavaScript 메모리로 복사하지 않는다.
- SQLite에 작업/구간 상태, 인식 결과, 번역 결과, 편집 결과를 각각 저장한다. API 키는 Android Keystore로 암호화한다.
- 한 번에 한 작업, 한 구간만 처리한다. 인식 완료 후 번역 실패 시 인식을 다시 요청하지 않는다.
- 로컬 WebView 화면은 기존 core/editor/history 모듈을 재사용한다. 네이티브 브리지는 앱 내부 HTTPS origin에서만 제공한다. 영상은 네이티브 플레이어에서 재생한다.
- Android 16의 긴 WorkManager 작업 할당량을 피하기 위해 사용자 시작 foreground service를 사용한다. 서비스 제한/프로세스 종료 시 저장된 경계부터 재개한다. 강제 중지나 재부팅 후에는 앱을 열어 이어한다.

## 파일별 계약

패키지: `com.haebi.subtitle`.

- `MediaChunks(Context)`: `inspect(Uri)` → `Info` (`durationMs`, `displayName`, `hasAudio`); `export(Uri, File, long startMs, long endMs, BooleanSupplier cancelled)` 동기 백그라운드 호출, 완료된 AAC MP4 파일.
- `ChunkPlan.create(long durationMs, long chunkMs, long paddingMs)` → `List<Segment>`; 각 항목 `index`, `startMs`, `endMs`, `extractStartMs`, `extractEndMs`.
- `JobStore(Context)`: `create(String uri,String name,long durationMs,JSONObject settings)` → id, `list()` → JSONArray, `get(String id)` → JSONObject, `cues(String id)` → JSONArray, `saveEdited(String id,JSONArray cues)`, `setStatus(String id,String status,String error)`.
- 작업 JSON: `id`, `uri`, `name`, `durationMs`, `status`, `stage`, `completedChunks`, `totalChunks`, `error`, `settings`. 상태: queued/running/paused/error/completed.
- `SecretStore(Context)`: `setKey(String)`, `getKey()`, `hasKey()`.
- `JobService.start(Context,String id)`, `JobService.pause(Context,String id)`; 자동 이어하기는 작업 상태 queued/running을 대상으로 한다.
- Web 메시지: `window.Native.postMessage(JSON.stringify({id,method,params}))`; 응답 `window.nativeResult({id,result,error})`. 이벤트 `window.nativeEvent({type,...})`.
- 메서드: `status` → `{jobs,hasKey}`, `setKey({key})`, `pickVideo({settings})`, `resume({jobId})`, `pause({jobId})`, `loadJob({jobId})` → `{job,cues}`, `saveCues({jobId,cues})`, `export({name,mime,text})`, `preview({jobId,positionMs})`, `importSubtitles`. `pickVideo`는 선택 완료 후 작업 생성/시작, 취소 시 null. API 키 조회 메서드는 없다.
- 설정: `sourceLanguage` auto, `targetLanguage` ko, `translationModel` gpt-5.5, `translate` true. STT는 타임스탬프 지원 whisper-1.
- 앱 화면은 `android/web/index.html`, `app.js`, `styles.css`; 공유 JS는 빌드에서 `/shared/`로 복사한다.

## 구현 및 검증 순서

1. 네이티브 추출/구간 계획과 150분 경계 테스트.
2. 영속 저장/암호화/API/서비스 및 복구 테스트.
3. APK 구성, 안전한 WebView 브리지, 파일 선택/내보내기/재생.
4. 모바일 작업 목록·진행률·이어하기·자막 편집 화면, 공유 JS 재사용.
5. 기존 Node 테스트, Android 단위 테스트·lint·debug APK 빌드. 가능한 경우 에뮬레이터에서 프로세스 종료 복구 검증.

## 한계와 확인 사항

- 150분 입력 지원 설계와 경계 테스트는 실제 150분 영상/API 처리 검증을 대신하지 않는다.
- API 응답을 받은 직후 저장 전에 프로세스가 죽으면 해당 요청만 중복될 수 있다. 서버 측 exactly-once 보장은 없다.
- 원본을 이동/삭제하거나 저장소 접근 권한을 잃으면 재개할 수 없다. 네트워크와 API 사용 요금은 필요하다.
- Android의 사용자 강제 중지, 배터리 제한, foreground service 시간 제한을 우회하지 않는다.
- 설계 시작 당시 폴더에는 Git 메타데이터와 Android SDK가 없었다. 이후 빌드 환경을 구성했으며 실제 확인 결과는 `android-verification.md`에 기록했다.
