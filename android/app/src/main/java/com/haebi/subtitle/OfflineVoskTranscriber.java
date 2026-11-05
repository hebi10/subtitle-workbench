package com.haebi.subtitle;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.SystemClock;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.atomic.AtomicBoolean;

import org.json.JSONArray;
import org.vosk.Model;
import org.vosk.Recognizer;

/** Decodes audio/video to 16kHz mono PCM and runs Vosk entirely on the Android device. */
final class OfflineVoskTranscriber {
    interface Progress { void update(String message, int percent, int cues); }
    static final long MAX_FILE_US = 60L * 60 * 1_000_000L;
    private static final long CODEC_TIMEOUT_US = 10_000L;
    private final Context context;

    OfflineVoskTranscriber(Context context) { this.context = context.getApplicationContext(); }

    JSONArray run(Uri source, File modelDir, AtomicBoolean cancelled, Progress progress) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec decoder = null;
        try {
            extractor.setDataSource(context, source, null);
            int track = -1;
            MediaFormat encoded = null;
            for (int index = 0; index < extractor.getTrackCount(); index++) {
                MediaFormat candidate = extractor.getTrackFormat(index);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = index;
                    encoded = candidate;
                    break;
                }
            }
            if (track < 0) throw new IOException("선택한 파일에 음성 트랙이 없습니다.");
            long durationUs = encoded.containsKey(MediaFormat.KEY_DURATION)
                    ? encoded.getLong(MediaFormat.KEY_DURATION) : -1;
            if (durationUs <= 0) throw new IOException("파일의 음성 재생 길이를 확인할 수 없습니다.");
            if (durationUs > MAX_FILE_US) throw new IOException("로컬 AI 전사는 최대 60분 파일까지 지원합니다.");
            extractor.selectTrack(track);
            String mime = encoded.getString(MediaFormat.KEY_MIME);
            if (mime == null || mime.isEmpty()) throw new IOException("오디오 형식을 확인할 수 없습니다.");

            decoder = MediaCodec.createDecoderByType(mime);
            decoder.configure(encoded, null, null, 0);
            decoder.start();
            progress.update("로컬 AI 모델을 불러오는 중", 0, 0);

            OfflineCueAccumulator cues = new OfflineCueAccumulator();
            try (Model model = new Model(modelDir.getAbsolutePath());
                 Recognizer recognizer = new Recognizer(model, OfflineModelCatalog.SAMPLE_RATE_HZ)) {
                recognizer.setWords(true);
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                boolean inputEnded = false, outputEnded = false;
                Pcm16Downsampler sampler = null;
                final double[] observedTime = {0d};
                long latestTimeUs = 0;
                long lastUpdate = 0;
                long lastCodecProgress = SystemClock.elapsedRealtime();
                while (!outputEnded) {
                    OfflineModelInstaller.requireNotCancelled(cancelled);
                    if (SystemClock.elapsedRealtime() - lastCodecProgress > 90_000L)
                        throw new IOException("오디오 디코더 응답 시간이 초과되었습니다.");
                    if (!inputEnded) {
                        int index = decoder.dequeueInputBuffer(CODEC_TIMEOUT_US);
                        if (index >= 0) {
                            ByteBuffer in = decoder.getInputBuffer(index);
                            if (in == null) throw new IOException("디코더 입력 버퍼를 읽을 수 없습니다.");
                            in.clear();
                            int bytes = extractor.readSampleData(in, 0);
                            if (bytes < 0) {
                                decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                inputEnded = true;
                            } else {
                                long pts = Math.max(0, extractor.getSampleTime());
                                decoder.queueInputBuffer(index, 0, bytes, pts, 0);
                                extractor.advance();
                            }
                            lastCodecProgress = SystemClock.elapsedRealtime();
                        }
                    }

                    int index = decoder.dequeueOutputBuffer(info, CODEC_TIMEOUT_US);
                    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (sampler != null) throw new IOException("처리 중 오디오 형식이 변경되었습니다.");
                        lastCodecProgress = SystemClock.elapsedRealtime();
                    } else if (index >= 0) {
                        try {
                            lastCodecProgress = SystemClock.elapsedRealtime();
                            if (info.size > 0) {
                                MediaFormat decoded = decoder.getOutputFormat(index);
                                int rate = decoded.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                                int channels = decoded.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                                int encoding = decoded.containsKey(MediaFormat.KEY_PCM_ENCODING)
                                        ? decoded.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
                                if (rate < 8_000 || rate > 192_000 || channels < 1 || channels > 8 ||
                                        (encoding != AudioFormat.ENCODING_PCM_16BIT &&
                                         encoding != AudioFormat.ENCODING_PCM_FLOAT))
                                    throw new IOException("지원하지 않는 PCM 오디오 출력 형식입니다.");
                                if (sampler == null) {
                                    sampler = new Pcm16Downsampler(rate, (samples, count) -> {
                                        if (recognizer.acceptWaveForm(samples, count))
                                            cues.appendResult(recognizer.getResult(), observedTime[0]);
                                    });
                                }
                                ByteBuffer output = decoder.getOutputBuffer(index);
                                if (output == null) throw new IOException("디코더 출력 버퍼를 읽을 수 없습니다.");
                                output.position(info.offset);
                                output.limit(info.offset + info.size);
                                output.order(ByteOrder.LITTLE_ENDIAN);
                                int bytesPerSample = encoding == AudioFormat.ENCODING_PCM_FLOAT ? 4 : 2;
                                int frameSize = channels * bytesPerSample;
                                if (info.size % frameSize != 0) throw new IOException("불완전한 PCM 오디오 샘플입니다.");
                                int frames = info.size / frameSize;
                                for (int frame = 0; frame < frames; frame++) {
                                    if ((frame & 511) == 0) OfflineModelInstaller.requireNotCancelled(cancelled);
                                    double sum = 0;
                                    for (int channel = 0; channel < channels; channel++) {
                                        if (encoding == AudioFormat.ENCODING_PCM_FLOAT) {
                                            float value = output.getFloat();
                                            if (!Float.isFinite(value)) throw new IOException("오디오 샘플이 올바르지 않습니다.");
                                            sum += Math.max(-1d, Math.min(1d, value)) * 32767;
                                        } else {
                                            sum += output.getShort();
                                        }
                                    }
                                    long averaged = Math.round(sum / channels);
                                    sampler.accept((short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, averaged)));
                                }
                                observedTime[0] = sampler.elapsedSeconds();
                                latestTimeUs = Math.max(latestTimeUs, info.presentationTimeUs);
                                long now = SystemClock.elapsedRealtime();
                                if (now - lastUpdate >= 500) {
                                    lastUpdate = now;
                                    progress.update("오프라인 음성 인식 중",
                                            (int) Math.min(99, latestTimeUs * 100 / durationUs), cues.size());
                                }
                            }
                            if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputEnded = true;
                        } finally { decoder.releaseOutputBuffer(index, false); }
                    }
                }
                if (sampler == null) throw new IOException("디코더가 오디오 샘플을 반환하지 않았습니다.");
                sampler.flush();
                cues.appendResult(recognizer.getFinalResult(), sampler.elapsedSeconds());
            }
            JSONArray result = cues.snapshot();
            progress.update(result.length() > 0 ? "로컬 음성 인식 완료" : "인식된 문장이 없습니다.",
                    100, result.length());
            return result;
        } finally {
            if (decoder != null) {
                try { decoder.stop(); } catch (RuntimeException ignored) {}
                decoder.release();
            }
            extractor.release();
        }
    }
}