package com.haebi.subtitle;

import org.json.JSONArray;
import org.junit.Test;
import static org.junit.Assert.*;

public class OfflineModelsTest {
    @Test public void modelCatalogIsPinnedAndCannotResolveArbitraryPaths() {
        assertEquals(3, OfflineModelCatalog.MODELS.length);
        for (OfflineModelCatalog.Spec model : OfflineModelCatalog.MODELS) {
            assertSame(model, OfflineModelCatalog.byId(model.id));
            assertTrue(model.source.startsWith("https://huggingface.co/rhasspy/vosk-models/"));
            assertTrue(model.sha256.matches("[0-9a-f]{64}"));
            assertTrue(model.minUsableBytes > 200 * 1024 * 1024);
        }
        assertThrows(IllegalArgumentException.class, () -> OfflineModelCatalog.byId("../etc"));
    }

    @Test public void finalizedWordTimesAreUsedWithoutInventingSpeakerIdentity() throws Exception {
        OfflineCueAccumulator acc = new OfflineCueAccumulator();
        acc.appendResult("{\"text\":\"hello there\",\"result\":[{\"start\":0.25,\"end\":0.53,\"word\":\"hello\"},{\"start\":0.53,\"end\":1.07,\"word\":\"there\"}]}", 1.3);
        acc.appendResult("{\"text\":\"a test\",\"result\":[{\"start\":1.1,\"end\":1.3,\"word\":\"a\"},{\"start\":1.3,\"end\":1.8,\"word\":\"test\"}]}", 2);
        JSONArray cues = acc.snapshot();
        assertEquals(2, cues.length());
        assertEquals(.25, cues.getJSONObject(0).getDouble("start"), .001);
        assertEquals(1.07, cues.getJSONObject(0).getDouble("end"), .001);
        assertEquals("word", cues.getJSONObject(1).getString("timingAccuracy"));
        assertFalse(cues.getJSONObject(0).has("speaker"));
        assertEquals("", cues.getJSONObject(0).getString("translated"));
    }

    @Test public void missingWordTimesUseApproximationAndEmptyTranscriptsAreSkipped() throws Exception {
        OfflineCueAccumulator acc = new OfflineCueAccumulator();
        acc.appendResult("{\"text\":\"\"}", 2);
        acc.appendResult("{\"text\":\" one \"}", 1.5);
        acc.appendResult("{\"text\":\"two\"}", 2);
        assertEquals(2, acc.size());
        assertEquals("estimated", acc.snapshot().getJSONObject(0).getString("timingAccuracy"));
        assertEquals(1.5, acc.snapshot().getJSONObject(1).getDouble("start"), .001);
        acc.appendResult("{\"text\":\"\"}", 30);
        assertEquals(2, acc.size());
    }
}