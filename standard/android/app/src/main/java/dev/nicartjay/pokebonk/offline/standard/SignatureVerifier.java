package dev.nicartjay.pokebonk.offline.standard;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/** Pure Java, testable without Android. Matches Node's DER ECDSA signatures. */
final class SignatureVerifier {
    static void verify(byte[] payload, byte[] signature, String pem) throws Exception {
        String encoded = pem.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replaceAll("\\s", "");
        ECPublicKey key = (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(
            new X509EncodedKeySpec(Base64.getDecoder().decode(encoded.getBytes(StandardCharsets.US_ASCII))));
        if (!key.getParams().getOrder().toString(16).equals("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551")) {
            throw new SecurityException("Expected a P-256 release key.");
        }
        Signature verifier = Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(key);
        verifier.update(payload);
        if (!verifier.verify(signature)) throw new SecurityException("Invalid Standard update signature.");
    }
}
