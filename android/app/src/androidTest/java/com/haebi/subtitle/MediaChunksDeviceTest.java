package com.haebi.subtitle;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.SystemClock;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CancellationException;
import java.util.Arrays;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Uses real Android media codecs. Run with connectedDebugAndroidTest on a device/emulator. */
@RunWith(AndroidJUnit4.class)
public final class MediaChunksDeviceTest {
    private Context context;
    private File directory;
    private MediaChunks chunks;

    @Before
    public void setUp() throws Exception {
        context = ApplicationProvider.getApplicationContext();
        directory = Files.createTempDirectory(context.getCacheDir().toPath(), "media-chunks-test-").toFile();
        chunks = new MediaChunks(context);
    }

    @After
    public void tearDown() throws Exception {
        File[] files = directory.listFiles();
        if (files != null) {
            for (File file : files) Files.deleteIfExists(file.toPath());
        }
        Files.deleteIfExists(directory.toPath());
    }

    @Test
    public void inspectReportsDurationAndAudio() throws Exception {
        File wave = makeWave("source.wav", 2);
        MediaChunks.Info info = chunks.inspect(Uri.fromFile(wave));
        assertEquals(2_000L, info.durationMs);
        assertEquals("source.wav", info.displayName);
        assertTrue(info.hasAudio);
    }

    @Test
    public void exportClipsAndReencodesAacAtBoundedSampleRate() throws Exception {
        File wave = makeWave("source.wav", 2);
        File destination = new File(directory, "chunk.m4a");
        chunks.export(Uri.fromFile(wave), destination, 500L, 1_500L, () -> false);
        assertTrue(destination.length() > 0);
        MediaChunks.Info info = chunks.inspect(Uri.fromFile(destination));
        assertTrue(info.durationMs >= 900L && info.durationMs <= 1_150L);
        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(destination.getAbsolutePath());
            assertEquals(1, extractor.getTrackCount());
            MediaFormat format = extractor.getTrackFormat(0);
            assertEquals("audio/mp4a-latm", format.getString(MediaFormat.KEY_MIME));
            assertEquals(24_000, format.getInteger(MediaFormat.KEY_SAMPLE_RATE));
            assertEquals(1, format.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
        } finally {
            extractor.release();
        }
        assertNoPendingFiles();
    }

    @Test
    public void cancelledExportPreservesPreviouslyCompletedDestination() throws Exception {
        File wave = makeWave("source.wav", 2);
        File destination = new File(directory, "chunk.m4a");
        Files.write(destination.toPath(), "previous".getBytes(StandardCharsets.UTF_8));
        assertThrows(CancellationException.class,
                () -> chunks.export(Uri.fromFile(wave), destination, 0L, 1_000L, () -> true));
        assertEquals("previous", new String(Files.readAllBytes(destination.toPath()), StandardCharsets.UTF_8));
        assertNoPendingFiles();
    }

    @Test
    public void cancellationAfterStartingRemovesPendingOutput() throws Exception {
        File wave = makeWave("source.wav", 30);
        File destination = new File(directory, "chunk.m4a");
        // A pending file is created only after metadata checks, immediately before Transformer starts.
        assertThrows(CancellationException.class,
                () -> chunks.export(Uri.fromFile(wave), destination, 0L, 30_000L,
                        () -> {
                            File[] pending = directory.listFiles((dir, name) -> name.endsWith(".pending"));
                            return pending != null && pending.length > 0;
                        }));
        assertFalse(destination.exists());
        assertNoPendingFiles();
    }

    @Test
    public void invalidRangesAndUnreadableSourcesDoNotPublishOutput() throws Exception {
        File wave = makeWave("source.wav", 2);
        File destination = new File(directory, "chunk.m4a");
        assertThrows(IllegalArgumentException.class,
                () -> chunks.export(Uri.fromFile(wave), destination, 0L, 421_001L, () -> false));
        assertThrows(IllegalArgumentException.class,
                () -> chunks.export(Uri.fromFile(wave), destination, -1L, 1_000L, () -> false));
        assertThrows(java.io.IOException.class,
                () -> chunks.export(Uri.fromFile(new File(directory, "missing.wav")), destination,
                        0L, 1_000L, () -> false));
        assertFalse(destination.exists());
        assertNoPendingFiles();
    }

