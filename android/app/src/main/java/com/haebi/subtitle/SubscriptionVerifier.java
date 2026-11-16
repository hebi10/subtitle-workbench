package com.haebi.subtitle;

import android.content.Context;
import android.os.SystemClock;
import com.google.android.gms.tasks.Task;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.StandardIntegrityManager;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.LongConsumer;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class SubscriptionVerifier {
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    static final long MAX_VALID_MS = TimeUnit.MINUTES.toMillis(15);
    private final StandardIntegrityManager integrity;
    private final long project;
    private final HttpUrl endpoint;
    private final OkHttpClient http = new OkHttpClient.Builder().followRedirects(false)
            .followSslRedirects(false).retryOnConnectionFailure(false).callTimeout(20, TimeUnit.SECONDS).build();
    private Task<StandardIntegrityManager.StandardIntegrityTokenProvider> provider;

    SubscriptionVerifier(Context context) {
        String origin = context.getString(R.string.subtitle_billing_verifier_url);
        HttpUrl url = HttpUrl.parse(origin);
        endpoint = url != null && url.isHttps() && url.port() == 443 && url.encodedPath().equals("/")
                && url.query() == null && url.fragment() == null && url.username().isEmpty() && url.password().isEmpty()
                ? url.newBuilder().addPathSegments("v1/subscriptions/verify").build() : null;
        project = Long.parseLong(context.getString(R.string.subtitle_billing_cloud_project));
        integrity = IntegrityManagerFactory.createStandard(context.getApplicationContext());
    }

    boolean configured() { return endpoint != null && project > 0; }

    void verify(List<String> tokens, LongConsumer result) {
        if (!configured() || tokens.size() > 4) {
            result.accept(-1);
            return;
        }
        if (provider == null || (provider.isComplete() && !provider.isSuccessful())) {
            provider = integrity.prepareIntegrityToken(StandardIntegrityManager.PrepareIntegrityTokenRequest.builder()
                    .setCloudProjectNumber(project).build());
        }
        String hash = hashTokens(tokens);
        provider.onSuccessTask(value -> value.request(StandardIntegrityManager.StandardIntegrityTokenRequest.builder()
                .setRequestHash(hash).build())).addOnSuccessListener(token -> send(tokens, token.token(), result))
                .addOnFailureListener(error -> {
                    provider = null;
                    result.accept(-1);
                });
    }

    private void send(List<String> tokens, String attestation, LongConsumer result) {
        long startedAt = SystemClock.elapsedRealtime();
        JSONObject payload = new JSONObject();
        try {
            payload.put("purchaseTokens", new JSONArray(tokens));
            payload.put("integrityToken", attestation);
        } catch (JSONException error) { result.accept(-1); return; }
        Request request = new Request.Builder().url(endpoint)
                .post(RequestBody.create(payload.toString(), JSON)).build();
        http.newCall(request).enqueue(new Callback() {
            @Override public void onFailure(Call call, IOException error) { result.accept(-1); }
            @Override public void onResponse(Call call, Response response) {
                long validity = -1;
                try (Response closed = response) {
                    if (closed.isSuccessful()) {
                        String body = closed.peekBody(257).string();
                        if (body.length() <= 256) {
                            long candidate = new JSONObject(body).optLong("validForMs", -1);
                            if (candidate >= 0 && candidate <= MAX_VALID_MS) {
                                validity = Math.max(0, candidate - (SystemClock.elapsedRealtime() - startedAt));
                            }
                        }
                    }
                } catch (IOException | JSONException ignored) { /* Treat unavailable responses as unverified. */ }
                result.accept(validity);
            }
        });
    }

    private static String hashTokens(List<String> tokens) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(String.join("\n", tokens).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                hex.append(Character.forDigit((value >>> 4) & 15, 16));
                hex.append(Character.forDigit(value & 15, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new AssertionError(error);
        }
    }

    void destroy() { http.dispatcher().cancelAll(); }
}
