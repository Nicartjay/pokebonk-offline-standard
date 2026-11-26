package dev.nicartjay.pokebonk.offline.standard;
import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;
public final class CloudNativePolicyTest {
    @Test public void signInRetriesAreBoundedAndOnlyTemporaryHttpFailuresQualify(){
        assertEquals(1000,CloudNative.loginRetryDelay(1));assertEquals(2000,CloudNative.loginRetryDelay(2));
        assertEquals(4000,CloudNative.loginRetryDelay(3));assertEquals(-1,CloudNative.loginRetryDelay(4));
        assertEquals(-1,CloudNative.loginRetryDelay(0));
        assertTrue(CloudNative.transientLoginStatus(500));assertTrue(CloudNative.transientLoginStatus(503));
        for(int status:new int[]{200,302,400,401,403,409,429})assertFalse(CloudNative.transientLoginStatus(status));
    }
    @Test public void browserReturnIsAnExactActivationWithoutTokensOrArbitraryDestinations(){
        String id="a".repeat(32),url="pokebonk-offline-standard://cloud/return/"+id;
        assertEquals(id,CloudNative.returnLoginId(url));
        assertEquals(id,CloudNative.returnLoginId("pokebonk-offline://cloud/return/"+id));
        for(String value:new String[]{null,url+"?token=secret",url+"#x",url+"/",url.toUpperCase(java.util.Locale.ROOT),
            url.replace("://cloud","://user@cloud"),url.replace("return/","return/%2e/"),
            "https://evil.invalid/"+id,"pokebonk-standard://game/index.html"})
            assertNull(CloudNative.returnLoginId(value));
        assertNull(CloudNative.returnLoginId("pokebonk://cloud/return/"+id));
    }
    @Test public void serviceOriginsAreFixedHttpsWorkersNotUserProvidedUrls()throws Exception{
        JSONObject config=new JSONObject().put("cloudSaves",new JSONObject().put("enabled",true).put("url","https://cloud-save.owner.workers.dev"));
        assertEquals("https://cloud-save.owner.workers.dev",CloudNative.origin(config));
        config.getJSONObject("cloudSaves").put("url","https://cloud-save.owner.workers.dev/");
        assertEquals("https://cloud-save.owner.workers.dev",CloudNative.origin(config));
        for(String url:new String[]{"http://cloud-save.owner.workers.dev","https://user@cloud-save.owner.workers.dev",
            "https://cloud-save.owner.workers.dev/path","https://cloud-save.owner.workers.dev?token=x","https://evil.invalid"}){
            config.getJSONObject("cloudSaves").put("url",url);assertNull(CloudNative.origin(config));
        }
    }
    @Test public void currentCommittedCoopTicketsDoNotBreakAndroidNativeSaving()throws Exception{
        for(String mode:new String[]{"standard","endless","relay","mutation","bossrush","expedition"}){
            JSONObject config=new JSONObject().put("species",4).put("mode",mode).put("tier",0)
                .put("biome",mode.equals("bossrush")?"newisland":mode.equals("expedition")?"wilds":"forest");
            JSONObject ticket=new JSONObject().put("id","offline-cloud-test").put("seed",123).put("party","lan-test")
                .put("coopRulesAt",1795564800000L).put("config",config)
                .put("lan",new JSONObject().put("version",2).put("party","lan-test").put("me","lan-host").put("size",2).put("launched",true));
            NativeSaveStore.ticket(ticket);
            assertThrows(Exception.class,()->NativeSaveStore.ticket(ticket.put("coopRulesAt","bad")));
        }
    }
    @Test public void cloudActionsAreUserClickedMainFrameCommandsNotUrlsOrPaths(){
        for(String action:new String[]{"connect","cancel","sync","auto-on","auto-off","disconnect","backups","review-local","review-cloud","confirm-local","confirm-cloud","review-backup/"+"a".repeat(32)}){
            String url=NativeMenuAction.ORIGIN+"/__native__/cloud/"+action;
            assertEquals("cloud/"+action,NativeMenuAction.resolve(url,"GET",true,true));
            assertNull(NativeMenuAction.resolve(url,"GET",true,false));assertNull(NativeMenuAction.resolve(url,"GET",false,true));
            assertNull(NativeMenuAction.resolve(url+"?url=https://evil.invalid","GET",true,true));
        }
    }
}
