package com.haebi.subtitle;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;

import java.io.File;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Fully app-managed Vosk model and file transcription, independent of Android SpeechRecognizer and OpenAI. */
public final class OfflineVoskActivity extends Activity {
    private static final int PICK_MEDIA = 603;
    private static final int INK = NativeDesignSystem.INK;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private OfflineModelInstaller installer;
    private Spinner selection;
    private TextView modelStatus, sourceStatus, status, captionPreview;
    private Button download, delete, pick, run, cancel, save;
    private Uri sourceUri;
    private String sourceName;
    private JSONArray cues;
    private boolean busy, destroyed, finishing;
    private int lastProgress = -1;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        setTitle("해비 자막 · 독립 로컬 AI");
        installer = new OfflineModelInstaller(this);
        createView();
        render();
    }

    private int dp(int amount) { return Math.round(getResources().getDisplayMetrics().density * amount); }

    private void createView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(NativeDesignSystem.CANVAS);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                        android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(18), dp(20), dp(36));
        scroll.addView(root);
        setContentView(scroll);

        label(root, "OFFLINE / LOCAL AI", 11, true);
        label(root, "독립 로컬 AI 자막", 22, true);
        label(root, "앱이 직접 다운로드한 Vosk 언어 모델로 영상·음성 파일을 전사합니다. 모델 설치 후에는 인터넷과 OpenAI API 키 없이 사용할 수 있습니다.", 14, false);
        label(root, "01 · 언어 모델", 16, true);
        selection = new Spinner(this);
        String[] choices = new String[OfflineModelCatalog.MODELS.length];
        for (int index = 0; index < choices.length; index++) {
            OfflineModelCatalog.Spec model = OfflineModelCatalog.MODELS[index];
            choices[index] = model.title + " · 약 " + model.approximateMegabytes + "MB";
        }
        selection.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, choices));
        NativeDesignSystem.language(selection, getResources().getDisplayMetrics().density);
        root.addView(selection);
        selection.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, android.view.View view, int position, long id) { render(); }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) { }
        });
        modelStatus = label(root, "", 14, false);
        NativeDesignSystem.surfaceText(modelStatus, getResources().getDisplayMetrics().density);
        download = button(root, "선택 모델 다운로드·설치", true, this::downloadSelected);
        delete = button(root, "다운로드한 모델 삭제", false, this::requestDelete);

        label(root, "02 · 음성 파일", 16, true);
        sourceStatus = label(root, "선택한 영상·오디오가 없습니다.", 14, false);
        NativeDesignSystem.surfaceText(sourceStatus, getResources().getDisplayMetrics().density);
        pick = button(root, "영상·오디오 파일 선택", false, this::pickFile);
        label(root, "오프라인 인식은 최대 60분 파일을 지원합니다. 기기 성능에 따라 처리 시간이 길어질 수 있으며 원본은 앱에 복사하지 않습니다.", 13, false);

        label(root, "03 · 인식 결과", 16, true);
        run = button(root, "오프라인 음성 인식 시작", true, this::runTranscription);
        cancel = button(root, "다운로드·인식 중단", false, () -> { cancelled.set(true); status.setText("중단 요청을 처리하고 있습니다…"); });
        cancel.setEnabled(false);
        status = label(root, "언어 모델과 영상·오디오를 선택하세요.", 14, false);
        NativeDesignSystem.surfaceText(status, getResources().getDisplayMetrics().density);
        captionPreview = label(root, "인식 결과는 이곳에 표시됩니다.", 14, false);
        NativeDesignSystem.surfaceText(captionPreview, getResources().getDisplayMetrics().density);
        save = button(root, "자막 저장 및 편집", true, this::save);
        save.setEnabled(false);
        button(root, "닫기", false, this::closeRequested);

        label(root, "Vosk 소형 모델은 Whisper와 인식 정확도가 다릅니다. 한국어 소형 모델의 공개 Zeroth 테스트 WER는 28.1%입니다. 모델 다운로드에만 네트워크를 사용하며 음성 파일은 OpenAI로 전송하지 않습니다. 모델 라이선스: Apache-2.0.", 13, false);
    }

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
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, dp(52));
        layout.topMargin = dp(8);
        root.addView(view, layout);
        return view;
    }

    private OfflineModelCatalog.Spec selected() {
        return OfflineModelCatalog.MODELS[selection.getSelectedItemPosition()];
    }

    private void render() {
        if (selection == null || modelStatus == null) return;
        OfflineModelCatalog.Spec model = selected();
        File installed = installer.installedModel(model);
        boolean damaged = installed == null && installer.hasLocalData(model);
        modelStatus.setText(installed != null
                ? model.title + " 설치됨 · 저장 공간 "
                    + (installer.installedSize(model) / (1024 * 1024)) + "MB 사용\n"
                    + model.description
                : damaged
                    ? model.title + " 설치 정보가 손상되었습니다. 모델 삭제 후 다시 다운로드해 주세요."
                    : model.title + " 설치되지 않음 · 모델 크기 약 " + model.approximateMegabytes
                        + "MB\n" + model.description);
        selection.setEnabled(!busy);
        download.setEnabled(!busy && installed == null && !damaged);
        delete.setEnabled(!busy && (installed != null || damaged));
        pick.setEnabled(!busy);
        run.setEnabled(!busy && installed != null && sourceUri != null);
        cancel.setEnabled(busy);
        save.setEnabled(!busy && cues != null && cues.length() > 0);
    }

    private void setBusy(boolean active) { busy = active; render(); }

    private void message(String text) {
        runOnUiThread(() -> { if (!destroyed) status.setText(text); });
    }

    private void progress(String title, long done, long total) {
        int percentage = (int) Math.max(0, Math.min(100, total > 0 ? (done * 100 / total) : 0));
        if (percentage != lastProgress) {
            lastProgress = percentage;
            message(title + " · " + percentage + "%");
        }
    }

    private void downloadSelected() {
        if (busy || installer.installedModel(selected()) != null) return;
        OfflineModelCatalog.Spec spec = selected();
        lastProgress = -1;
        cancelled.set(false);
        setBusy(true);
        status.setText("모델을 다운로드합니다. Wi-Fi 사용을 권장합니다.");
        worker.execute(() -> {
            try {
                installer.download(spec, cancelled, this::progress);
                message("SHA-256 검증 및 로컬 설치가 완료되었습니다. 인터넷 없이 전사할 수 있습니다.");
            } catch (InterruptedException error) {
                message("다운로드를 중단했습니다. 완료되지 않은 임시 파일을 정리했습니다.");
            } catch (Exception error) {
                message("모델 설치 실패: " + readable(error));
            } finally {
                runOnUiThread(() -> { if (!destroyed) setBusy(false); });
            }
        });
    }

    private void requestDelete() {
        if (busy) return;
        OfflineModelCatalog.Spec spec = selected();
        if (!installer.hasLocalData(spec)) return;
        new AlertDialog.Builder(this).setTitle("로컬 AI 모델 삭제")
                .setMessage(spec.title + " 모델 파일을 기기에서 삭제합니다. 저장된 자막 작업은 유지됩니다.")
                .setNegativeButton("취소", null)
                .setPositiveButton("모델 삭제", (dialog, which) -> {
                    setBusy(true);
                    worker.execute(() -> {
                        try {
                            installer.delete(spec);
                            message("모델을 삭제했습니다. 기존 자막 기록은 유지됩니다.");
                        } catch (Exception error) { message("모델을 삭제하지 못했습니다: " + readable(error)); }
                        finally { runOnUiThread(() -> { if (!destroyed) setBusy(false); }); }
                    });
                }).show();
    }

    private void pickFile() {
        if (busy) return;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"audio/*", "video/*"});
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(intent, PICK_MEDIA); }
        catch (RuntimeException error) { status.setText("기기의 파일 선택기를 열 수 없습니다."); }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_MEDIA) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        sourceUri = data.getData();
        sourceName = displayName(sourceUri);
        cues = null;
        sourceStatus.setText(sourceName);
        status.setText("파일을 선택했습니다. 설치된 모델로 오프라인 음성 인식을 시작할 수 있습니다.");
        captionPreview.setText("아직 이 파일의 인식 결과가 없습니다.");
        render();
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String value = cursor.getString(0);
                if (value != null && !value.isEmpty())
                    return value.length() > 120 ? value.substring(0, 120) : value;
            }
        } catch (Exception ignored) { }
        return "선택한 미디어";
    }

    private void runTranscription() {
        if (busy || sourceUri == null) return;
        OfflineModelCatalog.Spec spec = selected();
        File model = installer.installedModel(spec);
        if (model == null) { status.setText("먼저 언어 모델을 다운로드해 주세요."); return; }
        Uri source = sourceUri;
        lastProgress = -1;
        cancelled.set(false);
        cues = null;
        setBusy(true);
        captionPreview.setText("AI가 음성을 분석하고 있습니다…");
        worker.execute(() -> {
            try {
                JSONArray transcript = new OfflineVoskTranscriber(getApplicationContext())
                        .run(source, model, cancelled, (text, percent, count) -> {
                            if (percent != lastProgress) {
                                lastProgress = percent;
                                message(text + " · " + percent + "% · 자막 " + count + "개");
                            }
                        });
                OfflineModelInstaller.requireNotCancelled(cancelled);
                runOnUiThread(() -> {
                    if (destroyed) return;
                    cues = transcript;
                    captionPreview.setText(transcript.length() + "개 자막을 생성했습니다.\n"
                            + (transcript.length() > 0 ? transcript.optJSONObject(0).optString("original") : "음성이 인식되지 않았습니다. 다른 언어 모델 또는 오디오 파일을 확인하세요."));
                    status.setText("로컬 음성 인식 완료 · 편집이 가능한 자막으로 저장할 수 있습니다.");
                });
            } catch (InterruptedException error) {
                message("로컬 음성 인식을 중단했습니다. 미완료 결과는 저장하지 않았습니다.");
            } catch (Exception error) {
                message("로컬 음성 인식 실패: " + readable(error));
            } finally { runOnUiThread(() -> { if (!destroyed) setBusy(false); }); }
        });
    }

    private void save() {
        if (busy || cues == null || cues.length() == 0) return;
        JSONArray snapshot = cues;
        String name = "오프라인 자막 · " + selected().title + " · " + (sourceName == null ? "음성" : sourceName);
        setBusy(true);
        status.setText("인식된 자막을 작업 기록에 저장 중…");
        worker.execute(() -> {
            try (JobStore store = new JobStore(getApplicationContext())) {
                String id = store.importCues(name, snapshot);
                runOnUiThread(() -> {
                    if (destroyed) return;
                    setResult(RESULT_OK, new Intent().putExtra("jobId", id));
                    finishing = true;
                    finish();
                });
            } catch (Exception error) {
                message("자막 작업 저장에 실패했습니다: " + readable(error));
            } finally { runOnUiThread(() -> { if (!destroyed) setBusy(false); }); }
        });
    }

    private String readable(Exception error) {
        String value = error.getMessage();
        return value == null || value.isEmpty() ? "기기의 저장 공간 또는 파일 형식을 확인해 주세요." :
                value.substring(0, Math.min(130, value.length()));
    }

    private void closeRequested() {
        if (busy) {
            cancelled.set(true);
            status.setText("진행 중인 작업의 중단을 요청했습니다. 중단 후 닫아 주세요.");
            return;
        }
        if (cues != null && cues.length() > 0 && !finishing) {
            new AlertDialog.Builder(this).setTitle("저장하지 않은 자막")
                    .setMessage("오프라인 인식 결과를 작업 기록에 저장하지 않고 닫을까요?")
                    .setNegativeButton("취소", null)
                    .setPositiveButton("저장 없이 닫기", (dialog, which) -> finish()).show();
        } else finish();
    }

    @Override public void onBackPressed() { closeRequested(); }

    @Override protected void onStop() {
        if (busy) cancelled.set(true);
        super.onStop();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        cancelled.set(true);
        worker.shutdownNow();
        super.onDestroy();
    }
}