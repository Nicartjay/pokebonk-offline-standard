package dev.nicartjay.pokebonk.offline.standard;

import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

final class LanPolicy {
    static boolean privateAddress(String value){
        if(value==null||!value.matches("\\d{1,3}(\\.\\d{1,3}){3}"))return false;
        String[]parts=value.split("\\.");int[]n=new int[4];
        for(int i=0;i<4;i++){n[i]=Integer.parseInt(parts[i]);if(n[i]>255||!Integer.toString(n[i]).equals(parts[i]))return false;}
        return n[0]==10||n[0]==172&&n[1]>=16&&n[1]<=31||n[0]==192&&n[1]==168||n[0]==169&&n[1]==254;
    }
    static boolean subnet(String a,String b,int prefix){
        if(!privateAddress(a)||!privateAddress(b)||prefix<8||prefix>32)return false;
        String[]x=a.split("\\."),y=b.split("\\.");long p=0,q=0;
        for(int i=0;i<4;i++){p=(p<<8)|Integer.parseInt(x[i]);q=(q<<8)|Integer.parseInt(y[i]);}
        long mask=(0xffffffffL<<(32-prefix))&0xffffffffL;return (p&mask)==(q&mask);
    }
    static void require(boolean condition,String reason)throws IOException {if(!condition)throw new IOException(reason);}
    static boolean id(String value){return value!=null&&value.matches("lan-[\\w-]{1,80}");}
    static void requireLanConnectionMode(JSONObject data)throws Exception {
        Object value=data.opt("connectionMode");
        String mode=value==null?"lan":value instanceof String?(String)value:"";
        require(mode.matches("lan|stun-only|turn-fallback"),"Invalid co-op connection mode.");
        require("lan".equals(mode),"Internet co-op is not connected to the app yet. LAN was not started.");
    }
    static JSONObject parse(String value,int max)throws Exception {
        require(value!=null&&value.length()<=max,"Oversized LAN message.");int depth=0;boolean string=false,escape=false;
        for(int i=0;i<value.length();i++){char c=value.charAt(i);if(string){if(escape)escape=false;else if(c=='\\')escape=true;else if(c=='"')string=false;}
            else if(c=='"')string=true;else if(c=='['||c=='{'){require(++depth<=64,"Deeply nested LAN message.");}else if(c==']'||c=='}')depth--;}
        return new JSONObject(value);
    }
    static JSONObject description(JSONObject value)throws Exception {
        String type=value.optString("type"),sdp=value.optString("sdp");
        require(("offer".equals(type)||"answer".equals(type))&&sdp.startsWith("v=0")&&sdp.length()<=32000,"Invalid local peer description.");
        StringBuilder out=new StringBuilder();boolean candidate=false;
        for(String line:sdp.split("\\r?\\n")){
            require(!line.matches("m=(?!application\\b).*" )&&!line.startsWith("a=remote-candidates:"),"Only local data channels are allowed.");
            if(line.startsWith("c=IN IP")){String[]p=line.split(" ");String address=p[p.length-1];require("0.0.0.0".equals(address)||"::".equals(address)||privateAddress(address)||address.matches("(?i)fe80:[a-f0-9:]+"),"Non-local peer address.");}
            if(line.startsWith("a=candidate:")){
                String[]p=line.split("\\s+");int typ=-1;for(int i=0;i<p.length;i++)if("typ".equals(p[i]))typ=i;
                if(p.length<8||typ<0||typ+1>=p.length||!"host".equals(p[typ+1])||!(privateAddress(p[4])||p[4].matches("(?i)[a-z0-9-]{1,100}\\.local")||p[4].matches("(?i)fe80:[a-f0-9:]+(%\\w+)?")))continue;
                candidate=true;
            }
            out.append(line).append("\r\n");
        }
        require(candidate,"No local peer candidates. Check Wi-Fi and Local Network permissions.");
        return new JSONObject().put("type",type).put("sdp",out.toString());
    }
    static boolean frame(String channel,Object value){
        if("ctl".equals(channel)&&value instanceof JSONObject){JSONObject data=(JSONObject)value;return data.opt("t") instanceof String&&data.optString("t").length()<=40&&data.toString().length()<=32768;}
        return "snap".equals(channel)&&value instanceof String&&((String)value).length()<=21856&&((String)value).matches("[A-Za-z0-9+/]*={0,2}");
    }
    static JSONObject listing(JSONObject source,String mode)throws Exception {
        require(source!=null&&source.optString("status").matches("idle|loading|ready|empty|error"),"Invalid room listing.");
        JSONArray incoming=source.getJSONArray("rooms"),rooms=new JSONArray();Set<String> codes=new HashSet<>();
        require(incoming.length()<=("lan".equals(mode)?32:8),"Oversized room listing.");
        for(int i=0;i<incoming.length();i++){
            JSONObject room=incoming.getJSONObject(i);String code=room.getString("code"),name=room.getString("name");int players=room.getInt("players");
            require(CoopCodes.valid(code,mode)&&codes.add(code)&&name.length()<=24&&!name.matches("(?s).*[\\x00-\\x1f\\x7f].*")&&
                room.opt("players") instanceof Number&&((Number)room.get("players")).doubleValue()==players&&players>=1&&players<4,"Invalid listed room.");
            rooms.put(new JSONObject().put("code",code).put("name",name).put("players",players));
        }
        JSONObject out=new JSONObject().put("status",source.getString("status")).put("rooms",rooms);
        if(source.opt("message") instanceof String){String message=source.getString("message");out.put("message",message.substring(0,Math.min(160,message.length())));}
        return out;
    }
    static JSONObject state(JSONObject value)throws Exception {
        require(value.toString().length()<=24000&&value.optString("phase").matches("idle|hosting|connecting|lobby|preparing|playing|closed|error"),"Invalid local room state.");
        JSONArray members=value.getJSONArray("members");require(members.length()<=4,"Local rooms have at most four trainers.");Set<String>ids=new HashSet<>();Set<Integer>slots=new HashSet<>();
        for(int i=0;i<members.length();i++){
            JSONObject m=members.getJSONObject(i);int species=m.getInt("species"),slot=m.getInt("slot");
            require(id(m.optString("id"))&&ids.add(m.getString("id"))&&m.getString("name").length()<=24&&species>0&&species<=10000&&slot>=0&&slot<=3&&slots.add(slot)&&m.opt("ready") instanceof Boolean,"Invalid local player.");
        }
        if(value.has("me"))require(id(value.getString("me"))&&value.optString("role").matches("host|client"),"Invalid local identity.");
        JSONObject match=value.optJSONObject("match");if(match!=null){
            JSONArray players=match.getJSONArray("players");long seed=match.getLong("seed");require(id(match.optString("party"))&&seed>=0&&seed<=4294967295L&&"standard".equals(match.optString("mode"))&&"forest".equals(match.optString("biome"))&&match.optInt("tier",-1)==0&&players.length()==members.length()&&players.length()>=2,"Invalid shared local match.");
            for(int i=0;i<players.length();i++)require(players.getString(i).equals(members.getJSONObject(i).getString("id")),"Mismatched local roster.");
        }
        JSONArray chat=value.optJSONArray("chat");if(chat!=null){require(chat.length()<=40,"Oversized local chat.");for(int i=0;i<chat.length();i++){JSONObject m=chat.getJSONObject(i);require(id(m.optString("from"))&&m.optString("name").length()<=24&&m.optString("text").length()<=140,"Invalid local chat.");}}
        return new JSONObject(value.toString());
    }
    private LanPolicy(){}
}
