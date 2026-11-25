package com.haebi.subtitle;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Immutable playback index built off the main thread; overlapping cues retain chronological priority. */
final class PreviewCueIndex {
    enum DisplayMode { TRANSLATED, ORIGINAL, BOTH }

    private static final class Cue {
        final double start, end;
        final String original, translated;
        Cue(double start, double end, String original, String translated) {
            this.start = start; this.end = end; this.original = original; this.translated = translated;
        }
        String text(DisplayMode mode) {
            if (mode == DisplayMode.ORIGINAL) return original;
            if (translated.isEmpty()) return original;
            if (mode != DisplayMode.BOTH || original.isEmpty() || original.equals(translated)) return translated;
            return original + "\n" + translated;
        }
    }
    private final List<Cue> cues = new ArrayList<>();
    private final double[] maxEnds;

    PreviewCueIndex(JSONArray source) {
        for (int i = 0; i < source.length(); i++) {
            JSONObject item = source.optJSONObject(i);
            if (item == null) continue;
            double start = item.optDouble("start", Double.NaN), end = item.optDouble("end", Double.NaN);
            if (!Double.isFinite(start) || !Double.isFinite(end) || end <= start) continue;
            String original = item.optString("original", "").trim(), translated = item.optString("translated", "").trim();
            boolean failed = "failed".equals(item.optString("status")) || "[번역 실패]".equals(translated) || "[번역 불가]".equals(translated);
            cues.add(new Cue(start, end, original, failed ? "" : translated));
        }
        cues.sort(Comparator.comparingDouble((Cue cue) -> cue.start).thenComparingDouble(cue -> cue.end));
        maxEnds = new double[cues.size()];
        double max = Double.NEGATIVE_INFINITY;
        for (int i = 0; i < cues.size(); i++) {
            max = Math.max(max, cues.get(i).end);
            maxEnds[i] = max;
        }
    }

    String textAt(double seconds) {
        return textAt(seconds, DisplayMode.TRANSLATED);
    }

    String textAt(double seconds, DisplayMode mode) {
        if (!Double.isFinite(seconds)) return "";
        int low = 0, high = cues.size();
        while (low < high) {
            int mid = low + (high - low) / 2;
            if (maxEnds[mid] > seconds) high = mid;
            else low = mid + 1;
        }
        return low < cues.size() && cues.get(low).start <= seconds ? cues.get(low).text(mode) : "";
    }
}
