package com.haebi.subtitle;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Only ciphertext and the public GCM nonce are written to private app preferences. */
public final class SecretStore {
    private final String alias;
    private final SharedPreferences preferences;

    public SecretStore(Context context) { this(context, "personal"); }

    SecretStore(Context context, String scope) {
        if (!scope.equals("personal") && !scope.equals("review_relay")) throw new IllegalArgumentException("인증 저장소를 확인해 주세요.");
        alias = scope.equals("personal") ? "haebi.subtitle.openai.v1" : "haebi.subtitle.review_relay.v1";
        preferences = context.getSharedPreferences(scope.equals("personal") ? "api_secret" : "review_relay_secret", Context.MODE_PRIVATE);
    }

    public synchronized void setKey(String value) {
        String key = value == null ? "" : value.trim();
        if (key.isEmpty() || key.length() > (alias.equals("haebi.subtitle.openai.v1") ? 512 : 2048) || key.indexOf('\n') >= 0 || key.indexOf('\r') >= 0) throw new IllegalArgumentException("유효한 인증 정보를 입력해 주세요.");
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
            byte[] encrypted = cipher.doFinal(key.getBytes(StandardCharsets.UTF_8));
            boolean saved = preferences.edit().putString("nonce", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit();
            if (!saved) throw new IllegalStateException("API 키를 저장하지 못했습니다.");
        } catch (Exception error) { throw new IllegalStateException("API 키를 안전하게 저장하지 못했습니다. 다시 시도해 주세요."); }
    }

    public synchronized String getKey() {
        String ciphertext = preferences.getString("ciphertext", "");
        if (ciphertext.isEmpty()) return "";
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            byte[] nonce = Base64.decode(preferences.getString("nonce", ""), Base64.NO_WRAP);
            cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, nonce));
            return new String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception error) { throw new IllegalStateException("저장된 API 키를 읽을 수 없습니다. API 키를 다시 저장해 주세요."); }
    }

    public boolean hasKey() { try { return !getKey().isEmpty(); } catch (IllegalStateException error) { return false; } }

    public synchronized void clearKey() {
        if (!preferences.edit().remove("nonce").remove("ciphertext").commit()) {
            throw new IllegalStateException("저장된 API 키를 삭제하지 못했습니다. 다시 시도해 주세요.");
        }
    }

    private SecretKey encryptionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).setKeySize(256).build());
        return generator.generateKey();
    }
}
