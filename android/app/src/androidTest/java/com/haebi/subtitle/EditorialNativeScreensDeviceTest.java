package com.haebi.subtitle;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import static org.junit.Assert.*;

/** Real Android native UI layouts; never requests microphone, a model download or paid API. */
@RunWith(AndroidJUnit4.class)
public final class EditorialNativeScreensDeviceTest {
    @Test public void onDeviceUsesThreeSectionsAndNoRecording() throws Exception {
        try (ActivityScenario<OnDeviceRecognitionActivity> screen =
                ActivityScenario.launch(OnDeviceRecognitionActivity.class)) {
            String[] theme = new String[1];
            screen.onActivity(activity -> {
                View root = activity.findViewById(android.R.id.content);
                verifyBackground(activity, root);
                assertSection(root, "01 / PREPARE");
                assertSection(root, "02 / CAPTURE");
                assertSection(root, "03 / RESULT");
                assertWorkflow(root, "언어 준비", "마이크 인식", "자막 저장");
                assertHelp(root, "언어 모델 도움말");
                assertHelp(root, "인식·저장 안내");
                LinearLayout steps = (LinearLayout) findTag(root, "editorial-native-workflow");
                NativeDesignSystem.setWorkflowStep(steps, 1,
                        activity.getResources().getDisplayMetrics().density);
                assertTrue(((TextView) steps.getChildAt(1)).getContentDescription().toString()
                        .contains("현재 단계"));
                NativeDesignSystem.setWorkflowStep(steps, 0,
                        activity.getResources().getDisplayMetrics().density);
                assertText(root, "OpenAI API 키나 API 이용 요금은 필요하지 않습니다");
                assertButton(root, "마이크 인식 시작");
                Button stop = button(root, "인식 종료");
                Button save = button(root, "완료 자막 저장 및 편집");
                assertNotNull(stop); assertFalse(stop.isEnabled());
                assertNotNull(save); assertFalse(save.isEnabled());
                theme[0] = NativeDesignSystem.isDark(activity) ? "dark" : "light";
            });
            screenshot("on-device-" + theme[0]);
        }
    }

    @Test public void paidCloudKeepsDisclosureBeforeMicrophoneAction() throws Exception {
        try (ActivityScenario<CloudLiveRecognitionActivity> screen =
                ActivityScenario.launch(CloudLiveRecognitionActivity.class)) {
            String[] theme = new String[1];
            screen.onActivity(activity -> {
                View root = activity.findViewById(android.R.id.content);
                verifyBackground(activity, root);
                assertSection(root, "01 / CONNECTION");
                assertSection(root, "02 / LIVE");
                assertSection(root, "03 / RESULT");
                assertWorkflow(root, "연결 확인", "실시간 인식", "자막 저장");
                assertHelp(root, "시간·전송 안내");
                assertText(root, "GPT 실시간 마이크 자막");
                assertText(root, "API 이용 요금");
                assertButton(root, "인식 종료 및 결과 확정");
                assertButton(root, "자막 작업 기록 저장 및 편집");
                theme[0] = NativeDesignSystem.isDark(activity) ? "dark" : "light";
            });
            screenshot("cloud-live-" + theme[0]);
        }
    }

    @Test public void voskKeepsModelFileAndTranscriptionStepsWithoutInstallingAnything() throws Exception {
        try (ActivityScenario<OfflineVoskActivity> screen =
                ActivityScenario.launch(OfflineVoskActivity.class)) {
            String[] theme = new String[1];
            screen.onActivity(activity -> {
                View root = activity.findViewById(android.R.id.content);
                verifyBackground(activity, root);
                assertSection(root, "01 / MODEL");
                assertSection(root, "02 / FILE");
                assertSection(root, "03 / TRANSCRIPTION");
                assertWorkflow(root, "모델 설치", "파일 선택", "전사·저장");
                assertHelp(root, "인식 품질·라이선스");
                assertText(root, "인터넷과 OpenAI API 키 없이");
                assertText(root, "오프라인 인식은 최대 60분");
                assertButton(root, "선택 모델 다운로드·설치");
                assertButton(root, "영상·오디오 파일 선택");
                Button run = button(root, "오프라인 음성 인식 시작");
                assertNotNull(run); assertFalse(run.isEnabled());
                theme[0] = NativeDesignSystem.isDark(activity) ? "dark" : "light";
            });
            screenshot("vosk-local-" + theme[0]);
        }
    }

