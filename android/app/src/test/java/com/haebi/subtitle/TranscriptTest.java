package com.haebi.subtitle;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class TranscriptTest {
    @Test public void paddingMidpointHasExactlyOneOwner() throws Exception {
        JSONObject raw = new JSONObject("{\"segments\":[{\"start\":0,\"end\":1,\"text\":\"경계\"},{\"start\":1,\"end\":2,\"text\":\"다음\"}]}");
        JSONArray cues = Transcript.normalize(raw, 419500, 420000, 840000);
        assertEquals(2, cues.length());
        assertEquals(419.5, cues.getJSONObject(0).getDouble("start"), 0.001);
        JSONArray previous = Transcript.normalize(raw, 419500, 0, 420000);
        assertEquals(0, previous.length());
    }

    @Test public void negativeAndInvalidTimingsCannotBecomeCues() throws Exception {
        JSONObject raw = new JSONObject("{\"segments\":[{\"start\":-9,\"end\":-1,\"text\":\"bad\"},{\"start\":4,\"end\":3,\"text\":\"bad\"},{\"start\":1,\"end\":2,\"text\":\"hello  world !\"}]}");
        JSONArray cues = Transcript.normalize(raw, 0, 0, 10000);
        assertEquals(1, cues.length());
        assertEquals("hello world!", cues.getJSONObject(0).getString("original"));
    }

    @Test public void wordsProduceReadableSentencesWithGlobalTimes() throws Exception {
        JSONObject raw = new JSONObject("{\"words\":[{\"start\":0,\"end\":0.3,\"word\":\"Hello\"},{\"start\":0.4,\"end\":0.8,\"word\":\"world.\"},{\"start\":1,\"end\":1.4,\"word\":\"Bye!\"}]}");
        JSONArray cues = Transcript.normalize(raw, 420000, 420000, 840000);
        assertEquals(2, cues.length());
        assertEquals("Hello world.", cues.getJSONObject(0).getString("original"));
        assertEquals(421.4, cues.getJSONObject(1).getDouble("end"), 0.001);
    }

    @Test public void translationsMapByIdAndNeverSilentlyCompleteMissingText() throws Exception {
        JSONArray source = new JSONArray("[{\"start\":1,\"end\":2,\"original\":\"one\"},{\"start\":2,\"end\":3,\"original\":\"two\"}]");
        JSONArray result = Transcript.translations(source, "{\"translations\":[{\"id\":1,\"translated\":\"둘\"},{\"id\":0,\"translated\":\"하나\"}]}");
        assertEquals("하나", result.getJSONObject(0).getString("translated"));
        assertEquals(2, result.getJSONObject(1).getInt("start"));
        assertThrows(IllegalArgumentException.class, () -> Transcript.translations(source, "{\"translations\":[{\"id\":0,\"translated\":\"하나\"}]}"));
        assertThrows(IllegalArgumentException.class, () -> Transcript.translations(source, "{\"translations\":[{\"id\":0,\"translated\":\"하나\"},{\"id\":0,\"translated\":\"둘\"}]}"));
    }

    @Test public void partialOrRefusedResponsesDoNotBecomeTranslationCheckpoints() throws Exception {
        assertEquals("ok", OpenAiClient.responseText(new JSONObject("{\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"ok\"}]}]}")));
        assertThrows(IllegalArgumentException.class, () -> OpenAiClient.responseText(new JSONObject("{\"status\":\"incomplete\",\"output_text\":\"partial\"}")));
    }
}
