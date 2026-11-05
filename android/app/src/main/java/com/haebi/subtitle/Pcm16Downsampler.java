package com.haebi.subtitle;

/** Converts decoded 8-96kHz PCM16 mono samples into 16kHz without holding the audio in RAM. */
final class Pcm16Downsampler {
    interface Sink { void write(short[] pcm, int count) throws Exception; }
    static final int OUTPUT_RATE = 16_000;
    private final int inputRate;
    private final short[] buffer = new short[2048];
    private final Sink sink;
    private long sourceFrames, outputFrames;
    private short previous;
    private int filled;

    Pcm16Downsampler(int sampleRate, Sink sink) {
        if (sampleRate < 8000 || sampleRate > 192000) throw new IllegalArgumentException("지원하지 않는 샘플링 주파수입니다.");
        this.inputRate = sampleRate;
        this.sink = sink;
    }

    void accept(short mono) throws Exception {
        long frame = sourceFrames++;
        // Generate each output sample when the right-hand source frame becomes available.
        while (outputFrames * inputRate <= frame * (long) OUTPUT_RATE) {
            double inputPosition = outputFrames * (double) inputRate / OUTPUT_RATE;
            double phase = frame == 0 ? 1d : Math.max(0d, Math.min(1d, inputPosition - frame + 1d));
            int value = (int) Math.round(previous * (1d - phase) + mono * phase);
            buffer[filled++] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, value));
            outputFrames++;
            if (filled == buffer.length) flush();
        }
        previous = mono;
    }

    void flush() throws Exception {
        if (filled > 0) {
            sink.write(buffer, filled);
            filled = 0;
        }
    }

    double elapsedSeconds() { return outputFrames / (double) OUTPUT_RATE; }
    long outputSamples() { return outputFrames; }
}