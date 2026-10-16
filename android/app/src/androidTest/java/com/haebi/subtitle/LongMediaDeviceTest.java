package com.haebi.subtitle;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
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
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Exercises a real 150-minute MP4 timeline with synthetic repeated AVC/AAC samples.
 * This checks duration, seeking and tail extraction, not movie quality or speech/API accuracy.
 */
@RunWith(AndroidJUnit4.class)
public final class LongMediaDeviceTest {
    private static final int SAMPLE_RATE = 24_000;
    private static final long DURATION_US = 150L * 60 * 1_000_000;

    @Test(timeout = 120_000L)
    public void extractsLastChunkFromOneHundredFiftyMinuteVideo() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        File directory = Files.createTempDirectory(context.getCacheDir().toPath(), "long-media-test-").toFile();
        long deadline = SystemClock.elapsedRealtime() + 110_000L;
        try {
            MediaChunks media = new MediaChunks(context);
            File wave = makeOneSecondWave(directory);
            File seedAudio = new File(directory, "seed.m4a");
            media.export(Uri.fromFile(wave), seedAudio, 0L, 1_000L, () -> expired(deadline));
            EncodedSample audio = readAudioSample(seedAudio);
            EncodedSample video = encodeVideoKeyFrame(deadline);
            File source = new File(directory, "synthetic-150-minutes.mp4");
            repeatSamples(source, audio, video, deadline);

            MediaChunks.Info input = media.inspect(Uri.fromFile(source));
            assertTrue(input.hasAudio);
            // AAC-LC carries 1024 samples/frame: one frame may extend past the requested endpoint.
            assertTrue("Source duration: " + input.durationMs,
                    input.durationMs >= 9_000_000L && input.durationMs <= 9_000_150L);
            MediaExtractor sourceTracks = new MediaExtractor();
            try {
                sourceTracks.setDataSource(source.getAbsolutePath());
                assertEquals(2, sourceTracks.getTrackCount());
            } finally {
                sourceTracks.release();
            }
            List<ChunkPlan.Segment> plan = ChunkPlan.create(input.durationMs, 420_000L, 500L);
            assertEquals(22, plan.size());
            ChunkPlan.Segment tail = plan.get(21);
            assertEquals(8_820_000L, tail.startMs);
            assertEquals(8_819_500L, tail.extractStartMs);
            File output = new File(directory, "last-chunk.m4a");
            media.export(Uri.fromFile(source), output, tail.extractStartMs, tail.extractEndMs,
                    () -> expired(deadline));
            assertTrue(output.length() > 0L);
            assertTrue(output.length() < 8L * 1024 * 1024);
            long expectedDuration = tail.extractEndMs - tail.extractStartMs;
            MediaChunks.Info extracted = media.inspect(Uri.fromFile(output));
            assertTrue("Tail duration: " + extracted.durationMs,
                    Math.abs(extracted.durationMs - expectedDuration) <= 200L);
            MediaExtractor result = new MediaExtractor();
            try {
                result.setDataSource(output.getAbsolutePath());
                assertEquals(1, result.getTrackCount());
                MediaFormat format = result.getTrackFormat(0);
                assertEquals("audio/mp4a-latm", format.getString(MediaFormat.KEY_MIME));
                assertEquals(SAMPLE_RATE, format.getInteger(MediaFormat.KEY_SAMPLE_RATE));
                assertEquals(1, format.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
            } finally {
                result.release();
            }
            File[] pending = directory.listFiles((dir, name) -> name.endsWith(".pending"));
            assertNotNull(pending);
            assertEquals(0, pending.length);
            checkDeadline(deadline);
        } finally {
            // Only this test's newly created private directory is cleaned; selected media is untouched.
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) Files.deleteIfExists(file.toPath());
            Files.deleteIfExists(directory.toPath());
        }
    }

    private static File makeOneSecondWave(File directory) throws Exception {
        int byteCount = SAMPLE_RATE * 2;
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + byteCount);
        header.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16);
        header.putShort((short) 1).putShort((short) 1).putInt(SAMPLE_RATE);
        header.putInt(SAMPLE_RATE * 2).putShort((short) 2).putShort((short) 16);
        header.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(byteCount);
        File file = new File(directory, "seed.wav");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(header.array());
            ByteBuffer samples = ByteBuffer.allocate(2_400 * 2).order(ByteOrder.LITTLE_ENDIAN);
            for (int frame = 0; frame < SAMPLE_RATE; frame++) {
                samples.putShort((short) (8_000 * Math.sin(frame * 2 * Math.PI * 440 / SAMPLE_RATE)));
                if (!samples.hasRemaining()) {
                    output.write(samples.array());
                    samples.clear();
                }
            }
        }
        return file;
    }

    private static EncodedSample readAudioSample(File file) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(file.getAbsolutePath());
            assertEquals(1, extractor.getTrackCount());
            MediaFormat source = extractor.getTrackFormat(0);
            MediaFormat format = MediaFormat.createAudioFormat("audio/mp4a-latm", SAMPLE_RATE, 1);
            copyCodecData(source, format);
            extractor.selectTrack(0);
            extractor.seekTo(200_000L, MediaExtractor.SEEK_TO_NEXT_SYNC);
            ByteBuffer buffer = ByteBuffer.allocate(64 * 1024);
            int size = extractor.readSampleData(buffer, 0);
            assertTrue(size > 0 && size <= buffer.capacity());
            byte[] sample = new byte[size];
            buffer.position(0);
            buffer.get(sample);
            return new EncodedSample(format, sample);
        } finally {
            extractor.release();
        }
    }

    private static EncodedSample encodeVideoKeyFrame(long deadline) throws Exception {
        MediaCodec encoder = MediaCodec.createEncoderByType("video/avc");
        MediaFormat requested = MediaFormat.createVideoFormat("video/avc", 320, 240);
        requested.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
        requested.setInteger(MediaFormat.KEY_BIT_RATE, 128_000);
        requested.setInteger(MediaFormat.KEY_FRAME_RATE, 10);
        requested.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
        try {
            encoder.configure(requested, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();
            byte[] frame = new byte[320 * 240 * 3 / 2];
            Arrays.fill(frame, 0, 320 * 240, (byte) 16);
            Arrays.fill(frame, 320 * 240, frame.length, (byte) 128);
            int submitted = 0;
            boolean inputEnded = false;
            boolean outputEnded = false;
            MediaFormat format = null;
            byte[] sample = null;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            long codecDeadline = Math.min(deadline, SystemClock.elapsedRealtime() + 15_000L);
            while (!outputEnded) {
                checkDeadline(codecDeadline);
                if (!inputEnded) {
                    int input = encoder.dequeueInputBuffer(10_000L);
                    if (input >= 0) {
                        ByteBuffer buffer = encoder.getInputBuffer(input);
                        assertNotNull(buffer);
                        buffer.clear();
                        if (submitted < 2) {
                            buffer.put(frame);
                            encoder.queueInputBuffer(input, 0, frame.length, submitted * 100_000L, 0);
                            submitted++;
                        } else {
                            encoder.queueInputBuffer(input, 0, 0, 200_000L, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnded = true;
                        }
                    }
                }
                int output = encoder.dequeueOutputBuffer(info, 10_000L);
                if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    format = MediaFormat.createVideoFormat("video/avc", 320, 240);
                    copyCodecData(encoder.getOutputFormat(), format);
                } else if (output >= 0) {
                    if (sample == null && info.size > 0
                            && (info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0
                            && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        assertTrue(info.size <= 64 * 1024);
                        ByteBuffer buffer = encoder.getOutputBuffer(output);
                        assertNotNull(buffer);
                        buffer.position(info.offset);
                        buffer.limit(info.offset + info.size);
                        sample = new byte[info.size];
                        buffer.get(sample);
                    }
                    outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    encoder.releaseOutputBuffer(output, false);
                }
            }
            assertNotNull(format);
            assertNotNull(sample);
            return new EncodedSample(format, sample);
        } finally {
            encoder.release();
        }
    }

    private static void repeatSamples(File file, EncodedSample audio, EncodedSample video,
            long deadline) throws Exception {
        MediaMuxer muxer = new MediaMuxer(file.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        boolean started = false;
        try {
            int audioTrack = muxer.addTrack(audio.format);
            int videoTrack = muxer.addTrack(video.format);
            muxer.start();
            started = true;
            ByteBuffer audioBuffer = ByteBuffer.wrap(audio.bytes);
            ByteBuffer videoBuffer = ByteBuffer.wrap(video.bytes);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            long nextVideoUs = 0L;
            for (long frame = 0L; ; frame++) {
                long audioUs = frame * 1_024L * 1_000_000L / SAMPLE_RATE;
                if (audioUs >= DURATION_US) break;
                if ((frame & 511L) == 0L) checkDeadline(deadline);
                while (nextVideoUs <= audioUs) {
                    videoBuffer.position(0);
                    info.set(0, video.bytes.length, nextVideoUs, MediaCodec.BUFFER_FLAG_KEY_FRAME);
                    muxer.writeSampleData(videoTrack, videoBuffer, info);
                    nextVideoUs += 1_000_000L;
                }
                audioBuffer.position(0);
                info.set(0, audio.bytes.length, audioUs, 0);
                muxer.writeSampleData(audioTrack, audioBuffer, info);
            }
        } finally {
            try { if (started) muxer.stop(); }
            finally { muxer.release(); }
        }
    }

    private static void copyCodecData(MediaFormat source, MediaFormat destination) {
        for (String key : new String[] {"csd-0", "csd-1"}) {
            if (!source.containsKey(key)) continue;
            ByteBuffer buffer = source.getByteBuffer(key);
            assertNotNull(buffer);
            ByteBuffer copy = buffer.duplicate();
            assertTrue(copy.remaining() <= 64 * 1024);
            byte[] bytes = new byte[copy.remaining()];
            copy.get(bytes);
            destination.setByteBuffer(key, ByteBuffer.wrap(bytes));
        }
    }

    private static boolean expired(long deadline) {
        return Thread.currentThread().isInterrupted() || SystemClock.elapsedRealtime() >= deadline;
    }

    private static void checkDeadline(long deadline) {
        assertTrue("Synthetic long-media test exceeded its time budget", !expired(deadline));
    }

    private static final class EncodedSample {
        final MediaFormat format;
        final byte[] bytes;
        EncodedSample(MediaFormat format, byte[] bytes) {
            this.format = format;
            this.bytes = bytes;
        }
    }
}
