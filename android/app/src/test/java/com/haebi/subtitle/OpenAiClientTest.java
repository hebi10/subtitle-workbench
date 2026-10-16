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
    }

    @Test public void responseLimitStopsBeforeParsingAndDoesNotRetry() throws Exception {
        AtomicInteger count = new AtomicInteger();
        OpenAiClient api = new OpenAiClient("test-key", new OpenAiClient.Cancellation(), path -> { count.incrementAndGet(); return new StubConnection(200, new byte[4 * 1024 * 1024 + 1]); });
        assertThrows(IOException.class, () -> api.translate(new JSONArray(), new JSONObject()));
        assertEquals(1, count.get());
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
        StubConnection(int code, byte[] response) throws IOException { super(new URL("https://example.invalid")); this.code = code; this.response = response; }
        @Override public OutputStream getOutputStream() { return upload; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(response); }
        @Override public int getResponseCode() { return code; }
        @Override public void disconnect() { }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() { }
    }
}
