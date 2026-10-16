package com.haebi.subtitle;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class AppSettingsTest {
    @Test public void upgradeReplacesPreviousDefaultButKeepsLanguages() throws Exception {
        JSONObject result = AppSettings.upgrade(new JSONObject().put("translationModel", "gpt-5.5")
                .put("sourceLanguage", "ja").put("targetLanguage", "en").put("translate", false));
        assertEquals("gpt-6-luna", result.getString("translationModel"));
        assertEquals("ja", result.getString("sourceLanguage"));
        assertEquals("en", result.getString("targetLanguage"));
        assertFalse(result.getBoolean("translate"));
    }

    @Test public void upgradePreservesExplicitCustomModelAndExcludesSecrets() throws Exception {
        JSONObject result = AppSettings.upgrade(new JSONObject().put("translationModel", " custom-model ")
                .put("apiKey", "fixture-not-a-secret"));
        assertEquals("custom-model", result.getString("translationModel"));
        assertFalse(result.has("apiKey"));
    }

    @Test public void ordinaryValidationNeverChangesExistingJobModel() throws Exception {
        assertEquals("gpt-5.5", AppSettings.checked(new JSONObject().put("translationModel", "gpt-5.5"))
                .getString("translationModel"));
        assertEquals("gpt-6-luna", AppSettings.checked(new JSONObject()).getString("translationModel"));
        assertThrows(IllegalArgumentException.class,
                () -> AppSettings.checked(new JSONObject().put("translationModel", "bad\nmodel")));
    }
}
