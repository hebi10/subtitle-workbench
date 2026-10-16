package com.haebi.subtitle;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Run with phase=seed, force-stop the app externally, then run phase=verify. No API requests. */
@RunWith(AndroidJUnit4.class)
public class ProcessRecoveryDeviceTest {
    @Test public void durableCheckpointAcrossProcesses() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        String phase = InstrumentationRegistry.getArguments().getString("phase", "roundtrip");
        try (JobStore store = new JobStore(context)) {
            if (!"verify".equals(phase)) {
                String id = store.create("content://test/recovery", "복구 검증 영상", 10_800_000, new JSONObject());
                JSONArray cues = new JSONArray("[{\"start\":1,\"end\":2,\"original\":\"saved\",\"translated\":\"저장됨\"}]");
                store.saveTranscription(id, 0, new JSONObject().put("text", "saved"), cues, 1);
                store.saveTranslation(id, 0, 0, cues);
                store.completeChunk(id, 0);
                store.saveTranscription(id, 1, new JSONObject().put("text", "waiting for translation"), cues, 1);
                store.setStatus(id, "paused", "테스트 체크포인트");
                assertTrue(context.getSharedPreferences("recovery_fixture", Context.MODE_PRIVATE).edit().putString("id", id).commit());
            }
            String id = context.getSharedPreferences("recovery_fixture", Context.MODE_PRIVATE).getString("id", "");
            assertFalse(id.isEmpty());
            assertEquals(26, store.get(id).getInt("totalChunks"));
            assertEquals(1, store.get(id).getInt("completedChunks"));
            assertTrue(store.isChunkComplete(id, 0));
            assertTrue(store.hasTranscription(id, 1));
            assertFalse(store.hasTranslation(id, 1, 0));
            assertFalse(store.isChunkComplete(id, 1));
            assertEquals("paused", store.get(id).getString("status"));
            assertEquals("저장됨", store.cues(id).getJSONObject(0).getString("translated"));
            JSONObject progress = store.get(id).getJSONObject("progress");
            assertEquals(420_000L, progress.getLong("processedMs"));
            assertEquals(2, progress.getInt("transcribedChunks"));
            assertEquals(1, progress.getInt("translatedChunks"));
            assertEquals(5, progress.getInt("percent"));
            assertTrue(progress.getLong("lastSavedAt") > 0);
            if ("interrupt-write".equals(phase)) {
                // The host force-stops this instrumentation after observing the marker.
                // A subsequent phase=verify must see only the prior committed checkpoint.
                android.database.sqlite.SQLiteDatabase db = store.getWritableDatabase();
                db.beginTransaction();
                try {
                    db.execSQL("UPDATE chunks SET complete=1 WHERE job_id=? AND chunk_index=1", new Object[]{id});
                    android.os.Bundle marker = new android.os.Bundle();
                    marker.putString("checkpoint", "uncommitted-transaction-ready");
                    InstrumentationRegistry.getInstrumentation().sendStatus(7, marker);
                    android.os.SystemClock.sleep(30000);
                    fail("The host must stop the test process at the transaction marker.");
                } finally { db.endTransaction(); }
            }
        }
    }
}
