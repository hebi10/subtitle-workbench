package com.haebi.subtitle;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;

/**
 * UI-09-A: real Android 15 WebView screenshots from deterministic, disposable
 * on-device QA fixtures. Only the "running" and "error" statuses are seeded
 * rather than produced by real audio transcription; never claim API quality.
 */
@RunWith(AndroidJUnit4.class)
public final class EditorialUi09aStateMatrixDeviceTest {
    private static final String PREFIX = "UI09A-";
    private static final String VIDEO = "UI09A-영상연결-다중자막-27개.mp4";
    private static final String SRT = "UI09A-SRT만-영상없음-15개.srt";

    @Test public void captureMediaLinkedAndStateMatrixWithoutPaidApi() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        String label = (NativeDesignSystem.isDark(context) ? "dark" : "light") + "-font"
                + Math.round(context.getResources().getConfiguration().fontScale * 100);
        List<String> inserted = new ArrayList<>();
        Uri media = null;
        try {
            media = createTestVideo(context);
            try (ActivityScenario<MainActivity> scene = ActivityScenario.launch(MainActivity.class)) {
                AtomicReference<WebView> reference = new AtomicReference<>();
                scene.onActivity(activity ->
                        reference.set(findWebView(activity.findViewById(android.R.id.content))));
                WebView web = reference.get();
                assertNotNull(web);
                waitFor(web, "Boolean(document.getElementById('navVideo') && document.getElementById('jobsSummary'))");
                waitFor(web, "Boolean(document.getElementById('jobsSummary').textContent.includes('전체 0개'))");

                show(web, "navVideo", "videoView");
                capture(context, "video-empty-" + label, web);
                show(web, "navJobs", "jobsView");
                capture(context, "jobs-empty-" + label, web);

                String attached;
                String imported;
                String prepared;
                String paused;
                String failed;
                try (JobStore store = new JobStore(context)) {
                    attached = store.importCues(VIDEO, cues(27), media.toString());
                    imported = store.importCues(SRT, cues(15));
                    prepared = store.createPrepared("content://ui09a/no-user-media/prepare",
                            PREFIX + "준비-모델선택-작업.mp4", 42_000, new JSONObject().put("translate", false));
                    paused = store.createPrepared("content://ui09a/no-user-media/paused",
                            PREFIX + "일시정지-장시간_촬영_파일명이_길어지는_상황_화면_잘림_검증_0123456789.mp4",
                            42_000, new JSONObject().put("translate", false));
                    store.setStatus(paused, "paused", "");
                    failed = store.createPrepared("content://ui09a/no-user-media/failed",
                            PREFIX + "오류-네트워크-재시도.mp4", 42_000,
                            new JSONObject().put("translate", false));
                    store.setStatus(failed, "error", "QA 상태 재현: 네트워크 연결 실패 · 실제 API 요청은 하지 않았습니다.");
                    for (String id : new String[]{attached, imported, prepared, paused, failed}) inserted.add(id);
                    assertEquals("completed", store.get(attached).getString("status"));
                    assertEquals(media.toString(), store.get(attached).getString("uri"));
                    assertEquals(27, store.cues(attached).length());
                    assertEquals("", store.get(imported).getString("uri"));
                }
                refresh(web);
                waitFor(web, "document.getElementById('jobsSummary').textContent.includes('전체 5개')");
                show(web, "navJobs", "jobsView");
                assertTrue(evaluate(web, "document.getElementById('jobsSummary').textContent.includes('준비 1')").equals("true"));
                assertTrue(evaluate(web, "document.getElementById('jobsSummary').textContent.includes('오류 1')").equals("true"));
                capture(context, "jobs-state-first-page-" + label, web);
                evaluate(web, "document.getElementById('nextJobs').click();true");
                waitFor(web, "document.getElementById('jobsPageInfo').textContent.includes('2 / 2')");
                capture(context, "jobs-state-second-page-" + label, web);
                evaluate(web, "document.getElementById('prevJobs').click();true");

                show(web, "navResults", "resultsView");
                selectResult(web, attached, VIDEO);
                assertEquals("false", evaluate(web, "document.getElementById('resultPreview').disabled"));
                capture(context, "results-with-real-video-" + label, web);
                evaluate(web, "document.getElementById('editResult').click();true");
                waitFor(web, "Boolean(!document.getElementById('editorView').hidden && document.querySelector('#cueList .cue') && document.getElementById('editorCuePosition').textContent.includes('27개'))");
                assertEquals("false", evaluate(web, "document.getElementById('previewSelectedCue').disabled"));
                capture(context, "editor-with-27-cues-" + label, web);
                evaluate(web, "document.getElementById('nextPage').click();true");
                waitFor(web, "Boolean(document.querySelector('#cueList [data-index=\"12\"]'))");
                capture(context, "editor-cue-second-page-" + label, web);

                show(web, "navResults", "resultsView");
                selectResult(web, imported, SRT);
                assertEquals("true", evaluate(web, "document.getElementById('resultPreview').disabled"));
                capture(context, "results-without-video-" + label, web);
                evaluate(web, "document.getElementById('editResult').click();true");
                waitFor(web, "Boolean(!document.getElementById('editorView').hidden && document.querySelector('#cueList .cue'))");
                assertEquals("true", evaluate(web, "document.getElementById('previewSelectedCue').disabled"));
                capture(context, "editor-without-video-" + label, web);

                show(web, "navSettings", "settingsView");
                evaluate(web, "document.getElementById('apiSettings').open=false;true");
                capture(context, "settings-collapsed-" + label, web);
                evaluate(web, "document.getElementById('apiSettings').open=true;true");
                capture(context, "settings-expanded-" + label, web);

                // Seed only a UI status; no service starts, no network or audio requests.
                try (JobStore store = new JobStore(context)) {
                    store.setStatus(paused, "running", "");
                }
                try {
                    refresh(web);
                    waitFor(web, "document.getElementById('jobsSummary').textContent.includes('진행 1')");
                    show(web, "navJobs", "jobsView");
                    waitFor(web, "Boolean(document.querySelector('[data-status=\"running\"]'))");
                    capture(context, "jobs-seeded-running-status-no-worker-" + label, web);
                } finally {
                    try (JobStore store = new JobStore(context)) {
                        store.setStatus(paused, "paused", "");
                    }
                }
            }
        } finally {
            // Only remove our unique QA records and MediaStore video. Do not alter user data.
            try (JobStore store = new JobStore(context)) {
                for (String id : inserted) {
                    String[] args = {id};
                    store.getWritableDatabase().delete("batches", "job_id=?", args);
                    store.getWritableDatabase().delete("payloads", "job_id=?", args);
                    store.getWritableDatabase().delete("chunks", "job_id=?", args);
                    store.getWritableDatabase().delete("jobs", "id=?", args);
                }
            }
            if (media != null) context.getContentResolver().delete(media, null, null);
        }
    }

    private static JSONArray cues(int count) throws Exception {
        JSONArray output = new JSONArray();
        for (int i = 0; i < count; i++) {
            double begin = 0.5 + i * 1.3;
            JSONObject cue = new JSONObject()
                    .put("start", begin)
                    .put("end", begin + 1.05)
                    .put("original", i == 17
                            ? "UI09A 실제 Android 긴 자막 원문 · 다양한 문장 길이에서도 줄바꿈과 스크롤 및 입력 영역이 정상인지 확인합니다."
                            : "UI09A 기기 QA 원문 자막 " + (i + 1))
                    .put("translated", "UI09A 번역 표시 검증 문장 " + (i + 1))
                    .put("speaker", i % 2 == 0 ? "A" : "B")
                    .put("status", "success");
            output.put(cue);
        }
        return output;
    }

    private static Uri createTestVideo(Context context) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, "ui09a-test-video-" + System.nanoTime() + ".mp4");
        values.put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/SubtitleUi09a");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri result = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
        assertNotNull("QA video must be written as a real content:// media item", result);
        try {
            try (InputStream source = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("ui09a-video.mp4");
                 OutputStream destination = resolver.openOutputStream(result)) {
                assertNotNull(destination);
                byte[] buffer = new byte[8192];
                int read;
                while ((read = source.read(buffer)) > 0) destination.write(buffer, 0, read);
            }
            ContentValues published = new ContentValues();
            published.put(MediaStore.MediaColumns.IS_PENDING, 0);
            assertEquals(1, resolver.update(result, published, null, null));
            try (MediaMetadataRetriever probe = new MediaMetadataRetriever()) {
                probe.setDataSource(context, result);
                String duration = probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                assertNotNull("Real playable fixture duration", duration);
                assertTrue("Video must cover 27 timed cues", Long.parseLong(duration) >= 36000);
            }
            return result;
        } catch (Exception error) {
            resolver.delete(result, null, null);
            throw error;
        }
    }

    private static void selectResult(WebView web, String id, String name) throws Exception {
        waitFor(web, "Array.from(document.querySelector('#resultJobSelector').options).some(o=>o.value===" + JSONObject.quote(id) + ")");
        evaluate(web, "(function(){const el=document.getElementById('resultJobSelector');" +
                "el.value=" + JSONObject.quote(id) + ";el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
        waitFor(web, "Boolean(!document.getElementById('resultContent').hidden && document.getElementById('resultName').textContent===" + JSONObject.quote(name) + ")");
    }

    private static void show(WebView web, String navId, String viewId) throws Exception {
        evaluate(web, "document.getElementById(" + JSONObject.quote(navId) + ").click();true");
        waitFor(web, "Boolean(!document.getElementById(" + JSONObject.quote(viewId) +
                ").hidden && document.querySelector('.app-nav [aria-current=\"page\"]')?.id===" +
                JSONObject.quote(navId) + ")");
        evaluate(web, "window.scrollTo(0,0);true");
    }

    private static void refresh(WebView web) throws Exception {
        evaluate(web, "window.nativeEvent({type:'status'});true");
    }

    private static void capture(Context context, String name, WebView web) throws Exception {
        assertEquals("No overflow and accessible navigation",
                "true", evaluate(web, "(function(){const nav=document.querySelector('.app-nav');" +
                        "return document.documentElement.scrollWidth<=innerWidth+1 && " +
                        "[...nav.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=48);})()"));
        Thread.sleep(550);
        Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull("Actual Android screenshot " + name, bitmap);
        File folder = context.getExternalFilesDir("ui09a-state-matrix");
        assertNotNull(folder);
        assertTrue(folder.exists() || folder.mkdirs());
        File file = new File(folder, name + ".png");
        try (FileOutputStream out = new FileOutputStream(file)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out));
        } finally {
            bitmap.recycle();
        }
        assertTrue(file.exists() && file.length() > 1024);
    }

    private static WebView findWebView(View root) {
        if (root instanceof WebView) return (WebView) root;
        if (root instanceof ViewGroup) {
            ViewGroup children = (ViewGroup) root;
            for (int i = 0; i < children.getChildCount(); i++) {
                WebView child = findWebView(children.getChildAt(i));
                if (child != null) return child;
            }
        }
        return null;
    }

    private static void waitFor(WebView web, String expression) throws Exception {
        long until = System.currentTimeMillis() + 20000;
        while (System.currentTimeMillis() < until) {
            if ("true".equals(evaluate(web, expression))) return;
            Thread.sleep(250);
        }
        fail("UI09A Android UI did not reach expected state: " + expression);
    }

    private static String evaluate(WebView web, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                web.evaluateJavascript(script, text -> { result.set(text); latch.countDown(); }));
        assertTrue("WebView JavaScript did not respond", latch.await(9, TimeUnit.SECONDS));
        return result.get();
    }
}
