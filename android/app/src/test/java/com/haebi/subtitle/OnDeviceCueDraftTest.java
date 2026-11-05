package com.haebi.subtitle;

import org.json.JSONArray;
import org.junit.Test;
import static org.junit.Assert.*;

public class OnDeviceCueDraftTest {
    @Test public void microphoneTurnsKeepMonotonicApproximateTimings() throws Exception {
        OnDeviceCueDraft draft = new OnDeviceCueDraft();
        assertFalse(draft.add(" ", 0, 20));
        assertTrue(draft.add(" Hello  world ", 0, 900));
        assertTrue(draft.add("두 번째", 700, 1700));
        JSONArray cues = draft.snapshot();
        assertEquals(2, cues.length());
        assertEquals("Hello world", cues.getJSONObject(0).getString("original"));
        assertEquals("estimated", cues.getJSONObject(0).getString("timingAccuracy"));
        assertEquals(0.9, cues.getJSONObject(1).getDouble("start"), 0.001);
        assertEquals(1.7, cues.getJSONObject(1).getDouble("end"), 0.001);
        assertEquals("", cues.getJSONObject(1).getString("translated"));
    }

    @Test public void emptyAndVeryShortTurnsCannotCorruptCues() throws Exception {
        OnDeviceCueDraft draft = new OnDeviceCueDraft();
        assertTrue(draft.add("yes", 200, 200));
        assertEquals(0.4, draft.snapshot().getJSONObject(0).getDouble("end"), 0.001);
        assertFalse(draft.add("", 600, 800));
        assertEquals(1, draft.size());
        assertThrows(IllegalArgumentException.class, () -> draft.add("a".repeat(10001), 800, 2000));
        assertEquals(1, draft.size());
    }
}