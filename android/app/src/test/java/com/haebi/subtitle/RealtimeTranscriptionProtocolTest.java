package com.haebi.subtitle;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.Base64;
import static org.junit.Assert.*;

public class RealtimeTranscriptionProtocolTest {
    @Test public void gaTranscriptionSessionUsesPcm24kAndNoAutomaticTurnDetection() throws Exception {
        JSONObject event = new JSONObject(RealtimeTranscriptionProtocol.sessionUpdate("ko"));
        assertEquals("session.update", event.getString("type"));
        JSONObject input = event.getJSONObject("session").getJSONObject("audio").getJSONObject("input");
        assertEquals("transcription", event.getJSONObject("session").getString("type"));
        assertEquals("audio/pcm", input.getJSONObject("format").getString("type"));
        assertEquals(24000, input.getJSONObject("format").getInt("rate"));
        assertTrue(input.isNull("turn_detection"));
        assertEquals("gpt-live-transcribe", input.getJSONObject("transcription").getString("model"));
        assertEquals("ko", input.getJSONObject("transcription").getJSONArray("languages").getString(0));
        assertFalse(RealtimeTranscriptionProtocol.sessionUpdate("auto").contains("\"languages\""));
        assertThrows(IllegalArgumentException.class, () -> RealtimeTranscriptionProtocol.sessionUpdate("../unsafe"));
    }

    @Test public void pcmChunksAreBase64WithoutAnyCredentials() throws Exception {
        byte[] pcm = {1, 2, 3, 4, 5, 6};
        JSONObject event = new JSONObject(RealtimeTranscriptionProtocol.append(pcm, 4));
        assertArrayEquals(new byte[]{1, 2, 3, 4}, Base64.getDecoder().decode(event.getString("audio")));
        assertEquals("input_audio_buffer.append", event.getString("type"));
        assertThrows(IllegalArgumentException.class, () -> RealtimeTranscriptionProtocol.append(pcm, 5));
        assertThrows(IllegalArgumentException.class, () -> RealtimeTranscriptionProtocol.append(pcm, 10));
        assertEquals("input_audio_buffer.commit", new JSONObject(RealtimeTranscriptionProtocol.commit()).getString("type"));
    }

    @Test public void finalTranscriptAndIncrementalDeltaAreDistinct() throws Exception {
        String delta = "{\"type\":\"conversation.item.input_audio_transcription.delta\",\"delta\":\"Hi\"}";
        String done = "{\"type\":\"conversation.item.input_audio_transcription.completed\",\"transcript\":\"Hi there\"}";
        assertEquals("Hi", RealtimeTranscriptionProtocol.eventText(delta, false));
        assertEquals("Hi there", RealtimeTranscriptionProtocol.eventText(done, true));
        assertEquals("conversation.item.input_audio_transcription.completed", RealtimeTranscriptionProtocol.eventType(done));
    }
}