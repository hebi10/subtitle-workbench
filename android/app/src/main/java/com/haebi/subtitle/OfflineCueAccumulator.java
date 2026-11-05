package com.haebi.subtitle;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Converts finalized Vosk recognition turns into editable cues. No model files or audio are retained. */
final class OfflineCueAccumulator {
    private final JSONArray cues = new JSONArray();
    private double previousEnd;

    void appendResult(String raw, double approximateEnd) throws JSONException {
        JSONObject data = new JSONObject(raw);
        String text = data.optString("text", "").replaceAll("\\s+", " ").trim();
        if (text.isEmpty()) return;
        JSONArray words = data.optJSONArray("result");
        double start = previousEnd;
        double end = Math.max(start + 0.1, approximateEnd);
        boolean wordTimed = words != null && words.length() > 0;
        if (wordTimed) {
            JSONObject first = words.optJSONObject(0);
            JSONObject last = words.optJSONObject(words.length() - 1);
            if (first != null && last != null) {
                double s = first.optDouble("start", Double.NaN);
                double e = last.optDouble("end", Double.NaN);
                if (Double.isFinite(s) && Double.isFinite(e) && e > s && s >= 0) {
                    start = Math.max(previousEnd, s);
                    end = Math.max(start + .1, e);
                } else wordTimed = false;
            } else wordTimed = false;
        }
        if (text.length() > 10000) throw new IllegalArgumentException("인식한 문장이 너무 깁니다.");
        if (cues.length() >= 50_000) throw new IllegalArgumentException("자막 수가 너무 많습니다.");
        cues.put(new JSONObject().put("start", Math.round(start * 1000) / 1000d)
                .put("end", Math.round(end * 1000) / 1000d)
                .put("original", text).put("translated", "")
                .put("status", "transcribed")
                .put("timingAccuracy", wordTimed ? "word" : "estimated"));
        previousEnd = end;
    }

    int size() { return cues.length(); }
    JSONArray snapshot() throws JSONException { return new JSONArray(cues.toString()); }
}