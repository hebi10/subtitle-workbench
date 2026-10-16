package com.haebi.subtitle;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/** All checkpoint flags and corresponding payloads commit in the same SQLite transaction. */
public final class JobStore extends SQLiteOpenHelper {
    public static final long CHUNK_MS = 7 * 60 * 1000L;
    public static final long PADDING_MS = 500;
    public static final int BATCH_SIZE = 30;
    private static final int MAX_PAYLOAD = 16 * 1024 * 1024;
    private static final int PAYLOAD_PART_CHARS = 64 * 1024;

    public JobStore(Context context) { super(context.getApplicationContext(), "subtitle_jobs.db", null, 1); }

    @Override public void onConfigure(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
        // FULL ensures a committed checkpoint survives a process/power interruption.
        db.execSQL("PRAGMA synchronous=FULL");
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY, uri TEXT NOT NULL, name TEXT NOT NULL, duration_ms INTEGER NOT NULL, settings TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE chunks (job_id TEXT NOT NULL REFERENCES jobs(id), chunk_index INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, extract_start_ms INTEGER NOT NULL, extract_end_ms INTEGER NOT NULL, transcribed INTEGER NOT NULL DEFAULT 0, batch_count INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(job_id,chunk_index))");
        db.execSQL("CREATE TABLE batches (job_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, batch_index INTEGER NOT NULL, PRIMARY KEY(job_id,chunk_index,batch_index), FOREIGN KEY(job_id,chunk_index) REFERENCES chunks(job_id,chunk_index))");
        // Small rows avoid Android CursorWindow's per-row limit even for a large transcript.
        db.execSQL("CREATE TABLE payloads (job_id TEXT NOT NULL REFERENCES jobs(id), chunk_index INTEGER NOT NULL, kind TEXT NOT NULL, batch_index INTEGER NOT NULL, part_index INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(job_id,chunk_index,kind,batch_index,part_index))");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { throw new IllegalStateException("지원되지 않는 작업 데이터베이스 버전입니다."); }

    public String create(String uri, String name, long durationMs, JSONObject settings) {
        if (uri == null || !uri.startsWith("content://") || durationMs <= 0 || durationMs > 48L * 60 * 60 * 1000) throw new IllegalArgumentException("유효한 영상과 재생 시간이 필요합니다.");
        String id = UUID.randomUUID().toString();
        transaction(db -> {
            db.insertOrThrow("jobs", null, jobValues(id, uri, name, durationMs, safeSettings(settings), "queued"));
            for (ChunkPlan.Segment segment : ChunkPlan.create(durationMs, CHUNK_MS, PADDING_MS)) {
                ContentValues row = new ContentValues();
                row.put("job_id", id); row.put("chunk_index", segment.index); row.put("start_ms", segment.startMs); row.put("end_ms", segment.endMs);
                row.put("extract_start_ms", segment.extractStartMs); row.put("extract_end_ms", segment.extractEndMs);
                db.insertOrThrow("chunks", null, row);
            }
        });
        return id;
    }

    public String importCues(String name, JSONArray cues) {
        validateCues(cues);
        String id = UUID.randomUUID().toString();
        long durationMs = 0;
        for (int i = 0; i < cues.length(); i++) durationMs = Math.max(durationMs, Math.round(cues.optJSONObject(i).optDouble("end") * 1000));
        final long duration = durationMs;
        transaction(db -> {
            db.insertOrThrow("jobs", null, jobValues(id, "", name, duration, safeSettings(new JSONObject().put("translate", false)), "completed"));
            writePayload(db, id, -1, "edited", -1, cues.toString());
        });
        return id;
    }

    public JSONArray list() { return jobsWhere(null); }
    public JSONArray runnableJobs() { return jobsWhere("status IN ('queued','running')"); }

    public JSONObject get(String id) {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT j.*, (SELECT COUNT(*) FROM chunks c WHERE c.job_id=j.id) AS total_chunks, (SELECT COUNT(*) FROM chunks c WHERE c.job_id=j.id AND c.complete=1) AS completed_chunks FROM jobs j WHERE id=?", new String[]{id})) {
            if (!cursor.moveToFirst()) throw new IllegalArgumentException("저장된 작업을 찾을 수 없습니다.");
            return new JSONObject().put("id", string(cursor, "id")).put("uri", string(cursor, "uri")).put("name", string(cursor, "name"))
                .put("durationMs", number(cursor, "duration_ms")).put("settings", new JSONObject(string(cursor, "settings")))
                .put("status", string(cursor, "status")).put("stage", string(cursor, "stage")).put("error", string(cursor, "error"))
                .put("totalChunks", number(cursor, "total_chunks")).put("completedChunks", number(cursor, "completed_chunks"))
                .put("createdAt", number(cursor, "created_at")).put("updatedAt", number(cursor, "updated_at"));
        } catch (JSONException error) { throw corrupt(); }
    }

