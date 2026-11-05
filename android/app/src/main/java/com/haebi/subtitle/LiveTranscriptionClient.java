package com.haebi.subtitle;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONException;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/** Live microphone PCM is streamed only after a user explicitly chooses paid GPT transcription. */
final class LiveTranscriptionClient {
    interface Listener {
        void onStatus(String text);
        void onDelta(String text);
        void onFinal(String text);
        void onError(String text);
    }

    private static final long MAX_RECORDING_MS = 5L * 60_000;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Listener listener;
    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(30, TimeUnit.SECONDS).build();
    private volatile WebSocket socket;
    private volatile AudioRecord recorder;
    private volatile boolean capturing, cancelled, stopping, completed;
    private volatile long startTime;
    private volatile int bytesSent;
    private Thread recorderThread;
    private final String language;

    LiveTranscriptionClient(String language, Listener listener) {
        this.language = language;
        this.listener = listener;
    }

    void start(String apiKey) {
        if (apiKey == null || apiKey.trim().isEmpty()) throw new IllegalArgumentException("OpenAI API 키가 필요합니다.");
        postStatus("OpenAI 실시간 전사 서버에 연결 중…");
        Request request = new Request.Builder().url(RealtimeTranscriptionProtocol.URL)
                .header("Authorization", "Bearer " + apiKey.trim())
                .build();
        ui.postDelayed(() -> {
            if (!cancelled && !completed && recorderThread == null)
                fail("실시간 인식 서버의 연결 준비 시간이 초과되었습니다.");
        }, 30_000L);
        socket = http.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket ws, Response response) {
                if (cancelled) { ws.cancel(); return; }
                try {
                    if (!ws.send(RealtimeTranscriptionProtocol.sessionUpdate(language))) fail("실시간 전사 설정을 보낼 수 없습니다.");
                } catch (JSONException | IllegalArgumentException error) { fail("실시간 인식 모델 설정이 올바르지 않습니다."); }
            }

            @Override public void onMessage(WebSocket ws, String message) {
                if (cancelled || completed) return;
                try {
                    String type = RealtimeTranscriptionProtocol.eventType(message);
                    if ("session.updated".equals(type)) {
                        if (!capturing && !stopping && recorderThread == null) beginCapture();
                    } else if ("conversation.item.input_audio_transcription.delta".equals(type)) {
                        String delta = RealtimeTranscriptionProtocol.eventText(message, false);
                        if (!delta.isEmpty()) ui.post(() -> { if (!cancelled) listener.onDelta(delta); });
                    } else if ("conversation.item.input_audio_transcription.completed".equals(type)) {
                        String text = RealtimeTranscriptionProtocol.eventText(message, true);
                        completed = true;
                        capturing = false;
                        ws.close(1000, "Done");
                        ui.post(() -> { if (!cancelled) listener.onFinal(text); });
                    } else if ("error".equals(type)) {
                        fail("OpenAI 실시간 전사 서버가 요청을 처리하지 못했습니다. 키와 사용 한도를 확인하세요.");
                    }
                } catch (JSONException error) { fail("실시간 전사 응답 형식이 올바르지 않습니다."); }
            }

            @Override public void onFailure(WebSocket ws, Throwable error, Response response) {
                if (!cancelled && !completed) fail("실시간 전사 연결이 끊어졌습니다. 네트워크와 API 권한을 확인하세요.");
            }

