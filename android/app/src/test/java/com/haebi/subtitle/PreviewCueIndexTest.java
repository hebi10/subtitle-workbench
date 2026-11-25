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

    @Test public void displayModesPreserveOriginalFallbackAndCueBoundaries() throws Exception {
        JSONArray source = new JSONArray()
                .put(cue(1, 2, "원문", "번역"))
                .put(cue(2, 3, "원문만", ""))
                .put(cue(3, 4, "실패 원문", "[번역 실패]"))
                .put(cue(4, 5, "실패 상태", "오래된 번역").put("status", "failed"))
                .put(cue(5, 6, "동일", "동일"))
                .put(cue(6, 7, "", "번역만"));
        PreviewCueIndex index = new PreviewCueIndex(source);
        assertEquals("번역", index.textAt(1));
        assertEquals("원문", index.textAt(1, PreviewCueIndex.DisplayMode.ORIGINAL));
        assertEquals("원문\n번역", index.textAt(1, PreviewCueIndex.DisplayMode.BOTH));
        for (PreviewCueIndex.DisplayMode mode : PreviewCueIndex.DisplayMode.values()) {
            assertEquals("원문만", index.textAt(2, mode));
            assertEquals("실패 원문", index.textAt(3, mode));
            assertEquals("실패 상태", index.textAt(4, mode));
            assertEquals("동일", index.textAt(5, mode));
            assertEquals("", index.textAt(7, mode));
        }
        assertEquals("", index.textAt(6, PreviewCueIndex.DisplayMode.ORIGINAL));
        assertEquals("번역만", index.textAt(6, PreviewCueIndex.DisplayMode.BOTH));
        assertEquals("원문\n번역", index.textAt(1, PreviewCueIndex.DisplayMode.BOTH));
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
