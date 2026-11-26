package dev.nicartjay.pokebonk.offline.standard;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class VoicePolicyTest {
    @Test public void microphoneVolumeDefaultsToFullLevelWithoutEnablingCapture() {
        assertEquals(100,VoicePolicy.DEFAULT_VOLUME);
        assertFalse(VoicePolicy.empty().optBoolean("enabled"));
    }
    private JSONObject room() throws Exception {
        return new JSONObject("{\"phase\":\"playing\",\"connectionMode\":\"lan\",\"me\":\"lan-me\","+
            "\"members\":[{\"id\":\"lan-me\"},{\"id\":\"lan-peer\"}]}");
    }
    @Test public void microphoneNeedsExactArmedForegroundAudioOnlyOrigin() throws Exception {
        JSONObject room=room();
        String origin=NativeMenuAction.ORIGIN,audio="android.webkit.resource.AUDIO_CAPTURE";
        assertTrue(VoicePolicy.microphone(origin,new String[]{audio},true,true,room));
        assertFalse(VoicePolicy.microphone(origin,new String[]{audio},false,true,room));
        assertFalse(VoicePolicy.microphone(origin,new String[]{audio},true,false,room));
        assertFalse(VoicePolicy.microphone(origin,new String[]{audio,"android.webkit.resource.VIDEO_CAPTURE"},true,true,room));
        assertFalse(VoicePolicy.microphone(origin,new String[]{},true,true,room));
        assertFalse(VoicePolicy.microphone(origin+".evil.invalid",new String[]{audio},true,true,room));
        assertFalse(VoicePolicy.microphone(origin,new String[]{audio},true,true,room.put("phase","closed")));
    }
    @Test public void stateStripsSignalingAndCredentialsAndRejectsUnknownPeers() throws Exception {
        JSONObject source=VoicePolicy.empty().put("enabled",true).put("mode","open").put("microphone","ready")
            .put("transmitting",true).put("credential","private")
            .put("peers",new JSONArray("[{\"id\":\"lan-peer\",\"status\":\"connected\",\"sdp\":\"private\"}]"));
        JSONObject safe=VoicePolicy.state(source,room());
        assertFalse(safe.has("credential"));assertFalse(safe.getJSONArray("peers").getJSONObject(0).has("sdp"));
        assertThrows(Exception.class,()->VoicePolicy.state(source.put("enabled",false),room()));
        source.put("enabled",true);
        assertThrows(Exception.class,()->VoicePolicy.state(source.put("mode","muted"),room()));
        source.put("mode","open").put("peers",new JSONArray("[{\"id\":\"lan-outsider\",\"status\":\"connected\"}]"));
        assertThrows(Exception.class,()->VoicePolicy.state(source,room()));
    }
    @Test public void oldInternetServiceNeverAutomaticallyEnablesVoice() throws Exception {
        JSONObject room=room();
        assertTrue(VoicePolicy.available(room));
        room.put("connectionMode","turn-fallback");assertFalse(VoicePolicy.available(room));
        room.put("voiceAvailable",true);assertTrue(VoicePolicy.available(room));
        room.put("phase","closed");assertFalse(VoicePolicy.available(room));
    }
    @Test public void nativeVoiceLinksRequireRealGestureExactActionAndOrigin() {
        String url=NativeMenuAction.ORIGIN+"/__native__/voice/toggle";
        assertEquals("voice/toggle",NativeMenuAction.resolve(url,"GET",true,true));
        assertNull(NativeMenuAction.resolve(url,"GET",true,false));
        assertNull(NativeMenuAction.resolve(url,"POST",true,true));
        assertNull(NativeMenuAction.resolve(url,"GET",false,true));
        assertNull(NativeMenuAction.resolve(url+"?command=arbitrary","GET",true,true));
        assertNull(NativeMenuAction.resolve(NativeMenuAction.ORIGIN+"/__native__/voice/press","GET",true,true));
        assertFalse(VoicePolicy.action("toggle")); // Native host must resolve the enum from its cached state.
    }
}