    public void setStatus(String id, String status, String error) {
        if (!Arrays.asList("queued", "running", "paused", "error", "completed").contains(status)) throw new IllegalArgumentException("알 수 없는 작업 상태입니다.");
        transaction(db -> {
            JSONObject job = get(id);
            if ("completed".equals(status) && job.getInt("completedChunks") != job.getInt("totalChunks")) throw new IllegalStateException("모든 구간을 저장하기 전에는 완료할 수 없습니다.");
            ContentValues values = new ContentValues();
            values.put("status", status); values.put("stage", status); values.put("error", error == null ? "" : error); values.put("updated_at", System.currentTimeMillis());
            db.update("jobs", values, "id=?", new String[]{id});
        });
    }

    boolean claim(String id) {
        ContentValues values = new ContentValues(); values.put("status", "running"); values.put("error", ""); values.put("updated_at", System.currentTimeMillis());
        return getWritableDatabase().update("jobs", values, "id=? AND status IN ('queued','running')", new String[]{id}) == 1;
    }

    void finishRunning(String id, String status, String error) {
        transaction(db -> {
            if (!"running".equals(get(id).getString("status"))) return;
            setStatus(id, status, error);
        });
    }

    void pauseRunnable(String id, String reason) {
        ContentValues values = new ContentValues(); values.put("status", "paused"); values.put("stage", "paused"); values.put("error", reason); values.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("jobs", values, "status IN ('queued','running')" + (id == null ? "" : " AND id=?"), id == null ? null : new String[]{id});
    }

    void stage(String id, String stage) {
        ContentValues values = new ContentValues(); values.put("stage", stage); values.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("jobs", values, "id=? AND status='running'", new String[]{id});
    }

    public JSONArray cues(String id) {
        get(id);
        String edited = readPayload(id, -1, "edited", -1);
        try {
            if (edited != null) return new JSONArray(edited);
            List<JSONObject> combined = new ArrayList<>();
            try (Cursor chunks = getReadableDatabase().rawQuery("SELECT chunk_index FROM chunks WHERE job_id=? AND transcribed=1 ORDER BY chunk_index", new String[]{id})) {
                while (chunks.moveToNext()) {
                    int index = chunks.getInt(0);
                    JSONArray source = transcriptionCues(id, index);
                    for (int offset = 0; offset < source.length(); offset += BATCH_SIZE) {
                        String translated = readPayload(id, index, "translation", offset / BATCH_SIZE);
                        JSONArray batch = translated == null ? slice(source, offset, Math.min(source.length(), offset + BATCH_SIZE)) : new JSONArray(translated);
                        for (int i = 0; i < batch.length(); i++) combined.add(batch.getJSONObject(i));
                    }
                }
            }
            combined.sort(Comparator.comparingDouble(item -> item.optDouble("start")));
            return new JSONArray(combined);
        } catch (JSONException error) { throw corrupt(); }
    }

    public void saveEdited(String id, JSONArray cues) {
        validateCues(cues);
        transaction(db -> {
            if (!"completed".equals(get(id).getString("status"))) throw new IllegalStateException("완료된 작업에서 자막을 편집해 주세요.");
            writePayload(db, id, -1, "edited", -1, cues.toString());
            ContentValues values = new ContentValues(); values.put("updated_at", System.currentTimeMillis());
            db.update("jobs", values, "id=?", new String[]{id});
        });
    }

    boolean hasTranscription(String id, int chunk) { return chunkNumber(id, chunk, "transcribed") == 1; }
    boolean isChunkComplete(String id, int chunk) { return chunkNumber(id, chunk, "complete") == 1; }
    int batchCount(String id, int chunk) { return chunkNumber(id, chunk, "batch_count"); }

    JSONArray transcriptionCues(String id, int chunk) {
        String value = readPayload(id, chunk, "cues", -1);
        if (value == null) throw new IllegalStateException("저장된 음성 인식 결과가 없습니다.");
        try { return new JSONArray(value); } catch (JSONException error) { throw corrupt(); }
    }

