package com.haebi.subtitle;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.graphics.Color;
import android.view.Gravity;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Spinner;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import org.json.JSONArray;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Hardware-backed playback reads content URI directly and never copies the video into WebView. */
public final class PreviewActivity extends Activity {
    private ExoPlayer player;
    private PlayerView view;
    private TextView subtitle;
    private PreviewCueIndex.DisplayMode displayMode = PreviewCueIndex.DisplayMode.TRANSLATED;
    private PreviewCueIndex cues = new PreviewCueIndex(new JSONArray());
    private boolean playbackError;
    private boolean cueLoadError;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long position;
    private boolean playWhenReady = true;
    private volatile boolean destroyed;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Runnable update = new Runnable() {
        @Override public void run() {
            if (player == null || playbackError) return;
            String text = cueLoadError ? "저장된 자막을 불러올 수 없습니다. 편집 화면으로 돌아가 확인해 주세요."
                    : cues.textAt(player.getCurrentPosition() / 1000.0, displayMode);
            if (!text.contentEquals(subtitle.getText())) subtitle.setText(text);
            handler.postDelayed(this, 100);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        position = state == null ? getIntent().getLongExtra("positionMs", 0) : state.getLong("position");
        playWhenReady = state == null || state.getBoolean("playing", true);
        if (state != null) {
            int selected = state.getInt("displayMode", 0);
            if (selected >= 0 && selected < PreviewCueIndex.DisplayMode.values().length) {
                displayMode = PreviewCueIndex.DisplayMode.values()[selected];
            }
        }
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(NativeDesignSystem.canvas(this));
        layout.setFitsSystemWindows(true);
        float density = getResources().getDisplayMetrics().density;
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(Math.round(8 * density), Math.round(4 * density), Math.round(12 * density), Math.round(4 * density));
        toolbar.setBackgroundColor(NativeDesignSystem.paper(this));
        Button close = new Button(this);
        close.setText("편집으로 돌아가기");
        NativeDesignSystem.button(close, false, density);
        close.setTextSize(13);
        close.setOnClickListener(v -> finish());
        toolbar.addView(close, new LinearLayout.LayoutParams(-2, -2));
        TextView title = new TextView(this);
        title.setText("영상 미리보기");
        NativeDesignSystem.text(title, 17, true, density);
        title.setGravity(Gravity.CENTER);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        layout.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout modeRow = new LinearLayout(this);
        boolean horizontal = getResources().getConfiguration().screenWidthDp >= 360
                && getResources().getConfiguration().fontScale <= 1.15f;
        modeRow.setOrientation(horizontal ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        modeRow.setGravity(Gravity.CENTER_VERTICAL);
        modeRow.setPadding(Math.round(12 * density), 0, Math.round(12 * density), Math.round(4 * density));
        modeRow.setBackgroundColor(NativeDesignSystem.paper(this));
        TextView modeLabel = new TextView(this);
        modeLabel.setText("자막 표시");
        NativeDesignSystem.text(modeLabel, 13, true, density);
        Spinner mode = new Spinner(this);
        mode.setId(android.view.View.generateViewId());
        mode.setTag("preview-display-mode");
        modeLabel.setLabelFor(mode.getId());
        mode.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
                new String[]{"번역 우선", "원문", "원문 + 번역"}));
        NativeDesignSystem.language(mode, density);
        mode.setSelection(displayMode.ordinal());
        mode.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, android.view.View selected, int index, long id) {
                displayMode = PreviewCueIndex.DisplayMode.values()[index];
            }
            @Override public void onNothingSelected(AdapterView<?> parent) {}
        });
        modeRow.addView(modeLabel, new LinearLayout.LayoutParams(horizontal ? 0 : -1, -2, horizontal ? 1f : 0f));
        modeRow.addView(mode, new LinearLayout.LayoutParams(horizontal ? 0 : -1, -2, horizontal ? 2f : 0f));
        layout.addView(modeRow, new LinearLayout.LayoutParams(-1, -2));
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.BLACK);
        view = new PlayerView(this);
        frame.addView(view, new FrameLayout.LayoutParams(-1, -1));
        subtitle = new TextView(this);
        subtitle.setTag("preview-caption");
        subtitle.setTextSize(20);
        subtitle.setTextColor(Color.WHITE);
        subtitle.setBackgroundColor(0xB0000000);
        subtitle.setGravity(Gravity.CENTER);
        int padding = (int) (12 * getResources().getDisplayMetrics().density);
        subtitle.setPadding(padding, padding, padding, padding);
        FrameLayout.LayoutParams subtitleParams = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        subtitleParams.bottomMargin = padding * 6;
        frame.addView(subtitle, subtitleParams);
        layout.addView(frame, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        io.execute(() -> {
            try (JobStore store = new JobStore(this)) {
                PreviewCueIndex loaded = new PreviewCueIndex(store.cues(getIntent().getStringExtra("jobId")));
                handler.post(() -> { if (!destroyed) cues = loaded; });
            } catch (Exception ignored) {
                handler.post(() -> { if (!destroyed) cueLoadError = true; });
            }
        });
    }

    @Override protected void onStart() {
        super.onStart();
        playbackError = false;
        player = new ExoPlayer.Builder(this).build();
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) {
                playbackError = true;
                handler.removeCallbacks(update);
                subtitle.setText("영상을 재생할 수 없습니다. 원본 파일의 위치와 지원 코덱을 확인해 주세요.");
            }
        });
        player.setMediaItem(MediaItem.fromUri(Uri.parse(getIntent().getStringExtra("uri"))));
        player.seekTo(position);
        player.prepare();
        player.setPlayWhenReady(playWhenReady);
        handler.post(update);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putLong("position", player == null ? position : player.getCurrentPosition());
        state.putBoolean("playing", player == null ? playWhenReady : player.getPlayWhenReady());
        state.putInt("displayMode", displayMode.ordinal());
        super.onSaveInstanceState(state);
    }

    @Override protected void onStop() {
        handler.removeCallbacks(update);
        if (player != null) {
            position = player.getCurrentPosition();
            playWhenReady = player.getPlayWhenReady();
            view.setPlayer(null);
            player.release(); player = null;
        }
        super.onStop();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        io.shutdown();
        super.onDestroy();
    }
}
