package com.haebi.subtitle;

import java.io.IOException;
import java.net.InetAddress;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class CloudAccessTest {
    private static final String CODE = "fixture-review-code-abcdefghijklmnopqrstuvwxyz0123456789";

    @Test public void personalAndRelayKeepAllDestinationsWithTheirOwnCredential() {
        CloudAccess personal = CloudAccess.personal("fixture-personal-key");
        CloudAccess relay = CloudAccess.relay("https://Relay.Subtitle.com:443", CODE);
        assertEquals("https://api.openai.com/v1/responses", personal.restUrl("/responses"));
        assertEquals(RealtimeTranscriptionProtocol.URL, personal.realtimeUrl());
        assertEquals("https://relay.subtitle.com/v1/audio/transcriptions", relay.restUrl("/audio/transcriptions"));
        assertEquals("https://relay.subtitle.com/v1/models/whisper-1", relay.restUrl("/models/whisper-1"));
        assertEquals("wss://relay.subtitle.com/v1/realtime?intent=transcription", relay.realtimeUrl());
        assertEquals(CODE, relay.token());
        assertEquals("fixture-personal-key", personal.token());
        assertEquals("https://relay.subtitle.com", CloudAccess.checkedRelayOrigin("https://relay.subtitle.com/"));
        assertFalse(relay.toString().contains(CODE));
        assertFalse(personal.toString().contains("fixture-personal-key"));
    }

    @Test public void rejectsNonOriginsPrivateHostsAndOpenAiImpersonationWithoutEchoingInput() {
        String[] invalid = {"http://relay.subtitle.com", "https://relay.subtitle.com/v1",
                "https://relay.subtitle.com?key=private", "https://relay.subtitle.com#private", "https://private@relay.subtitle.com",
                "https://relay.subtitle.com:8443", " https://relay.subtitle.com", "https://relay.subtitle.com\n",
                "https://api.openai.com", "https://api.openai.com.evil.com", "https://openai-relay.com", "https://localhost",
                "https://127.0.0.1", "https://10.0.0.1", "https://[::1]", "https://2130706433", "https://0x7f000001",
                "https://relay.local", "https://relay.internal", "https://relay.localhost", "https://relay.com.",
                "https://relay%2ecom", "https://relay.subtitle.com\\@evil.com", "https://例.example.com"};
        for (String value : invalid) {
            IllegalArgumentException failure = assertThrows(value, IllegalArgumentException.class, () -> CloudAccess.relay(value, CODE));
            assertFalse(failure.toString().contains("private"));
            assertFalse(failure.toString().contains(CODE));
        }
    }

    @Test public void relayOnlyAcceptsServerCompatibleAccessCodes() {
        for (String code : new String[]{"", "short", "sk-" + "a".repeat(48), "SK-" + "a".repeat(48),
                "a".repeat(129), "a".repeat(43) + "\nprivate", "a".repeat(43) + " secret", "a".repeat(43) + "/"}) {
            IllegalArgumentException failure = assertThrows(IllegalArgumentException.class, () -> CloudAccess.relay("https://relay.subtitle.com", code));
            assertFalse(failure.toString().contains(code.isEmpty() ? "private" : code));
        }
        assertEquals("a".repeat(43), CloudAccess.relay("https://relay.subtitle.com", "a".repeat(43)).token());
    }

    @Test public void arbitraryRoutesCannotLeaveTheSelectedApi() {
        CloudAccess relay = CloudAccess.relay("https://relay.subtitle.com", CODE);
        for (String path : new String[]{"https://evil.com", "//evil.com", "/../responses", "/responses?url=evil", "/files", "/models/../secret"})
            assertThrows(IllegalArgumentException.class, () -> relay.restUrl(path));
    }

    @Test public void privateOrReservedDnsAnswersAreRejectedBeforeCredentialsAreSent() throws Exception {
        for (String address : new String[]{"0.0.0.0", "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
                "100.64.0.1", "198.18.0.1", "192.0.2.1", "224.0.0.1", "::1", "fe80::1", "fc00::1", "2001:db8::1", "::ffff:127.0.0.1"})
            assertThrows(address, IOException.class, () -> CloudAccess.requirePublicAddress(InetAddress.getByName(address)));
        CloudAccess.requirePublicAddress(InetAddress.getByName("8.8.8.8"));
        CloudAccess.requirePublicAddress(InetAddress.getByName("2606:4700:4700::1111"));
    }

    @Test public void persistedDestinationRejectsModeAndOriginChangesIncludingLegacyJobs() throws Exception {
        CloudAccess relay = CloudAccess.relay("https://relay.subtitle.com", CODE);
        CloudAccess another = CloudAccess.relay("https://another.subtitle.com", CODE);
        CloudAccess personal = CloudAccess.personal("fixture-personal");
        JSONObject pinned = CloudJobDestination.pin(new JSONObject(), relay);
        CloudJobDestination.requireMatch(pinned, relay);
        assertThrows(IllegalArgumentException.class, () -> CloudJobDestination.requireMatch(pinned, another));
        assertThrows(IllegalArgumentException.class, () -> CloudJobDestination.requireMatch(pinned, personal));
        CloudJobDestination.requireMatch(new JSONObject(), personal);
        assertThrows(IllegalArgumentException.class, () -> CloudJobDestination.requireMatch(new JSONObject(), relay));
        assertFalse(pinned.toString().contains(CODE));
    }

    @Test public void settingsValidationPreservesOnlyValidatedDestinationMetadata() throws Exception {
        JSONObject pinned = CloudJobDestination.pin(new JSONObject().put("code", CODE).put("apiKey", "fixture-personal"),
                CloudAccess.relay("https://relay.subtitle.com", CODE));
        JSONObject checked = AppSettings.checked(pinned);
        assertEquals("relay", checked.getString("_cloudMode"));
        assertEquals("https://relay.subtitle.com", checked.getString("_relayOrigin"));
        assertFalse(checked.has("code")); assertFalse(checked.has("apiKey"));
        assertThrows(IllegalArgumentException.class, () -> AppSettings.checked(new JSONObject().put("_cloudMode", "unknown")));
        assertThrows(IllegalArgumentException.class, () -> AppSettings.checked(new JSONObject().put("_cloudMode", "relay").put("_relayOrigin", "https://127.0.0.1")));
        assertThrows(IllegalArgumentException.class, () -> AppSettings.checked(new JSONObject().put("_relayOrigin", "https://relay.subtitle.com")));
    }
}
