package com.haebi.subtitle;

import android.content.Context;
import android.os.Build;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.widget.Button;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.LinearLayout;
import android.view.View;

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
        int activeInk = primary ? onAction(context) : ink(context);
        ColorStateList textColors = new ColorStateList(
                new int[][] { new int[] { -android.R.attr.state_enabled }, new int[] {} },
                new int[] { muted(context), activeInk });
        StateListDrawable backgrounds = new StateListDrawable();
        backgrounds.addState(new int[] { -android.R.attr.state_enabled },
                surface(isDark(context) ? Color.rgb(48, 48, 48) : Color.rgb(234, 234, 234), line(context), density));
        backgrounds.addState(new int[] {},
                surface(primary ? ink(context) : paper(context), primary ? ink(context) : line(context), density));
        view.setBackgroundTintList(null);
        view.setTextColor(textColors);
        view.setBackground(backgrounds);
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
        view.setElevation(0f);
        view.setMinHeight(dp(density, 72));
        view.setPadding(dp(density, 14), dp(density, 12), dp(density, 14), dp(density, 12));
    }

    static void language(Spinner spinner, float density) {
        spinner.setMinimumHeight(dp(density, 52));
        spinner.setPadding(dp(density, 12), 0, dp(density, 12), 0);
        spinner.setBackgroundTintList(ColorStateList.valueOf(ink(spinner.getContext())));
    }
    static int soft(Context context) {
        return isDark(context) ? Color.rgb(48, 48, 48) : Color.rgb(240, 240, 240);
    }
    private static TextView line(LinearLayout parent, String value, int size, boolean strong, float density) {
        TextView label = new TextView(parent.getContext());
        label.setText(value);
        text(label, size, strong, density);
        parent.addView(label, new LinearLayout.LayoutParams(-1, -2));
        return label;
    }
    static void header(LinearLayout root, String kicker, String title, String description, float density) {
        TextView eyebrow = line(root, kicker, 11, true, density);
        eyebrow.setTextColor(muted(root.getContext()));
        eyebrow.setPadding(0, 0, 0, dp(density, 4));
        TextView heading = line(root, title, 22, true, density);
        heading.setPadding(0, 0, 0, dp(density, 6));
        if (Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
        TextView intro = line(root, description, 14, false, density);
        intro.setPadding(0, 0, 0, dp(density, 8));
    }
    static LinearLayout section(LinearLayout parent, String index, String title, float density) {
        Context context = parent.getContext();
        LinearLayout group = new LinearLayout(context);
        group.setOrientation(LinearLayout.VERTICAL);
        group.setBackground(surface(paper(context), line(context), density));
        group.setPadding(dp(density, 14), dp(density, 12), dp(density, 14), dp(density, 14));
        group.setElevation(0f);
        group.setTag("editorial-section:" + index);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
        layout.topMargin = dp(density, 12);
        parent.addView(group, layout);
        TextView kicker = line(group, index, 11, true, density);
        kicker.setTextColor(muted(context));
        kicker.setPadding(0, 0, 0, dp(density, 2));
        TextView heading = line(group, title, 17, true, density);
        heading.setPadding(0, 0, 0, dp(density, 8));
        if (Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
        return group;
    }
    static void statusPanel(TextView view, float density) {
        Context context = view.getContext();
        surfaceText(view, density);
        view.setBackground(surface(soft(context), line(context), density));
        view.setTextColor(ink(context));
        view.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    }
    static void transcriptPanel(TextView view, float density) {
        Context context = view.getContext();
        surfaceText(view, density);
        view.setBackground(surface(soft(context), line(context), density));
        view.setTextColor(ink(context));
        view.setMinHeight(dp(density, 88));
        view.setTextIsSelectable(true);
    }

}
