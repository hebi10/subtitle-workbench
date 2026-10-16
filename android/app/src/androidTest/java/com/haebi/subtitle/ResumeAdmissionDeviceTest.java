package com.haebi.subtitle;

import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ResumeAdmissionDeviceTest {
    @Test public void resumeReservesQueueBeforeServiceStartsAndRejectsDuplicate() throws Exception {
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            String id = store.createPrepared("content://test/resume-admission", "resume", 1000,
                    new JSONObject().put("translationModel", "gpt-5.5"));
            try {
                assertTrue(MainActivity.queueResume(store, id, "gpt-6-luna"));
                assertEquals("queued", store.get(id).getString("status"));
                assertEquals("gpt-6-luna", store.get(id).getJSONObject("settings").getString("translationModel"));
                assertThrows(IllegalArgumentException.class, () -> MainActivity.queueResume(store, id, null));
            } finally { store.pauseRunnable(id, "테스트 완료"); }
        }
    }

    @Test public void completedWorkCannotBeQueuedOrHaveItsModelChanged() throws Exception {
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            String id = store.importCues("completed", new JSONArray("[{\"start\":0,\"end\":1,\"original\":\"kept\"}]"));
            JSONObject before = store.get(id).getJSONObject("settings");
            assertFalse(MainActivity.queueResume(store, id, "other-model"));
            assertEquals("completed", store.get(id).getString("status"));
            assertEquals(before.toString(), store.get(id).getJSONObject("settings").toString());
            assertEquals("kept", store.cues(id).getJSONObject(0).getString("original"));
        }
    }
}
