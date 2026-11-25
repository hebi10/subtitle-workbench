package com.haebi.subtitle;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.assertEquals;

public final class PreviewCueIndexTest {
    private JSONObject cue(double start, double end, String original, String translated) throws Exception {
        return new JSONObject().put("start", start).put("end", end).put("original", original).put("translated", translated);
    }

    @Test public void overlapsBoundariesAndReverseSeek() throws Exception {
        JSONArray source = new JSONArray().put(cue(7, 10, "late", "")).put(cue(1, 8, "long", ""))
                .put(cue(2, 3, "nested", "")).put(cue(1, 2, "short", "")).put(cue(10, 11, "adjacent", ""))
                .put(cue(4, 4, "invalid", ""));
        PreviewCueIndex index = new PreviewCueIndex(source);
        assertEquals("", index.textAt(0));
        assertEquals("short", index.textAt(1));
        assertEquals("long", index.textAt(2));
        assertEquals("late", index.textAt(8));
        assertEquals("adjacent", index.textAt(10));
        assertEquals("", index.textAt(11));
        assertEquals("long", index.textAt(2.5));
    }

    @Test public void failedTranslationFallsBackToOriginalAndLongSeeksRemainCorrect() throws Exception {
        JSONArray source = new JSONArray();
        for (int i = 0; i < 20000; i++) source.put(cue(i * .5, (i + 1) * .5, String.valueOf(i), "[번역 실패]"));
        PreviewCueIndex index = new PreviewCueIndex(source);
        for (int i = 0; i < 1000; i++) {
            int n = (i * 7919) % 20000;
            assertEquals(String.valueOf(n), index.textAt(n * .5));
        }
    }
}
