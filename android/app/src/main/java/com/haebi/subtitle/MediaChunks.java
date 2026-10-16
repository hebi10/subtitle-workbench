package com.haebi.subtitle;

import android.content.Context;
import android.database.Cursor;
import android.media.MediaCodecInfo;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.audio.ChannelMixingAudioProcessor;
import androidx.media3.common.audio.ChannelMixingMatrix;
import androidx.media3.common.audio.SonicAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.transformer.AudioEncoderSettings;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Collections;
import java.util.Objects;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Streams a bounded audio clip from the original SAF URI, without copying the source file. */
@OptIn(markerClass = UnstableApi.class)
public final class MediaChunks {
    private static final long MAX_CLIP_MS = 421_000L;
    private static final long MAX_OUTPUT_BYTES = 8L * 1024 * 1024;
    private static final int OUTPUT_SAMPLE_RATE = 24_000;
    private static final int OUTPUT_BITRATE = 64_000;
    private static final long CANCEL_WAIT_MS = 5_000L;
    private static final long METADATA_TIMEOUT_MS = 60_000L;
    // Some SAF providers block in native I/O despite interruption. Keep callers bounded without
    // creating an unbounded number of blocked threads or queued requests after repeated retries.
    private static final ThreadPoolExecutor METADATA = new ThreadPoolExecutor(1, 1, 0L,
            TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(1), task -> {
                Thread thread = new Thread(task, "subtitle-media-metadata");
                thread.setDaemon(true);
                return thread;
            });
    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public MediaChunks(Context context) {
        this.context = Objects.requireNonNull(context).getApplicationContext();
    }

    public static final class Info {
        public final long durationMs;
        public final String displayName;
        public final boolean hasAudio;

        private Info(long durationMs, String displayName, boolean hasAudio) {
            this.durationMs = durationMs;
            this.displayName = displayName;
            this.hasAudio = hasAudio;
        }
    }

    public static final class NoAudioException extends IOException {
        public NoAudioException() {
            super("선택한 영상에 오디오 트랙이 없습니다.");
        }
    }

    /** The caller retains the SAF read grant when the source is selected with ACTION_OPEN_DOCUMENT. */
    public Info inspect(Uri uri) throws IOException {
        try {
            return inspect(uri, () -> false);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            InterruptedIOException error = new InterruptedIOException("미디어 정보 확인이 중단되었습니다.");
            error.initCause(interrupted);
            throw error;
        }
    }

    Info inspect(Uri uri, BooleanSupplier cancelled) throws IOException, InterruptedException {
        Objects.requireNonNull(uri, "uri");
        checkCancelled(cancelled);
        Future<Info> future;
        try {
            future = METADATA.submit(() -> readInfo(uri));
        } catch (RejectedExecutionException busy) {
            throw new IOException("다른 파일 정보 확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.", busy);
        }
        long started = SystemClock.elapsedRealtime();
        try {
            while (true) {
                checkCancelled(cancelled);
                try {
                    return future.get(100, TimeUnit.MILLISECONDS);
                } catch (TimeoutException waiting) {
                    if (SystemClock.elapsedRealtime() - started >= METADATA_TIMEOUT_MS) {
                        throw new IOException("파일 정보 확인 시간이 초과되었습니다. 기기에 저장된 파일을 선택해 주세요.");
                    }
                } catch (ExecutionException error) {
                    if (error.getCause() instanceof IOException) throw (IOException) error.getCause();
                    throw new IOException("미디어 정보를 읽을 수 없습니다.", error.getCause());
                }
            }
        } finally {
            future.cancel(true);
            METADATA.purge();
        }
    }

