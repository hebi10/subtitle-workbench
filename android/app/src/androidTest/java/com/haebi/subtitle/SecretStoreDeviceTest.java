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
