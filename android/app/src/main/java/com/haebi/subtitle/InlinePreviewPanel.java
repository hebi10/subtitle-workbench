package com.haebi.subtitle;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/** Optional real native player above the existing WebView. No media bytes or URI are exposed by this bridge. */
final class InlinePreviewPanel {
    private final Activity activity;
    private final LinearLayout parent;
    private final LinearLayout panel;
    private final PlayerView playerView;
    private final TextView caption;
    private final TextView heading;
    private final float density;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private PreviewCueIndex cues;
    private boolean playbackError, cueError;
    private volatile String jobId;
    private volatile long generation;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player == null || playbackError) return;
            String text = cueError ? "저장 자막을 다시 불러와 주세요." : cues.textAt(player.getCurrentPosition() / 1000.0);
            if (!text.contentEquals(caption.getText())) caption.setText(text);
            caption.setVisibility(text.isEmpty() ? View.INVISIBLE : View.VISIBLE);
            handler.postDelayed(this, 100);
        }
    };

    @OptIn(markerClass = UnstableApi.class)
    InlinePreviewPanel(Activity activity, LinearLayout parent) {
        this.activity = activity;
        this.parent = parent;
        density = activity.getResources().getDisplayMetrics().density;
        panel = new LinearLayout(activity);
        panel.setTag("inline-preview-panel");
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(NativeDesignSystem.paper(activity));
        panel.setVisibility(View.GONE);
        parent.addView(panel, new LinearLayout.LayoutParams(-1, dp(220)));

        LinearLayout bar = new LinearLayout(activity);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), 0, dp(8), 0);
        heading = new TextView(activity);
        heading.setText("저장된 자막 미리보기");
        NativeDesignSystem.text(heading, 14, true, density);
        bar.addView(heading, new LinearLayout.LayoutParams(0, -2, 1f));
        Button close = new Button(activity);
        close.setText("영상 닫기");
        close.setTag("inline-preview-close");
        NativeDesignSystem.button(close, false, density);
        close.setTextSize(13);
        close.setOnClickListener(v -> close());
        bar.addView(close, new LinearLayout.LayoutParams(-2, -2));
        panel.addView(bar, new LinearLayout.LayoutParams(-1, -2));

        FrameLayout media = new FrameLayout(activity);
        media.setBackgroundColor(Color.BLACK);
        playerView = new PlayerView(activity);
        playerView.setTag("inline-preview-player");
        playerView.setControllerShowTimeoutMs(3000);
        media.addView(playerView, new FrameLayout.LayoutParams(-1, -1));
        caption = new TextView(activity);
        caption.setTag("inline-preview-caption");
        caption.setTextSize(15);
        caption.setTextColor(Color.WHITE);
        caption.setBackgroundColor(0xB0000000);
        caption.setGravity(Gravity.CENTER);
        caption.setPadding(dp(8), dp(4), dp(8), dp(4));
        caption.setMaxLines(3);
        caption.setEllipsize(android.text.TextUtils.TruncateAt.END);
        FrameLayout.LayoutParams overlay = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        overlay.bottomMargin = dp(48);
        media.addView(caption, overlay);
        panel.addView(media, new LinearLayout.LayoutParams(-1, 0, 1f));
        parent.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> resize());
    }

    private int dp(int value) { return Math.round(density * value); }
    boolean isOpen() { return jobId != null; }
    long generation() { return generation; }
    long sessionFor(String id) { return id.equals(jobId) ? generation : -1; }
    private boolean fits() { return parent.getHeight() >= dp(540); }

    private void resize() {
        if (!isOpen()) return;
        if (!fits()) { close(); return; }
        int height = Math.min(dp(260), Math.round(parent.getHeight() * .34f));
        if (panel.getLayoutParams().height != height) {
            LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) panel.getLayoutParams();
            params.height = height;
            panel.setLayoutParams(params);
        }
    }

    @OptIn(markerClass = UnstableApi.class)
    boolean open(String id, Uri uri, long positionMs, PreviewCueIndex savedCues) {
        if (!fits()) return false;
        close();
        cues = savedCues;
        cueError = playbackError = false;
        caption.setText("");
        caption.setVisibility(View.INVISIBLE);
        heading.setText("저장된 자막 미리보기");
        ExoPlayer next = new ExoPlayer.Builder(activity).build();
        player = next;
        jobId = id;
        playerView.setPlayer(next);
        next.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) {
                if (player != next) return;
                playbackError = true;
                handler.removeCallbacks(tick);
                caption.setText("영상을 재생할 수 없습니다. 원본 파일을 확인해 주세요.");
                caption.setVisibility(View.VISIBLE);
            }
        });
        next.setMediaItem(MediaItem.fromUri(uri));
        next.seekTo(positionMs);
        // Explicit play remains in the player; opening the editor preview never starts audio.
        next.setPlayWhenReady(false);
        next.prepare();
        panel.setVisibility(View.VISIBLE);
        resize();
        playerView.showController();
        handler.post(tick);
        return true;
    }

    void updateCues(String id, long session, PreviewCueIndex index) {
        if (!id.equals(jobId) || session != generation) return;
        cues = index;
        cueError = false;
        heading.setText("저장된 자막 미리보기");
    }

    void cueRefreshFailed(String id, long session) {
        if (!id.equals(jobId) || session != generation) return;
        cueError = true;
        heading.setText("저장 자막 다시 열기 필요");
    }

    void close() {
        jobId = null;
        generation++;
        handler.removeCallbacks(tick);
        if (player != null) {
            playerView.setPlayer(null);
            player.release();
            player = null;
        }
        cues = null;
        caption.setText("");
        panel.setVisibility(View.GONE);
    }
}
