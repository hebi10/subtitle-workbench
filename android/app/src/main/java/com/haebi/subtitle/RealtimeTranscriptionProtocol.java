package com.haebi.subtitle;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Base64;

/** OpenAI Realtime GA transcription payloads; never includes credentials. */
final class RealtimeTranscriptionProtocol {
    static final String MODEL = "gpt-live-transcribe";
    static final int SAMPLE_RATE = 24_000;
    static final String URL = "wss://api.openai.com/v1/realtime?intent=transcription";

    private RealtimeTranscriptionProtocol() {}

    static String sessionUpdate(String language) throws JSONException {
        JSONObject transcription = new JSONObject().put("model", MODEL);
        if (language != null && !language.isEmpty() && !language.equals("auto")) {
            if (!language.matches("ko|en|ja|zh")) throw new IllegalArgumentException("지원하지 않는 언어 코드입니다.");
            transcription.put("languages", new JSONArray().put(language));
        }
        JSONObject input = new JSONObject()
                .put("format", new JSONObject().put("type", "audio/pcm").put("rate", SAMPLE_RATE))
                .put("transcription", transcription).put("turn_detection", JSONObject.NULL);
        return new JSONObject().put("type", "session.update")
                .put("session", new JSONObject().put("type", "transcription")
                        .put("audio", new JSONObject().put("input", input))).toString();
    }

    static String append(byte[] pcm, int length) throws JSONException {
        if (pcm == null || length <= 0 || length > pcm.length || length > 48_000 || length % 2 != 0)
            throw new IllegalArgumentException("유효한 PCM16 마이크 데이터가 필요합니다.");
        String audio = Base64.getEncoder().encodeToString(java.util.Arrays.copyOf(pcm, length));
        return new JSONObject().put("type", "input_audio_buffer.append").put("audio", audio).toString();
    }

    static String commit() { return "{\"type\":\"input_audio_buffer.commit\"}"; }

    static String eventType(String raw) throws JSONException { return new JSONObject(raw).optString("type", ""); }

    static String eventText(String raw, boolean isFinal) throws JSONException {
        JSONObject event = new JSONObject(raw);
        return event.optString(isFinal ? "transcript" : "delta", "");
    }
}