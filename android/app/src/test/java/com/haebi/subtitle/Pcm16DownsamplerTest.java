package com.haebi.subtitle;

import java.util.ArrayList;
import org.junit.Test;
import static org.junit.Assert.*;

public class Pcm16DownsamplerTest {
    private static long count(int inputRate, int samples) throws Exception {
        final long[] total = {0};
        Pcm16Downsampler converter = new Pcm16Downsampler(inputRate, (data, length) -> {
            total[0] += length;
            for (int i = 0; i < length; i++) assertTrue(data[i] <= Short.MAX_VALUE);
        });
        for (int i = 0; i < samples; i++) converter.accept((short) (i % 256));
        converter.flush();
        assertEquals(converter.outputSamples(), total[0]);
        return total[0];
    }

    @Test public void supportsCommonAudioRatesWithoutDriftOrLargeAllocations() throws Exception {
        assertEquals(16_000, count(16_000, 16_000));
        assertEquals(16_000, count(48_000, 48_000));
        assertEquals(16_000, count(44_100, 44_100));
        assertEquals(16_000, count(8_000, 8_000));
    }

    @Test public void boundsUnsupportedRates() {
        assertThrows(IllegalArgumentException.class, () -> new Pcm16Downsampler(0, (a,b) -> {}));
        assertThrows(IllegalArgumentException.class, () -> new Pcm16Downsampler(192001, (a,b) -> {}));
    }
}