    @Test
    public void videoWithoutAudioHasExplicitResultAndCannotProduceAChunk() throws Exception {
        File video = makeSilentVideo();
        MediaChunks.Info info = chunks.inspect(Uri.fromFile(video));
        assertTrue(info.durationMs > 0L);
        assertFalse(info.hasAudio);
        File destination = new File(directory, "chunk.m4a");
        assertThrows(MediaChunks.NoAudioException.class,
                () -> chunks.export(Uri.fromFile(video), destination, 0L, 500L, () -> false));
        assertFalse(destination.exists());
        assertNoPendingFiles();
    }

    private void assertNoPendingFiles() {
        File[] pending = directory.listFiles((dir, name) -> name.endsWith(".pending"));
        assertNotNull(pending);
        assertEquals(0, pending.length);
    }

    private File makeWave(String name, int seconds) throws Exception {
        int sampleRate = 48_000;
        int frames = seconds * sampleRate;
        int byteCount = frames * 4;
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + byteCount);
        header.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16);
        header.putShort((short) 1).putShort((short) 2).putInt(sampleRate);
        header.putInt(sampleRate * 4).putShort((short) 4).putShort((short) 16);
        header.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(byteCount);
        File wave = new File(directory, name);
        try (FileOutputStream output = new FileOutputStream(wave)) {
            output.write(header.array());
            ByteBuffer samples = ByteBuffer.allocate(4_800 * 4).order(ByteOrder.LITTLE_ENDIAN);
            for (int frame = 0; frame < frames; frame++) {
                short amplitude = (short) (8_000 * Math.sin(frame * 2 * Math.PI * 440 / sampleRate));
                samples.putShort(amplitude).putShort(amplitude);
                if (!samples.hasRemaining()) {
                    output.write(samples.array());
                    samples.clear();
                }
            }
            if (samples.position() > 0) output.write(samples.array(), 0, samples.position());
        }
        return wave;
    }

    private File makeSilentVideo() throws Exception {
        File file = new File(directory, "silent.mp4");
        MediaFormat format = MediaFormat.createVideoFormat("video/avc", 320, 240);
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
        format.setInteger(MediaFormat.KEY_BIT_RATE, 128_000);
        format.setInteger(MediaFormat.KEY_FRAME_RATE, 10);
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
        MediaCodec encoder = MediaCodec.createEncoderByType("video/avc");
        MediaMuxer muxer = new MediaMuxer(file.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        boolean muxerStarted = false;
        try {
            encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();
            byte[] frame = new byte[320 * 240 * 3 / 2];
            Arrays.fill(frame, 0, 320 * 240, (byte) 16);
            Arrays.fill(frame, 320 * 240, frame.length, (byte) 128);
            int submitted = 0;
            int track = -1;
            boolean inputEnded = false;
            boolean outputEnded = false;
            long deadline = SystemClock.elapsedRealtime() + 15_000L;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (!outputEnded && SystemClock.elapsedRealtime() < deadline) {
                if (!inputEnded) {
                    int input = encoder.dequeueInputBuffer(10_000L);
                    if (input >= 0) {
                        ByteBuffer buffer = encoder.getInputBuffer(input);
                        assertNotNull(buffer);
                        buffer.clear();
                        if (submitted < 20) {
                            buffer.put(frame);
                            encoder.queueInputBuffer(input, 0, frame.length, submitted * 100_000L, 0);
                            submitted++;
                        } else {
                            encoder.queueInputBuffer(input, 0, 0, 2_000_000L, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnded = true;
                        }
                    }
                }
                int output = encoder.dequeueOutputBuffer(info, 10_000L);
                if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    track = muxer.addTrack(encoder.getOutputFormat());
                    muxer.start();
                    muxerStarted = true;
                } else if (output >= 0) {
                    ByteBuffer buffer = encoder.getOutputBuffer(output);
                    assertNotNull(buffer);
                    if (info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        assertTrue(muxerStarted);
                        buffer.position(info.offset);
                        buffer.limit(info.offset + info.size);
                        muxer.writeSampleData(track, buffer, info);
                    }
                    outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    encoder.releaseOutputBuffer(output, false);
                }
            }
            assertTrue("Synthetic video encoding timed out", outputEnded);
        } finally {
            encoder.release();
            if (muxerStarted) muxer.stop();
            muxer.release();
        }
        return file;
    }
}
