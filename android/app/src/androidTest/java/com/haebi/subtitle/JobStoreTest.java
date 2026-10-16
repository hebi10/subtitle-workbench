package com.haebi.subtitle;

import android.content.Context;
import android.content.ContextWrapper;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.SystemClock;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.After;
import org.junit.runner.RunWith;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class JobStoreTest {
    @Test public void preparedJobsCannotAutoRunAndPausedModelChangeKeepsSavedWork() throws Exception {
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            String id = store.createPrepared("content://test/prepared", "prepared", 420_000L, new JSONObject());
            assertEquals("paused", store.get(id).getString("status"));
            assertEquals("ready", store.get(id).getString("stage"));
            assertEquals("gpt-6-luna", store.get(id).getJSONObject("settings").getString("translationModel"));
            assertFalse(store.claim(id));
            JSONArray source = new JSONArray("[{\"start\":0,\"end\":1,\"original\":\"saved\"}]");
            JSONArray translated = new JSONArray("[{\"start\":0,\"end\":1,\"original\":\"saved\",\"translated\":\"보존됨\"}]");
            store.saveTranscription(id, 0, new JSONObject(), source, 1);
            store.saveTranslation(id, 0, 0, translated);
            long checkpoint = store.get(id).getJSONObject("progress").getLong("lastSavedAt");
            store.updateTranslationModel(id, "gpt-5.5");
            assertEquals("gpt-5.5", store.get(id).getJSONObject("settings").getString("translationModel"));
            assertTrue(store.hasTranscription(id, 0));
            assertTrue(store.hasTranslation(id, 0, 0));
            assertEquals("보존됨", store.cues(id).getJSONObject(0).getString("translated"));
            assertEquals(checkpoint, store.get(id).getJSONObject("progress").getLong("lastSavedAt"));
            store.setStatus(id, "queued", "");
            assertThrows(IllegalStateException.class, () -> store.updateTranslationModel(id, "gpt-6-luna"));
            store.completeChunk(id, 0);
            store.setStatus(id, "completed", "");
            assertThrows(IllegalStateException.class, () -> store.updateTranslationModel(id, "gpt-6-luna"));
            assertEquals(100, store.get(id).getJSONObject("progress").getInt("percent"));
        }
    }

    @Test public void elapsedTimeExcludesPausesAndStatusPollingIsNotACheckpoint() throws Exception {
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            String id = store.create("content://test/elapsed", "elapsed", 1000, new JSONObject());
            assertTrue(store.claim(id));
            SystemClock.sleep(40);
            store.progress(id, "extracting", 0, 45, "오디오 추출 중");
            JSONObject first = store.get(id).getJSONObject("progress");
            assertTrue(first.getLong("elapsedMs") >= 40);
            assertEquals(0, first.getLong("lastSavedAt"));
            assertEquals(45, first.getInt("extractionPercent"));
            store.heartbeat(id);
            assertEquals(0, store.get(id).getJSONObject("progress").getLong("lastSavedAt"));
            store.pauseRunnable(id, "");
            long paused = store.get(id).getJSONObject("progress").getLong("elapsedMs");
            SystemClock.sleep(60);
            assertEquals(paused, store.get(id).getJSONObject("progress").getLong("elapsedMs"));
            store.setStatus(id, "queued", "");
            assertTrue(store.claim(id));
            SystemClock.sleep(30);
            store.pauseRunnable(id, "");
            assertTrue(store.get(id).getJSONObject("progress").getLong("elapsedMs") >= paused + 30);
            assertEquals(0, store.get(id).getJSONObject("progress").getInt("percent"));
        }
    }

    @Test public void versionOneMigrationRetainsLongJobsModelsAndTranslationCheckpoints() throws Exception {
        Context context = isolatedDatabaseContext();
        try (SQLiteOpenHelper legacy = new SQLiteOpenHelper(context, "subtitle_jobs.db", null, 1) {
            @Override public void onCreate(SQLiteDatabase db) {
                db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY, uri TEXT NOT NULL, name TEXT NOT NULL, duration_ms INTEGER NOT NULL, settings TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
                db.execSQL("CREATE TABLE chunks (job_id TEXT NOT NULL REFERENCES jobs(id), chunk_index INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, extract_start_ms INTEGER NOT NULL, extract_end_ms INTEGER NOT NULL, transcribed INTEGER NOT NULL DEFAULT 0, batch_count INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(job_id,chunk_index))");
                db.execSQL("CREATE TABLE batches (job_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, batch_index INTEGER NOT NULL, PRIMARY KEY(job_id,chunk_index,batch_index))");
                db.execSQL("CREATE TABLE payloads (job_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, kind TEXT NOT NULL, batch_index INTEGER NOT NULL, part_index INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(job_id,chunk_index,kind,batch_index,part_index))");
            }
            @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }
        }) {
            SQLiteDatabase db = legacy.getWritableDatabase();
            db.execSQL("INSERT INTO jobs VALUES ('legacy','content://test/legacy','old four hours',14400000,'{\"translate\":true,\"translationModel\":\"gpt-5.5\"}','paused','paused','',12345,23456)");
            for (ChunkPlan.Segment chunk : ChunkPlan.create(14_400_000L, 420_000L, 500L)) {
                db.execSQL("INSERT INTO chunks VALUES ('legacy',?,?,?,?,?,0,0,0)", new Object[]{chunk.index, chunk.startMs, chunk.endMs, chunk.extractStartMs, chunk.extractEndMs});
            }
            db.execSQL("UPDATE chunks SET transcribed=1,batch_count=1,complete=1 WHERE chunk_index=0");
            db.execSQL("INSERT INTO batches VALUES ('legacy',0,0)");
            String source = "[{\"start\":0,\"end\":1,\"original\":\"old\"}]";
            String translated = "[{\"start\":0,\"end\":1,\"original\":\"old\",\"translated\":\"이전 결과\"}]";
            db.execSQL("INSERT INTO payloads VALUES ('legacy',0,'cues',-1,0,?)", new Object[]{source});
            db.execSQL("INSERT INTO payloads VALUES ('legacy',0,'translation',0,0,?)", new Object[]{translated});
        }
        try (JobStore store = new JobStore(context)) {
            JSONObject job = store.get("legacy");
            assertEquals(14_400_000L, job.getLong("durationMs"));
            assertEquals(35, job.getInt("totalChunks"));
            assertEquals("gpt-5.5", job.getJSONObject("settings").getString("translationModel"));
            assertTrue(store.hasTranslation("legacy", 0, 0));
            assertTrue(store.isChunkComplete("legacy", 0));
            assertEquals("이전 결과", store.cues("legacy").getJSONObject(0).getString("translated"));
            assertEquals(420_000L, job.getJSONObject("progress").getLong("processedMs"));
            assertEquals(0L, job.getJSONObject("progress").getLong("lastSavedAt"));
            store.updateTranslationModel("legacy", "gpt-6-luna");
        }
        try (JobStore reopened = new JobStore(context)) {
            assertTrue(reopened.isChunkComplete("legacy", 0));
            assertEquals("gpt-6-luna", reopened.get("legacy").getJSONObject("settings").getString("translationModel"));
        }
    }

    private static Context isolatedDatabaseContext() {
        String prefix = "migration-" + UUID.randomUUID() + "-";
        return new ContextWrapper(ApplicationProvider.getApplicationContext()) {
            @Override public Context getApplicationContext() { return this; }
            @Override public java.io.File getDatabasePath(String name) { return super.getDatabasePath(prefix + name); }
            @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode, SQLiteDatabase.CursorFactory factory) {
                return super.openOrCreateDatabase(prefix + name, mode, factory);
            }
            @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode, SQLiteDatabase.CursorFactory factory, DatabaseErrorHandler handler) {
                return super.openOrCreateDatabase(prefix + name, mode, factory, handler);
            }
        };
    }

    @Test public void newVideoAllowsThreeHoursButRejectsOneMillisecondMore() throws Exception {
        try (JobStore store = new JobStore(ApplicationProvider.getApplicationContext())) {
            String id = store.create("content://test/three-hours", "180 minutes", 10_800_000L, new JSONObject());
            assertEquals(26, store.get(id).getInt("totalChunks"));
            assertThrows(IllegalArgumentException.class,
                    () -> store.create("content://test/too-long", "too long", 10_800_001L, new JSONObject()));
        }
    }

    @Test public void savedTranslationBatchesAdvanceProgressWithoutCompletingChunk() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        String id;
        JSONArray source = new JSONArray();
        for (int i = 0; i < 31; i++) source.put(new JSONObject().put("start", i).put("end", i + 0.5).put("original", "line " + i));
        try (JobStore store = new JobStore(context)) {
            id = store.create("content://test/batches", "batches", 420_000L, new JSONObject());
            assertEquals(0, store.get(id).getJSONObject("progress").getInt("percent"));
            store.saveTranscription(id, 0, new JSONObject(), source, 2);
            assertEquals(50, store.get(id).getJSONObject("progress").getInt("percent"));
            JSONArray translated = new JSONArray();
            for (int i = 0; i < 30; i++) translated.put(new JSONObject(source.getJSONObject(i).toString()).put("translated", "번역 " + i));
            store.saveTranslation(id, 0, 0, translated);
            assertEquals(75, store.get(id).getJSONObject("progress").getInt("percent"));
        }
        try (JobStore store = new JobStore(context)) {
            JSONObject progress = store.get(id).getJSONObject("progress");
            assertEquals(75, progress.getInt("percent"));
            assertEquals(0, progress.getLong("processedMs"));
            assertEquals(1, progress.getInt("transcribedChunks"));
            assertEquals(0, progress.getInt("translatedChunks"));
            assertTrue(progress.getLong("lastSavedAt") > 0);
            long savedAt = progress.getLong("lastSavedAt");
            store.setStatus(id, "paused", "");
            assertEquals(savedAt, store.get(id).getJSONObject("progress").getLong("lastSavedAt"));
        }
    }

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
