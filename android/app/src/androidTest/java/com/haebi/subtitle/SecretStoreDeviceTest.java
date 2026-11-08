package com.haebi.subtitle;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SecretStoreDeviceTest {
    @Test public void personalAndRelayUseDifferentEncryptedScopesAndKeepSelectionAfterRecreation() throws Exception {
        Context context = new ContextWrapper(ApplicationProvider.getApplicationContext()) {
            private final String prefix = "fixture_cloud_" + java.util.UUID.randomUUID() + "_";
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return super.getSharedPreferences(prefix + name, mode);
            }
        };
        String personalKey = "fixture-personal-only";
        String code = "fixture-review-code-abcdefghijklmnopqrstuvwxyz0123456789";
        CloudAccessStore cloud = new CloudAccessStore(context);
        cloud.setPersonalKey(personalKey);
        cloud.setRelay("https://relay.subtitle.com", code);
        assertEquals("relay", new CloudAccessStore(context).mode());
        assertEquals(code, new CloudAccessStore(context).current().token());
        assertEquals(personalKey, new SecretStore(context).getKey());
        assertTrue(cloud.status().getBoolean("hasPersonalKey"));
        assertTrue(cloud.status().getJSONObject("reviewRelay").getBoolean("hasCode"));
        assertFalse(cloud.status().toString().contains(code));
        assertFalse(cloud.status().toString().contains(personalKey));
        for (String name : new String[]{"api_secret", "review_relay_secret", "cloud_access"}) {
            String stored = context.getSharedPreferences(name, Context.MODE_PRIVATE).getAll().toString();
            assertFalse(stored.contains(code)); assertFalse(stored.contains(personalKey));
        }
        cloud.usePersonal();
        assertEquals(personalKey, cloud.current().token());
        cloud.setRelay("https://relay.subtitle.com", "");
        assertEquals(code, cloud.current().token());
        assertThrows(IllegalArgumentException.class, () -> cloud.setRelay("https://another.subtitle.com", ""));
        assertEquals("https://relay.subtitle.com", cloud.current().origin());
        cloud.clearRelay();
        assertEquals("personal", new CloudAccessStore(context).mode());
        assertEquals(personalKey, cloud.current().token());
        assertFalse(new SecretStore(context, "review_relay").hasKey());
        assertFalse(cloud.status().getJSONObject("reviewRelay").getBoolean("hasCode"));
        new SecretStore(context).clearKey();
    }

    @Test public void copyingPersonalCiphertextCannotDecryptInRelayScope() {
        Context context = new ContextWrapper(ApplicationProvider.getApplicationContext()) {
            private final String prefix = "fixture_scope_" + java.util.UUID.randomUUID() + "_";
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return super.getSharedPreferences(prefix + name, mode);
            }
        };
        SecretStore personal = new SecretStore(context);
        personal.setKey("fixture-personal-scope");
        SharedPreferences source = context.getSharedPreferences("api_secret", Context.MODE_PRIVATE);
        context.getSharedPreferences("review_relay_secret", Context.MODE_PRIVATE).edit()
                .putString("nonce", source.getString("nonce", ""))
                .putString("ciphertext", source.getString("ciphertext", "")).commit();
        assertFalse(new SecretStore(context, "review_relay").hasKey());
        assertEquals("fixture-personal-scope", personal.getKey());
        personal.clearKey();
        new SecretStore(context, "review_relay").clearKey();
    }

    @Test public void explicitKeyResetRemovesOnlyEncryptedCredentialAndAllowsReplacement() {
        Context context = new ContextWrapper(ApplicationProvider.getApplicationContext()) {
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return super.getSharedPreferences("fixture_reset_" + name, mode);
            }
        };
        SecretStore store = new SecretStore(context);
        store.setKey("fixture-first-key");
        SharedPreferences stored = context.getSharedPreferences("api_secret", Context.MODE_PRIVATE);
        stored.edit().putString("unrelated", "preserve").commit();
        store.clearKey();
        assertFalse(new SecretStore(context).hasKey());
        assertEquals("", new SecretStore(context).getKey());
        assertFalse(stored.contains("nonce"));
        assertFalse(stored.contains("ciphertext"));
        assertEquals("preserve", stored.getString("unrelated", ""));
        store.setKey("fixture-replacement-key");
        assertEquals("fixture-replacement-key", new SecretStore(context).getKey());
        store.clearKey();
    }

    @Test public void ciphertextSurvivesStoreRecreationAndTamperingFailsClosed() {
        Context context = new ContextWrapper(ApplicationProvider.getApplicationContext()) {
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return super.getSharedPreferences("fixture_" + name, mode);
            }
        };
        SecretStore first = new SecretStore(context);
        String fixtureKey = "fixture-only-not-a-real-api-key";
        first.setKey(fixtureKey);
        assertEquals(fixtureKey, new SecretStore(context).getKey());
        SharedPreferences stored = context.getSharedPreferences("api_secret", Context.MODE_PRIVATE);
        assertFalse(stored.getAll().toString().contains(fixtureKey));
        stored.edit().putString("ciphertext", "invalid-data").commit();
        assertFalse(new SecretStore(context).hasKey());
    }
}
