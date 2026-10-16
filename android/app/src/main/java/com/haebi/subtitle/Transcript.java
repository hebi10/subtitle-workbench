package com.haebi.subtitle;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Android equivalent of the web core's word grouping and midpoint chunk ownership. */
final class Transcript {
    private Transcript() {}

    static JSONArray normalize(JSONObject response, long offsetMs, long coreStartMs, long coreEndMs) throws JSONException {
        JSONArray words = response.optJSONArray("words");
        JSONArray segments = response.optJSONArray("segments");
        List<JSONObject> local = new ArrayList<>();
        boolean wordPunctuation = false;
        boolean segmentPunctuation = false;
        if (words != null) for (int i = 0; i < words.length(); i++) {
            JSONObject word = words.optJSONObject(i);
            if (word != null && clean(word.optString("word", word.optString("text"))).matches("(?s).*[.!?]$")) wordPunctuation = true;
        }
        if (segments != null) for (int i = 0; i < segments.length(); i++) {
            JSONObject segment = segments.optJSONObject(i);
            if (segment != null && segment.optString("text").matches("(?s).*[.!?].*")) segmentPunctuation = true;
        }
        if (words != null && words.length() > 0 && (wordPunctuation || !segmentPunctuation)) {
            List<JSONObject> normalizedWords = new ArrayList<>();
            for (int i = 0; i < words.length(); i++) {
                JSONObject word = words.optJSONObject(i);
                if (word == null) continue;
                double start = word.optDouble("start", -1), end = word.optDouble("end", -1);
                String text = clean(word.optString("word", word.optString("text")));
                if (validTime(start, end) && !text.isEmpty()) normalizedWords.add(cue(start, end, text));
            }
            normalizedWords.sort(Comparator.comparingDouble(o -> o.optDouble("start")));
            StringBuilder text = new StringBuilder();
            double start = 0, end = 0;
            for (JSONObject word : normalizedWords) {
                String token = word.getString("text");
                double nextEnd = word.getDouble("end");
                String joined = clean(text + " " + token);
                double duration = Math.max(0.001, nextEnd - start);
                if (!wordPunctuation && text.length() > 0 && (joined.length() > 42 || duration > 4.5 || joined.length() / duration > 27)) {
                    local.add(cue(start, end, text.toString()));
                    text.setLength(0);
                }
                if (text.length() == 0) start = word.getDouble("start");
                else text.append(' ');
                text.append(token);
                end = nextEnd;
                if (token.matches("(?s).*[.!?]$")) {
                    local.add(cue(start, end, clean(text.toString())));
                    text.setLength(0);
                }
            }
            if (text.length() > 0) local.add(cue(start, end, clean(text.toString())));
        }
        if (local.isEmpty() && segments != null) {
            for (int i = 0; i < segments.length(); i++) {
                JSONObject segment = segments.optJSONObject(i);
                if (segment != null && validTime(segment.optDouble("start", -1), segment.optDouble("end", -1))) local.add(segment);
            }
        }
        if (local.isEmpty() && (segments == null || segments.length() == 0) && (words == null || words.length() == 0)) {
            String text = clean(response.optString("text"));
            if (!text.isEmpty()) local.add(cue(0, Math.max(0.001, response.optDouble("duration", (coreEndMs - offsetMs) / 1000d)), text));
        }
        List<JSONObject> global = new ArrayList<>();
        for (JSONObject item : local) {
            String text = clean(item.optString("text"));
            if (text.isEmpty()) continue;
            double start = round(offsetMs / 1000d + item.optDouble("start"));
            double end = round(Math.min(coreEndMs / 1000d + 0.5, Math.max(start + 0.001, offsetMs / 1000d + item.optDouble("end"))));
            double midpointMs = (start + end) * 500;
            if (midpointMs < coreStartMs || midpointMs >= coreEndMs || end <= start) continue;
            List<String> parts = split(text);
            for (int p = 0; p < parts.size(); p++) {
                double partStart = round(start + (end - start) * p / parts.size());
                double partEnd = round(start + (end - start) * (p + 1) / parts.size());
                global.add(new JSONObject().put("start", partStart).put("end", Math.max(partStart + 0.001, partEnd))
                    .put("original", parts.get(p)).put("translated", "").put("status", "transcribed"));
            }
        }
        global.sort(Comparator.comparingDouble(o -> o.optDouble("start")));
        return new JSONArray(global);
    }

    static JSONArray translations(JSONArray source, String text) {
        try {
            JSONObject parsed = new JSONObject(text.trim());
            JSONArray translations = parsed.getJSONArray("translations");
            if (translations.length() != source.length()) throw new IllegalArgumentException("번역 결과의 자막 수가 일치하지 않습니다. 이어하기로 재시도해 주세요.");
            String[] translated = new String[source.length()];
            for (int i = 0; i < translations.length(); i++) {
                JSONObject item = translations.getJSONObject(i);
                double number = item.getDouble("id");
                int id = (int) number;
                if (number != id || id < 0 || id >= source.length() || translated[id] != null || !(item.get("translated") instanceof String)) throw new IllegalArgumentException("번역 결과의 자막 ID가 올바르지 않습니다.");
                translated[id] = clean(item.getString("translated"));
                if (translated[id].isEmpty() || translated[id].equals("[번역 불가]")) throw new IllegalArgumentException("번역되지 않은 자막이 있습니다. 이어하기로 재시도해 주세요.");
            }
            JSONArray result = new JSONArray();
            for (int i = 0; i < source.length(); i++) {
                result.put(new JSONObject(source.getJSONObject(i).toString()).put("translated", translated[i]).put("status", "translated"));
            }
            return result;
        } catch (JSONException error) { throw new IllegalArgumentException("번역 응답 형식이 올바르지 않습니다. 이어하기로 재시도해 주세요."); }
    }

    static String clean(String text) { return text.replaceAll("\\s+", " ").replaceAll("\\s+([,.!?;:])", "$1").trim(); }
    private static boolean validTime(double start, double end) { return Double.isFinite(start) && Double.isFinite(end) && start >= 0 && end >= start; }
    private static double round(double number) { return Math.round(number * 1000) / 1000d; }
    private static JSONObject cue(double start, double end, String text) throws JSONException { return new JSONObject().put("start", start).put("end", end).put("text", text); }
    private static List<String> split(String text) {
        List<String> result = new ArrayList<>();
        for (String sentence : text.split("(?<=[.!?])\\s+")) {
            String remaining = sentence;
            while (remaining.length() > 42) {
                int cut = remaining.lastIndexOf(' ', 42);
                if (cut < 1) cut = 42;
                if (Character.isHighSurrogate(remaining.charAt(cut - 1))) cut--;
                result.add(remaining.substring(0, cut).trim());
                remaining = remaining.substring(cut).trim();
            }
            if (!remaining.isEmpty()) result.add(remaining);
        }
        return result;
    }
}