    private static void assertWorkflow(View root, String first, String second, String third) {
        View found = findTag(root, "editorial-native-workflow");
        assertNotNull("Native workflow summary", found);
        assertTrue(found instanceof LinearLayout);
        LinearLayout row = (LinearLayout) found;
        assertEquals(3, row.getChildCount());
        String[] labels = {first, second, third};
        int activeCount = 0;
        for (int index = 0; index < labels.length; index++) {
            View item = findTag(row, "editorial-native-step-" + index);
            assertTrue(item instanceof TextView);
            TextView label = (TextView) item;
            assertTrue(label.getText().toString().contains(labels[index]));
            assertNotNull(label.getBackground());
            assertEquals(0f, label.getElevation(), 0f);
            assertTrue("Stage status must be announced", label.getContentDescription().length() > 0);
            if (label.getContentDescription().toString().contains("현재 단계")) activeCount++;
        }
        assertEquals("Exactly one current step", 1, activeCount);
    }

    private static void assertHelp(View root, String label) {
        View details = findTag(root, "editorial-native-help:" + label);
        assertNotNull("Disclosure content: " + label, details);
        assertEquals(View.GONE, details.getVisibility());
        Button toggle = button(root, label + " 보기");
        assertNotNull("Disclosure toggle: " + label, toggle);
        toggle.performClick();
        assertEquals(View.VISIBLE, details.getVisibility());
        assertTrue(toggle.getText().toString().contains("접기"));
        toggle.performClick();
        assertEquals(View.GONE, details.getVisibility());
        assertTrue(toggle.getText().toString().contains("보기"));
    }

    private static void verifyBackground(Activity activity, View root) {
        assertNotNull(root);
        ScrollView scroll = scroll(root);
        assertNotNull(scroll);
        assertTrue(scroll.getBackground() instanceof ColorDrawable);
        assertEquals(NativeDesignSystem.canvas(activity), ((ColorDrawable) scroll.getBackground()).getColor());
    }

    private static void assertSection(View root, String code) {
        String tag = "editorial-section:" + code;
        View found = findTag(root, tag);
        assertNotNull(tag, found);
        assertEquals(0f, found.getElevation(), 0f);
        assertNotNull(found.getBackground());
    }

    private static void assertText(View root, String phrase) {
        assertTrue("Missing text: " + phrase, hasText(root, phrase));
    }

    private static void assertButton(View root, String phrase) {
        Button found = button(root, phrase);
        assertNotNull(phrase, found);
        assertEquals(ViewGroup.LayoutParams.WRAP_CONTENT, found.getLayoutParams().height);
    }

    private static boolean hasText(View root, String phrase) {
        if (root instanceof TextView && String.valueOf(((TextView) root).getText()).contains(phrase)) return true;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++)
                if (hasText(group.getChildAt(i), phrase)) return true;
        }
        return false;
    }

    private static View findTag(View root, String tag) {
        if (tag.equals(root.getTag())) return root;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                View found = findTag(group.getChildAt(i), tag);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static ScrollView scroll(View root) {
        if (root instanceof ScrollView) return (ScrollView) root;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                ScrollView found = scroll(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private static Button button(View root, String phrase) {
        if (root instanceof Button && String.valueOf(((Button) root).getText()).contains(phrase))
            return (Button) root;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                Button found = button(group.getChildAt(i), phrase);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static void screenshot(String title) throws Exception {
        Thread.sleep(300);
        Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull("Native Android screenshot: " + title, bitmap);
        File folder = ApplicationProvider.getApplicationContext().getExternalFilesDir("editorial-3c");
        assertNotNull(folder);
        assertTrue(folder.exists() || folder.mkdirs());
        File image = new File(folder, title + ".png");
        try (FileOutputStream output = new FileOutputStream(image)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output));
        } finally {
            bitmap.recycle();
        }
        assertTrue(image.exists() && image.length() > 0);
    }
}
