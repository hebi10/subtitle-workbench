package com.haebi.subtitle;

import org.json.JSONException;
import org.json.JSONObject;

/** Only global defaults are migrated. Persisted jobs keep their original model until explicitly changed. */
final class AppSettings {
    static final String DEFAULT_TRANSLATION_MODEL = "gpt-6-luna";
    private AppSettings() {}

    static JSONObject checked(JSONObject settings) throws JSONException {
        String source = settings.optString("sourceLanguage", "auto");
        String target = settings.optString("targetLanguage", "ko");
        String model = settings.optString("translationModel", DEFAULT_TRANSLATION_MODEL).trim();
        if (!source.matches("auto|[a-z]{2,3}") || !target.matches("[a-z]{2,3}") || !model.matches("[A-Za-z0-9_.:-]{1,100}"))
            throw new IllegalArgumentException("언어와 번역 모델 설정을 확인해 주세요.");
        return new JSONObject().put("sourceLanguage", source).put("targetLanguage", target)
                .put("translationModel", model).put("translate", settings.optBoolean("translate", true));
    }

    static JSONObject upgrade(JSONObject settings) throws JSONException {
        JSONObject result = checked(settings);
        if ("gpt-5.5".equals(result.getString("translationModel")))
            result.put("translationModel", DEFAULT_TRANSLATION_MODEL);
        return result;
    }
}
