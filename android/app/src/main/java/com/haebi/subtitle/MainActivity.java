package com.haebi.subtitle;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
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
    private WebView web;
    private JobStore store;
    private SecretStore secrets;
    private String pendingId;
    private PendingDocument documents;
    private boolean destroyed;

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
                case "status": result = new JSONObject().put("jobs", store.list()).put("hasKey", secrets.hasKey()).put("settings", readSettings()); break;
                case "getSettings": result = readSettings(); break;
                case "setSettings":
                    JSONObject options = checkedSettings(params.getJSONObject("settings"));
                    if (!getSharedPreferences("app_settings", MODE_PRIVATE).edit().putString("settings", options.toString()).commit())
                        throw new IllegalStateException("설정을 저장할 수 없습니다.");
                    result = options; break;
                case "setKey":
                    String key = params.getString("key").trim();
                    if (key.isEmpty() || key.length() > 1024 || key.contains("\n") || key.contains("\r"))
                        throw new IllegalArgumentException("유효한 API 키를 입력해 주세요.");
                    secrets.setKey(key);
                    result = new JSONObject().put("hasKey", true); break;
                case "pickVideo":
                    if (!secrets.hasKey()) throw new IllegalArgumentException("먼저 API 키를 저장해 주세요.");
                    startPicker(id, PICK_VIDEO, params.optJSONObject("settings"), null, null, null); return;
                case "resume":
                    if (!secrets.hasKey()) throw new IllegalArgumentException("API 키를 다시 저장해 주세요.");
                    String resumeId = params.getString("jobId");
                    if (!"completed".equals(store.get(resumeId).getString("status"))) {
                        String requestId = id;
                        runOnUiThread(() -> {
                            try { JobService.start(this, resumeId); reply(requestId, true, null); }
                            catch (Exception error) { reply(requestId, null, "백그라운드 작업을 시작하지 못했습니다. 앱에서 다시 이어해 주세요."); }
                        });
                        return;
                    }
                    result = true; break;
                case "pause": JobService.pause(this, params.getString("jobId")); result = true; break;
                case "loadJob": result = jobPayload(params.getString("jobId")); break;
                case "saveCues":
                    store.saveEdited(params.getString("jobId"), checkedCues(params.getJSONArray("cues")));
                    result = true; break;
                case "importSubtitles": startPicker(id, IMPORT, null, null, null, null); return;
                case "importCues":
                    String importedId = store.importCues(params.optString("name", "자막"), checkedCues(params.getJSONArray("cues")));
                    result = jobPayload(importedId); break;
                case "export":
                    String body = params.getString("text");
                    if (body.getBytes(StandardCharsets.UTF_8).length > MAX_TEXT_BYTES) throw new IllegalArgumentException("내보내기 용량을 초과했습니다.");
                    startPicker(id, EXPORT, null, body, params.optString("name", "subtitles.srt"), params.optString("mime", "text/plain")); return;
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

    private JSONObject readSettings() throws Exception {
        return checkedSettings(new JSONObject(getSharedPreferences("app_settings", MODE_PRIVATE).getString("settings", "{}")));
    }

    private static JSONObject checkedSettings(JSONObject settings) throws Exception {
        JSONObject result = new JSONObject();
        String source = settings.optString("sourceLanguage", "auto");
        String target = settings.optString("targetLanguage", "ko");
        String model = settings.optString("translationModel", "gpt-5.5").trim();
        if (!source.matches("auto|[a-z]{2,3}") || !target.matches("[a-z]{2,3}") || !model.matches("[A-Za-z0-9_.:-]{1,100}"))
            throw new IllegalArgumentException("언어와 번역 모델 설정을 확인해 주세요.");
        return result.put("sourceLanguage", source).put("targetLanguage", target).put("translationModel", model)
                .put("translate", settings.optBoolean("translate", true));
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

    private void startPicker(String id, int type, JSONObject settings, String exportText, String name, String mime) {
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
                    String jobId = store.create(uri.toString(), info.displayName, info.durationMs, settings);
                    runOnUiThread(() -> {
                        try { JobService.start(this, jobId); }
                        catch (Exception error) { store.setStatus(jobId, "paused", "앱에서 이어하기를 눌러 주세요."); }
                    });
                    reply(id, jobPayload(jobId), null);
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
                reply(id, null, error instanceof IllegalArgumentException ? error.getMessage() : "파일 접근에 실패했습니다. 기기에 저장된 파일을 다시 선택해 주세요.");
                emitError("파일 선택 또는 저장을 마치지 못했습니다. 앱에서 다시 시도해 주세요.");
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
        io.execute(() -> store.close());
        io.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
