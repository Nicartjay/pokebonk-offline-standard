package dev.nicartjay.pokebonk.offline.standard;

import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;

/** Mirrors common/coop-rules.mjs; only reviewed engine rules cross the bridge. */
final class CoopRules {
    private static final String[] MAPS={"forest","desert","coast","glacier","canela","cave","encina","iris","plateado","furia"};
    private static boolean map(String value){return Arrays.asList(MAPS).contains(value);}
    private static boolean integer(Object value,int min,int max){
        return value instanceof Number&&((Number)value).doubleValue()==((Number)value).intValue()&&
            ((Number)value).intValue()>=min&&((Number)value).intValue()<=max;
    }
    static JSONObject maps(JSONObject raw)throws Exception{
        JSONObject out=new JSONObject().put("forest",0);
        if(raw!=null)for(String id:MAPS)if(integer(raw.opt(id),0,2))out.put(id,raw.getInt(id));
        return out;
    }
    static JSONObject settings(JSONObject raw)throws Exception{
        if(raw==null)return new JSONObject().put("biome","forest").put("tier",0);
        int tier=raw.optInt("tier",-1);
        LanPolicy.require((tier==4?raw.optString("biome").matches("wilds|safari"):
            map(raw.optString("biome"))||(tier==6||tier==7)&&"newisland".equals(raw.optString("biome")))&&
            integer(raw.opt("tier"),0,7),"Choose a supported co-op mode and map.");
        return new JSONObject().put("biome",tier==7?"newisland":tier==6?"forest":raw.getString("biome")).put("tier",tier);
    }
    static JSONObject destination(String value)throws Exception{
        if(value==null||value.isEmpty())return settings(null);
        LanPolicy.require(value.matches("wilds|safari"),"Choose a supported Expedition destination.");
        return settings(new JSONObject().put("biome",value).put("tier",4));
    }
    static boolean matches(JSONObject settings,String value)throws Exception{
        JSONObject wanted=destination(value),actual=settings(settings);
        return value==null||value.isEmpty()||actual.getInt("tier")==4&&actual.getString("biome").equals(wanted.getString("biome"));
    }
    static JSONObject loadout(JSONObject value)throws Exception{
        LanPolicy.require(value!=null&&value.optJSONArray("worn")!=null&&value.getJSONArray("worn").length()<=4&&
            integer(value.opt("bag"),0,12)&&integer(value.opt("risk"),0,1000000000)&&integer(value.opt("ins"),0,1000000000),
            "Invalid Expedition loadout summary.");
        JSONArray worn=new JSONArray();
        for(int i=0;i<value.getJSONArray("worn").length();i++){
            JSONObject item=value.getJSONArray("worn").getJSONObject(i);
            LanPolicy.require(item.optString("b").matches("[a-z0-9-]{1,80}")&&integer(item.opt("r"),0,4)&&
                integer(item.opt("lv"),1,30),"Invalid Expedition equipment summary.");
            worn.put(new JSONObject().put("b",item.getString("b")).put("r",item.getInt("r")).put("lv",item.getInt("lv")));
        }
        JSONObject out=new JSONObject().put("worn",worn).put("bag",value.getInt("bag")).put("risk",value.getInt("risk")).put("ins",value.getInt("ins"));
        if(value.has("card")){LanPolicy.require(value.optString("card").matches("card-[a-z0-9-]{1,60}"),"Invalid route card.");out.put("card",value.getString("card"));}
        return out;
    }
    static JSONArray completed(JSONObject state)throws Exception{
        JSONArray out=new JSONArray();java.util.Set<String>seen=new java.util.HashSet<>();
        JSONObject finished=state.optJSONObject("finished");if(finished==null)return out;
        java.util.Iterator<String>keys=finished.keys();
        while(keys.hasNext()){
            JSONObject result=finished.optJSONObject(keys.next()),record=result==null?null:result.optJSONObject("record");
            JSONObject coop=record==null?null:record.optJSONObject("coop");String party=coop==null?"":coop.optString("party");
            if(LanPolicy.id(party)&&seen.add(party))out.put(party);
        }
        return out;
    }
    static void returned(JSONObject profile,JSONObject state,Object data)throws Exception{
        JSONObject match=state.optJSONObject("match"),ticket=profile.optJSONObject("ticket");
        boolean saved=false;JSONArray parties=profile.optJSONArray("completedParties");
        if(parties!=null)for(int i=0;i<parties.length();i++)if(parties.getString(i).equals(data))saved=true;
        LanPolicy.require(data instanceof String&&"playing".equals(state.optString("phase"))&&match!=null&&
            data.equals(match.optString("party"))&&(ticket==null||!data.equals(ticket.optString("party")))&&saved,
            "The completed co-op run has not been saved.");
    }
    static JSONObject seats(JSONObject raw,int count)throws Exception{
        if(raw==null)raw=new JSONObject().put("discoverable",false).put("capacity",4);
        LanPolicy.require(raw.opt("discoverable") instanceof Boolean&&integer(raw.opt("capacity"),2,4)&&raw.getInt("capacity")>=count,
            "Choose Duo, Trio or Squad without removing a teammate.");
        return new JSONObject().put("discoverable",raw.getBoolean("discoverable")).put("capacity",raw.getInt("capacity"));
    }
    static boolean game(JSONObject value){
        if(value==null)return false;
        return "expedition".equals(value.optString("mode"))&&value.optString("biome").matches("wilds|safari")&&integer(value.opt("tier"),0,0)||
            "bossrush".equals(value.optString("mode"))&&"newisland".equals(value.optString("biome"))&&integer(value.opt("tier"),0,0)||
            map(value.optString("biome"))&&(value.optString("mode").matches("standard|mutation")&&integer(value.opt("tier"),0,2)||
            value.optString("mode").matches("endless|relay")&&integer(value.opt("tier"),0,0));
    }
    static long time(Object value)throws Exception{
        LanPolicy.require(value instanceof Number&&((Number)value).doubleValue()==((Number)value).longValue()&&
            ((Number)value).longValue()>=0&&((Number)value).longValue()<=8640000000000000L,"Invalid shared co-op rule clock.");
        return ((Number)value).longValue();
    }
    static void action(String channel,Object data,JSONObject state)throws Exception{
        LanPolicy.require("host".equals(state.optString("role"))&&data instanceof JSONObject,"Only the host can change this room.");
        JSONObject raw=(JSONObject)data;JSONArray members=state.getJSONArray("members");
        if("room-seats".equals(channel)){seats(raw,members.length());return;}
        JSONObject selection=settings(raw);String id=selection.getString("biome");int tier=selection.getInt("tier");if(tier>2)tier=0;
        if(selection.getInt("tier")==4||selection.getInt("tier")==6||selection.getInt("tier")==7)return;
        for(int i=0;i<members.length();i++)LanPolicy.require(maps(members.getJSONObject(i).optJSONObject("maps")).optInt(id,-1)>=tier,
            "A teammate has not unlocked this map or difficulty.");
    }
    private CoopRules(){}
}