    void saveTranscription(String id, int chunk, JSONObject raw, JSONArray cues, int batches) {
        validateCues(cues);
        if (batches < 0 || batches > (cues.length() + BATCH_SIZE - 1) / BATCH_SIZE) throw new IllegalArgumentException("번역 묶음 수가 올바르지 않습니다.");
        transaction(db -> {
            if (hasTranscription(id, chunk)) return;
            int expected = get(id).getJSONObject("settings").optBoolean("translate", true) ? (cues.length() + BATCH_SIZE - 1) / BATCH_SIZE : 0;
            if (batches != expected) throw new IllegalArgumentException("번역 묶음 수가 작업 설정과 일치하지 않습니다.");
            writePayload(db, id, chunk, "raw", -1, raw.toString());
            writePayload(db, id, chunk, "cues", -1, cues.toString());
            ContentValues values = new ContentValues(); values.put("transcribed", 1); values.put("batch_count", batches);
            if (db.update("chunks", values, "job_id=? AND chunk_index=?", new String[]{id, Integer.toString(chunk)}) != 1) throw new IllegalStateException("처리 구간을 찾을 수 없습니다.");
        });
    }

    boolean hasTranslation(String id, int chunk, int batch) {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT 1 FROM batches WHERE job_id=? AND chunk_index=? AND batch_index=?", new String[]{id, Integer.toString(chunk), Integer.toString(batch)})) { return cursor.moveToFirst(); }
    }

    void saveTranslation(String id, int chunk, int batch, JSONArray cues) {
        validateCues(cues);
        transaction(db -> {
            if (!hasTranscription(id, chunk) || batch < 0 || batch >= batchCount(id, chunk)) throw new IllegalStateException("번역 대상 구간이 올바르지 않습니다.");
            if (hasTranslation(id, chunk, batch)) return;
            JSONArray source = transcriptionCues(id, chunk);
            int first = batch * BATCH_SIZE;
            if (cues.length() != Math.min(BATCH_SIZE, source.length() - first)) throw new IllegalArgumentException("번역 결과 수가 일치하지 않습니다.");
            for (int i = 0; i < cues.length(); i++) {
                JSONObject translated = cues.getJSONObject(i), original = source.getJSONObject(first + i);
                if (translated.optString("translated").trim().isEmpty() || !original.getString("original").equals(translated.optString("original")) || original.getDouble("start") != translated.getDouble("start") || original.getDouble("end") != translated.getDouble("end")) throw new IllegalArgumentException("번역 결과가 원본 자막과 일치하지 않습니다.");
            }
            writePayload(db, id, chunk, "translation", batch, cues.toString());
            ContentValues row = new ContentValues(); row.put("job_id", id); row.put("chunk_index", chunk); row.put("batch_index", batch);
            db.insertOrThrow("batches", null, row);
        });
    }

    void completeChunk(String id, int chunk) {
        transaction(db -> {
            if (!hasTranscription(id, chunk)) throw new IllegalStateException("음성 인식 결과가 저장되지 않았습니다.");
            int expected = batchCount(id, chunk);
            for (int i = 0; i < expected; i++) if (!hasTranslation(id, chunk, i)) throw new IllegalStateException("번역 결과가 모두 저장되지 않았습니다.");
            ContentValues values = new ContentValues(); values.put("complete", 1);
            db.update("chunks", values, "job_id=? AND chunk_index=?", new String[]{id, Integer.toString(chunk)});
        });
    }

    static JSONArray slice(JSONArray source, int start, int end) throws JSONException {
        JSONArray result = new JSONArray();
        for (int i = start; i < end; i++) result.put(source.getJSONObject(i));
        return result;
    }

    private JSONArray jobsWhere(String where) {
        JSONArray result = new JSONArray();
        try (Cursor cursor = getReadableDatabase().query("jobs", new String[]{"id"}, where, null, null, null, "created_at DESC")) { while (cursor.moveToNext()) result.put(get(cursor.getString(0))); }
        return result;
    }

    private int chunkNumber(String id, int chunk, String column) {
        try (Cursor cursor = getReadableDatabase().query("chunks", new String[]{column}, "job_id=? AND chunk_index=?", new String[]{id, Integer.toString(chunk)}, null, null, null)) {
            if (!cursor.moveToFirst()) throw new IllegalArgumentException("저장된 구간을 찾을 수 없습니다.");
            return cursor.getInt(0);
        }
    }

