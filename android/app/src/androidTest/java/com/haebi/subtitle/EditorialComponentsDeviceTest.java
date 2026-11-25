package com.haebi.subtitle;

import android.content.Context;
import android.graphics.drawable.StateListDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.*;

/** Checks common native presentation; never uses the microphone or any API. */
@RunWith(AndroidJUnit4.class)
public final class EditorialComponentsDeviceTest {
    @Test public void primaryAndSecondaryButtonsProvideEnabledAndDisabledColors() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            Context context = ApplicationProvider.getApplicationContext();
            float density = context.getResources().getDisplayMetrics().density;
            for (boolean primary : new boolean[] { true, false }) {
                Button button = new Button(context);
                NativeDesignSystem.button(button, primary, density);
                assertTrue(button.getBackground() instanceof StateListDrawable);
                assertTrue(button.getMinHeight() >= Math.round(density * 52));
                assertEquals(0f, button.getElevation(), 0f);
                int active = primary ? NativeDesignSystem.onAction(context) : NativeDesignSystem.ink(context);
                assertEquals(active, button.getTextColors().getColorForState(
                        new int[] { android.R.attr.state_enabled }, 0));
                button.setEnabled(false);
                assertEquals(NativeDesignSystem.muted(context), button.getTextColors().getColorForState(
                        new int[] { -android.R.attr.state_enabled }, 0));
            }
        });
    }

    @Test public void statusSurfaceAndLanguageSelectionShareNativeComponentMetrics() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            Context context = ApplicationProvider.getApplicationContext();
            float density = context.getResources().getDisplayMetrics().density;
            TextView state = new TextView(context);
            NativeDesignSystem.text(state, 14, false, density);
            NativeDesignSystem.surfaceText(state, density);
            assertEquals(NativeDesignSystem.muted(context), state.getCurrentTextColor());
            assertEquals("Compact informational surface must retain 52dp minimum", Math.round(52 * density), state.getMinHeight());
            assertNotNull(state.getBackground());

            TextView status = new TextView(context);
            NativeDesignSystem.statusPanel(status, density);
            assertEquals("Status panel must retain 52dp minimum", Math.round(52 * density), status.getMinHeight());
            assertEquals(NativeDesignSystem.ink(context), status.getCurrentTextColor());
            assertEquals(View.ACCESSIBILITY_LIVE_REGION_POLITE, status.getAccessibilityLiveRegion());
            assertNotNull(status.getBackground());

            TextView transcript = new TextView(context);
            NativeDesignSystem.transcriptPanel(transcript, density);
            assertEquals("Transcript panel must retain 72dp minimum", Math.round(72 * density), transcript.getMinHeight());
            assertEquals(NativeDesignSystem.ink(context), transcript.getCurrentTextColor());
            assertTrue("Transcript text must remain selectable", transcript.isTextSelectable());
            assertNotNull(transcript.getBackground());

            Spinner selector = new Spinner(context);
            NativeDesignSystem.language(selector, density);
            assertTrue(selector.getMinimumHeight() >= Math.round(52 * density));
            assertNotNull(selector.getBackgroundTintList());
        });
    }
}
