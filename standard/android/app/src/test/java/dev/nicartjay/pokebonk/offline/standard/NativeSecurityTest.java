package dev.nicartjay.pokebonk.offline.standard;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
public final class NativeSecurityTest {
    private byte[] fixture(String name) throws Exception {
        try (InputStream input = getClass().getResourceAsStream("/" + name)) {
            assertNotNull("Missing shared signature fixture", input);
            return input.readAllBytes();
        }
    }
    @Test public void nodeDERFixtureVerifiesOnJava() throws Exception {
        SignatureVerifier.verify(fixture("ecdsa-payload.txt"),
            Base64.getDecoder().decode(new String(fixture("ecdsa-signature.txt"), StandardCharsets.US_ASCII)),
            new String(fixture("ecdsa-public.pem"), StandardCharsets.US_ASCII));
    }
    @Test public void modifiedPayloadAndSignatureAreRejected() throws Exception {
        byte[] payload = fixture("ecdsa-payload.txt");
        byte[] signature = Base64.getDecoder().decode(new String(fixture("ecdsa-signature.txt"), StandardCharsets.US_ASCII));
        String key = new String(fixture("ecdsa-public.pem"), StandardCharsets.US_ASCII);
        payload[0] ^= 1;
        assertThrows(Exception.class, () -> SignatureVerifier.verify(payload, signature, key));
        payload[0] ^= 1; signature[signature.length - 1] ^= 1;
        assertThrows(Exception.class, () -> SignatureVerifier.verify(payload, signature, key));
    }
    @Test public void nonP256KeyIsRejected() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp384r1"));
        String pem = "-----BEGIN PUBLIC KEY-----\n" + Base64.getEncoder().encodeToString(generator.generateKeyPair().getPublic().getEncoded()) + "\n-----END PUBLIC KEY-----";
        assertThrows(SecurityException.class, () -> SignatureVerifier.verify(fixture("ecdsa-payload.txt"), new byte[]{1}, pem));
    }
    @Test public void nativeNetworkingRejectsUntrustedDestinations() throws Exception {
        assertTrue(RepositoryUpdater.allowedURL(new URL(RepositoryUpdater.ENDPOINT)));
        assertTrue(RepositoryUpdater.allowedURL(new URL("https://release-assets.githubusercontent.com/file?opaque=redirect")));
        for (String url : new String[]{"http://github.com/test", "https://github.com.evil.invalid/test", "https://user@github.com/test",
            "https://127.0.0.1/test", "https://github.com:444/test", "file:///etc/hosts"}) {
            assertFalse(url, RepositoryUpdater.allowedURL(new URL(url)));
        }
    }
    @Test public void nativeVersionOrderingAndThrottleAreStable() throws Exception {
        assertTrue(RepositoryUpdater.compare("0.10.0", "0.2.0") > 0);
        assertTrue(RepositoryUpdater.compare("1.0.0", "0.99.99") > 0);
        assertEquals(24L * 60 * 60 * 1000, RepositoryUpdater.INTERVAL);
        assertThrows(Exception.class, () -> RepositoryUpdater.compare("v1.0.0", "1.0.0"));
    }
}
