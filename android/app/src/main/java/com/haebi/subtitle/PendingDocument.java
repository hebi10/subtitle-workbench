package com.haebi.subtitle;

import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** The system document picker can outlive the Activity/process; keep its payload off the Bundle. */
final class PendingDocument {
    private final File file;
    PendingDocument(File directory) { file = new File(directory, "pending-document.json"); }
    synchronized void save(JSONObject payload) throws Exception {
        File pending = new File(file.getParentFile(), "pending-document.tmp");
        try (FileOutputStream stream = new FileOutputStream(pending)) {
            stream.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            stream.getFD().sync();
        }
        Files.move(pending.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }
    synchronized JSONObject read() throws Exception {
        if (!file.exists()) return new JSONObject();
        if (file.length() > 32L * 1024 * 1024) throw new IllegalArgumentException("파일 선택 정보를 복원할 수 없습니다.");
        return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
    }
    void clear() throws Exception { save(new JSONObject()); }
}
