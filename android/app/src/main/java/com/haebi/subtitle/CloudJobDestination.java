package com.haebi.subtitle;

import org.json.JSONException;
import org.json.JSONObject;

/** Old jobs belong to the personal API; changing settings cannot retarget a job. */
final class CloudJobDestination {
    private CloudJobDestination() {}

    static JSONObject pin(JSONObject settings, CloudAccess access) throws JSONException {
        return settings.put("_cloudMode", access.mode()).put("_relayOrigin", access.isRelay() ? access.origin() : "");
    }

    static void copy(JSONObject from, JSONObject to) throws JSONException {
        if (!from.has("_cloudMode") && !from.has("_relayOrigin")) return;
        String mode = mode(from);
        String origin = origin(from, mode);
        to.put("_cloudMode", mode).put("_relayOrigin", origin);
    }

    static void requireMatch(JSONObject settings, CloudAccess access) {
        String mode = mode(settings);
        String origin = origin(settings, mode);
        if (!mode.equals(access.mode()) || !origin.equals(access.isRelay() ? access.origin() : ""))
            throw new IllegalArgumentException("저장된 작업의 클라우드 연결과 현재 연결이 다릅니다. 작업을 준비한 개인 API 또는 같은 테스트 서버로 전환해 주세요.");
    }

    private static String mode(JSONObject settings) {
        String value = settings.optString("_cloudMode", CloudAccess.PERSONAL);
        if (!CloudAccess.PERSONAL.equals(value) && !CloudAccess.RELAY.equals(value)) throw invalid();
        return value;
    }

    private static String origin(JSONObject settings, String mode) {
        String value = settings.optString("_relayOrigin", "");
        if (CloudAccess.RELAY.equals(mode)) return CloudAccess.checkedRelayOrigin(value);
        if (!value.isEmpty()) throw invalid();
        return "";
    }

    private static IllegalArgumentException invalid() { return new IllegalArgumentException("저장된 작업의 클라우드 연결 정보를 확인할 수 없습니다."); }
}