            @Override public void onClosed(WebSocket ws, int code, String reason) {
                if (!cancelled && !completed) fail("실시간 전사 연결이 종료되었습니다. 다시 시도하세요.");
            }
        });
    }

    private void beginCapture() {
        if (cancelled || stopping) return;
        recorderThread = new Thread(() -> {
            AudioRecord active = null;
            try {
                if (cancelled || stopping) return;
                int min = AudioRecord.getMinBufferSize(RealtimeTranscriptionProtocol.SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (min <= 0) { fail("이 기기는 24kHz PCM16 마이크 녹음을 지원하지 않습니다."); return; }
                int bufferSize = Math.max(min * 2, 19_200);
                active = new AudioRecord(MediaRecorder.AudioSource.MIC, RealtimeTranscriptionProtocol.SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize);
                if (active.getState() != AudioRecord.STATE_INITIALIZED) {
                    fail("마이크를 초기화할 수 없습니다.");
                    return;
                }
                recorder = active;
                active.startRecording();
                if (active.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                    fail("마이크 녹음이 시작되지 않았습니다.");
                    return;
                }
                startTime = SystemClock.elapsedRealtime();
                capturing = true;
                postStatus("GPT 실시간 인식 중 · 마이크 음성이 OpenAI로 전송됩니다.");
                byte[] pcm = new byte[9_600];
                while (capturing && !cancelled) {
                    if (SystemClock.elapsedRealtime() - startTime >= MAX_RECORDING_MS) {
                        stopping = true;
                        capturing = false;
                        postStatus("5분 인식 제한에 도달했습니다. 최종 자막을 기다리는 중…");
                        scheduleFinalDeadline();
                        break;
                    }
                    int n = active.read(pcm, 0, pcm.length);
                    if (!capturing || cancelled) break;
                    if (n < 0) { fail("마이크 데이터를 읽을 수 없습니다."); break; }
                    if (n >= 2) {
                        int even = n - (n % 2);
                        if (even == 0) continue;
                        if (!socket.send(RealtimeTranscriptionProtocol.append(pcm, even))) {
                            fail("실시간 음성을 전송할 수 없습니다.");
                            break;
                        }
                        bytesSent += even;
                    }
                }
            } catch (SecurityException error) { fail("마이크 접근 권한이 없습니다."); }
            catch (Exception error) { if (!cancelled) fail("마이크 실시간 처리에 실패했습니다."); }
            finally {
                if (active != null) {
                    try { if (active.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) active.stop(); }
                    catch (RuntimeException ignored) {}
                    active.release();
                }
                recorder = null;
                if (stopping && !cancelled && bytesSent > 0 && socket != null) {
                    if (!socket.send(RealtimeTranscriptionProtocol.commit())) fail("실시간 전사 완료 요청을 보낼 수 없습니다.");
                    else postStatus("음성 전송 완료 · 최종 인식 결과 수신 중…");
                } else if (stopping && bytesSent == 0 && !cancelled) {
                    fail("전송된 음성이 없습니다. 마이크를 확인하고 다시 시도하세요.");
                }
            }
        }, "haebi-live-microphone");
        recorderThread.start();
    }

    void stop() {
        if (cancelled || completed || stopping) return;
        stopping = true;
        capturing = false;
        scheduleFinalDeadline();
        AudioRecord audio = recorder;
        if (audio != null) {
            try { audio.stop(); } catch (RuntimeException ignored) {}
        } else if (socket != null) {
            // A stop before session initialization is a cancellation, never an empty paid request.
            abort();
            ui.post(() -> listener.onError("실시간 연결 준비 중 중단했습니다. 다시 시작해 주세요."));
        }
    }

    private void scheduleFinalDeadline() {
        ui.postDelayed(() -> {
            if (stopping && !completed && !cancelled)
                fail("최종 자막 응답 시간이 초과되었습니다. 이전에 확정된 결과는 유지됩니다.");
        }, 60_000L);
    }

    void abort() {
        cancelled = true;
        capturing = false;
        stopping = true;
        AudioRecord audio = recorder;
        if (audio != null) try { audio.stop(); } catch (RuntimeException ignored) {}
        WebSocket ws = socket;
        if (ws != null) ws.cancel();
        http.dispatcher().executorService().shutdown();
        http.connectionPool().evictAll();
    }

    private void fail(String message) {
        if (cancelled || completed) return;
        abort();
        ui.post(() -> listener.onError(message));
    }

    private void postStatus(String text) { ui.post(() -> { if (!cancelled) listener.onStatus(text); }); }
}