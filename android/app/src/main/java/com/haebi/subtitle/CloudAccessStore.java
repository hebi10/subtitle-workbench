package com.haebi.subtitle;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONException;
import org.json.JSONObject;

final class CloudAccessStore {
    private static final Object LOCK = new Object();
    private final SharedPreferences preferences;
    private final SecretStore personal, relay;

    CloudAccessStore(Context context) {
        preferences = context.getSharedPreferences("cloud_access", Context.MODE_PRIVATE);
        personal = new SecretStore(context);
        relay = new SecretStore(context, "review_relay");
    }

    String mode() {
        synchronized (LOCK) {
            String mode = preferences.getString("mode", CloudAccess.PERSONAL);
            if (!CloudAccess.PERSONAL.equals(mode) && !CloudAccess.RELAY.equals(mode)) throw new IllegalArgumentException("클라우드 연결을 다시 선택해 주세요.");
            return mode;
        }
    }

    CloudAccess current() {
        synchronized (LOCK) {
            if (CloudAccess.RELAY.equals(mode())) return CloudAccess.relay(relayOrigin(), relayCode());
            return CloudAccess.personal(personal.getKey());
        }
    }

    boolean isReady() { try { current(); return true; } catch (RuntimeException error) { return false; } }

    JSONObject status() throws JSONException {
        synchronized (LOCK) {
            return new JSONObject().put("hasKey", isReady()).put("hasPersonalKey", personal.hasKey()).put("cloudMode", mode())
                    .put("reviewRelay", new JSONObject().put("url", relayOrigin()).put("hasCode", hasRelayCode()));
        }
    }

    void setPersonalKey(String key) {
        synchronized (LOCK) { personal.setKey(CloudAccess.personal(key).token()); usePersonal(); }
    }

    void usePersonal() {
        synchronized (LOCK) { save(preferences.edit().putString("mode", CloudAccess.PERSONAL)); }
    }

    void setRelay(String url, String code) {
        synchronized (LOCK) {
            String origin = CloudAccess.checkedRelayOrigin(url);
            String next = code == null ? "" : code;
            if (next.isEmpty()) {
                if (!origin.equals(relayOrigin())) throw new IllegalArgumentException("새 테스트 서버의 접근 코드를 입력해 주세요.");
                next = relayCode();
            }
            CloudAccess access = CloudAccess.relay(origin, next);
            // The encrypted payload binds the code to its origin even if the preferences commit fails.
            try { relay.setKey(new JSONObject().put("origin", origin).put("code", access.token()).toString()); }
            catch (JSONException error) { throw new IllegalStateException("테스트 연결 정보를 저장하지 못했습니다."); }
            save(preferences.edit().putString("relayOrigin", origin).putString("mode", CloudAccess.RELAY));
        }
    }

    void clearRelay() {
        synchronized (LOCK) {
            relay.clearKey();
            save(preferences.edit().remove("relayOrigin").putString("mode", CloudAccess.PERSONAL));
        }
    }

    String redact(String message) {
        synchronized (LOCK) {
            String result = message;
            try { String key = personal.getKey(); if (!key.isEmpty()) result = result.replace(key, "[REDACTED]"); } catch (RuntimeException ignored) { }
            try {
                String encrypted = relay.getKey();
                if (!encrypted.isEmpty()) {
                    String code = new JSONObject(encrypted).optString("code", "");
                    if (!code.isEmpty()) result = result.replace(code, "[REDACTED]");
                }
            } catch (RuntimeException | JSONException ignored) { }
            return result;
        }
    }

    private String relayOrigin() {
        String value = preferences.getString("relayOrigin", "");
        return value.isEmpty() ? "" : CloudAccess.checkedRelayOrigin(value);
    }

    private String relayCode() {
        try {
            JSONObject value = new JSONObject(relay.getKey());
            if (!relayOrigin().equals(value.optString("origin"))) throw new IllegalArgumentException("테스트 접근 코드를 다시 저장해 주세요.");
            return CloudAccess.checkedRelayCode(value.optString("code"));
        } catch (JSONException error) { throw new IllegalArgumentException("테스트 접근 코드를 먼저 저장해 주세요."); }
    }

    private boolean hasRelayCode() { try { relayCode(); return true; } catch (RuntimeException error) { return false; } }
    private static void save(SharedPreferences.Editor editor) {
        if (!editor.commit()) throw new IllegalStateException("클라우드 연결 정보를 저장하지 못했습니다.");
    }
}
