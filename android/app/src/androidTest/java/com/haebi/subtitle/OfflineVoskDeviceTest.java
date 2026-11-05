package com.haebi.subtitle;

import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** No network, API key, or downloaded AI model is required to verify offline screen entry. */
@RunWith(AndroidJUnit4.class)
public class OfflineVoskDeviceTest {
    @Test public void offlineModelScreenStartsWithoutInstallingOrCallingCloudAI() {
        try (ActivityScenario<OfflineVoskActivity> screen = ActivityScenario.launch(OfflineVoskActivity.class)) {
            screen.onActivity(activity -> {
                View root = activity.findViewById(android.R.id.content);
                assertTrue(hasText(root, "독립 로컬 AI 자막"));
                assertTrue(hasText(root, "선택 모델 다운로드·설치"));
                assertTrue(hasText(root, "영상·오디오 파일 선택"));
                assertTrue(hasText(root, "오프라인 인식은 최대 60분"));
                Button start = findButton(root, "오프라인 음성 인식 시작");
                assertNotNull(start);
                assertFalse(start.isEnabled());
            });
        }
    }

    @Test public void importedOfflineCaptionsCanKeepTheirOriginalMediaUri() throws Exception {
        try (JobStore store = new JobStore(androidx.test.core.app.ApplicationProvider.getApplicationContext())) {
            org.json.JSONArray cues = new org.json.JSONArray()
                    .put(new org.json.JSONObject().put("start", 0.5).put("end", 1.7)
                            .put("original", "오프라인 영상 자막").put("translated", "")
                            .put("timingAccuracy", "word"));
            String id = store.importCues("선택한 영상", cues, "content://fixture/offline-file");
            try {
                assertEquals("completed", store.get(id).getString("status"));
                assertEquals("content://fixture/offline-file", store.get(id).getString("uri"));
                assertEquals("오프라인 영상 자막", store.cues(id).getJSONObject(0).getString("original"));
            } finally { store.deleteCompleted(id); }
        }
    }

    @Test public void importedCaptionsRejectNonDocumentFileSchemes() throws Exception {
        try (JobStore store = new JobStore(androidx.test.core.app.ApplicationProvider.getApplicationContext())) {
            org.json.JSONArray cues = new org.json.JSONArray()
                    .put(new org.json.JSONObject().put("start", 0).put("end", 1)
                            .put("original", "sample").put("translated", ""));
            assertThrows(IllegalArgumentException.class,
                    () -> store.importCues("not allowed", cues, "file:///sdcard/private.mp4"));
        }
    }

    private static boolean hasText(View view, String needle) {
        if (view instanceof TextView && String.valueOf(((TextView) view).getText()).contains(needle)) return true;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) if (hasText(group.getChildAt(i), needle)) return true;
        }
        return false;
    }

    private static Button findButton(View view, String needle) {
        if (view instanceof Button && String.valueOf(((Button) view).getText()).contains(needle)) return (Button) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                Button found = findButton(group.getChildAt(i), needle);
                if (found != null) return found;
            }
        }
        return null;
    }
}