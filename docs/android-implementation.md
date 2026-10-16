# Android 구현 설계 및 작업 계획

요청: 기존 자막 도구를 Android 앱으로 제공하고, 최대 180분 영상과 상세 진행 표시, 사용자 API 키 입력, 앱 종료 후 이어하기를 지원한다. 최초 예시였던 150분을 3시간 지원 기준으로 확장했다.

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
- 작업 JSON: `id`, `uri`, `name`, `durationMs`, `status`, `stage`, `completedChunks`, `totalChunks`, `error`, `settings`, `progress`. 상태: queued/running/paused/error/completed. 선택만 마친 영상은 paused 상태와 ready 단계로 보관한다.
- `progress`: 저장 결과 기반 `percent`, 완료 구간 영상 길이 `processedMs`, `transcribedChunks`, `translatedChunks`, `currentChunk`(1부터 시작, 현재 구간 없음/완료는 0), 현재 구간의 `batchCompleted`/`batchTotal`, 측정 가능한 `extractionPercent`(측정 불가 시 null), 활성 실행 시간 `elapsedMs`, 마지막 체크포인트 시각 `lastSavedAt`(저장 이력 없음 또는 이전 데이터의 시각 미상은 0), 상태 `message`.
- `SecretStore(Context)`: `setKey(String)`, `getKey()`, `hasKey()`, `clearKey()`. 화면에는 키 값을 반환하지 않는다.
- `JobService.start(Context,String id)`, `JobService.pause(Context,String id)`; 자동 이어하기는 작업 상태 queued/running을 대상으로 한다.
- Web 메시지: `window.Native.postMessage(JSON.stringify({id,method,params}))`; 응답 `window.nativeResult({id,result,error})`. 이벤트 `window.nativeEvent({type,...})`.
- 메서드: `status` → `{jobs,hasKey,settings,keyCheck,maxDurationMs}`, `setKey({key})`, `clearKey()`, `checkConnection({settings})`, `openApiKeyPage()`, `pickVideo({settings})`, `resume({jobId,translationModel?})`, `pause({jobId})`, `loadJob({jobId})` → `{job,cues}`, `saveCues({jobId,cues})`, `export({name,mime,text})`, `preview({jobId,positionMs})`, `importSubtitles`. `pickVideo`는 선택 완료 후 `createPrepared`로 준비 작업만 만들며, 생성은 명시적인 resume 요청으로 시작한다. 취소 시 null. API 키 조회 메서드는 없다.
- 설정은 `getSettings()`와 `setSettings({settings})`로 조회·저장한다. 자막 파일 가져오기는 `importSubtitles()` → `{name,text}`를 화면에서 파싱한 뒤 `importCues({name,cues})` → `{job,cues}`로 저장한다.
- 연결 확인은 별도 네트워크 실행기에서 모델 조회 GET만 수행한다. 키·설정 변경과 Activity 종료 시 오래된 결과를 버린다. 유료 생성이나 결제 상태 검증은 수행하지 않는다.
- 설정: `sourceLanguage` auto, `targetLanguage` ko, `translationModel` gpt-6-luna, `translate` true. STT는 타임스탬프 지원 whisper-1(2027-02-26 종료 예정).
- 전역 설정에서 이전 기본 모델만 한 번 이전한다. 작업별 모델은 보존하며, `updateTranslationModel`은 멈춘 작업에서만 완료 결과를 그대로 두고 변경한다. SQLite v1→v2는 열 추가 방식으로 기존 데이터를 보존한다.
- 앱 화면은 `android/web/index.html`, `app.js`, `styles.css`; 공유 JS는 빌드에서 `/shared/`로 복사한다.

## 구현 및 검증 순서

1. 네이티브 추출/구간 계획과 180분 포함·초과 경계 테스트.
2. 영속 저장/암호화/API/서비스 및 복구 테스트.
3. APK 구성, 안전한 WebView 브리지, 파일 선택/내보내기/재생.
4. 모바일 작업 목록·진행률·이어하기·자막 편집 화면, 공유 JS 재사용.
5. 기존 Node 테스트, Android 단위 테스트·lint·debug APK 빌드. 가능한 경우 에뮬레이터에서 프로세스 종료 복구 검증.

## 한계와 확인 사항

- 180분 입력 지원 설계와 합성 영상 추출 검증은 실제 180분 영상 전체의 API 처리·음성 인식 품질 검증을 대신하지 않는다.
- API 응답을 받은 직후 저장 전에 프로세스가 죽으면 해당 요청만 중복될 수 있다. 서버 측 exactly-once 보장은 없다.
- 원본을 이동/삭제하거나 저장소 접근 권한을 잃으면 재개할 수 없다. 네트워크와 API 사용 요금은 필요하다.
- Android의 사용자 강제 중지, 배터리 제한, foreground service 시간 제한을 우회하지 않는다.
- 설계 시작 당시 폴더에는 Git 메타데이터와 Android SDK가 없었다. 이후 빌드 환경을 구성했으며 실제 확인 결과는 `android-verification.md`에 기록했다.
