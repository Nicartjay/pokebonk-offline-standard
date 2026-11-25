package dev.nicartjay.pokebonk.offline.standard;
import org.junit.Test;
import org.json.JSONObject;
import org.json.JSONArray;
import static org.junit.Assert.*;

public final class CoopRulesTest {
    @Test public void acceptsAllFiveModesAndRejectsArbitraryRules() throws Exception {
        for(int tier:new int[]{0,1,2,3,5,6,7})assertEquals(tier,CoopRules.settings(new JSONObject().put("biome","forest").put("tier",tier)).getInt("tier"));
        assertEquals("newisland",CoopRules.settings(new JSONObject().put("biome","forest").put("tier",7)).getString("biome"));
        assertEquals("forest",CoopRules.settings(new JSONObject().put("biome","newisland").put("tier",6)).getString("biome"));
        assertThrows(Exception.class,()->CoopRules.settings(new JSONObject().put("biome","forest").put("tier",4)));
        assertThrows(Exception.class,()->CoopRules.settings(new JSONObject().put("biome","https://example.invalid").put("tier",7)));
    }
    @Test public void expeditionHasTwoDestinationsAndDataOnlyLoadoutSummaries() throws Exception {
        for(String id:new String[]{"wilds","safari"}){
            JSONObject selection=CoopRules.destination(id);assertEquals(4,selection.getInt("tier"));
            assertTrue(CoopRules.game(new JSONObject().put("mode","expedition").put("biome",id).put("tier",0)));
            assertTrue(CoopRules.matches(selection,id));
        }
        assertFalse(CoopRules.matches(new JSONObject().put("biome","forest").put("tier",0),"wilds"));
        assertThrows(Exception.class,()->CoopRules.destination("https://example.invalid"));
        JSONObject summary=new JSONObject().put("worn",new JSONArray().put(new JSONObject().put("b","choice-band")
            .put("r",1).put("lv",1).put("credential","private"))).put("bag",0).put("risk",20).put("ins",0).put("token","private");
        assertFalse(CoopRules.loadout(summary).toString().contains("private"));
        assertThrows(Exception.class,()->CoopRules.loadout(summary.put("bag",13)));
    }
    @Test public void hostOnlyControlsAndCapacityCannotEvictMembers() throws Exception {
        JSONObject state=new JSONObject().put("role","host").put("members",new JSONArray().put(new JSONObject()).put(new JSONObject()).put(new JSONObject()));
        assertThrows(Exception.class,()->CoopRules.action("room-seats",new JSONObject().put("discoverable",false).put("capacity",2),state));
        state.put("role","client");
        assertThrows(Exception.class,()->CoopRules.action("room-seats",new JSONObject().put("discoverable",true).put("capacity",4),state));
    }
    @Test public void sharedRuleClockAndPublicStateDoNotCarryPrivateFields() throws Exception {
        long clock=1795564800000L;
        JSONObject source=new JSONObject().put("phase","hosting").put("role","host").put("me","lan-host").put("linked",false)
            .put("rulesAt",clock).put("settings",new JSONObject().put("biome","forest").put("tier",6).put("credential","private"))
            .put("seats",new JSONObject().put("discoverable",false).put("capacity",3).put("token","private"))
            .put("members",new JSONArray().put(new JSONObject().put("id","lan-host").put("slot",0).put("name","Host")
                .put("species",4).put("ready",true).put("maps",new JSONObject().put("forest",2).put("credential","private"))));
        JSONObject clean=InternetPolicy.state(source,"stun-only");
        assertEquals(clock,clean.getLong("rulesAt"));assertEquals(6,clean.getJSONObject("settings").getInt("tier"));
        assertFalse(clean.getJSONObject("seats").getBoolean("discoverable"));
        assertEquals(2,clean.getJSONArray("members").getJSONObject(0).getJSONObject("maps").getInt("forest"));
        assertFalse(clean.toString().contains("private"));
        assertThrows(Exception.class,()->CoopRules.time("1795564800000"));
    }
}
