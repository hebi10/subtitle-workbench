package com.haebi.subtitle;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Microphone turns have estimated timings; they never claim word-level sync. */
final class OnDeviceCueDraft {
    private final JSONArray cues = new JSONArray();
    private long lastEndMs;

    int size() { return cues.length(); }

    boolean add(String transcript, long fromMs, long toMs) throws JSONException {
        String text = String.valueOf(transcript == null ? "" : transcript).replaceAll("\\s+", " ").trim();
        if (text.isEmpty()) return false;
        if (text.length() > 10000) throw new IllegalArgumentException("한 구간의 자막이 너무 깁니다.");
        long from = Math.max(lastEndMs, Math.max(0, fromMs));
        long end = Math.max(from + 200, toMs);
        cues.put(new JSONObject().put("start", from / 1000d).put("end", end / 1000d)
                .put("original", text).put("translated", "").put("status", "transcribed")
                .put("timingAccuracy", "estimated"));
        lastEndMs = end;
        return true;
    }

    JSONArray snapshot() throws JSONException { return new JSONArray(cues.toString()); }
}