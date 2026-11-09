package com.haebi.subtitle;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.widget.Button;
import android.widget.Spinner;
import android.widget.TextView;

/** Editorial Studio colors follow the Android system night mode. */
final class NativeDesignSystem {
    private static final int DAY_CANVAS = Color.rgb(245, 245, 245);
    private static final int DAY_SURFACE = Color.WHITE;
    private static final int DAY_INK = Color.rgb(23, 23, 23);
    private static final int DAY_MUTED = Color.rgb(98, 98, 98);
    private static final int DAY_BORDER = Color.rgb(216, 216, 216);
    private static final int NIGHT_CANVAS = Color.rgb(20, 20, 20);
    private static final int NIGHT_SURFACE = Color.rgb(36, 36, 36);
    private static final int NIGHT_INK = Color.rgb(242, 242, 242);
    private static final int NIGHT_MUTED = Color.rgb(173, 173, 173);
    private static final int NIGHT_BORDER = Color.rgb(65, 65, 65);

    private NativeDesignSystem() {}

    static boolean isDark(Context context) {
        return (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    static int canvas(Context context) { return isDark(context) ? NIGHT_CANVAS : DAY_CANVAS; }
    static int paper(Context context) { return isDark(context) ? NIGHT_SURFACE : DAY_SURFACE; }
    static int ink(Context context) { return isDark(context) ? NIGHT_INK : DAY_INK; }
    static int muted(Context context) { return isDark(context) ? NIGHT_MUTED : DAY_MUTED; }
    static int line(Context context) { return isDark(context) ? NIGHT_BORDER : DAY_BORDER; }
    static int onAction(Context context) { return isDark(context) ? DAY_INK : DAY_SURFACE; }

    private static int dp(float density, int value) { return Math.round(density * value); }

    static GradientDrawable surface(int fill, int stroke, float density) {
        GradientDrawable shape = new GradientDrawable();
        shape.setShape(GradientDrawable.RECTANGLE);
        shape.setColor(fill);
        shape.setCornerRadius(0f);
        shape.setStroke(Math.max(1, dp(density, 1)), stroke);
        return shape;
    }

    static void button(Button view, boolean primary, float density) {
        Context context = view.getContext();
        view.setAllCaps(false);
        view.setTextSize(15);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setTextColor(primary ? onAction(context) : ink(context));
        view.setBackground(surface(primary ? ink(context) : paper(context),
                primary ? ink(context) : line(context), density));
        view.setElevation(0f);
        view.setMinHeight(dp(density, 52));
        view.setPadding(dp(density, 12), dp(density, 10), dp(density, 12), dp(density, 10));
    }

    static void text(TextView view, int size, boolean strong, float density) {
        Context context = view.getContext();
        view.setTextSize(size);
        view.setTextColor(strong ? ink(context) : muted(context));
        view.setTypeface(Typeface.DEFAULT, strong ? Typeface.BOLD : Typeface.NORMAL);
        view.setLineSpacing(dp(density, 2), 1f);
        view.setPadding(0, dp(density, 8), 0, dp(density, 10));
    }

    static void surfaceText(TextView view, float density) {
        Context context = view.getContext();
        view.setBackground(surface(paper(context), line(context), density));
        view.setMinHeight(dp(density, 72));
        view.setPadding(dp(density, 14), dp(density, 12), dp(density, 14), dp(density, 12));
    }

    static void language(Spinner spinner, float density) {
        spinner.setMinimumHeight(dp(density, 52));
        spinner.setPadding(dp(density, 12), 0, dp(density, 12), 0);
    }
}
