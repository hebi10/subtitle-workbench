package com.haebi.subtitle;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.WindowInsets;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A foreground-only, user-initiated paid transcription session. */
public final class CloudLiveRecognitionActivity extends Activity {
    private static final int MICROPHONE_PERMISSION = 509;
    private static final int INK = Color.rgb(23, 23, 23);
    private static final String[] LANGUAGES = {"auto", "ko", "en", "ja", "zh"};
    private final ExecutorService storage = Executors.newSingleThreadExecutor();
    private final OnDeviceCueDraft draft = new OnDeviceCueDraft();
    private LiveTranscriptionClient client;
    private Spinner language;
    private Button start, stop, save;
    private TextView status, partial, completed, disclosure;
    private final StringBuilder liveText = new StringBuilder();
    private long recordingOrigin = -1, turnStartMs, turnStopMs;
    private boolean saving, destroyed, finishing;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setTitle("해비 자막 · GPT 실시간 인식");
        buildView();
        try {
            updateDisclosure(new CloudAccessStore(this).current());
        } catch (RuntimeException error) {
            status.setText("사용할 클라우드 연결이 없습니다. 설정에서 개인 API 또는 테스트 연결을 저장해 주세요.");
            start.setEnabled(false);
        }
    }

    private int dp(int amount) { return Math.round(getResources().getDisplayMetrics().density * amount); }

    private TextView label(LinearLayout root, String text, int size, boolean strong) {
        TextView view = new TextView(this);
        view.setText(text);
        NativeDesignSystem.text(view, size, strong, getResources().getDisplayMetrics().density);
        root.addView(view, new LinearLayout.LayoutParams(-1, -2));
        return view;
    }

    private Button button(LinearLayout root, String text, boolean primary, Runnable action) {
        Button view = new Button(this);
        view.setText(text);
        NativeDesignSystem.button(view, primary, getResources().getDisplayMetrics().density);
        view.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(52));
        lp.topMargin = dp(8);
        root.addView(view, lp);
        return view;
    }

    private void buildView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(NativeDesignSystem.CANVAS);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
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

        label(root, "CLOUD / REALTIME", 11, true);
        label(root, "GPT 실시간 마이크 자막", 22, true);
        disclosure = label(root, "개인 API 연결은 API 이용 요금이 별도로 청구되며, 테스트 연결은 서버의 공용 테스트 한도가 적용됩니다. 선택한 전송 대상을 확인한 뒤 시작해 주세요.", 14, false);
        label(root, "인식 언어", 15, true);
        language = new Spinner(this);
        language.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
                new String[]{"자동 감지", "한국어", "English", "日本語", "中文"}));
        NativeDesignSystem.language(language, getResources().getDisplayMetrics().density);
        root.addView(language);

        start = button(root, "유료 GPT 실시간 인식 시작", true, this::requestStart);
        stop = button(root, "인식 종료 및 결과 확정", false, this::stopRecognition);
        stop.setEnabled(false);
        status = label(root, "마이크를 시작하지 않았습니다.", 14, false);
        NativeDesignSystem.surfaceText(status, getResources().getDisplayMetrics().density);
        label(root, "실시간 인식 중", 16, true);
        partial = label(root, "대기 중", 16, false);
        NativeDesignSystem.surfaceText(partial, getResources().getDisplayMetrics().density);
        label(root, "확정된 자막", 16, true);
        completed = label(root, "저장할 자막이 없습니다.", 14, false);
        NativeDesignSystem.surfaceText(completed, getResources().getDisplayMetrics().density);
        save = button(root, "자막 작업 기록 저장 및 편집", true, this::saveCues);
        save.setEnabled(false);
        button(root, "닫기", false, this::closeRequested);
        label(root, "한 번에 최대 5분 동안 인식할 수 있습니다. 말하는 도중 텍스트가 표시되고 종료 후 최종 문장이 저장됩니다. 정확한 단어별 시간은 제공하지 않아 구간 시간은 추정값입니다. 화면을 벗어나면 마이크 전송을 중지합니다.", 13, false);
    }

    private String chosenLanguage() { return LANGUAGES[language.getSelectedItemPosition()]; }

    private void updateDisclosure(CloudAccess access) {
        disclosure.setText(access.isRelay()
                ? "테스트 연결: " + access.origin() + "\n마이크 음성을 이 테스트 서버를 거쳐 OpenAI의 gpt-live-transcribe로 전송합니다. 개인 API 키와 개인 결제는 필요하지 않으며 서버의 공용 테스트 한도가 적용됩니다. 시작을 누른 경우에만 전송합니다."
                : "개인 API 연결: OpenAI\n본인의 OpenAI API 키로 gpt-live-transcribe를 사용합니다. 마이크 음성을 OpenAI로 전송하며 API 이용 요금이 별도로 청구됩니다. 시작을 누른 경우에만 전송합니다.");
        start.setText(access.isRelay() ? "테스트 GPT 실시간 인식 시작" : "유료 GPT 실시간 인식 시작");
    }

    private void requestStart() {
        if (saving || client != null) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE_PERMISSION);
            return;
        }
        startRecognition();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(requestCode, permissions, grants);
        if (requestCode == MICROPHONE_PERMISSION) {
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) startRecognition();
            else status.setText("마이크 권한이 없어 실시간 인식을 시작할 수 없습니다.");
        }
    }

    private void startRecognition() {
        if (client != null || saving) return;
        final CloudAccess access;
        try { access = new CloudAccessStore(this).current(); updateDisclosure(access); }
        catch (RuntimeException error) { status.setText("클라우드 연결을 읽을 수 없습니다. 설정에서 개인 API 또는 테스트 연결을 확인해 주세요."); return; }
        long now = SystemClock.elapsedRealtime();
        if (recordingOrigin < 0) recordingOrigin = now;
        turnStartMs = now - recordingOrigin;
        turnStopMs = 0;
        liveText.setLength(0);
        partial.setText("연결 준비 중…");
        start.setEnabled(false);
        stop.setEnabled(true);
        save.setEnabled(false);
        language.setEnabled(false);
        client = new LiveTranscriptionClient(chosenLanguage(), new LiveTranscriptionClient.Listener() {
            @Override public void onStatus(String value) { if (!destroyed) status.setText(value); }
            @Override public void onDelta(String value) {
                if (destroyed) return;
                if (liveText.length() < 10000) liveText.append(value, 0, Math.min(value.length(), 10000 - liveText.length()));
                partial.setText(liveText.toString());
            }
            @Override public void onFinal(String text) {
                if (destroyed) return;
                releaseClient();
                String finalText = String.valueOf(text == null ? "" : text).trim();
                if (!finalText.isEmpty()) {
                    try {
                        long end = turnStopMs > 0 ? turnStopMs :
                                Math.min(SystemClock.elapsedRealtime() - recordingOrigin, turnStartMs + 5L * 60_000);
                        draft.add(finalText, turnStartMs, end);
                        completed.setText("확정 자막 " + draft.size() + "개\n마지막: " + finalText);
                        partial.setText("최종 자막 수신 완료");
                        status.setText("최종 문장이 저장 대기 상태입니다. 다음 문장 인식 또는 자막 저장이 가능합니다.");
                    } catch (Exception error) { status.setText("인식된 텍스트가 너무 길어 자막에 추가하지 못했습니다."); }
                } else {
                    status.setText("인식 결과가 없습니다. 다시 시작해 주세요.");
                }
                resetActions();
            }
            @Override public void onError(String error) {
                if (destroyed) return;
                releaseClient();
                partial.setText("전사 실패 · 임시 인식 문장은 저장되지 않았습니다.");
                status.setText(error);
                resetActions();
            }
        });
        try { client.start(access); }
        catch (RuntimeException error) {
            releaseClient();
            status.setText("실시간 전사 연결을 시작하지 못했습니다.");
            resetActions();
        }
    }

    private void stopRecognition() {
        if (client == null) return;
        stop.setEnabled(false);
        turnStopMs = Math.max(1, SystemClock.elapsedRealtime() - recordingOrigin);
        status.setText("전송을 종료하고 최종 인식 결과를 기다리는 중…");
        client.stop();
    }

    private void releaseClient() {
        if (client != null) { client.abort(); client = null; }
    }

    private void resetActions() {
        start.setEnabled(!saving);
        stop.setEnabled(false);
        save.setEnabled(!saving && draft.size() > 0);
        language.setEnabled(!saving);
    }

    private void saveCues() {
        if (client != null || saving || draft.size() == 0) return;
        saving = true;
        start.setEnabled(false);
        save.setEnabled(false);
        status.setText("자막 작업 기록을 저장하는 중…");
        final JSONArray snapshot;
        try { snapshot = draft.snapshot(); }
        catch (Exception error) { saving = false; resetActions(); status.setText("자막 저장 자료에 오류가 있습니다."); return; }
        String title = "GPT 실시간 마이크 " + new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.KOREA).format(new Date());
        storage.execute(() -> {
            try (JobStore store = new JobStore(getApplicationContext())) {
                String id = store.importCues(title, snapshot);
                runOnUiThread(() -> {
                    if (destroyed) return;
                    setResult(RESULT_OK, new Intent().putExtra("jobId", id));
                    finishing = true;
                    finish();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (destroyed) return;
                    saving = false;
                    resetActions();
                    status.setText("자막 저장에 실패했습니다. 저장 공간을 확인하고 다시 시도하세요.");
                });
            }
        });
    }

    private void closeRequested() {
        releaseClient();
        resetActions();
        if (draft.size() > 0 && !finishing) {
            new AlertDialog.Builder(this).setTitle("저장하지 않은 자막")
                    .setMessage("확정된 자막을 저장하지 않고 닫을까요?")
                    .setNegativeButton("취소", null)
                    .setPositiveButton("저장 없이 닫기", (dialog, value) -> finish()).show();
        } else finish();
    }

    @Override public void onBackPressed() { closeRequested(); }

    @Override protected void onStop() {
        if (client != null) {
            releaseClient();
            resetActions();
            status.setText("화면을 벗어나 마이크 전송을 중단했습니다. 확정된 자막은 유지됩니다.");
        }
        super.onStop();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        releaseClient();
        storage.shutdown();
        super.onDestroy();
    }
}
