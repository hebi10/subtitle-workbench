package com.haebi.subtitle;

import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** No audio input and no paid network API are used in instrumentation. */
@RunWith(AndroidJUnit4.class)
public class MicrophoneActivityDeviceTest {
    @Test public void onDeviceScreenStartsWithoutAsrEngineOrMicPermission() {
        try (ActivityScenario<OnDeviceRecognitionActivity> screen =
                     ActivityScenario.launch(OnDeviceRecognitionActivity.class)) {
            screen.onActivity(activity -> {
                View root = activity.findViewById(android.R.id.content);
                assertNotNull(root);
                assertTrue(containsText(root, "온디바이스 마이크 자막"));
                assertTrue(containsText(root, "인식 언어"));
            });
        }
    }

    @Test public void cloudScreenOpensWithoutStartingPaidRecognition() {
        try (ActivityScenario<CloudLiveRecognitionActivity> screen =
                     ActivityScenario.launch(CloudLiveRecognitionActivity.class)) {
            screen.onActivity(activity -> {
                View root = activity.findViewById(android.R.id.content);
                assertNotNull(root);
                assertTrue(containsText(root, "GPT 실시간 마이크 자막"));
                assertTrue(containsText(root, "API 이용 요금"));
            });
        }
    }

    @Test public void capturedCaptionDraftPersistsAndRemovesOnlyItsOwnSqliteRows() throws Exception {
        OnDeviceCueDraft draft = new OnDeviceCueDraft();
        draft.add("에뮬레이터 자막", 100, 2000);
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            String id = store.importCues("에뮬레이터 시험", draft.snapshot());
            assertEquals("completed", store.get(id).getString("status"));
            assertEquals("에뮬레이터 자막", store.cues(id).getJSONObject(0).getString("original"));
            assertEquals("estimated", store.cues(id).getJSONObject(0).getString("timingAccuracy"));
            store.deleteCompleted(id);
            assertThrows(IllegalArgumentException.class, () -> store.get(id));
        }
    }

    private static boolean containsText(View view, String match) {
        if (view instanceof TextView && String.valueOf(((TextView) view).getText()).contains(match)) return true;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                if (containsText(group.getChildAt(index), match)) return true;
            }
        }
        return false;
    }
}