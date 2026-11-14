package com.haebi.subtitle;

/** Versions, immutable release hashes and licenses for supported Vosk Android models. */
final class OfflineModelCatalog {
    static final int SAMPLE_RATE_HZ = 16_000;
    static final long MAX_DOWNLOAD_BYTES = 140L * 1024 * 1024;
    static final long MAX_UNPACKED_BYTES = 520L * 1024 * 1024;

    static final class Spec {
        final String id, title, language, description, source, sha256;
        final int approximateMegabytes;
        final long minUsableBytes;

        Spec(String id, String title, String language, String description,
             String source, String sha256, int sizeMb, int freeMb) {
            this.id = id;
            this.title = title;
            this.language = language;
            this.description = description;
            this.source = source;
            this.sha256 = sha256;
            this.approximateMegabytes = sizeMb;
            this.minUsableBytes = (long) freeMb * 1024 * 1024;
        }
    }

    static final Spec[] MODELS = {
        new Spec("vosk-model-small-ko-0.22", "한국어 · 소형", "ko",
            "약 87MB 다운로드 · Zeroth 벤치마크 WER 28.1% · Apache-2.0",
            "https://huggingface.co/rhasspy/vosk-models/resolve/main/ko/vosk-model-small-ko-0.22.zip",
            "eea36124087fed26c59996a4761519458e3bd185e8ea9d9865ad8760c4a1d989", 87, 550),
        new Spec("vosk-model-small-en-us-0.15", "영어(미국) · 소형", "en",
            "약 42MB 다운로드 · LibriSpeech WER 9.85% · Apache-2.0",
            "https://huggingface.co/rhasspy/vosk-models/resolve/main/en/vosk-model-small-en-us-0.15.zip",
            "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498", 42, 330),
        new Spec("vosk-model-small-ja-0.22", "일본어 · 소형", "ja",
            "약 50MB 다운로드 · Apache-2.0",
            "https://huggingface.co/rhasspy/vosk-models/resolve/main/ja/vosk-model-small-ja-0.22.zip",
            "efa092d280153a77615e9e0c7d7283e93e600de3d19d3bec686c57ef19d52eac", 50, 380)
    };

    static Spec byId(String id) {
        for (Spec spec : MODELS) if (spec.id.equals(id)) return spec;
        throw new IllegalArgumentException("지원하지 않는 로컬 AI 모델입니다.");
    }

    private OfflineModelCatalog() {}
}