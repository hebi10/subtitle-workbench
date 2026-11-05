package com.haebi.subtitle;

import android.content.Context;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import javax.net.ssl.HttpsURLConnection;

/** App-private, checksum-verified, transactional model installer with zip-slip protections. */
final class OfflineModelInstaller {
    interface Progress { void update(String message, long complete, long total); }
    private static final int BUFFER = 32 * 1024;
    private static final int MAX_FILES = 4096;
    private static final String PROOF = ".model-sha256";
    private final File base;
    private final File cache;

    OfflineModelInstaller(Context context) {
        base = new File(context.getFilesDir(), "offline_vosk_models");
        cache = context.getCacheDir();
    }

    File installedModel(OfflineModelCatalog.Spec spec) {
        File folder = new File(base, spec.id);
        File proof = new File(folder, PROOF);
        try {
            if (new File(folder, "am/final.mdl").isFile()
                    && new File(folder, "conf").isDirectory()
                    && new File(folder, "graph").isDirectory()
                    && proof.isFile()
                    && isProofValid(proof, spec.sha256)) {
                return folder;
            }
        } catch (IOException ignored) { }
        return null;
    }

    static boolean isProofValid(File proof, String sha) throws IOException {
        byte[] value = new byte[64];
        try (FileInputStream input = new FileInputStream(proof)) {
            int read = 0;
            while (read < value.length) {
                int current = input.read(value, read, value.length - read);
                if (current < 0) return false;
                read += current;
            }
            if (input.read() != -1) return false;
        }
        return sha.equals(new String(value, StandardCharsets.US_ASCII));
    }

    long installedSize(OfflineModelCatalog.Spec spec) {
        File dir = installedModel(spec);
        return dir == null ? 0L : recursiveSize(dir);
    }

    File download(OfflineModelCatalog.Spec spec, AtomicBoolean cancelled, Progress progress) throws Exception {
        File ready = installedModel(spec);
        if (ready != null) return ready;
        if (cache.getUsableSpace() < spec.minUsableBytes || base.getUsableSpace() < spec.minUsableBytes) {
            throw new IOException("로컬 AI 모델을 위해 저장 공간을 확보해 주세요. 권장 여유 공간 "
                    + (spec.minUsableBytes / (1024 * 1024)) + "MB");
        }
        if (!base.isDirectory() && !base.mkdirs()) throw new IOException("모델 보관 폴더를 만들 수 없습니다.");
        String random = UUID.randomUUID().toString();
        File part = new File(cache, "vosk-model-" + random + ".zip");
        File staging = new File(base, ".extract-" + random);
        try {
            downloadZip(spec, part, cancelled, progress);
            requireNotCancelled(cancelled);
            if (!staging.mkdirs()) throw new IOException("모델 설치 폴더를 만들 수 없습니다.");
            unzip(spec, part, staging, cancelled, progress);
            File unpacked = new File(staging, spec.id);
            if (!new File(unpacked, "am/final.mdl").isFile()
                    || !new File(unpacked, "conf").isDirectory()
                    || !new File(unpacked, "graph").isDirectory())
                throw new IOException("모델 압축 파일 내부 구성이 올바르지 않습니다.");
            try (FileOutputStream stamp = new FileOutputStream(new File(unpacked, PROOF))) {
                stamp.write(spec.sha256.getBytes(StandardCharsets.US_ASCII));
                stamp.getFD().sync();
            }
            requireNotCancelled(cancelled);
            if (installedModel(spec) != null) return installedModel(spec);
            File target = new File(base, spec.id);
            if (target.exists()) throw new IOException("기존 모델 설치 데이터가 손상되었습니다. 모델 삭제 후 다시 시도하세요.");
            if (!unpacked.renameTo(target)) throw new IOException("모델 설치를 완료하지 못했습니다.");
            progress.update("모델 다운로드 및 설치 완료", 1, 1);
            return target;
        } finally {
            deleteTree(staging);
            if (part.exists() && !part.delete()) part.deleteOnExit();
        }
    }