    private Info readInfo(Uri uri) throws IOException {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            // A content URI is kept intact; resolving a guessed filesystem path breaks SAF grants.
            retriever.setDataSource(context, uri);
            String durationText = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            long durationMs = durationText == null ? 0 : Long.parseLong(durationText);
            if (durationMs <= 0) throw new IOException("영상 길이를 확인할 수 없습니다.");
            boolean hasAudio = "yes".equalsIgnoreCase(
                    retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO));
            return new Info(durationMs, displayName(uri), hasAudio);
        } catch (RuntimeException error) {
            throw new IOException("미디어를 읽을 수 없습니다. 원본 파일과 접근 권한을 확인해 주세요.", error);
        } finally {
            // close()/AutoCloseable were introduced in API 29; release() also works on minSdk 26.
            retriever.release();
        }
    }

    /**
     * Blocks a worker thread until the AAC MP4 clip is atomically published to destination.
     * Throws CancellationException on a requested pause. A failed export preserves an existing file.
     */
    public void export(Uri uri, File destination, long startMs, long endMs, BooleanSupplier cancelled)
            throws IOException, InterruptedException {
        export(uri, destination, startMs, endMs, cancelled, percent -> { });
    }

    /** Reports measured extraction progress at most once per second; null means unavailable. */
    public void export(Uri uri, File destination, long startMs, long endMs, BooleanSupplier cancelled,
            Consumer<Integer> progress) throws IOException, InterruptedException {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw new IllegalStateException("오디오 추출은 백그라운드 스레드에서 실행해야 합니다.");
        }
        Objects.requireNonNull(uri, "uri");
        Objects.requireNonNull(destination, "destination");
        Objects.requireNonNull(cancelled, "cancelled");
        Objects.requireNonNull(progress, "progress");
        if (startMs < 0 || endMs <= startMs || endMs - startMs > MAX_CLIP_MS
                || endMs > Long.MAX_VALUE / 1_000) {
            throw new IllegalArgumentException("오디오 추출 범위가 올바르지 않습니다.");
        }
        checkCancelled(cancelled);
        Info info = inspect(uri, cancelled);
        if (!info.hasAudio) throw new NoAudioException();
        if (startMs >= info.durationMs || endMs > info.durationMs) {
            throw new IllegalArgumentException("오디오 추출 범위가 영상 길이를 벗어났습니다.");
        }
        checkCancelled(cancelled);
        File output = destination.getAbsoluteFile();
        File parent = output.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
            throw new IOException("오디오 임시 저장 폴더를 만들 수 없습니다.");
        }
        File pending = File.createTempFile("audio-chunk-", ".pending", parent);
        ExportSession session = new ExportSession(uri, pending, startMs, endMs);
        try {
            if (!mainHandler.post(session::start)) {
                throw new IOException("오디오 추출 작업을 시작할 수 없습니다.");
            }
            // A separate wall-clock cap also covers a missing callback or an unresponsive main loop.
            long timeoutMs = Math.max(120_000L, (endMs - startMs) * 4L);
            long started = SystemClock.elapsedRealtime();
            long lastReportedAt = started;
            int lastPercent = -1;
            while (!session.finished.await(100, TimeUnit.MILLISECONDS)) {
                checkCancelled(cancelled);
                long now = SystemClock.elapsedRealtime();
                int percent = session.percent.get();
                if (now - lastReportedAt >= 1_000L && percent != lastPercent) {
                    progress.accept(percent < 0 ? null : percent);
                    lastPercent = percent;
                    lastReportedAt = now;
                }
                if (pending.length() > MAX_OUTPUT_BYTES) {
                    throw new IOException("추출된 오디오가 허용 크기를 초과했습니다.");
                }
                if (SystemClock.elapsedRealtime() - started >= timeoutMs) {
                    throw new IOException("오디오 추출 시간이 초과되었습니다. 다시 이어하기를 실행해 주세요.");
                }
            }
            checkCancelled(cancelled);
            if (session.failure != null) throw session.failure;
            ExportResult result = session.result;
            if (result == null || !MimeTypes.AUDIO_AAC.equals(result.audioMimeType)
                    || result.channelCount != 1 || result.sampleRate != OUTPUT_SAMPLE_RATE
                    || pending.length() <= 0 || pending.length() > MAX_OUTPUT_BYTES) {
                throw new IOException("올바른 오디오 구간을 생성하지 못했습니다.");
            }
            // Sync the closed muxer output before publishing. No file contents are loaded into RAM.
            try (FileInputStream input = new FileInputStream(pending)) {
                input.getFD().sync();
            }
            checkCancelled(cancelled);
            Files.move(pending.toPath(), output.toPath(),
                    StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            progress.accept(100);
        } catch (IOException | InterruptedException | RuntimeException error) {
            IOException cleanupFailure = session.abort();
            if (cleanupFailure != null) error.addSuppressed(cleanupFailure);
            if (error instanceof InterruptedException) Thread.currentThread().interrupt();
            throw error;
        }
    }

    private String displayName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = context.getContentResolver().query(uri,
                    new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    String name = column < 0 ? null : cursor.getString(column);
                    if (name != null && !name.trim().isEmpty()) return name;
                }
            } catch (RuntimeException ignored) {
                // The provider may permit playback while not exposing a display name.
            }
        }
        String last = uri.getLastPathSegment();
        return last == null || last.trim().isEmpty() ? "선택한 영상" : last;
    }

    private static void checkCancelled(BooleanSupplier cancelled) throws InterruptedException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException("오디오 추출 중단");
        if (cancelled.getAsBoolean()) throw new CancellationException("오디오 추출 일시정지");
    }

    private final class ExportSession {
        private final Uri uri;
        private final File pending;
        private final long startMs;
        private final long endMs;
        private final CountDownLatch finished = new CountDownLatch(1);
        private final AtomicBoolean abandoned = new AtomicBoolean();
        private final AtomicInteger percent = new AtomicInteger(-1);
        private final Runnable pollProgress = new Runnable() {
            @Override public void run() {
                if (abandoned.get() || finished.getCount() == 0 || transformer == null) return;
                ProgressHolder holder = new ProgressHolder();
                if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
                    percent.set(Math.max(0, Math.min(100, holder.progress)));
                }
                mainHandler.postDelayed(this, 250L);
            }
        };
        // Transformer is exclusively accessed on the main looper, including during cancellation.
        private Transformer transformer;
        private ExportResult result;
        private IOException failure;

        private ExportSession(Uri uri, File pending, long startMs, long endMs) {
            this.uri = uri;
            this.pending = pending;
            this.startMs = startMs;
            this.endMs = endMs;
        }

        private void start() {
            if (abandoned.get()) return;
            try {
                ChannelMixingAudioProcessor mono = new ChannelMixingAudioProcessor();
                for (int channels = 1; channels <= 8; channels++) {
                    float[] weights = new float[channels];
                    Arrays.fill(weights, 1f / channels);
                    mono.putChannelMixingMatrix(new ChannelMixingMatrix(channels, 1, weights));
                }
                SonicAudioProcessor resampler = new SonicAudioProcessor();
                resampler.setOutputSampleRateHz(OUTPUT_SAMPLE_RATE);
                MediaItem source = new MediaItem.Builder().setUri(uri)
                        .setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder()
                                .setStartPositionMs(startMs).setEndPositionMs(endMs).build())
                        .build();
                EditedMediaItem clip = new EditedMediaItem.Builder(source)
                        .setRemoveVideo(true)
                        .setEffects(new Effects(Arrays.asList(mono, resampler), Collections.emptyList()))
                        .build();
                // Non-default AudioEncoderSettings force decoding/re-encoding even for AAC input.
                DefaultEncoderFactory encoder = new DefaultEncoderFactory.Builder(context)
                        .setEnableFallback(false)
                        .setRequestedAudioEncoderSettings(new AudioEncoderSettings.Builder()
                                .setBitrate(OUTPUT_BITRATE)
                                .setProfile(MediaCodecInfo.CodecProfileLevel.AACObjectLC).build())
                        .build();
                transformer = new Transformer.Builder(context)
                        .setLooper(Looper.getMainLooper())
                        .setAudioMimeType(MimeTypes.AUDIO_AAC)
                        .setEncoderFactory(encoder)
                        .setMaxDelayBetweenMuxerSamplesMs(60_000L)
                        .addListener(new Transformer.Listener() {
                            @Override
                            public void onCompleted(Composition composition, ExportResult exportResult) {
                                result = exportResult;
                                mainHandler.removeCallbacks(pollProgress);
                                finished.countDown();
                            }

                            @Override
                            public void onError(Composition composition, ExportResult exportResult,
                                    ExportException exportException) {
                                failure = new IOException("오디오 추출에 실패했습니다. 코덱 또는 원본 파일을 확인해 주세요.",
                                        exportException);
                                mainHandler.removeCallbacks(pollProgress);
                                finished.countDown();
                            }
                        }).build();
                transformer.start(clip, pending.getAbsolutePath());
                mainHandler.post(pollProgress);
            } catch (RuntimeException error) {
                failure = new IOException("오디오 변환기를 시작할 수 없습니다.", error);
                finished.countDown();
            }
        }

        private IOException abort() {
            abandoned.set(true);
            CountDownLatch stopped = new CountDownLatch(1);
            IOException[] cleanupFailure = new IOException[1];
            boolean posted = mainHandler.post(() -> {
                try {
                    mainHandler.removeCallbacks(pollProgress);
                    if (transformer != null) transformer.cancel();
                    Files.deleteIfExists(pending.toPath());
                } catch (IOException | RuntimeException error) {
                    cleanupFailure[0] = new IOException("오디오 임시 파일 정리를 마치지 못했습니다.", error);
                } finally {
                    stopped.countDown();
                }
            });
            if (!posted) return new IOException("오디오 변환 중단을 전달하지 못했습니다.");
            try {
                if (!stopped.await(CANCEL_WAIT_MS, TimeUnit.MILLISECONDS)) {
                    // Keep cleanup queued. Never remove a file while its muxer may still be writing.
                    return new IOException("오디오 변환 중단 확인 시간이 초과되었습니다.");
                }
                return cleanupFailure[0];
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return new IOException("오디오 변환 중단 확인이 중단되었습니다.", interrupted);
            }
        }
    }
}
