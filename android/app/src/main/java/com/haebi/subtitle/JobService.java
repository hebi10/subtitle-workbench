package com.haebi.subtitle;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** One foreground service and one sequential worker own all processing and checkpoints. */
public final class JobService extends Service {
    private static final String START = "com.haebi.subtitle.START";
    private static final String PAUSE = "com.haebi.subtitle.PAUSE";
    private static final String RECOVER = "com.haebi.subtitle.RECOVER";
    private static final String CHANNEL = "subtitle_processing";
    private static final int NOTIFICATION_ID = 1001;
    // Shared across service instances: a rapid stop/start cannot overlap an old closing worker.
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean draining = new AtomicBoolean();
    private volatile String activeId;
    private volatile OpenAiClient.Cancellation cancellation;
    private volatile boolean stopping;
    private JobStore store;
    private PowerManager.WakeLock wakeLock;
    private int lastStartId;
    private boolean cacheChecked;

    public static void start(Context context, String id) {
        context.startForegroundService(new Intent(context, JobService.class).setAction(START).putExtra("jobId", id));
    }

    public static void pause(Context context, String id) {
        // Persist user intent before dispatch: a process death cannot undo a pause.
        try (JobStore store = new JobStore(context)) { store.pauseRunnable(id, ""); }
        context.startService(new Intent(context, JobService.class).setAction(PAUSE).putExtra("jobId", id));
    }

