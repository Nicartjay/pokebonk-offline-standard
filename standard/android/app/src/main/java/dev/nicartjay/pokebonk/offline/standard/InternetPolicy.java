package dev.nicartjay.pokebonk.offline.standard;

import java.net.URI;
import org.json.JSONObject;

/** Pinned service access for the trusted broker, never the game WebView. */
final class InternetPolicy {
    static String gateway(JSONObject config){
        try{
            JSONObject value=config.optJSONObject("internetCoop");
            if(value==null||!value.optBoolean("enabled",false))return null;
            URI uri=new URI(value.getString("url"));
            if(!"https".equals(uri.getScheme())||uri.getHost()==null||
                !uri.getHost().matches("[a-z0-9-]+\\.[a-z0-9-]+\\.workers\\.dev")||
                uri.getPort()!=-1||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||
                !(uri.getPath().isEmpty()||"/".equals(uri.getPath())))return null;
            return "https://"+uri.getHost();
        }catch(Exception error){return null;}
    }
    static boolean request(String value,String gateway){
        if(gateway==null)return false;
        try{URI uri=new URI(value),base=new URI(gateway);
            return ("https".equals(uri.getScheme())||"wss".equals(uri.getScheme()))&&base.getHost().equals(uri.getHost())&&
                uri.getPort()==-1&&uri.getUserInfo()==null&&uri.getQuery()==null&&uri.getFragment()==null&&
                uri.getPath().matches("/v1/[a-zA-Z0-9/-]+");
        }catch(Exception error){return false;}
    }
    static JSONObject state(JSONObject source,String mode)throws Exception {
        LanPolicy.require(mode.matches("stun-only|turn-fallback"),"Invalid Internet mode.");
        JSONObject value=new JSONObject();
        // Native boundary allowlist, including nested objects. Broker tokens,
        // ICE credentials/candidates and service URLs never enter the game.
        for(String key:new String[]{"phase","linked","role","me","code","error","match","disconnected","chat","members","discovery"})
            if(source.has(key))value.put(key,source.get(key));
        String invitation=source.optString("invitation","");
        JSONObject checked=LanPolicy.state(value),result=new JSONObject();
        for(String key:new String[]{"phase","linked","role","me","code","error","disconnected"})if(checked.has(key))result.put(key,checked.get(key));
        org.json.JSONArray members=new org.json.JSONArray(),incoming=checked.getJSONArray("members");
        for(int i=0;i<incoming.length();i++){
            JSONObject member=new JSONObject(),raw=incoming.getJSONObject(i);
            for(String key:new String[]{"id","name","species","slot","ready"})member.put(key,raw.get(key));
            members.put(member);
        }
        result.put("members",members).put("connectionMode",mode);
        if(source.optString("transport").matches("lan|stun|turn|direct|waiting|connecting"))result.put("transport",source.getString("transport"));
        if(checked.has("match")){
            JSONObject match=new JSONObject(),raw=checked.getJSONObject("match");
            for(String key:new String[]{"party","seed","mode","biome","tier","players"})match.put(key,raw.get(key));
            result.put("match",match);
        }
        org.json.JSONArray chat=new org.json.JSONArray(),rawChat=checked.optJSONArray("chat");
        if(rawChat!=null)for(int i=0;i<rawChat.length();i++){
            JSONObject message=new JSONObject(),raw=rawChat.getJSONObject(i);
            for(String key:new String[]{"id","from","name","text","at"})message.put(key,raw.get(key));
            chat.put(message);
        }
        result.put("chat",chat);
        if(!invitation.isEmpty())LanPolicy.require(invitation.matches("[A-Z2-7]{8}#[A-Za-z0-9_-]{43}"),"Invalid Internet invitation.");
        if(source.has("roomListing"))result.put("roomListing",LanPolicy.listing(source.optJSONObject("roomListing"),mode));
        JSONObject search=value.optJSONObject("discovery");
        if(search!=null&&search.optString("status").matches("idle|searching|joining|empty|error"))
            result.put("discovery",new JSONObject().put("status",search.getString("status"))
                .put("rooms",Math.max(0,Math.min(8,search.optInt("rooms",0)))));
        return result;
    }
}
