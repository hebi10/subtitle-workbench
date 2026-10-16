package com.haebi.subtitle;

import java.util.AbstractList;
import java.util.Collections;
import java.util.List;

/** Plans non-overlapping subtitle ownership ranges with padded audio extraction ranges. */
public final class ChunkPlan {
    private ChunkPlan() {}

    public static List<Segment> create(long durationMs, long chunkMs, long paddingMs) {
        if (durationMs <= 0 || chunkMs <= 0 || paddingMs < 0) {
            throw new IllegalArgumentException("길이와 구간은 양수, 패딩은 0 이상이어야 합니다.");
        }
        // Subtract before division, so ceiling division cannot overflow near Long.MAX_VALUE.
        long count = 1 + (durationMs - 1) / chunkMs;
        if (count > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("처리할 오디오 구간이 너무 많습니다.");
        }
        // Calculate each segment on demand instead of allocating from untrusted media metadata.
        return Collections.unmodifiableList(new AbstractList<Segment>() {
            @Override
            public Segment get(int index) {
                if (index < 0 || index >= count) {
                    throw new IndexOutOfBoundsException("구간 번호: " + index);
                }
                long start = index * chunkMs;
                long end = start + Math.min(chunkMs, durationMs - start);
                long extractStart = start - Math.min(start, paddingMs);
                long extractEnd = end + Math.min(paddingMs, durationMs - end);
                return new Segment(index, start, end, extractStart, extractEnd);
            }

            @Override
            public int size() {
                return (int) count;
            }
        });
    }

    public static final class Segment {
        public final int index;
        public final long startMs;
        public final long endMs;
        public final long extractStartMs;
        public final long extractEndMs;

        private Segment(int index, long startMs, long endMs, long extractStartMs, long extractEndMs) {
            this.index = index;
            this.startMs = startMs;
            this.endMs = endMs;
            this.extractStartMs = extractStartMs;
            this.extractEndMs = extractEndMs;
        }
    }
}
