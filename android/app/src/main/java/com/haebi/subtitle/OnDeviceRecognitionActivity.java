package com.haebi.subtitle;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.speech.ModelDownloadListener;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Only the OS on-device recognizer is used. This activity never sends microphone audio to OpenAI. */
public final class OnDeviceRecognitionActivity extends Activity {
    private static final int AUDIO_PERMISSION = 501;
    private static final String[] LANGUAGES = {"ko-KR", "en-US", "ja-JP", "zh-CN"};

    private final ExecutorService storage = Executors.newSingleThreadExecutor();
    private final OnDeviceCueDraft draft = new OnDeviceCueDraft();
    private SpeechRecognizer recognizer;
    private Spinner language;
    private Button startButton, stopButton, saveButton, downloadButton, checkButton;
    private TextView status, partial, completed;
    private long recordingOriginMs = -1, utteranceStartMs;
    private boolean recognizing, saving, finishing, destroyed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setTitle("해비 자막 · 온디바이스 마이크");
        buildView();
        if (Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            showStatus("이 기기에서는 온디바이스 음성 인식이 제공되지 않습니다. Android 12 이상과 설치된 인식 엔진이 필요합니다.");
            startButton.setEnabled(false);
            checkButton.setEnabled(false);
            downloadButton.setEnabled(false);
            return;
        }
        try {
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
            recognizer.setRecognitionListener(listener);
            showStatus("온디바이스 인식 서비스를 찾았습니다. 언어를 선택하고 인식을 시작하세요.");
        } catch (RuntimeException error) {
            showStatus("온디바이스 음성 인식 서비스를 시작할 수 없습니다.");
            startButton.setEnabled(false);
            checkButton.setEnabled(false);
            downloadButton.setEnabled(false);
        }
    }

    private void buildView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(NativeDesignSystem.canvas(this));
        scroll.setClipToPadding(false);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(20), dp(20), dp(36));
        scroll.addView(root);
        setContentView(scroll);
        addText(root, "ON-DEVICE / MICROPHONE", 11, true);
        addText(root, "온디바이스 마이크 자막", 22, true);
        addText(root, "기기의 음성 인식 서비스로 말하는 동안 자막을 만듭니다. OpenAI API 키나 API 이용 요금은 필요하지 않습니다. 인식 품질과 지원 언어는 기기마다 다릅니다.", 14, false);
        addText(root, "인식 언어", 15, true);
        language = new Spinner(this);
        language.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"한국어", "English", "日本語", "中文"}));
        NativeDesignSystem.language(language, getResources().getDisplayMetrics().density);
        root.addView(language);
        checkButton = addButton(root, "언어 지원 확인", false, this::checkSupport);
        downloadButton = addButton(root, "온디바이스 언어 모델 다운로드 요청", false, this::downloadModel);
        addText(root, "모델은 Android 시스템 인식 서비스가 설치·관리합니다. Android 13 이상에서만 다운로드 요청을 지원합니다.", 13, false);
        startButton = addButton(root, "마이크 인식 시작", true, this::requestStart);
        stopButton = addButton(root, "인식 종료", false, this::stopListening);
        stopButton.setEnabled(false);
        status = addText(root, "서비스 지원 상태를 확인 중입니다.", 14, false);
        NativeDesignSystem.surfaceText(status, getResources().getDisplayMetrics().density);
        addText(root, "인식 중인 문장", 16, true);
        partial = addText(root, "마이크 입력 대기", 16, false);
        NativeDesignSystem.surfaceText(partial, getResources().getDisplayMetrics().density);
        addText(root, "저장 예정 자막", 16, true);
        completed = addText(root, "확정된 문장이 없습니다.", 14, false);
        NativeDesignSystem.surfaceText(completed, getResources().getDisplayMetrics().density);
        saveButton = addButton(root, "완료 자막 저장 및 편집", true, this::save);
        saveButton.setEnabled(false);
        addButton(root, "닫기", false, this::closeRequested);
        addText(root, "말을 마친 후 다음 문장은 인식을 다시 시작하세요. 자막 시간은 마이크 호출 시점을 기준으로 계산된 추정값이며, 확정되지 않은 임시 문장은 저장되지 않습니다.", 13, false);
    }

    private TextView addText(LinearLayout root, String text, int sp, boolean strong) {
        TextView node = new TextView(this);
        node.setText(text);
        NativeDesignSystem.text(node, sp, strong, getResources().getDisplayMetrics().density);
        root.addView(node, new LinearLayout.LayoutParams(-1, -2));
        return node;
    }

    private Button addButton(LinearLayout root, String label, boolean primary, Runnable action) {
        Button node = new Button(this);
        node.setText(label);
        NativeDesignSystem.button(node, primary, getResources().getDisplayMetrics().density);
        node.setOnClickListener(view -> action.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(52));
        params.topMargin = dp(7);
        root.addView(node, params);
        return node;
    }

    private int dp(int value) { return Math.round(getResources().getDisplayMetrics().density * value); }
    private void showStatus(String value) { if (status != null) status.setText(value); }
    private String chosenLanguage() { return LANGUAGES[language.getSelectedItemPosition()]; }

    private Intent recognitionIntent() {
        return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, chosenLanguage())
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
    }

    private void checkSupport() {
        if (recognizer == null || recognizing || saving) return;
        if (Build.VERSION.SDK_INT < 33) {
            showStatus("이 Android 버전에서는 모델 지원 조회가 제공되지 않습니다. 인식 버튼으로 확인하세요.");
            return;
        }
        showStatus("인식 언어 지원 상태 확인 중…");
        try {
            recognizer.checkRecognitionSupport(recognitionIntent(), getMainExecutor(), new RecognitionSupportCallback() {
                @Override public void onSupportResult(RecognitionSupport supported) {
                    String desired = chosenLanguage();
                    boolean installed = containsLocale(supported.getInstalledOnDeviceLanguages(), desired);
                    boolean downloadable = containsLocale(supported.getSupportedOnDeviceLanguages(), desired);
                    boolean pending = containsLocale(supported.getPendingOnDeviceLanguages(), desired);
                    showStatus(installed ? "선택한 언어의 모델이 설치되어 있습니다." :
                            pending ? "모델 다운로드가 예약되어 있습니다." :
                            downloadable ? "모델 다운로드가 필요합니다. 다운로드 요청을 선택하세요." :
                            "해당 언어의 지원 목록이 없습니다. 다른 언어 또는 기기 인식 엔진을 확인하세요.");
                }
                @Override public void onError(int error) { showStatus("모델 지원 조회 실패 (" + error + ")."); }
            });
        } catch (RuntimeException error) { showStatus("이 기기에서는 지원 목록을 조회할 수 없습니다."); }
    }

    private static boolean containsLocale(List<String> list, String desired) {
        String root = desired.substring(0, 2).toLowerCase(Locale.ROOT);
        for (String item : list) {
            if (item.equalsIgnoreCase(desired) || item.equalsIgnoreCase(root)) return true;
        }
        return false;
    }

    private void downloadModel() {
        if (recognizer == null || recognizing || saving) return;
        if (Build.VERSION.SDK_INT < 33) { showStatus("모델 다운로드 요청은 Android 13 이상에서 제공됩니다."); return; }
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                recognizer.triggerModelDownload(recognitionIntent(), getMainExecutor(), new ModelDownloadListener() {
                    @Override public void onSuccess() { showStatus("모델 다운로드 완료. 인식을 시작할 수 있습니다."); }
                    @Override public void onScheduled() { showStatus("다운로드가 예약되었습니다. 기기의 알림과 설정을 확인하세요."); }
                    @Override public void onProgress(int percent) { showStatus("모델 다운로드 " + percent + "%"); }
                    @Override public void onError(int error) { showStatus("모델 다운로드 실패 (" + error + ")."); }
                });
            } else {
                recognizer.triggerModelDownload(recognitionIntent());
                showStatus("기기 인식 서비스에 모델 다운로드를 요청했습니다. 언어 지원 확인으로 상태를 확인하세요.");
            }
        } catch (RuntimeException error) { showStatus("기기의 음성 인식 서비스가 다운로드를 지원하지 않습니다."); }
    }

    private void requestStart() {
        if (recognizer == null || recognizing || saving) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION);
        } else startListening();
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == AUDIO_PERMISSION) {
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) startListening();
            else showStatus("마이크 권한이 거부되어 인식을 시작할 수 없습니다.");
        }
    }

    private void startListening() {
        if (recognizer == null || recognizing || saving) return;
        recognizing = true;
        startButton.setEnabled(false);
        stopButton.setEnabled(true);
        saveButton.setEnabled(false);
        checkButton.setEnabled(false);
        downloadButton.setEnabled(false);
        long now = SystemClock.elapsedRealtime();
        if (recordingOriginMs < 0) recordingOriginMs = now;
        utteranceStartMs = now - recordingOriginMs;
        partial.setText("음성을 인식 중입니다…");
        showStatus("마이크 인식 중 · 기기 내 엔진 사용");
        try { recognizer.startListening(recognitionIntent()); }
        catch (RuntimeException error) { endListening(); showStatus("인식을 시작하지 못했습니다."); }
    }

    private void stopListening() {
        if (!recognizing || recognizer == null) return;
        stopButton.setEnabled(false);
        showStatus("최종 인식 결과를 확정하는 중…");
        recognizer.stopListening();
    }

    private void endListening() {
        recognizing = false;
        startButton.setEnabled(recognizer != null && !saving);
        stopButton.setEnabled(false);
        saveButton.setEnabled(draft.size() > 0 && !saving);
        checkButton.setEnabled(recognizer != null && !saving);
        downloadButton.setEnabled(recognizer != null && !saving);
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle bundle) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float value) {}
        @Override public void onBufferReceived(byte[] bytes) {}
        @Override public void onEndOfSpeech() { showStatus("인식된 문장을 확정하고 있습니다…"); }
        @Override public void onPartialResults(Bundle results) {
            String text = firstResult(results);
            if (recognizing && !text.isEmpty()) partial.setText(text + "\n(임시 문장)");
        }
        @Override public void onResults(Bundle results) {
            String text = firstResult(results);
            if (recognizing && !text.isEmpty()) {
                try {
                    draft.add(text, utteranceStartMs, SystemClock.elapsedRealtime() - recordingOriginMs);
                    completed.setText("확정된 자막 " + draft.size() + "개\n마지막 문장: " + text);
                    partial.setText("다음 문장은 인식을 다시 시작하세요.");
                    showStatus("문장 인식 완료 · 계속 인식하거나 저장할 수 있습니다.");
                } catch (Exception error) { showStatus("인식된 자막을 추가하지 못했습니다."); }
            } else showStatus("인식된 문장이 없습니다. 다시 시도하세요.");
            endListening();
        }
        @Override public void onError(int error) {
            if (destroyed) return;
            endListening();
            if (error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE || error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED)
                showStatus("언어 모델이 없습니다. 다운로드를 요청하거나 다른 언어를 선택하세요. (" + error + ")");
            else if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
                showStatus("인식된 말이 없습니다. 다시 시도해 주세요.");
            else showStatus("음성 인식 오류 (" + error + "). 기기 서비스를 확인하세요.");
        }
        @Override public void onEvent(int type, Bundle bundle) {}
    };

    private static String firstResult(Bundle bundle) {
        ArrayList<String> list = bundle == null ? null : bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list == null || list.isEmpty() ? "" : String.valueOf(list.get(0)).trim();
    }

    private void save() {
        if (recognizing || saving || draft.size() == 0) return;
        saving = true;
        saveButton.setEnabled(false);
        startButton.setEnabled(false);
        showStatus("자막을 저장하고 있습니다…");
        final JSONArray cues;
        try { cues = draft.snapshot(); }
        catch (Exception error) { saving = false; endListening(); showStatus("자막 확인에 실패했습니다."); return; }
        String title = "온디바이스 마이크 " + new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.KOREA).format(new Date());
        storage.execute(() -> {
            try (JobStore store = new JobStore(getApplicationContext())) {
                String jobId = store.importCues(title, cues);
                runOnUiThread(() -> {
                    if (destroyed) return;
                    setResult(RESULT_OK, new Intent().putExtra("jobId", jobId));
                    finishing = true;
                    finish();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (destroyed) return;
                    saving = false;
                    endListening();
                    showStatus("저장에 실패했습니다. 저장 공간을 확인하고 다시 시도하세요.");
                });
            }
        });
    }

    private void closeRequested() {
        if (draft.size() > 0 && !finishing) {
            new AlertDialog.Builder(this).setTitle("저장하지 않은 자막")
                    .setMessage("인식된 자막을 저장하지 않고 닫을까요?")
                    .setNegativeButton("취소", null)
                    .setPositiveButton("저장 없이 닫기", (dialog, which) -> finish()).show();
        } else finish();
    }

    @Override public void onBackPressed() { closeRequested(); }

    @Override protected void onStop() {
        if (recognizing && recognizer != null) {
            recognizer.cancel();
            endListening();
            showStatus("화면이 전환되어 마이크를 중단했습니다. 확정된 자막은 유지됩니다.");
        }
        super.onStop();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        if (recognizer != null) { recognizer.cancel(); recognizer.destroy(); recognizer = null; }
        storage.shutdown();
        super.onDestroy();
    }
}