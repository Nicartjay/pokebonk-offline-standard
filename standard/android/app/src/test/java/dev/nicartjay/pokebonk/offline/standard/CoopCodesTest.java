package dev.nicartjay.pokebonk.offline.standard;
import org.junit.Test;
import org.json.JSONObject;
import org.json.JSONArray;
import static org.junit.Assert.*;

public final class CoopCodesTest {
    @Test public void lengthsAndPublicCodesMatchDesktop() {
        assertEquals(4,CoopCodes.length("lan"));assertEquals(6,CoopCodes.length("stun-only"));assertEquals(6,CoopCodes.length("turn-fallback"));
        assertTrue(CoopCodes.valid("BONK","lan"));assertFalse(CoopCodes.valid("BONK23","lan"));
        assertTrue(CoopCodes.valid("BONK23","stun-only"));assertFalse(CoopCodes.valid("BONK","stun-only"));
        assertEquals("O85T",CoopCodes.lan("lan-host"));
        assertEquals("8GXN",CoopCodes.lan("lan-a1b2c3d4-1111-4444-8888-111111111111"));
        assertEquals("OCIN",CoopCodes.lan("lan-00000000-0000-4000-8000-000000000000"));
        assertEquals("9XPQ",CoopCodes.lan("lan-collision-7335"));assertEquals("9XPQ",CoopCodes.lan("lan-collision-8240"));
    }
    @Test public void pickerRoutesAreExactUserGesturesWithoutPathsOrTokens() {
        for(String code:new String[]{"BONK","BONK23"}){
            String action="lan/join/"+code,url=NativeMenuAction.ORIGIN+"/__native__/"+action;
            assertEquals(action,NativeMenuAction.resolve(url,"GET",true,true));
            assertEquals(code,NativeMenuAction.joinCode(action));
            assertNull(NativeMenuAction.resolve(url,"GET",true,false));
            assertNull(NativeMenuAction.resolve(url+"?token=private","GET",true,true));
        }
        for(String path:new String[]{"lan/join/BONK2345","lan/join/../file","lan/join/BONK#secret","lan/join/BONK/"} )
            assertNull(NativeMenuAction.joinCode(path));
    }
    @Test public void listingBoundaryStripsNestedCredentialAndAddressFields() throws Exception {
        JSONObject raw=new JSONObject().put("status","ready").put("rooms",new JSONArray().put(new JSONObject()
            .put("code","BONK23").put("name","Trainer").put("players",1).put("credential","private").put("address","192.168.1.10")));
        JSONObject clean=LanPolicy.listing(raw,"stun-only");
        assertFalse(clean.toString().contains("private"));assertFalse(clean.toString().contains("192.168"));
        assertEquals(3,clean.getJSONArray("rooms").getJSONObject(0).length());
        assertThrows(Exception.class,()->LanPolicy.listing(raw,"lan"));
    }
    @Test public void internetStateRetainsPublicListButNotLegacyInvitationSecrets() throws Exception {
        JSONObject raw=new JSONObject().put("phase","idle").put("members",new JSONArray()).put("linked",false)
            .put("invitation","ABCDEFGH#"+"a".repeat(43)).put("sessionToken","private")
            .put("roomListing",new JSONObject().put("status","ready").put("rooms",new JSONArray().put(
                new JSONObject().put("code","BONK23").put("name","Trainer").put("players",1))));
        JSONObject clean=InternetPolicy.state(raw,"turn-fallback");
        assertFalse(clean.has("invitation"));assertFalse(clean.has("sessionToken"));
        assertEquals("BONK23",clean.getJSONObject("roomListing").getJSONArray("rooms").getJSONObject(0).getString("code"));
    }
}