    private static void downloadZip(OfflineModelCatalog.Spec spec, File destination,
                                    AtomicBoolean cancelled, Progress callback) throws Exception {
        URL current = new URL(spec.source);
        int redirects = 0;
        while (true) {
            requireNotCancelled(cancelled);
            if (!"https".equalsIgnoreCase(current.getProtocol())) throw new IOException("보안 연결이 아닌 다운로드를 차단했습니다.");
            HttpsURLConnection connection = (HttpsURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(35_000);
            connection.setRequestProperty("User-Agent", "SubtitleWorkbench-OfflineModel/0.9");
            try {
                int status = connection.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    if (++redirects > 6) throw new IOException("모델 다운로드 리디렉션이 너무 많습니다.");
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) throw new IOException("모델 다운로드 주소가 올바르지 않습니다.");
                    current = new URL(current, location);
                    continue;
                }
                if (status != 200) throw new IOException("모델 다운로드에 실패했습니다. HTTP " + status);
                long reported = connection.getContentLengthLong();
                if (reported > OfflineModelCatalog.MAX_DOWNLOAD_BYTES) throw new IOException("모델 압축 파일이 허용 크기를 초과합니다.");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long received = 0;
                try (InputStream input = new BufferedInputStream(connection.getInputStream());
                     FileOutputStream output = new FileOutputStream(destination)) {
                    byte[] block = new byte[BUFFER];
                    int count;
                    while ((count = input.read(block)) != -1) {
                        requireNotCancelled(cancelled);
                        received += count;
                        if (received > OfflineModelCatalog.MAX_DOWNLOAD_BYTES) throw new IOException("모델 파일 크기 제한을 초과했습니다.");
                        digest.update(block, 0, count);
                        output.write(block, 0, count);
                        callback.update("모델 다운로드 중", received, reported > 0 ? reported : spec.approximateMegabytes * 1024L * 1024L);
                    }
                    output.getFD().sync();
                }
                StringBuilder hash = new StringBuilder(64);
                for (byte byteValue : digest.digest()) hash.append(String.format(Locale.ROOT, "%02x", byteValue & 0xff));
                if (!spec.sha256.equals(hash.toString())) throw new IOException("다운로드한 AI 모델의 무결성 검증에 실패했습니다.");
                callback.update("무결성 검사 완료 · 압축 해제 중", 1, 1);
                return;
            } finally { connection.disconnect(); }
        }
    }

    static void unzip(OfflineModelCatalog.Spec spec, File zip, File output,
                      AtomicBoolean cancelled, Progress listener) throws Exception {
        String requiredPrefix = spec.id + "/";
        long expanded = 0;
        int files = 0;
        String canonicalOutput = output.getCanonicalPath() + File.separator;
        try (ZipInputStream input = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)))) {
            ZipEntry entry;
            byte[] block = new byte[BUFFER];
            while ((entry = input.getNextEntry()) != null) {
                requireNotCancelled(cancelled);
                if (++files > MAX_FILES) throw new IOException("모델 파일 항목 수가 너무 많습니다.");
                String name = entry.getName();
                if (!name.startsWith(requiredPrefix) || name.contains("\\") || name.contains("../")
                        || name.contains("/./") || name.startsWith("/")) {
                    throw new IOException("허용되지 않는 모델 압축 경로입니다.");
                }
                File destination = new File(output, name);
                if (!destination.getCanonicalPath().startsWith(canonicalOutput))
                    throw new IOException("모델 압축 파일에 안전하지 않은 경로가 있습니다.");
                if (entry.isDirectory()) {
                    if (!destination.isDirectory() && !destination.mkdirs())
                        throw new IOException("모델 폴더를 생성하지 못했습니다.");
                } else {
                    File parent = destination.getParentFile();
                    if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("모델 폴더를 생성하지 못했습니다.");
                    try (FileOutputStream file = new FileOutputStream(destination);
                         BufferedOutputStream stream = new BufferedOutputStream(file)) {
                        int n;
                        while ((n = input.read(block)) != -1) {
                            requireNotCancelled(cancelled);
                            expanded += n;
                            if (expanded > OfflineModelCatalog.MAX_UNPACKED_BYTES)
                                throw new IOException("압축 해제 크기가 허용 범위를 초과했습니다.");
                            stream.write(block, 0, n);
                        }
                    }
                }
                input.closeEntry();
                if (files % 25 == 0) listener.update("모델 설치 중 · " + files + "개 파일", files, MAX_FILES);
            }
        }
    }

    void delete(OfflineModelCatalog.Spec spec) throws IOException {
        File target = new File(base, spec.id);
        if (target.exists()) {
            deleteTree(target);
            if (target.exists()) throw new IOException("로컬 AI 모델을 삭제하지 못했습니다.");
        }
    }

    static void requireNotCancelled(AtomicBoolean cancelled) throws InterruptedException {
        if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new InterruptedException("모델 다운로드를 취소했습니다.");
    }

    static long recursiveSize(File root) {
        if (!root.exists() || Files.isSymbolicLink(root.toPath())) return 0;
        if (root.isFile()) return root.length();
        long total = 0;
        File[] children = root.listFiles();
        if (children != null) for (File child : children) total += recursiveSize(child);
        return total;
    }

    static void deleteTree(File root) {
        if (!root.exists()) return;
        if (root.isDirectory() && !Files.isSymbolicLink(root.toPath())) {
            File[] children = root.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        if (!root.delete()) root.deleteOnExit();
    }
}