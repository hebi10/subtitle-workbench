package com.haebi.subtitle;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class PendingDocumentTest {
    @Rule public TemporaryFolder folder = new TemporaryFolder();
    @Test public void exportSurvivesActivityAndStoreRecreationWithoutBundle() throws Exception {
        String text = "한글 자막\n".repeat(100000);
        PendingDocument original = new PendingDocument(folder.getRoot());
        original.save(new JSONObject().put("id", "web-1").put("type", 102).put("text", text));
        PendingDocument recreated = new PendingDocument(folder.getRoot());
        assertEquals(text, recreated.read().getString("text"));
        recreated.clear();
        assertEquals(0, new PendingDocument(folder.getRoot()).read().length());
    }
}
