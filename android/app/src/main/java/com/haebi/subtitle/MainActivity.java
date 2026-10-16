package com.haebi.subtitle;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Only packaged, trusted HTML can send bridge messages. Keys never return to JavaScript. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PICK_VIDEO = 101, EXPORT = 102, IMPORT = 103;
    private static final int MAX_TEXT_BYTES = 8 * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService connectionIo = Executors.newSingleThreadExecutor();
    private volatile OpenAiClient.Cancellation connectionCancellation;
    private WebView web;
    private JobStore store;
    private SecretStore secrets;
    private String pendingId;
    private PendingDocument documents;
    private volatile boolean destroyed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        store = new JobStore(this);
        secrets = new SecretStore(this);
        documents = new PendingDocument(getFilesDir());
        web = new WebView(this);
        // Resize the WebView viewport itself: its own padding does not move CSS position:fixed bars.
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setDomStorageEnabled(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isInternal(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!isInternal(request.getUrl())) return blocked();
                WebResourceResponse result = loader.shouldInterceptRequest(request.getUrl());
                return result == null ? blocked() : result;
            }
        });
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            android.widget.TextView error = new android.widget.TextView(this);
            error.setText("Android System WebView를 업데이트한 뒤 앱을 다시 열어 주세요.");
            error.setPadding(32, 64, 32, 32);
            setContentView(error);
            return;
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(web, "Native", Collections.singleton(ORIGIN),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                    if (!isMainFrame || !ORIGIN.equals(sourceOrigin.toString())) return;
                    String data = message.getData();
                    if (data == null || data.length() > MAX_TEXT_BYTES) return;
                    io.execute(() -> dispatch(data));
                });
        web.loadUrl(ORIGIN + "/assets/web/index.html");
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        // This is a visible, user-initiated launch, including after a force-stop or reboot.
        try { JobService.recover(this); } catch (Exception ignored) { /* Jobs remain persisted for Resume. */ }
    }

    private static boolean isInternal(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                && uri.getPort() == -1 && uri.getPath() != null && uri.getPath().startsWith("/assets/");
    }

    @Override public void onBackPressed() { handleBack(); }

    private void handleBack() {
        web.evaluateJavascript("window.handleNativeBack ? window.handleNativeBack() : false", result -> {
            if (!"true".equals(result)) finish();
        });
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0]));
    }

    private void dispatch(String text) {
        String id = "";
        try {
            JSONObject request = new JSONObject(text);
            id = request.getString("id");
            String method = request.getString("method");
            JSONObject params = request.optJSONObject("params");
            if (params == null) params = new JSONObject();
            Object result;
            switch (method) {
                case "status": result = new JSONObject().put("jobs", store.list()).put("hasKey", secrets.hasKey())
                        .put("settings", readSettings()).put("keyCheck", readConnectionCheck()).put("maxDurationMs", JobStore.MAX_DURATION_MS); break;
                case "getSettings": result = readSettings(); break;
                case "setSettings":
                    JSONObject options = checkedSettings(params.getJSONObject("settings"));
                    if (!getSharedPreferences("app_settings", MODE_PRIVATE).edit().putString("settings", options.toString()).remove("keyCheck").commit())
                        throw new IllegalStateException("설정을 저장할 수 없습니다.");
                    result = options; break;
                case "setKey":
                    requireIdleForKeyChange();
                    String key = params.getString("key").trim();
                    if (key.isEmpty() || key.length() > 1024 || key.contains("\n") || key.contains("\r"))
                        throw new IllegalArgumentException("유효한 API 키를 입력해 주세요.");
                    invalidateConnectionCheck();
                    secrets.setKey(key);
                    result = new JSONObject().put("hasKey", true); break;
                case "clearKey":
                    requireIdleForKeyChange();
                    invalidateConnectionCheck();
                    secrets.clearKey();
                    result = new JSONObject().put("hasKey", false); break;
                case "checkConnection":
                    checkConnection(id, checkedSettings(params.has("settings") ? params.getJSONObject("settings") : readSettings()));
                    return;
                case "openApiKeyPage":
                    runOnUiThread(() -> {
                        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://platform.openai.com/api-keys"))); }
                        catch (Exception error) { emitError("API 키 발급 페이지를 열 수 없습니다. 브라우저에서 platform.openai.com을 열어 주세요."); }
                    });
                    result = true; break;
                case "pickVideo":
                    if (!secrets.hasKey()) throw new IllegalArgumentException("먼저 API 키를 저장해 주세요.");
                    String replacementId = params.optString("replaceJobId", "");
                    if (!replacementId.isEmpty()) store.requirePrepared(replacementId);
                    JSONObject videoSettings = checkedSettings(params.has("settings") ? params.getJSONObject("settings") : readSettings());
                    startPicker(id, PICK_VIDEO, videoSettings, null, null, null, replacementId); return;
                case "updatePreparedSettings":
                    result = store.updatePreparedSettings(params.getString("jobId"), params.getJSONObject("settings")); break;
                case "cancelPrepared":
                    result = store.cancelPrepared(params.getString("jobId")); break;
                case "resume":
                    if (!secrets.hasKey()) throw new IllegalArgumentException("API 키를 다시 저장해 주세요.");
                    String resumeId = params.getString("jobId");
                    if (queueResume(store, resumeId, params.has("translationModel") ? params.getString("translationModel") : null)) {
                        String requestId = id;
                        runOnUiThread(() -> {
                            // A queued bridge request may outlive this Activity. Keep the durable
                            // queue for next launch instead of starting with a destroyed UI executor.
                            if (destroyed) return;
                            try { JobService.start(this, resumeId); reply(requestId, true, null); }
                            catch (Exception error) {
                                io.execute(() -> {
                                    synchronized (JobStore.WORKER_LOCK) {
                                        if (!JobService.isWorking(resumeId) && "queued".equals(store.get(resumeId).optString("status")))
                                            store.setStatus(resumeId, "paused", "백그라운드 작업을 시작하지 못했습니다. 앱에서 다시 이어해 주세요.");
                                    }
                                    reply(requestId, null, "백그라운드 작업을 시작하지 못했습니다. 앱에서 다시 이어해 주세요.");
                                });
                            }
                        });
                        return;
                    }
                    result = true; break;
                case "pause": JobService.pause(this, params.getString("jobId")); result = true; break;
                case "loadJob": result = jobPayload(params.getString("jobId")); break;
                case "saveCues":
                    store.saveEdited(params.getString("jobId"), checkedCues(params.getJSONArray("cues")));
                    result = true; break;
                case "importSubtitles": startPicker(id, IMPORT, null, null, null, null, null); return;
                case "importCues":
                    String importedId = store.importCues(params.optString("name", "자막"), checkedCues(params.getJSONArray("cues")));
                    result = jobPayload(importedId); break;
                case "export":
                    String body = params.getString("text");
                    if (body.getBytes(StandardCharsets.UTF_8).length > MAX_TEXT_BYTES) throw new IllegalArgumentException("내보내기 용량을 초과했습니다.");
                    startPicker(id, EXPORT, null, body, params.optString("name", "subtitles.srt"), params.optString("mime", "text/plain"), null); return;
                case "preview":
                    JSONObject job = store.get(params.getString("jobId"));
                    if (job.optString("uri").isEmpty()) throw new IllegalArgumentException("가져온 자막에는 연결된 영상이 없습니다.");
                    Intent preview = new Intent(this, PreviewActivity.class);
                    preview.putExtra("uri", job.getString("uri"));
                    preview.putExtra("jobId", job.getString("id"));
                    preview.putExtra("positionMs", Math.max(0, params.optLong("positionMs", 0)));
                    runOnUiThread(() -> startActivity(preview));
                    result = true; break;
                default: throw new IllegalArgumentException("지원하지 않는 요청입니다.");
            }
            reply(id, result, null);
        } catch (Exception exception) {
            // Never forward raw network/credential/provider exceptions across the bridge.
            reply(id, null, exception instanceof IllegalArgumentException ? exception.getMessage() : "요청을 처리하지 못했습니다. 작업 상태를 확인하고 다시 시도해 주세요.");
        }
    }

    private JSONObject jobPayload(String id) throws Exception {
        return new JSONObject().put("job", store.get(id)).put("cues", store.cues(id));
    }

    /** Persist start intent before posting to the UI thread, so key edits cannot race service startup. */
    static boolean queueResume(JobStore store, String id, String model) {
        synchronized (JobStore.WORKER_LOCK) {
            JSONObject job = store.get(id);
            String status = job.optString("status");
            if ("completed".equals(status)) return false;
            if (JobService.isWorking(id) || "queued".equals(status) || "running".equals(status))
                throw new IllegalArgumentException("작업이 시작되었거나 진행 중인 요청을 정리하고 있습니다. 잠시 기다려 주세요.");
            if (model != null) store.updateTranslationModel(id, model);
            store.setStatus(id, "queued", "");
            return true;
        }
    }

    private JSONObject readSettings() throws Exception {
        SharedPreferences preferences = getSharedPreferences("app_settings", MODE_PRIVATE);
        JSONObject saved = new JSONObject(preferences.getString("settings", "{}"));
        if (preferences.getInt("settingsVersion", 0) < 2) {
            saved = AppSettings.upgrade(saved);
            if (!preferences.edit().putString("settings", saved.toString()).putInt("settingsVersion", 2).remove("keyCheck").commit())
                throw new IllegalStateException("설정을 저장할 수 없습니다.");
        }
        return checkedSettings(saved);
    }

    private static JSONObject checkedSettings(JSONObject settings) throws Exception {
        return AppSettings.checked(settings);
    }

    private Object readConnectionCheck() {
        if (!secrets.hasKey()) return JSONObject.NULL;
        try { return new JSONObject(getSharedPreferences("app_settings", MODE_PRIVATE).getString("keyCheck", "")); }
        catch (Exception ignored) { return JSONObject.NULL; }
    }

    private void invalidateConnectionCheck() {
        OpenAiClient.Cancellation active = connectionCancellation;
        if (active != null) active.cancel();
        SharedPreferences preferences = getSharedPreferences("app_settings", MODE_PRIVATE);
        if (!preferences.edit().remove("keyCheck").putLong("keyRevision", preferences.getLong("keyRevision", 0) + 1).commit())
            throw new IllegalArgumentException("연결 확인 상태를 저장하지 못했습니다. 다시 시도해 주세요.");
    }

    private void requireIdleForKeyChange() {
        JSONArray jobs = store.list();
        for (int i = 0; i < jobs.length(); i++) {
            JSONObject job = jobs.optJSONObject(i);
            if (job != null && (JobService.isWorking(job.optString("id")) || "running".equals(job.optString("status")) || "queued".equals(job.optString("status"))))
                throw new IllegalArgumentException("API 키를 바꾸거나 삭제하려면 진행 중인 작업을 일시정지한 뒤 잠시 기다려 주세요.");
        }
    }

    private void checkConnection(String requestId, JSONObject settings) {
        if (!secrets.hasKey()) throw new IllegalArgumentException("먼저 API 키를 저장해 주세요.");
        if (connectionCancellation != null) throw new IllegalArgumentException("API 연결을 확인하고 있습니다. 잠시 기다려 주세요.");
        String apiKey = secrets.getKey();
        SharedPreferences preferences = getSharedPreferences("app_settings", MODE_PRIVATE);
        long revision = preferences.getLong("keyRevision", 0);
        String persistedSettings = preferences.getString("settings", "{}");
        OpenAiClient.Cancellation token = new OpenAiClient.Cancellation();
        connectionCancellation = token;
        connectionIo.execute(() -> {
            JSONObject checked = null;
            String failure = null;
            try { checked = new OpenAiClient(apiKey, token).checkConnection(settings); }
            catch (Exception error) {
                failure = token.isCancelled() ? "연결 확인이 취소되었습니다. 다시 확인해 주세요." : connectionError(error);
            }
            final JSONObject result = checked;
            final String errorMessage = failure;
            if (destroyed) return;
            try { io.execute(() -> {
                if (connectionCancellation == token) connectionCancellation = null;
                if (destroyed) return;
                boolean unchanged = revision == preferences.getLong("keyRevision", 0)
                        && persistedSettings.equals(preferences.getString("settings", "{}"));
                if (!unchanged || token.isCancelled()) { reply(requestId, null, "API 키 또는 설정이 바뀌었습니다. 연결을 다시 확인해 주세요."); return; }
                if (result != null) {
                    if (!preferences.edit().putString("keyCheck", result.toString()).commit()) {
                        reply(requestId, null, "연결 확인 결과를 저장하지 못했습니다."); return;
                    }
                } else preferences.edit().remove("keyCheck").apply();
                reply(requestId, result, errorMessage);
            }); } catch (java.util.concurrent.RejectedExecutionException ignored) { }
        });
    }

    private static String connectionError(Exception error) {
        switch (OpenAiClient.failureCode(error)) {
            case "authentication": return "API 키가 유효하지 않습니다. 키를 다시 입력해 주세요.";
            case "permission": return "이 API 키에 모델 접근 권한이 없습니다. 프로젝트 권한을 확인해 주세요.";
            case "model_unavailable": return "선택한 모델을 사용할 수 없습니다. 모델 이름과 계정 접근 권한을 확인해 주세요.";
            case "quota": return "API 사용 한도 또는 결제 상태를 확인해 주세요.";
            case "rate_limit": return "API 요청이 많습니다. 잠시 뒤 연결을 다시 확인해 주세요.";
            case "network": return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
            case "server": return "OpenAI 서버가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.";
            default: return "API 연결을 확인하지 못했습니다. 키와 모델 설정을 확인해 주세요.";
        }
    }

    static JSONArray checkedCues(JSONArray cues) throws Exception {
        if (cues.length() > 50000) throw new IllegalArgumentException("자막은 최대 50,000개까지 저장할 수 있습니다.");
        JSONArray checked = new JSONArray();
        for (int i = 0; i < cues.length(); i++) {
            JSONObject cue = cues.getJSONObject(i);
            double start = cue.getDouble("start"), end = cue.getDouble("end");
            if (!Double.isFinite(start) || !Double.isFinite(end) || start < 0 || end <= start)
                throw new IllegalArgumentException("자막 시작·종료 시간을 확인해 주세요.");
            String original = cue.optString("original", ""), translated = cue.optString("translated", "");
            if (original.length() > 10000 || translated.length() > 10000) throw new IllegalArgumentException("자막 문장이 너무 깁니다.");
            checked.put(new JSONObject().put("id", i + 1).put("start", start).put("end", end)
                    .put("original", original).put("translated", translated).put("status", cue.optString("status", "success")));
        }
        return checked;
    }

    private void startPicker(String id, int type, JSONObject settings, String exportText, String name, String mime, String replaceJobId) {
        runOnUiThread(() -> {
            if (pendingId != null) { reply(id, null, "열려 있는 파일 선택을 먼저 완료해 주세요."); return; }
            pendingId = id;
            Intent intent;
            if (type == EXPORT) {
                intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(mime).putExtra(Intent.EXTRA_TITLE, name);
            } else {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*");
                if (type == PICK_VIDEO) intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"video/*", "audio/*"});
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            }
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            io.execute(() -> {
                try {
                    documents.save(new JSONObject().put("id", id).put("type", type)
                            .put("settings", checkedSettings(settings == null ? new JSONObject() : settings))
                            .put("replaceJobId", replaceJobId == null ? JSONObject.NULL : replaceJobId)
                            .put("text", exportText == null ? JSONObject.NULL : exportText));
                    runOnUiThread(() -> {
                        if (destroyed) return;
                        try { startActivityForResult(intent, type); }
                        catch (Exception exception) { pendingId = null; reply(id, null, "파일 선택기를 열 수 없습니다."); }
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> pendingId = null);
                    reply(id, null, "파일 선택 정보를 저장할 수 없습니다. 기기 저장 공간을 확인해 주세요.");
                }
            });
        });
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_VIDEO && requestCode != IMPORT && requestCode != EXPORT) return;
        pendingId = null;
        Uri uri = data == null ? null : data.getData();
        int grantFlags = data == null ? 0 : data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
        if (uri != null && requestCode == PICK_VIDEO && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 104);
        io.execute(() -> {
            String id = "";
            try {
                JSONObject pending = documents.read();
                id = pending.getString("id");
                if (pending.getInt("type") != requestCode) throw new IllegalArgumentException("파일 선택 결과가 일치하지 않습니다. 다시 선택해 주세요.");
                if (resultCode != RESULT_OK || uri == null) { documents.clear(); reply(id, JSONObject.NULL, null); return; }
                JSONObject settings = pending.getJSONObject("settings");
                String exportText = pending.isNull("text") ? null : pending.getString("text");
                if (requestCode == PICK_VIDEO) {
                    if ((grantFlags & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0) throw new IllegalArgumentException("이 저장소는 읽기 권한을 제공하지 않습니다. 기기에 저장된 파일을 선택해 주세요.");
                    getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    MediaChunks.Info info = new MediaChunks(this).inspect(uri);
                    if (!info.hasAudio || info.durationMs <= 0) throw new IllegalArgumentException("읽을 수 있는 음성 트랙이 있는 영상을 선택해 주세요.");
                    if (info.durationMs > JobStore.MAX_DURATION_MS) throw new IllegalArgumentException("최대 3시간(180분) 영상까지 지원합니다. 더 짧은 영상을 선택해 주세요.");
                    if (getCacheDir().getUsableSpace() < 64L * 1024 * 1024)
                        throw new IllegalArgumentException("오디오 추출과 작업 저장을 위해 기기 저장 공간을 64MB 이상 확보해 주세요.");
                    String replaceJobId = pending.optString("replaceJobId", "");
                    String jobId = replaceJobId.isEmpty() ? store.createPrepared(uri.toString(), info.displayName, info.durationMs, settings)
                            : store.replacePrepared(replaceJobId, uri.toString(), info.displayName, info.durationMs, settings).getString("id");
                    reply(id, jobPayload(jobId), null);
                    emitNotice("영상이 준비되었습니다. 작업 정보를 확인한 뒤 생성 시작을 눌러 주세요.");
                } else if (requestCode == IMPORT) {
                    try (InputStream stream = getContentResolver().openInputStream(uri)) {
                        if (stream == null) throw new IllegalArgumentException("파일을 읽을 수 없습니다.");
                        reply(id, new JSONObject().put("name", displayName(uri)).put("text", readText(stream)), null);
                    }
                } else {
                    try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) {
                        if (stream == null || exportText == null) throw new IllegalArgumentException("파일을 저장할 수 없습니다.");
                        stream.write(exportText.getBytes(StandardCharsets.UTF_8));
                        stream.flush();
                    }
                    reply(id, true, null);
                    emitNotice("자막 파일을 저장했습니다.");
                }
                documents.clear();
            } catch (Exception error) {
                String safeMessage = error instanceof IllegalArgumentException ? error.getMessage() : "파일 접근에 실패했습니다. 기기에 저장된 파일을 다시 선택해 주세요.";
                reply(id, null, safeMessage);
                emitError(safeMessage);
            }
        });
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) { }
        return "subtitles.srt";
    }

    static String readText(InputStream stream) throws Exception {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            if (result.size() + read > MAX_TEXT_BYTES) throw new IllegalArgumentException("자막 파일은 8MB 이하로 선택해 주세요.");
            result.write(buffer, 0, read);
        }
        return result.toString(StandardCharsets.UTF_8.name());
    }

    private void reply(String id, Object result, String error) {
        try {
            JSONObject response = new JSONObject().put("id", id).put("result", result == null ? JSONObject.NULL : result)
                    .put("error", error == null ? JSONObject.NULL : error);
            runOnUiThread(() -> { if (!destroyed) web.evaluateJavascript("window.nativeResult && window.nativeResult(" + response + ")", null); });
        } catch (Exception ignored) { }
    }

    private void emitError(String message) {
        emit("error", message);
    }

    private void emitNotice(String message) { emit("notice", message); }

    private void emit(String type, String message) {
        try {
            JSONObject event = new JSONObject().put("type", type).put("message", message);
            runOnUiThread(() -> { if (!destroyed) web.evaluateJavascript("window.nativeEvent && window.nativeEvent(" + event + ")", null); });
        } catch (Exception ignored) { }
    }

    @Override protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        OpenAiClient.Cancellation active = connectionCancellation;
        if (active != null) active.cancel();
        connectionIo.shutdownNow();
        io.execute(() -> store.close());
        io.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
