package com.haebi.subtitle;

import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Selected credentials and destination stay together; diagnostics never include credentials. */
final class CloudAccess {
    static final String PERSONAL = "personal", RELAY = "relay";
    private final String mode, origin, token;

    private CloudAccess(String mode, String origin, String token) {
        this.mode = mode; this.origin = origin; this.token = token;
    }

    static CloudAccess personal(String key) {
        return new CloudAccess(PERSONAL, "https://api.openai.com", checkedToken(key, false));
    }

    static CloudAccess relay(String origin, String code) {
        return new CloudAccess(RELAY, checkedRelayOrigin(origin), checkedToken(code, true));
    }

    static String checkedRelayOrigin(String value) {
        try {
            if (value == null || value.isEmpty() || value.length() > 253 || !value.matches("[\\x21-\\x7e]+")) throw invalidOrigin();
            URI uri = new URI(value);
            String host = uri.getHost();
            if (!"https".equals(uri.getScheme()) || host == null || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath())
                    || uri.getPort() != -1 && uri.getPort() != 443) throw invalidOrigin();
            host = host.toLowerCase(Locale.ROOT);
            if (host.length() > 253 || !host.matches("(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}")
                    || host.contains("openai") || host.endsWith(".localhost") || host.endsWith(".local")
                    || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home")
                    || host.endsWith(".test") || host.endsWith(".invalid") || host.endsWith(".example")
                    || host.endsWith(".onion") || host.endsWith(".arpa")) throw invalidOrigin();
            return "https://" + host;
        } catch (URISyntaxException error) { throw invalidOrigin(); }
    }

    static String checkedRelayCode(String code) { return checkedToken(code, true); }

    private static String checkedToken(String value, boolean relay) {
        String token = value == null ? "" : value.trim();
        if (token.isEmpty() || token.length() > 512 || !token.matches("[\\x21-\\x7e]+")
                || relay && (!token.matches("[A-Za-z0-9_-]{43,128}") || token.toLowerCase(Locale.ROOT).startsWith("sk-")))
            throw new IllegalArgumentException(relay ? "유효한 테스트 접근 코드를 입력해 주세요. 개인 API 키는 사용할 수 없습니다." : "OpenAI API 키를 먼저 저장해 주세요.");
        return token;
    }

    String mode() { return mode; }
    boolean isRelay() { return RELAY.equals(mode); }
    String origin() { return origin; }
    String token() { return token; }
    String restUrl(String path) {
        if (path == null || !path.matches("/(?:models/[A-Za-z0-9._:-]{1,100}|audio/transcriptions|responses)"))
            throw new IllegalArgumentException("지원하지 않는 API 경로입니다.");
        return origin + "/v1" + path;
    }
    String realtimeUrl() { return "wss://" + origin.substring("https://".length()) + "/v1/realtime?intent=transcription"; }

    void requirePublicResolution() throws IOException {
        if (!isRelay()) return;
        InetAddress[] addresses = InetAddress.getAllByName(URI.create(origin).getHost());
        if (addresses.length == 0) throw new IOException("테스트 서버 주소를 확인할 수 없습니다.");
        for (InetAddress address : addresses) requirePublicAddress(address);
    }

    static void requirePublicAddress(InetAddress address) throws IOException {
        byte[] bytes = address.getAddress();
        boolean blocked = address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress();
        if (bytes.length == 4) {
            int first = bytes[0] & 255, second = bytes[1] & 255, third = bytes[2] & 255;
            blocked |= first == 0 || first == 100 && second >= 64 && second <= 127 || first >= 224
                    || first == 192 && second == 0 && (third == 0 || third == 2)
                    || first == 198 && (second == 18 || second == 19 || second == 51 && third == 100)
                    || first == 203 && second == 0 && third == 113;
        } else if (bytes.length == 16) {
            blocked |= (bytes[0] & 0xfe) == 0xfc || (bytes[0] & 0xe0) != 0x20
                    || (bytes[0] & 255) == 0x20 && (bytes[1] & 255) == 1 && (bytes[2] & 255) == 0x0d && (bytes[3] & 255) == 0xb8;
        } else blocked = true;
        if (blocked) throw new IOException("테스트 서버는 공개 인터넷 주소를 사용해야 합니다.");
    }

    @Override public String toString() { return "CloudAccess{mode=" + mode + ", origin=" + origin + "}"; }
    private static IllegalArgumentException invalidOrigin() { return new IllegalArgumentException("테스트 서버는 경로 없이 공개 HTTPS 주소만 입력해 주세요."); }
}
