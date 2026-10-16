package com.haebi.subtitle;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public class OpenAiClientTest {
    private static final String RESPONSE = "{\"status\":\"completed\",\"output_text\":\"{\\\"translations\\\":[{\\\"id\\\":0,\\\"translated\\\":\\\"안녕\\\"}]}\"}";

    @Test public void transientFailureRetriesButKeepsSubtitleIdentity() throws Exception {
        AtomicInteger count = new AtomicInteger();
        StubConnection success = new StubConnection(200, RESPONSE.getBytes(StandardCharsets.UTF_8));
        OpenAiClient api = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> count.incrementAndGet() == 1 ? new StubConnection(503, new byte[0]) : success);
        JSONArray result = api.translate(new JSONArray("[{\"start\":4,\"end\":5,\"original\":\"Hello\"}]"), new JSONObject());
        assertEquals(2, count.get());
        assertEquals(4, result.getJSONObject(0).getInt("start"));
        assertEquals("안녕", result.getJSONObject(0).getString("translated"));
        JSONObject sent = new JSONObject(success.upload.toString(StandardCharsets.UTF_8.name()));
        assertEquals("gpt-6-luna", sent.getString("model"));
        assertEquals("low", sent.getJSONObject("reasoning").getString("effort"));
        JSONObject format = sent.getJSONObject("text").getJSONObject("format");
        assertEquals("json_schema", format.getString("type"));
        assertTrue(format.getBoolean("strict"));
        assertEquals("Hello", new JSONObject(sent.getString("input")).getJSONArray("subtitles").getJSONObject(0).getString("text"));
        assertFalse(sent.getBoolean("store"));
    }

    @Test public void authenticationFailureIsNotRetriedAndNeverEchoesResponse() throws Exception {
        AtomicInteger count = new AtomicInteger();
        OpenAiClient api = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> { count.incrementAndGet(); return new StubConnection(401, "test-key sensitive provider body".getBytes(StandardCharsets.UTF_8)); });
        IOException failure = assertThrows(IOException.class, () -> api.translate(new JSONArray(), new JSONObject()));
        assertEquals(1, count.get());
        assertTrue(failure.getMessage().contains("401"));
        assertFalse(failure.getMessage().contains("test-key"));
        assertEquals("authentication", OpenAiClient.failureCode(failure));
        assertFalse(OpenAiClient.isRetryable(failure));
    }

    @Test public void responseLimitStopsBeforeParsingAndDoesNotRetry() throws Exception {
        AtomicInteger count = new AtomicInteger();
        OpenAiClient api = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> { count.incrementAndGet(); return new StubConnection(200, new byte[4 * 1024 * 1024 + 1]); });
        assertThrows(IOException.class, () -> api.translate(new JSONArray(), new JSONObject()));
        assertEquals(1, count.get());
    }

    @Test public void insufficientQuotaStopsImmediatelyAndNeverEchoesProviderDetails() throws Exception {
        AtomicInteger count = new AtomicInteger();
        String response = "{\"error\":{\"code\":\"insufficient_quota\",\"message\":\"test-key private billing data\"}}";
        OpenAiClient api = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> {
            count.incrementAndGet();
            return new StubConnection(429, response.getBytes(StandardCharsets.UTF_8));
        });
        IOException failure = assertThrows(IOException.class, () -> api.translate(new JSONArray(), new JSONObject()));
        assertEquals(1, count.get());
        assertTrue(failure.getMessage().contains("할당량"));
        assertFalse(failure.toString().contains("test-key"));
        assertFalse(failure.toString().contains("private billing data"));
        assertEquals("quota", OpenAiClient.failureCode(failure));
        assertFalse(OpenAiClient.isRetryable(failure));
    }

    @Test public void accessCheckUsesBoundedGetRequestsAndReturnsNoProviderOrKeyData() throws Exception {
        List<String> paths = new ArrayList<>();
        List<StubConnection> requests = new ArrayList<>();
        OpenAiClient api = new OpenAiClient("fixture-private-key", new OpenAiClient.Cancellation(), path -> {
            paths.add(path);
            StubConnection connection = new StubConnection(200, ("{\"id\":\"" + path.substring("/models/".length()) + "\",\"object\":\"model\",\"extra\":\"fixture-private-key\"}").getBytes(StandardCharsets.UTF_8));
            requests.add(connection);
            return connection;
        });
        long started = System.currentTimeMillis();
        JSONObject checked = api.checkConnection(new JSONObject());
        assertEquals(List.of("/models/whisper-1", "/models/gpt-6-luna"), paths);
        assertTrue(checked.getLong("checkedAt") >= started);
        assertEquals("whisper-1", checked.getString("transcriptionModel"));
        assertEquals("gpt-6-luna", checked.getString("translationModel"));
        assertTrue(checked.getString("message").contains("인증"));
        assertTrue(checked.getString("message").contains("결제"));
        assertFalse(checked.toString().contains("fixture-private-key"));
        for (StubConnection connection : requests) {
            assertEquals("GET", connection.getRequestMethod());
            assertFalse(connection.getDoOutput());
            assertEquals(0, connection.upload.size());
            assertTrue(connection.getConnectTimeout() > 0 && connection.getConnectTimeout() <= 15000);
            assertTrue(connection.getReadTimeout() > 0 && connection.getReadTimeout() <= 15000);
            assertEquals("Bearer fixture-private-key", connection.getRequestProperty("Authorization"));
            assertFalse(connection.getInstanceFollowRedirects());
            assertTrue(connection.disconnected);
        }
    }

    @Test public void accessCheckSkipsDisabledTranslationAndChecksSelectedModelWhenEnabled() throws Exception {
        List<String> paths = new ArrayList<>();
        OpenAiClient api = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> {
            paths.add(path);
            return new StubConnection(200, ("{\"id\":\"" + path.substring("/models/".length()) + "\"}").getBytes(StandardCharsets.UTF_8));
        });
        JSONObject checked = api.checkConnection(new JSONObject().put("translate", false).put("translationModel", "../unsafe"));
        assertEquals(List.of("/models/whisper-1"), paths);
        assertEquals("", checked.getString("translationModel"));
        paths.clear();
        api.checkConnection(new JSONObject().put("translationModel", "selected-model"));
        assertEquals(List.of("/models/whisper-1", "/models/selected-model"), paths);
    }

    @Test public void nonRetryableHttpFailuresHaveSafeActionableClassifications() throws Exception {
        int[] statuses = {401, 403, 404, 400};
        String[] codes = {"authentication", "permission", "model_unavailable", "invalid_request"};
        String[] hints = {"키", "권한", "모델", "요청"};
        for (int i = 0; i < statuses.length; i++) {
            int status = statuses[i];
            AtomicInteger count = new AtomicInteger();
            OpenAiClient api = new OpenAiClient("fixture-private-key", new OpenAiClient.Cancellation(), path -> {
                count.incrementAndGet();
                return new StubConnection(status, "{\"error\":{\"code\":\"fixture-private-key\",\"message\":\"private response\"}}".getBytes(StandardCharsets.UTF_8));
            });
            IOException failure = assertThrows(IOException.class, () -> api.translate(new JSONArray(), new JSONObject()));
            assertEquals(1, count.get());
            assertEquals(codes[i], OpenAiClient.failureCode(failure));
            assertTrue(failure.getMessage().contains(hints[i]));
            assertFalse(OpenAiClient.isRetryable(failure));
            assertFalse(failure.toString().contains("fixture-private-key"));
            assertFalse(failure.toString().contains("private response"));
        }
    }

    @Test public void accessCheckReturnsTransientErrorsWithoutRetryingOrLeakingNetworkMessages() throws Exception {
        AtomicInteger count = new AtomicInteger();
        OpenAiClient api = new OpenAiClient("fixture-private-key", new OpenAiClient.Cancellation(), path -> {
            count.incrementAndGet();
            throw new IOException("URL contains fixture-private-key");
        });
        IOException failure = assertThrows(IOException.class, () -> api.checkConnection(new JSONObject()));
        assertEquals(1, count.get());
        assertEquals("network", OpenAiClient.failureCode(failure));
        assertTrue(OpenAiClient.isRetryable(failure));
        assertFalse(failure.toString().contains("fixture-private-key"));
        assertNull(failure.getCause());

        OpenAiClient server = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> new StubConnection(503, new byte[0]));
        IOException unavailable = assertThrows(IOException.class, () -> server.checkConnection(new JSONObject()));
        assertEquals("server", OpenAiClient.failureCode(unavailable));
        assertTrue(OpenAiClient.isRetryable(unavailable));
    }

    @Test public void rateLimitRetryNotifiesProgressButLongRetryAfterDoesNotRetryEarly() throws Exception {
        AtomicInteger count = new AtomicInteger();
        List<String> progress = new ArrayList<>();
        OpenAiClient api = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> {
            if (count.incrementAndGet() > 1) return new StubConnection(200, RESPONSE.getBytes(StandardCharsets.UTF_8));
            StubConnection limited = new StubConnection(429, "{\"error\":{\"code\":\"rate_limit_exceeded\"}}".getBytes(StandardCharsets.UTF_8));
            limited.retryAfter = "1";
            return limited;
        }, (next, maximum) -> progress.add(next + "/" + maximum));
        long started = System.nanoTime();
        api.translate(new JSONArray("[{\"original\":\"Hello\"}]"), new JSONObject());
        assertTrue("Retry-After must delay the next request", System.nanoTime() - started >= 900_000_000L);
        assertEquals(2, count.get());
        assertEquals(List.of("2/3"), progress);

        count.set(0);
        OpenAiClient slow = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> {
            count.incrementAndGet();
            StubConnection limited = new StubConnection(429, new byte[0]);
            limited.retryAfter = "120";
            return limited;
        });
        IOException failure = assertThrows(IOException.class, () -> slow.translate(new JSONArray(), new JSONObject()));
        assertEquals(1, count.get());
        assertEquals("rate_limit", OpenAiClient.failureCode(failure));
        assertTrue(OpenAiClient.isRetryable(failure));
    }

    @Test public void malformedSuccessDoesNotLeakResponseContentsOrRetry() throws Exception {
        AtomicInteger count = new AtomicInteger();
        OpenAiClient api = new OpenAiClient("fixture-private-key", new OpenAiClient.Cancellation(), path -> {
            count.incrementAndGet();
            return new StubConnection(200, "{ fixture-private-key response content".getBytes(StandardCharsets.UTF_8));
        });
        Exception failure = assertThrows(Exception.class, () -> api.translate(new JSONArray(), new JSONObject()));
        assertEquals(1, count.get());
        assertFalse(failure.toString().contains("fixture-private-key"));
        assertFalse(OpenAiClient.isRetryable(failure));
    }

    @Test public void oversizedErrorBodyIsReadOnlyUpToABoundedPrefix() throws Exception {
        AtomicInteger bytesRead = new AtomicInteger();
        StubConnection connection = new StubConnection(403, new byte[0]);
        connection.errorInput = new InputStream() {
            @Override public int read() { bytesRead.incrementAndGet(); return 'x'; }
        };
        OpenAiClient api = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> connection);
        IOException failure = assertThrows(IOException.class, () -> api.checkConnection(new JSONObject()));
        assertEquals("permission", OpenAiClient.failureCode(failure));
        assertTrue(bytesRead.get() > 0 && bytesRead.get() < 65536);
    }

    @Test public void cancellationDuringRetryPreventsAnotherRequest() throws Exception {
        OpenAiClient.Cancellation token = new OpenAiClient.Cancellation();
        AtomicInteger requests = new AtomicInteger();
        OpenAiClient api = new OpenAiClient("test-key", token, path -> {
            requests.incrementAndGet();
            return new StubConnection(503, new byte[0]);
        }, (next, maximum) -> token.cancel());
        IOException failure = assertThrows(IOException.class, () -> api.translate(new JSONArray(), new JSONObject()));
        assertTrue(failure instanceof java.io.InterruptedIOException);
        assertFalse(OpenAiClient.isRetryable(failure));
        assertEquals(1, requests.get());
    }

    @Test public void multipartIncludesTimestampSettingsAndAudioBytes() throws Exception {
        Path file = Files.createTempFile("subtitle-api-test", ".m4a");
        try {
            Files.write(file, "test-audio-content".getBytes(StandardCharsets.UTF_8));
            StubConnection connection = new StubConnection(200, "{\"text\":\"hello\"}".getBytes(StandardCharsets.UTF_8));
            OpenAiClient api = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> connection);
            assertEquals("hello", api.transcribe(file.toFile(), new JSONObject().put("sourceLanguage", "ko")).getString("text"));
            String uploaded = connection.upload.toString(StandardCharsets.UTF_8.name());
            assertTrue(uploaded.contains("name=\"model\"\r\n\r\nwhisper-1"));
            assertTrue(uploaded.contains("name=\"timestamp_granularities[]\"\r\n\r\nword"));
            assertTrue(uploaded.contains("name=\"language\"\r\n\r\nko"));
            assertTrue(uploaded.contains("test-audio-content"));
            assertFalse(uploaded.contains("test-key"));
        } finally { Files.deleteIfExists(file); }
    }

    @Test public void pauseInterruptsRetryWaitPromptly() throws Exception {
        OpenAiClient.Cancellation token = new OpenAiClient.Cancellation();
        AtomicReference<Exception> result = new AtomicReference<>();
        Thread waiter = new Thread(() -> { try { token.waitFor(30000); } catch (Exception error) { result.set(error); } });
        waiter.start();
        token.cancel();
        waiter.join(2000);
        assertFalse(waiter.isAlive());
        assertTrue(result.get() instanceof java.io.InterruptedIOException);
    }

    private static final class StubConnection extends HttpURLConnection {
        final ByteArrayOutputStream upload = new ByteArrayOutputStream();
        final int code;
        final byte[] response;
        String retryAfter;
        InputStream errorInput;
        boolean disconnected;
        StubConnection(int code, byte[] response) throws IOException { super(new URL("https://example.invalid")); this.code = code; this.response = response; }
        @Override public OutputStream getOutputStream() { return upload; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(response); }
        @Override public InputStream getErrorStream() { return errorInput == null ? new ByteArrayInputStream(response) : errorInput; }
        @Override public int getResponseCode() { return code; }
        @Override public String getHeaderField(String name) { return "Retry-After".equals(name) ? retryAfter : null; }
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() { }
    }
}
