package com.haebi.subtitle;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.After;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class JobStoreTest {
    @After public void pauseFixturesBeforeAnyUiLaunch() {
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            for (int i = 0; i < store.list().length(); i++) {
                JSONObject job = store.list().optJSONObject(i);
                if (job != null && job.optString("uri").startsWith("content://test/")) store.pauseRunnable(job.optString("id"), "테스트 작업");
            }
        }
    }
    @Test public void reopenKeepsTranscriptionAndBatchWithoutCompletingChunk() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        String id;
        JSONArray source = new JSONArray("[{\"start\":0,\"end\":1,\"original\":\"Hello\",\"translated\":\"\"}]");
        try (JobStore first = new JobStore(context)) {
            id = first.create("content://test/video", "video.mp4", 9000000, new JSONObject().put("apiKey", "must-not-persist"));
            first.saveTranscription(id, 0, new JSONObject().put("text", "Hello"), source, 1);
            first.saveTranslation(id, 0, 0, new JSONArray("[{\"start\":0,\"end\":1,\"original\":\"Hello\",\"translated\":\"안녕\",\"status\":\"translated\"}]"));
        }
        try (JobStore reopened = new JobStore(context)) {
            assertTrue(reopened.hasTranscription(id, 0));
            assertTrue(reopened.hasTranslation(id, 0, 0));
            assertFalse(reopened.isChunkComplete(id, 0));
            assertEquals(0, reopened.get(id).getInt("completedChunks"));
            assertEquals(22, reopened.get(id).getInt("totalChunks"));
            assertFalse(reopened.get(id).getJSONObject("settings").has("apiKey"));
            reopened.completeChunk(id, 0);
            reopened.completeChunk(id, 0);
            assertEquals(1, reopened.get(id).getInt("completedChunks"));
            assertEquals("안녕", reopened.cues(id).getJSONObject(0).getString("translated"));
        }
    }

    @Test public void incompleteTranslationsCannotMarkChunkCompleteAndPausedIsNotRecoverable() throws Exception {
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            String id = store.create("content://test/video", "test", 1000, new JSONObject());
            store.saveTranscription(id, 0, new JSONObject(), new JSONArray("[{\"start\":0,\"end\":1,\"original\":\"one\"}]"), 1);
            assertThrows(IllegalStateException.class, () -> store.completeChunk(id, 0));
            store.setStatus(id, "paused", "");
            JSONArray jobs = store.runnableJobs();
            for (int i = 0; i < jobs.length(); i++) assertNotEquals(id, jobs.getJSONObject(i).getString("id"));
            assertEquals(0, store.get(id).getInt("completedChunks"));
        }
    }

    @Test public void missingTranslationPlanCannotCreateACompleteCheckpoint() throws Exception {
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            String id = store.create("content://test/video", "test", 1000, new JSONObject());
            JSONArray cues = new JSONArray("[{\"start\":0,\"end\":1,\"original\":\"one\"}]");
            assertThrows(IllegalArgumentException.class, () -> store.saveTranscription(id, 0, new JSONObject(), cues, 0));
            assertFalse(store.hasTranscription(id, 0));
            assertEquals(0, store.cues(id).length());
        }
    }

    @Test public void largePayloadSurvivesReopenAndEditedCuesReplaceGeneratedCues() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        String id;
        StringBuilder rawText = new StringBuilder();
        for (int i = 0; i < 400000; i++) rawText.append("긴원문");
        try (JobStore store = new JobStore(context)) {
            id = store.create("content://test/video", "test", 1000, new JSONObject().put("translate", false));
            store.saveTranscription(id, 0, new JSONObject().put("text", rawText.toString()), new JSONArray("[{\"start\":0,\"end\":1,\"original\":\"before\"}]"), 0);
            store.completeChunk(id, 0);
            store.setStatus(id, "completed", "");
            store.saveEdited(id, new JSONArray("[{\"start\":0.1,\"end\":0.9,\"original\":\"edited\"}]"));
        }
        try (JobStore reopened = new JobStore(context)) {
            assertTrue(reopened.hasTranscription(id, 0));
            assertEquals("completed", reopened.get(id).getString("status"));
            assertEquals("edited", reopened.cues(id).getJSONObject(0).getString("original"));
            assertEquals(0.1, reopened.cues(id).getJSONObject(0).getDouble("start"), 0.001);
        }
    }

    @Test public void staleWorkerCannotOverwritePauseOrNewResumeIntent() throws Exception {
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            String id = store.create("content://test/video", "test", 1000, new JSONObject());
            assertTrue(store.claim(id));
            store.pauseRunnable(id, "");
            store.finishRunning(id, "error", "old error");
            assertEquals("paused", store.get(id).getString("status"));
            store.setStatus(id, "queued", "");
            store.finishRunning(id, "paused", "");
            assertEquals("queued", store.get(id).getString("status"));
        }
    }
}
