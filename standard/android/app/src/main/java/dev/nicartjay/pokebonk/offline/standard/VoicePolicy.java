package dev.nicartjay.pokebonk.offline.standard;

import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native projections/commands only. Never returns SDP, ICE or media to the game. */
final class VoicePolicy {
    static final int DEFAULT_VOLUME=100;
    static JSONObject empty() {
        try{return new JSONObject("{\"version\":1,\"enabled\":false,\"mode\":\"muted\",\"microphone\":\"off\",\"transmitting\":false,\"peers\":[],\"error\":\"\"}");}
        catch(Exception impossible){throw new IllegalStateException(impossible);}
    }
    static boolean active(JSONObject room){return room.optString("phase").matches("hosting|lobby|preparing|playing");}
    static boolean available(JSONObject room){return active(room)&&("lan".equals(room.optString("connectionMode"))||room.optBoolean("voiceAvailable"));}
    static boolean action(String value){return value!=null&&value.matches("enable|disable|mute|ptt|open-mic|press|release|suspend|permission-denied");}
    static JSONObject state(JSONObject source,JSONObject room)throws Exception {
        LanPolicy.require(source!=null&&source.toString().length()<=4096&&source.optInt("version")==1&&
            source.opt("enabled") instanceof Boolean&&source.opt("transmitting") instanceof Boolean&&
            source.optString("mode").matches("muted|ptt|open")&&source.optString("microphone").matches("off|requesting|ready|denied|error")&&
            source.optString("error").matches("|permission-denied|microphone-unavailable|direct-unavailable|relay-blocked|service-unavailable|audio-blocked|suspended"),"Invalid voice state.");
        JSONArray input=source.getJSONArray("peers"),members=room.getJSONArray("members"),peers=new JSONArray();
        LanPolicy.require(input.length()<=3,"Too many voice peers.");Set<String> ids=new HashSet<>();
        for(int i=0;i<input.length();i++){
            JSONObject peer=input.getJSONObject(i);String id=peer.getString("id");boolean member=false;
            for(int j=0;j<members.length();j++)if(id.equals(members.getJSONObject(j).optString("id")))member=true;
            LanPolicy.require(member&&!id.equals(room.optString("me"))&&ids.add(id)&&
                peer.optString("status").matches("connecting|connected|unavailable"),"Invalid voice peer.");
            peers.put(new JSONObject().put("id",id).put("status",peer.getString("status")));
        }
        boolean enabled=source.getBoolean("enabled"),speaking=source.getBoolean("transmitting");
        String mode=source.getString("mode"),mic=source.getString("microphone");
        LanPolicy.require(enabled||("muted".equals(mode)&&!"ready".equals(mic)&&!speaking&&peers.length()==0),"Invalid disabled voice.");
        LanPolicy.require(!speaking||(!"muted".equals(mode)&&"ready".equals(mic)),"Invalid microphone state.");
        return new JSONObject().put("version",1).put("enabled",enabled).put("mode",mode)
            .put("microphone",mic).put("transmitting",speaking).put("peers",peers).put("error",source.getString("error"));
    }
    static boolean microphone(String origin,String[] resources,boolean armed,boolean foreground,JSONObject room){
        return armed&&foreground&&active(room)&&origin!=null&&
            (NativeMenuAction.ORIGIN.equals(origin)||(NativeMenuAction.ORIGIN+"/").equals(origin))&&
            resources!=null&&resources.length==1&&"android.webkit.resource.AUDIO_CAPTURE".equals(resources[0]);
    }
    private VoicePolicy(){}
}