    private String readPayload(String id, int chunk, String kind, int batch) {
        StringBuilder value = new StringBuilder();
        try (Cursor cursor = getReadableDatabase().query("payloads", new String[]{"value"}, "job_id=? AND chunk_index=? AND kind=? AND batch_index=?", new String[]{id, Integer.toString(chunk), kind, Integer.toString(batch)}, null, null, "part_index ASC")) {
            if (!cursor.moveToFirst()) return null;
            do {
                value.append(cursor.getString(0));
                if (value.length() > MAX_PAYLOAD) throw corrupt();
            } while (cursor.moveToNext());
        }
        return value.toString();
    }

    private void writePayload(SQLiteDatabase db, String id, int chunk, String kind, int batch, String value) {
        if (value.getBytes(StandardCharsets.UTF_8).length > MAX_PAYLOAD) throw new IllegalArgumentException("저장할 자막 데이터가 너무 큽니다.");
        db.delete("payloads", "job_id=? AND chunk_index=? AND kind=? AND batch_index=?", new String[]{id, Integer.toString(chunk), kind, Integer.toString(batch)});
        int part = 0;
        for (int start = 0; start < value.length();) {
            int end = Math.min(value.length(), start + PAYLOAD_PART_CHARS);
            if (end < value.length() && Character.isHighSurrogate(value.charAt(end - 1))) end--;
            ContentValues row = new ContentValues(); row.put("job_id", id); row.put("chunk_index", chunk); row.put("kind", kind); row.put("batch_index", batch); row.put("part_index", part++); row.put("value", value.substring(start, end));
            db.insertOrThrow("payloads", null, row);
            start = end;
        }
    }

    private static ContentValues jobValues(String id, String uri, String name, long duration, JSONObject settings, String status) {
        ContentValues row = new ContentValues(); row.put("id", id); row.put("uri", uri); row.put("name", name == null ? "자막" : name.substring(0, Math.min(name.length(), 512))); row.put("duration_ms", duration); row.put("settings", settings.toString()); row.put("status", status); row.put("stage", status); row.put("created_at", System.currentTimeMillis()); row.put("updated_at", System.currentTimeMillis());
        return row;
    }

    private static JSONObject safeSettings(JSONObject source) throws JSONException {
        JSONObject input = source == null ? new JSONObject() : source;
        // Explicit whitelist: API keys, proxy credentials and arbitrary UI values never reach SQLite.
        return new JSONObject().put("sourceLanguage", limited(input.optString("sourceLanguage", "auto"), 16))
            .put("targetLanguage", limited(input.optString("targetLanguage", "ko"), 32))
            .put("translationModel", limited(input.optString("translationModel", "gpt-5.5"), 100)).put("translate", input.optBoolean("translate", true));
    }

    private static String limited(String value, int max) { if (value.length() > max) throw new IllegalArgumentException("설정 값이 너무 깁니다."); return value; }
    private static void validateCues(JSONArray cues) {
        if (cues == null || cues.length() > 100000) throw new IllegalArgumentException("자막 수가 너무 많습니다.");
        for (int i = 0; i < cues.length(); i++) {
            JSONObject cue = cues.optJSONObject(i);
            if (cue == null) throw new IllegalArgumentException("자막 형식이 올바르지 않습니다.");
            double start = cue.optDouble("start", Double.NaN), end = cue.optDouble("end", Double.NaN);
            if (!Double.isFinite(start) || !Double.isFinite(end) || start < 0 || end <= start || end > 48 * 60 * 60) throw new IllegalArgumentException("자막 시간이 올바르지 않습니다.");
            if (cue.optString("original").length() > 20000 || cue.optString("translated").length() > 20000) throw new IllegalArgumentException("자막 한 줄이 너무 깁니다.");
        }
    }

    private void transaction(Change change) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try { change.run(db); db.setTransactionSuccessful(); }
        catch (JSONException error) { throw corrupt(); }
        finally { db.endTransaction(); }
    }

    private interface Change { void run(SQLiteDatabase db) throws JSONException; }
    private static String string(Cursor cursor, String name) { return cursor.getString(cursor.getColumnIndexOrThrow(name)); }
    private static long number(Cursor cursor, String name) { return cursor.getLong(cursor.getColumnIndexOrThrow(name)); }
    private static IllegalStateException corrupt() { return new IllegalStateException("저장된 자막 데이터를 읽을 수 없습니다."); }
}
