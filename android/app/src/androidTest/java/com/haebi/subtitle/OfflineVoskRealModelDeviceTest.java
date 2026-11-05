package com.haebi.subtitle;

import android.content.Context;
import android.net.Uri;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import static org.junit.Assert.*;

/**
 * Opt-in, network-backed real English Vosk model and WAV sample integration test.
 * Executed only from the dedicated offline-model workflow, never from ordinary app tests.
 * The microphone, OpenAI API and any user secret are not involved.
 */
@RunWith(AndroidJUnit4.class)
public final class OfflineVoskRealModelDeviceTest {
    private static final String SAMPLE =
            "https://raw.githubusercontent.com/alphacep/vosk-api/"
                    + "4ab9821510b488efb7740094714a130bd3545e90/python/example/test.wav";
    private static final long MAX_SAMPLE_BYTES = 500_000L;

    @Test(timeout = 720000)
    public void verifiedEnglishModelActuallyTranscribesOfflineWavFile() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        OfflineModelInstaller installer = new OfflineModelInstaller(context);
        OfflineModelCatalog.Spec modelSpec =
                OfflineModelCatalog.byId("vosk-model-small-en-us-0.15");
        AtomicBoolean cancelled = new AtomicBoolean(false);
        File modelDir = null;
        File wav = new File(context.getCacheDir(), "offline-vosk-integration-test.wav");
        try {
            modelDir = installer.download(modelSpec, cancelled, (text, done, total) -> {
                assertNotNull(text);
                assertTrue("model download progress cannot go negative", done >= 0);
            });
            assertTrue("verified model should exist", modelDir.isDirectory());
            assertNotNull("installed model must contain a proof file", installer.installedModel(modelSpec));
            downloadBoundedSample(wav);

            JSONArray transcript = new OfflineVoskTranscriber(context).run(
                    Uri.fromFile(wav), modelDir, cancelled,
                    (message, percent, count) -> {
                        assertTrue("progress must be in range", percent >= 0 && percent <= 100);
                    });

            assertTrue("real English speech should yield at least one subtitle cue", transcript.length() > 0);
            double previousEnd = 0;
            for (int i = 0; i < transcript.length(); i++) {
                JSONObject cue = transcript.getJSONObject(i);
                double start = cue.getDouble("start");
                double end = cue.getDouble("end");
                assertTrue("cues must be monotonic", start + 0.001 >= previousEnd);
                assertTrue("each cue must have positive duration", end > start);
                assertFalse("transcript must contain words", cue.optString("original", "").trim().isEmpty());
                assertEquals("transcribed", cue.getString("status"));
                previousEnd = end;
            }

            try (JobStore store = new JobStore(context)) {
                String jobId = store.importCues("Offline model e2e fixture", transcript);
                try {
                    assertEquals("completed", store.get(jobId).getString("status"));
                    assertEquals(transcript.length(), store.cues(jobId).length());
                } finally {
                    store.deleteCompleted(jobId);
                }
            }
        } finally {
            cancelled.set(true);
            if (wav.exists()) assertTrue("test WAV cleanup", wav.delete());
            // Intentionally keep downloaded model in the test app's private storage
            // so a rerun doesn't spend the network/battery cost again.
        }
    }

    private static void downloadBoundedSample(File destination) throws Exception {
        HttpsURLConnection connection =
                (HttpsURLConnection) new URL(SAMPLE).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(40_000);
        connection.setInstanceFollowRedirects(false);
        try {
            assertEquals("sample WAV download should succeed", 200, connection.getResponseCode());
            assertTrue("sample file must be bounded",
                    connection.getContentLengthLong() <= MAX_SAMPLE_BYTES);
            long total = 0;
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(destination)) {
                byte[] chunk = new byte[8192];
                int count;
                while ((count = input.read(chunk)) >= 0) {
                    total += count;
                    if (total > MAX_SAMPLE_BYTES)
                        throw new IllegalArgumentException("Sample fixture exceeded safety size");
                    output.write(chunk, 0, count);
                }
                output.getFD().sync();
            }
            assertTrue("downloaded WAV must not be empty", total > 44);
        } finally {
            connection.disconnect();
        }
    }
}