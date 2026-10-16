package com.haebi.subtitle;

import android.content.Context;
import android.content.ContextWrapper;
import android.database.Cursor;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PreparedJobDeviceTest {
    @Test public void settingsChangePersistsValidatedValuesWithoutChangingSourceOrPlan() throws Exception {
        Context context = isolatedContext();
        String id;
        try (JobStore store = new JobStore(context)) {
            id = prepared(store);
            JSONObject updated = store.updatePreparedSettings(id, new JSONObject().put("sourceLanguage", "en")
                    .put("targetLanguage", "ja").put("translationModel", " gpt-6-luna ")
                    .put("translate", false).put("apiKey", "must-not-persist"));
            assertEquals(id, updated.getString("id"));
            assertEquals("content://test/original", updated.getString("uri"));
            assertEquals(3, updated.getInt("totalChunks"));
            assertEquals("ready", updated.getString("stage"));
            assertEquals(0, updated.getJSONObject("progress").getLong("lastSavedAt"));
        }
        try (JobStore reopened = new JobStore(context)) {
            JSONObject settings = reopened.get(id).getJSONObject("settings");
            assertEquals("en", settings.getString("sourceLanguage"));
            assertEquals("ja", settings.getString("targetLanguage"));
            assertEquals("gpt-6-luna", settings.getString("translationModel"));
            assertFalse(settings.getBoolean("translate"));
            assertFalse(settings.has("apiKey"));
        }
    }

    @Test public void replacingVideoRetainsIdentityAndRebuildsOnlyTheUnstartedPlan() throws Exception {
        Context context = isolatedContext();
        String id;
        long createdAt;
        try (JobStore store = new JobStore(context)) {
            id = prepared(store);
            createdAt = store.get(id).getLong("createdAt");
            JSONObject replacement = store.replacePrepared(id, "content://test/replacement", "새 영상", 600_000L,
                    new JSONObject().put("translate", false));
            assertEquals(id, replacement.getString("id"));
            assertEquals("content://test/replacement", replacement.getString("uri"));
            assertEquals("새 영상", replacement.getString("name"));
            assertEquals(600_000L, replacement.getLong("durationMs"));
            assertEquals(2, replacement.getInt("totalChunks"));
            assertEquals(1, store.list().length());
            try (Cursor row = store.getReadableDatabase().rawQuery("SELECT start_ms,end_ms,extract_start_ms,extract_end_ms FROM chunks WHERE job_id=? AND chunk_index=1", new String[]{id})) {
                assertTrue(row.moveToFirst());
                assertEquals(420_000L, row.getLong(0));
                assertEquals(600_000L, row.getLong(1));
                assertEquals(419_500L, row.getLong(2));
                assertEquals(600_000L, row.getLong(3));
            }
        }
        try (JobStore reopened = new JobStore(context)) {
            assertEquals(createdAt, reopened.get(id).getLong("createdAt"));
            assertEquals("paused", reopened.get(id).getString("status"));
            assertEquals("ready", reopened.get(id).getString("stage"));
            assertEquals(0, reopened.cues(id).length());
            assertFalse(reopened.get(id).getJSONObject("settings").getBoolean("translate"));
            assertFalse(reopened.claim(id));
        }
    }

    @Test public void invalidSettingsAndInvalidReplacementPreserveThePreparedJob() throws Exception {
        try (JobStore store = new JobStore(isolatedContext())) {
            String id = prepared(store);
            String before = store.get(id).toString();
            JSONObject invalid = new JSONObject().put("sourceLanguage", "not a language");
            assertThrows(IllegalArgumentException.class, () -> store.updatePreparedSettings(id, invalid));
            assertThrows(IllegalArgumentException.class, () -> store.replacePrepared(id, "file:///test/video", "invalid", 1000, new JSONObject()));
            assertThrows(IllegalArgumentException.class, () -> store.replacePrepared(id, "content://test/video", "empty", 0, new JSONObject()));
            assertThrows(IllegalArgumentException.class, () -> store.replacePrepared(id, "content://test/video", "too long", 10_800_001L, new JSONObject()));
            assertThrows(IllegalArgumentException.class, () -> store.replacePrepared(id, "content://test/video", "invalid", 1000, invalid));
            assertEquals(before, store.get(id).toString());
            assertEquals(3, count(store, "chunks", id));
        }
    }

    @Test public void replacementWriteFailureRollsBackSourceSettingsAndChunkPlan() throws Exception {
        try (JobStore store = new JobStore(isolatedContext())) {
            String id = prepared(store);
            String before = store.get(id).toString();
            store.getWritableDatabase().execSQL("CREATE TRIGGER reject_replacement BEFORE INSERT ON chunks BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END");
            assertThrows(android.database.sqlite.SQLiteException.class,
                    () -> store.replacePrepared(id, "content://test/replacement", "replacement", 1000, new JSONObject().put("translate", false)));
            assertEquals(before, store.get(id).toString());
            assertEquals(3, count(store, "chunks", id));
        }
    }

    @Test public void cancellingPreparedWorkRemovesOnlyItsDatabaseRows() throws Exception {
        try (JobStore store = new JobStore(isolatedContext())) {
            String id = prepared(store);
            String other = prepared(store);
            String kept = store.get(other).toString();
            assertTrue(store.cancelPrepared(id));
            assertThrows(IllegalArgumentException.class, () -> store.get(id));
            assertEquals(0, count(store, "chunks", id));
            assertEquals(0, count(store, "batches", id));
            assertEquals(0, count(store, "payloads", id));
            assertEquals(kept, store.get(other).toString());
            assertEquals(1, store.list().length());
        }
    }

    @Test public void queuedRunningPausedErrorAndCompletedJobsRejectPreparationChanges() throws Exception {
        try (JobStore store = new JobStore(isolatedContext())) {
            for (String status : new String[]{"queued", "running", "paused", "error"}) {
                String id = prepared(store);
                store.setStatus(id, status, "");
                assertPreparationRejected(store, id);
            }
            String completed = store.importCues("completed", new JSONArray("[{\"start\":0,\"end\":1,\"original\":\"saved\"}]"));
            assertPreparationRejected(store, completed);
            assertEquals("saved", store.cues(completed).getJSONObject(0).getString("original"));
        }
    }

    @Test public void readyLabelCannotHideAnySavedPayloadBatchOrChunkProgress() throws Exception {
        try (JobStore store = new JobStore(isolatedContext())) {
            for (String column : new String[]{"transcribed", "batch_count", "complete"}) {
                String id = prepared(store);
                store.getWritableDatabase().execSQL("UPDATE chunks SET " + column + "=1 WHERE job_id=? AND chunk_index=0", new Object[]{id});
                assertPreparationRejected(store, id);
            }
            String batch = prepared(store);
            store.getWritableDatabase().execSQL("INSERT INTO batches VALUES (?,0,0)", new Object[]{batch});
            assertPreparationRejected(store, batch);
            assertEquals(1, count(store, "batches", batch));
            String payload = prepared(store);
            store.getWritableDatabase().execSQL("INSERT INTO payloads VALUES (?,-1,'edited',-1,0,'[]')", new Object[]{payload});
            assertPreparationRejected(store, payload);
            assertEquals(1, count(store, "payloads", payload));
            for (String column : new String[]{"last_saved_at", "elapsed_ms", "current_chunk"}) {
                String id = prepared(store);
                store.getWritableDatabase().execSQL("UPDATE jobs SET " + column + "=1 WHERE id=?", new Object[]{id});
                assertPreparationRejected(store, id);
            }
        }
    }

    @Test public void resumeAdmissionProtectsSettingsAndSourceBeforeTheWorkerStarts() throws Exception {
        try (JobStore store = new JobStore(isolatedContext())) {
            String id = prepared(store);
            assertTrue(MainActivity.queueResume(store, id, null));
            assertPreparationRejected(store, id);
            assertEquals("queued", store.get(id).getString("status"));
            assertTrue(store.claim(id));
            assertPreparationRejected(store, id);
            store.pauseRunnable(id, "test finished");
        }
    }

    private static void assertPreparationRejected(JobStore store, String id) throws Exception {
        String before = snapshotWithoutActiveClock(store, id);
        assertThrows(IllegalArgumentException.class, () -> store.updatePreparedSettings(id, new JSONObject().put("translate", false)));
        assertThrows(IllegalArgumentException.class, () -> store.replacePrepared(id, "content://test/replacement", "replacement", 1000, new JSONObject()));
        assertThrows(IllegalArgumentException.class, () -> store.cancelPrepared(id));
        assertEquals(before, snapshotWithoutActiveClock(store, id));
    }

    private static String snapshotWithoutActiveClock(JobStore store, String id) throws Exception {
        JSONObject job = store.get(id);
        job.getJSONObject("progress").remove("elapsedMs");
        return job.toString();
    }

    private static String prepared(JobStore store) {
        return store.createPrepared("content://test/original", "original", 900_000L, new JSONObject());
    }

    private static int count(JobStore store, String table, String id) {
        try (Cursor cursor = store.getReadableDatabase().rawQuery("SELECT COUNT(*) FROM " + table + " WHERE job_id=?", new String[]{id})) {
            assertTrue(cursor.moveToFirst());
            return cursor.getInt(0);
        }
    }

    private static Context isolatedContext() {
        String prefix = "preparation-" + UUID.randomUUID() + "-";
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
}
