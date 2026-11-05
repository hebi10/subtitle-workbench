package com.haebi.subtitle;

import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.widget.Button;
import android.widget.Spinner;
import android.widget.TextView;

/** Unified grayscale design primitives for the two native microphone screens. */
final class NativeDesignSystem {
    static final int CANVAS = Color.rgb(245, 245, 245);
    static final int PAPER = Color.WHITE;
    static final int INK = Color.rgb(22, 22, 22);
    static final int MUTED = Color.rgb(92, 92, 92);
    static final int LINE = Color.rgb(213, 213, 213);

    private NativeDesignSystem() {}

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
        view.setAllCaps(false);
        view.setTextSize(15);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setTextColor(primary ? PAPER : INK);
        view.setBackground(surface(primary ? INK : PAPER, primary ? INK : LINE, density));
        view.setElevation(0f);
        view.setMinHeight(dp(density, 52));
        view.setPadding(dp(density, 12), dp(density, 10), dp(density, 12), dp(density, 10));
    }

    static void text(TextView view, int size, boolean strong, float density) {
        view.setTextSize(size);
        view.setTextColor(strong ? INK : MUTED);
        view.setTypeface(Typeface.DEFAULT, strong ? Typeface.BOLD : Typeface.NORMAL);
        view.setLineSpacing(dp(density, 2), 1f);
        view.setPadding(0, dp(density, 8), 0, dp(density, 10));
    }

    static void surfaceText(TextView view, float density) {
        view.setBackground(surface(PAPER, LINE, density));
        view.setMinHeight(dp(density, 72));
        view.setPadding(dp(density, 14), dp(density, 12), dp(density, 14), dp(density, 12));
    }

    static void language(Spinner spinner, float density) {
        spinner.setMinimumHeight(dp(density, 52));
        spinner.setPadding(dp(density, 12), 0, dp(density, 12), 0);
    }
}