package com.haebi.subtitle;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.webkit.WebView;
import android.view.View;
import android.view.ViewGroup;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Captures real Android WebView screens without audio, API charges or user credentials. */
@RunWith(AndroidJUnit4.class)
public final class EditorialFullWebViewDeviceTest {
    @Test public void allFiveScreensHonorSystemThemeAndFontScale() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        OnDeviceCueDraft fixture = new OnDeviceCueDraft();
        fixture.add("Editorial Studio 5-A UI 검증 문장", 1000, 3000);
        String jobId;
        try (JobStore jobs = new JobStore(context)) {
            jobId = jobs.importCues("Editorial-5A-QA.srt", fixture.snapshot());
        }
        try {
            try (ActivityScenario<MainActivity> scene = ActivityScenario.launch(MainActivity.class)) {
                AtomicReference<WebView> captured = new AtomicReference<>();
                AtomicReference<String> theme = new AtomicReference<>();
                scene.onActivity(activity -> {
                    captured.set(findWebView(activity.findViewById(android.R.id.content)));
                    theme.set(NativeDesignSystem.isDark(activity) ? "dark" : "light");
                    assertNotNull(captured.get());
                    int expectedZoom = Math.round(activity.getResources().getConfiguration().fontScale * 100);
                    assertTrue("System text zoom was not applied to WebView",
                            Math.abs(expectedZoom - captured.get().getSettings().getTextZoom()) <= 1);
                });
                WebView web = captured.get();
                assertNotNull(web);
                waitFor(web, "Boolean(document.querySelector('#navJobs') && document.querySelector('#appMessage'))");
                waitFor(web, "Boolean(document.querySelector('#jobList [data-job-id]'))");
                Thread.sleep(600);
                String label = theme.get() + "-font" +
                        Math.round(context.getResources().getConfiguration().fontScale * 100);
                show(web, "navVideo", "videoView");
                assertViewport(web, "videoView");
                screenshot(context, "video-" + label);

                show(web, "navJobs", "jobsView");
                waitFor(web, "Array.from(document.querySelectorAll('#jobList [data-job-id]')).some(" +
                        "e => e.dataset.jobId === " + JSONObject.quote(jobId) + ")");
                assertViewport(web, "jobsView");
                screenshot(context, "jobs-" + label);

                show(web, "navResults", "resultsView");
                waitFor(web, "Array.from(document.querySelector('#resultJobSelector').options).some(" +
                        "o => o.value === " + JSONObject.quote(jobId) + ")");
                evaluate(web, "(function(){ const select=document.getElementById('resultJobSelector');" +
                        " select.value=" + JSONObject.quote(jobId) + ";" +
                        " select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
                waitFor(web, "Boolean(document.querySelector('#resultContent') && !document.getElementById('resultContent').hidden)");
                assertViewport(web, "resultsView");
                screenshot(context, "results-" + label);

                evaluate(web, "(function(){document.getElementById('editResult').click();return true;})()");
                waitFor(web, "Boolean(document.querySelector('#editorView') && !document.getElementById('editorView').hidden && document.querySelector('.cue'))");
                assertViewport(web, "editorView");
                screenshot(context, "editor-" + label);

                show(web, "navSettings", "settingsView");
                assertViewport(web, "settingsView");
                screenshot(context, "settings-" + label);
                evaluate(web, "(function(){document.getElementById('apiSettings').open=true;return true;})()");
                waitFor(web, "document.getElementById('apiSettings').open");
                assertViewport(web, "settingsView");
                screenshot(context, "settings-expanded-" + label);
            }
        } finally {
            try (JobStore jobs = new JobStore(context)) {
                jobs.deleteCompleted(jobId);
            }
        }
    }

    private static void show(WebView web, String navId, String section) throws Exception {
        evaluate(web, "(function(){document.getElementById(" + JSONObject.quote(navId) +
                ").click();window.scrollTo(0,0);return true;})()");
        waitFor(web, "Boolean(document.getElementById(" + JSONObject.quote(section) +
                ") && !document.getElementById(" + JSONObject.quote(section) +
                ").hidden && document.querySelector('.app-nav [aria-current=\\\"page\\\"]') && " +
                "document.querySelector('.app-nav [aria-current=\\\"page\\\"]').id === " + JSONObject.quote(navId) + ")");
    }

    private static void assertViewport(WebView web, String section) throws Exception {
        String js = "(function(){ const root=document.documentElement;" +
                " const nav=document.querySelector('.app-nav');" +
                " const active=document.querySelector('.app-nav [aria-current=\"page\"]');" +
                " const visible=document.getElementById(" + JSONObject.quote(section) + ");" +
                " const navBox=nav.getBoundingClientRect();" +
                " return !!active && !!visible && !visible.hidden && navBox.bottom>0 && navBox.top<innerHeight" +
                " && root.scrollWidth<=innerWidth+1;})()";
        assertEquals("No horizontal overflow or hidden bottom menu expected in " + section,
                "true", evaluate(web, js));
    }

    private static void waitFor(WebView web, String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 18000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate(web, expression))) return;
            Thread.sleep(250);
        }
        fail("Android WebView did not reach expected state: " + expression);
    }

    private static String evaluate(WebView web, String javascript) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> output = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                web.evaluateJavascript(javascript, result -> {
                    output.set(result);
                    done.countDown();
                }));
        assertTrue("Timed out waiting for WebView JavaScript", done.await(8, TimeUnit.SECONDS));
        return output.get();
    }

    private static WebView findWebView(View root) {
        if (root instanceof WebView) return (WebView) root;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i=0; i<group.getChildCount(); i++) {
                WebView found=findWebView(group.getChildAt(i));
                if (found!=null) return found;
            }
        }
        return null;
    }

    private static void screenshot(Context context, String filename) throws Exception {
        Thread.sleep(750);
        Bitmap bitmap=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(filename, bitmap);
        File folder=context.getExternalFilesDir("editorial-5a-webview");
        assertNotNull(folder);
        assertTrue(folder.exists()||folder.mkdirs());
        File file=new File(folder,filename+".png");
        try(FileOutputStream output=new FileOutputStream(file)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,output));
        } finally { bitmap.recycle(); }
        assertTrue(file.exists()&&file.length()>0);
    }
}
