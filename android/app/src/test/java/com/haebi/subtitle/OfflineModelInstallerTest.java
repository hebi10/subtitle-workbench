package com.haebi.subtitle;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Test;
import static org.junit.Assert.*;

public class OfflineModelInstallerTest {
    private static File archive(String name) throws Exception {
        File zip = File.createTempFile("vosk-test-", ".zip");
        try (ZipOutputStream stream = new ZipOutputStream(new FileOutputStream(zip))) {
            stream.putNextEntry(new ZipEntry(name));
            stream.write("fixture".getBytes(StandardCharsets.US_ASCII));
            stream.closeEntry();
        }
        return zip;
    }

    @Test public void unzipAllowsOnlyFilesInsideFixedCatalogRoot() throws Exception {
        OfflineModelCatalog.Spec spec = OfflineModelCatalog.MODELS[0];
        File dir = Files.createTempDirectory("vosk-safe-").toFile();
        File zip = archive(spec.id + "/am/final.mdl");
        try {
            OfflineModelInstaller.unzip(spec, zip, dir, new AtomicBoolean(), (msg, completed, total) -> {});
            assertTrue(new File(dir, spec.id + "/am/final.mdl").isFile());
        } finally {
            OfflineModelInstaller.deleteTree(dir);
            zip.delete();
        }
    }

    @Test public void craftedZipCannotEscapeItsPrivateExtractionDirectory() throws Exception {
        OfflineModelCatalog.Spec spec = OfflineModelCatalog.MODELS[0];
        File dir = Files.createTempDirectory("vosk-untrusted-").toFile();
        File zip = archive(spec.id + "/../outside.txt");
        try {
            assertThrows(IOException.class,
                    () -> OfflineModelInstaller.unzip(spec, zip, dir, new AtomicBoolean(), (msg, count, max) -> {}));
            assertFalse(new File(dir, "outside.txt").exists());
        } finally {
            OfflineModelInstaller.deleteTree(dir);
            zip.delete();
        }
    }

    @Test public void cancellationStopsExtractionBeforeAnyFileIsWritten() throws Exception {
        OfflineModelCatalog.Spec spec = OfflineModelCatalog.MODELS[0];
        File dir = Files.createTempDirectory("vosk-cancel-").toFile();
        File zip = archive(spec.id + "/am/final.mdl");
        try {
            assertThrows(InterruptedException.class,
                    () -> OfflineModelInstaller.unzip(spec, zip, dir, new AtomicBoolean(true), (msg, count, max) -> {}));
        } finally {
            OfflineModelInstaller.deleteTree(dir);
            zip.delete();
        }
    }

    @Test public void installProofMustMatchEntirePinnedSha() throws Exception {
        File proof = File.createTempFile("vosk-sha-", ".txt");
        try {
            String sha = OfflineModelCatalog.MODELS[0].sha256;
            Files.write(proof.toPath(), sha.getBytes(StandardCharsets.US_ASCII));
            assertTrue(OfflineModelInstaller.isProofValid(proof, sha));
            assertFalse(OfflineModelInstaller.isProofValid(proof, OfflineModelCatalog.MODELS[1].sha256));
            Files.write(proof.toPath(), (sha + "injected").getBytes(StandardCharsets.US_ASCII));
            assertFalse(OfflineModelInstaller.isProofValid(proof, sha));
        } finally { proof.delete(); }
    }
}