    /** Call only while the Activity is visible; force-stop and reboot never launch work by themselves. */
    public static void recover(Context context) {
        try (JobStore store = new JobStore(context)) {
            if (store.runnableJobs().length() > 0) context.startForegroundService(new Intent(context, JobService.class).setAction(RECOVER));
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        store = new JobStore(this);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "자막 처리", NotificationManager.IMPORTANCE_LOW));
        PowerManager power = getSystemService(PowerManager.class);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "haebi:subtitle-chunk");
        wakeLock.setReferenceCounted(false);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        lastStartId = startId;
        String action = intent == null ? RECOVER : intent.getAction();
        String id = intent == null ? null : intent.getStringExtra("jobId");
        if (PAUSE.equals(action)) {
            store.pauseRunnable(id, "");
            if (id == null || id.equals(activeId)) {
                OpenAiClient.Cancellation token = cancellation;
                if (token != null) token.cancel();
            }
            if (!draining.get()) stopSelfResult(startId);
            return START_NOT_STICKY;
        }
        if (stopping) { stopSelfResult(startId); return START_NOT_STICKY; }
        try {
            startInForeground(notification("작업 준비 중", 0, 0));
            if (START.equals(action) && id != null) {
                JSONObject job = store.get(id);
                String status = job.optString("status");
                boolean sameLiveJob = id.equals(activeId) && cancellation != null && !cancellation.isCancelled();
                if (!"completed".equals(status) && !sameLiveJob) store.setStatus(id, "queued", "");
            }
            scheduleDrain();
            return START_STICKY;
        } catch (RuntimeException error) {
            if (id != null) try { store.setStatus(id, "error", "백그라운드 처리를 시작할 수 없습니다. 앱을 연 상태에서 다시 이어해 주세요."); } catch (RuntimeException ignored) { }
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }
    }

    private void startInForeground(Notification notification) {
        if (Build.VERSION.SDK_INT >= 35) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING);
        else if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NOTIFICATION_ID, notification);
    }

    private void scheduleDrain() {
        if (stopping || !draining.compareAndSet(false, true)) return;
        WORKER.execute(() -> {
            try {
                if (!cacheChecked) { cleanOldAudioCache(); cacheChecked = true; }
                while (!stopping) {
                    JSONArray candidates = store.runnableJobs();
                    if (candidates.length() == 0) break;
                    // Oldest queued job first; get/list remain newest first for the history UI.
                    JSONObject job = candidates.optJSONObject(candidates.length() - 1);
                    String id = job.optString("id");
                    OpenAiClient.Cancellation token = new OpenAiClient.Cancellation();
                    activeId = id;
                    cancellation = token;
                    if (!store.claim(id)) { activeId = null; cancellation = null; continue; }
                    try {
                        process(job, token);
                        token.check();
                        store.finishRunning(id, "completed", "");
                    } catch (Exception error) {
                        if (token.isCancelled() || stopping) store.finishRunning(id, "paused", "");
                        else store.finishRunning(id, "error", safeError(error));
                    } finally {
                        releaseWakeLock();
                        activeId = null;
                        cancellation = null;
                    }
                }
            } finally {
                draining.set(false);
                main.post(() -> {
                    if (stopping) return;
                    if (store.runnableJobs().length() > 0) scheduleDrain();
                    else { stopForeground(STOP_FOREGROUND_REMOVE); stopSelfResult(lastStartId); }
                });
            }
        });
    }

    private void process(JSONObject job, OpenAiClient.Cancellation token) throws Exception {
        String id = job.getString("id");
        JSONObject settings = job.getJSONObject("settings");
        String key = new SecretStore(this).getKey();
        OpenAiClient api = new OpenAiClient(key, token);
        MediaChunks media = new MediaChunks(this);
        Uri source = Uri.parse(job.getString("uri"));
        int total = job.getInt("totalChunks");
        for (ChunkPlan.Segment chunk : ChunkPlan.create(job.getLong("durationMs"), JobStore.CHUNK_MS, JobStore.PADDING_MS)) {
            token.check();
            if (!"running".equals(store.get(id).optString("status"))) { token.cancel(); token.check(); }
            if (store.isChunkComplete(id, chunk.index)) continue;
            // Bounded to each chunk. Android's service timeout remains authoritative.
            holdWakeLock(30 * 60 * 1000L);
            try {
                if (!store.hasTranscription(id, chunk.index)) {
                    progress(id, "extracting", "오디오 추출 " + (chunk.index + 1) + "/" + total);
                    File directory = new File(getCacheDir(), "subtitle-engine");
                    File file = new File(directory, "subtitle-audio-" + id + "-" + chunk.index + ".m4a");
                    try {
                        media.export(source, file, chunk.extractStartMs, chunk.extractEndMs, token::isCancelled);
                        token.check();
                        holdWakeLock(10 * 60 * 1000L);
                        progress(id, "transcribing", "음성 인식 " + (chunk.index + 1) + "/" + total);
                        JSONObject raw = api.transcribe(file, settings);
                        JSONArray cues = Transcript.normalize(raw, chunk.extractStartMs, chunk.startMs, chunk.endMs);
                        int batches = settings.optBoolean("translate", true) ? (cues.length() + JobStore.BATCH_SIZE - 1) / JobStore.BATCH_SIZE : 0;
                        store.saveTranscription(id, chunk.index, raw, cues, batches);
                    } finally {
                        // This is only our regenerable AAC cache, never the source content URI.
                        if (file.exists()) file.delete();
                    }
                }
                token.check();
                JSONArray cues = store.transcriptionCues(id, chunk.index);
                int batches = store.batchCount(id, chunk.index);
                for (int batch = 0; batch < batches; batch++) {
                    token.check();
                    if (store.hasTranslation(id, chunk.index, batch)) continue;
                    holdWakeLock(10 * 60 * 1000L);
                    progress(id, "translating", "번역 " + (chunk.index + 1) + "/" + total + " · " + (batch + 1) + "/" + batches);
                    int first = batch * JobStore.BATCH_SIZE;
                    JSONArray translated = api.translate(JobStore.slice(cues, first, Math.min(cues.length(), first + JobStore.BATCH_SIZE)), settings);
                    store.saveTranslation(id, chunk.index, batch, translated);
                }
                token.check();
                store.completeChunk(id, chunk.index);
                progress(id, "checkpoint", "구간 저장 " + (chunk.index + 1) + "/" + total);
            } finally { releaseWakeLock(); }
        }
    }

    private void progress(String id, String stage, String text) {
        store.stage(id, stage);
        JSONObject job = store.get(id);
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(text, job.optInt("completedChunks"), job.optInt("totalChunks")));
    }

    private Notification notification(String text, int done, int total) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent pause = new Intent(this, JobService.class).setAction(PAUSE);
        if (activeId != null) pause.putExtra("jobId", activeId);
        PendingIntent pauseIntent = PendingIntent.getService(this, 1, pause, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_subtitles).setContentTitle("자막 만들기")
            .setContentText(text).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .setProgress(total, done, total == 0).addAction(new Notification.Action.Builder(null, "일시정지", pauseIntent).build()).build();
    }

    /** Android 15+ gives only a few seconds after this callback; stop immediately. */
    @Override public void onTimeout(int startId, int foregroundServiceType) {
        stopping = true;
        OpenAiClient.Cancellation token = cancellation;
        if (token != null) token.cancel();
        store.pauseRunnable(null, "Android의 백그라운드 처리 시간이 끝났습니다. 앱에서 이어하기를 눌러 주세요.");
        releaseWakeLock();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        stopping = true;
        OpenAiClient.Cancellation token = cancellation;
        if (token != null) token.cancel();
        releaseWakeLock();
        // The same executor closes the DB only after any in-flight durable save has finished.
        WORKER.execute(store::close);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
    private synchronized void holdWakeLock(long timeoutMs) { wakeLock.acquire(timeoutMs); }
    private synchronized void releaseWakeLock() { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); }
    private void cleanOldAudioCache() {
        File directory = new File(getCacheDir(), "subtitle-engine");
        File[] files = directory.listFiles();
        if (files == null) return;
        long expired = System.currentTimeMillis() - 24 * 60 * 60 * 1000L;
        int checked = 0;
        for (File file : files) {
            if (++checked > 500) break;
            // Only old engine cache files, never selected media or other app cache entries.
            if (file.isFile() && file.lastModified() < expired && (file.getName().matches("subtitle-audio-[a-f0-9-]+-[0-9]+\\.m4a") || file.getName().matches("audio-chunk-[a-zA-Z0-9_-]+\\.pending"))) file.delete();
        }
    }
    private String safeError(Exception error) {
        if (error instanceof org.json.JSONException) return "API 응답 형식이 올바르지 않습니다. 이어하기로 재시도해 주세요.";
        String message = error.getMessage();
        if (message == null || message.isEmpty()) message = "처리 중 오류가 발생했습니다. 이어하기로 재시도해 주세요.";
        try { String key = new SecretStore(this).getKey(); if (!key.isEmpty()) message = message.replace(key, "[REDACTED]"); } catch (RuntimeException ignored) { }
        return message.substring(0, Math.min(message.length(), 1000));
    }
}
