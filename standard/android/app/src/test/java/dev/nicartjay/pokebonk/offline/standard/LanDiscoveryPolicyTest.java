package dev.nicartjay.pokebonk.offline.standard;
import org.junit.Test;
import static org.junit.Assert.*;

public final class LanDiscoveryPolicyTest {
    private static final String KEY="abcdef0123456789abcdef0123456789";
    @Test public void currentNonceAndProtocolConstantsMatchDesktop(){
        assertEquals("PBLAND1",LanDiscoveryPolicy.MAGIC);
        assertEquals("239.255.80.66",LanDiscoveryPolicy.GROUP);
        assertEquals(48124,LanDiscoveryPolicy.PORT);
        assertEquals(4000,LanDiscoveryPolicy.SEARCH_MS);
        assertTrue(LanDiscoveryPolicy.nonce(KEY));
        assertFalse(LanDiscoveryPolicy.nonce(KEY.toUpperCase(java.util.Locale.ROOT)));
        assertFalse(LanDiscoveryPolicy.nonce("../path"));
    }
    @Test public void onlyTheRespondingPrivateHostWithFreeSeatsIsEligible(){
        String invite="192.168.1.10:42000#"+KEY;
        assertTrue(LanDiscoveryPolicy.room("192.168.1.10",invite,"lan-host","Host",1));
        assertTrue(LanDiscoveryPolicy.room("192.168.1.10",invite,"lan-host","Host",3));
        for(int count:new int[]{-1,0,4,5})assertFalse(LanDiscoveryPolicy.room("192.168.1.10",invite,"lan-host","Host",count));
        assertFalse(LanDiscoveryPolicy.room("192.168.1.11",invite,"lan-host","Host",1));
        assertFalse(LanDiscoveryPolicy.room("8.8.8.8","8.8.8.8:42000#"+KEY,"lan-host","Host",1));
        assertFalse(LanDiscoveryPolicy.room("192.168.1.10","192.168.1.10:80#"+KEY,"lan-host","Host",1));
        assertFalse(LanDiscoveryPolicy.room("192.168.1.10",invite,"not-a-room","Host",1));
        assertFalse(LanDiscoveryPolicy.room("192.168.1.10",invite,"lan-host","Bad\nname",1));
    }
}
