package com.haebi.subtitle;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public final class ChunkPlanMediaTest {
    @Test
    public void oneHundredFiftyMinutesHasTwentyTwoContinuousChunks() {
        List<ChunkPlan.Segment> plan = ChunkPlan.create(9_000_000L, 420_000L, 500L);
        assertEquals(22, plan.size());
        assertSegment(plan.get(0), 0, 0L, 420_000L, 0L, 420_500L);
        assertSegment(plan.get(1), 1, 420_000L, 840_000L, 419_500L, 840_500L);
        assertSegment(plan.get(21), 21, 8_820_000L, 9_000_000L, 8_819_500L, 9_000_000L);
        long previousEnd = 0;
        for (int index = 0; index < plan.size(); index++) {
            ChunkPlan.Segment segment = plan.get(index);
            assertEquals(index, segment.index);
            assertEquals(previousEnd, segment.startMs);
            assertTrue(segment.extractEndMs - segment.extractStartMs <= 421_000L);
            previousEnd = segment.endMs;
        }
        assertEquals(9_000_000L, previousEnd);
    }

    @Test
    public void exactBoundaryDoesNotAddAnEmptyFinalChunk() {
        List<ChunkPlan.Segment> plan = ChunkPlan.create(840_000L, 420_000L, 0L);
        assertEquals(2, plan.size());
        assertSegment(plan.get(1), 1, 420_000L, 840_000L, 420_000L, 840_000L);
    }

    @Test
    public void shortMediaAndOversizedPaddingStayInsideSource() {
        List<ChunkPlan.Segment> plan = ChunkPlan.create(1_001L, 1_000L, 10_000L);
        assertEquals(2, plan.size());
        assertSegment(plan.get(0), 0, 0L, 1_000L, 0L, 1_001L);
        assertSegment(plan.get(1), 1, 1_000L, 1_001L, 0L, 1_001L);
    }

    @Test
    public void longDurationsAndPaddingCannotOverflow() {
        List<ChunkPlan.Segment> plan = ChunkPlan.create(Long.MAX_VALUE, Long.MAX_VALUE - 10, Long.MAX_VALUE);
        assertEquals(2, plan.size());
        assertSegment(plan.get(0), 0, 0L, Long.MAX_VALUE - 10, 0L, Long.MAX_VALUE);
        assertSegment(plan.get(1), 1, Long.MAX_VALUE - 10, Long.MAX_VALUE, 0L, Long.MAX_VALUE);
    }

    @Test
    public void timesBeyondIntegerMillisecondsRemainPositive() {
        List<ChunkPlan.Segment> plan = ChunkPlan.create(4_000_000_000L, 3_000_000_000L, 500L);
        assertSegment(plan.get(1), 1, 3_000_000_000L, 4_000_000_000L, 2_999_999_500L, 4_000_000_000L);
    }

    @Test
    public void invalidInputsAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> ChunkPlan.create(0L, 1L, 0L));
        assertThrows(IllegalArgumentException.class, () -> ChunkPlan.create(-1L, 1L, 0L));
        assertThrows(IllegalArgumentException.class, () -> ChunkPlan.create(1L, 0L, 0L));
        assertThrows(IllegalArgumentException.class, () -> ChunkPlan.create(1L, -1L, 0L));
        assertThrows(IllegalArgumentException.class, () -> ChunkPlan.create(1L, 1L, -1L));
        assertThrows(IllegalArgumentException.class, () -> ChunkPlan.create(Long.MAX_VALUE, 1L, 0L));
    }

    private static void assertSegment(ChunkPlan.Segment segment, int index, long start, long end,
            long extractStart, long extractEnd) {
        assertEquals(index, segment.index);
        assertEquals(start, segment.startMs);
        assertEquals(end, segment.endMs);
        assertEquals(extractStart, segment.extractStartMs);
        assertEquals(extractEnd, segment.extractEndMs);
    }
}
