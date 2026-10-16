package com.haebi.subtitle;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.graphics.Color;
import android.view.Gravity;
import android.view.WindowInsets;
import android.widget.Button;
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
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Hardware-backed playback reads content URI directly and never copies the video into WebView. */
public final class PreviewActivity extends Activity {
    private ExoPlayer player;
    private PlayerView view;
    private TextView subtitle;
    private JSONArray cues = new JSONArray();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long position;
    private boolean playWhenReady = true;
    private volatile boolean destroyed;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Runnable update = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            double seconds = player.getCurrentPosition() / 1000.0;
            String text = "";
            for (int i = 0; i < cues.length(); i++) {
                JSONObject cue = cues.optJSONObject(i);
                if (cue != null && cue.optDouble("start") <= seconds && cue.optDouble("end") > seconds) {
                    text = cue.optString("translated");
                    if (text.isEmpty()) text = cue.optString("original");
                    break;
                }
            }
            subtitle.setText(text);
            handler.postDelayed(this, 100);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        position = state == null ? getIntent().getLongExtra("positionMs", 0) : state.getLong("position");
        playWhenReady = state == null || state.getBoolean("playing", true);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.BLACK);
        layout.setFitsSystemWindows(true);
        Button close = new Button(this);
        close.setText("편집으로 돌아가기");
        close.setOnClickListener(v -> finish());
        layout.addView(close, new LinearLayout.LayoutParams(-1, -2));
        FrameLayout frame = new FrameLayout(this);
        view = new PlayerView(this);
        frame.addView(view, new FrameLayout.LayoutParams(-1, -1));
        subtitle = new TextView(this);
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
                JSONArray loaded = store.cues(getIntent().getStringExtra("jobId"));
                handler.post(() -> { if (!destroyed) cues = loaded; });
            } catch (Exception ignored) { }
        });
    }

    @Override protected void onStart() {
        super.onStart();
        player = new ExoPlayer.Builder(this).build();
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) {
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
