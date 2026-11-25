package dev.nicartjay.pokebonk.offline.standard;

import android.content.Context;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.json.JSONObject;

/** Native mode router. The existing LAN implementation remains independent. */
final class CoopNetwork implements AutoCloseable {
    private final LanNetwork local;
    private final LanNetwork.Profile profile;
    private final Consumer<JSONObject> broker,event;
    private final String gateway,identity;
    private final boolean relayReady;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private volatile boolean internet,disposed,starting,finding;
    private volatile long epoch;
    private volatile String mode="stun-only",current="{\"phase\":\"idle\",\"members\":[],\"linked\":false}";
    CoopNetwork(Context context,JSONObject config,String identity,LanNetwork.Profile profile,Consumer<JSONObject> broker,Consumer<JSONObject> event){
        this.gateway=InternetPolicy.gateway(config);this.identity=identity;this.profile=profile;this.broker=broker;this.event=event;
        this.relayReady=gateway!=null&&config.optJSONObject("internetCoop").optBoolean("relayEnabled",false);
        local=new LanNetwork(context,identity,profile,broker,value->{if(!internet)forward(value);});
    }
    private void forward(JSONObject value){
        try{
            if("state".equals(value.optString("type")))value.put("value",new JSONObject(state()));
            event.accept(value);
        }catch(Exception ignored){}
    }
    private void notice(String message){
        try{event.accept(new JSONObject().put("type","notice").put("message",message.substring(0,Math.min(240,message.length()))));}
        catch(Exception ignored){}
    }
    String state(){
        try{
            JSONObject value=new JSONObject(internet?current:local.state());
            value.put("connectionMode",internet?mode:"lan").put("capabilities",new JSONObject().put("internetReady",gateway!=null).put("relayReady",relayReady));
            return value.toString();
        }catch(Exception error){return "{\"phase\":\"error\",\"members\":[],\"linked\":false}";}
    }
    void publish(){try{event.accept(new JSONObject().put("type","state").put("value",new JSONObject(state())));}catch(Exception ignored){}}
    private void input(JSONObject value)throws Exception {value.put("scope","internet").put("epoch",epoch);broker.accept(value);}
    synchronized void cancelFind(){if(internet){if(finding)stop("",false);else publish();}else local.fromGame("cancel-find","null");}
    synchronized void stop(String reason,boolean error){
        if(!internet){local.stop(reason,error);return;}
        epoch++;finding=false;
        try{
            input(new JSONObject().put("type","reset"));
            JSONObject value=new JSONObject().put("phase",error?"error":"closed").put("members",new org.json.JSONArray()).put("linked",false);
            if(!reason.isEmpty())value.put("error",reason.substring(0,Math.min(240,reason.length())));
            current=value.toString();publish();
        }catch(Exception ignored){}
    }
    private boolean occupied()throws Exception{return starting||finding||(!internet&&local.busy())||new JSONObject(internet?current:local.state()).optString("phase").matches("connecting|hosting|lobby|preparing|playing");}
    synchronized void command(String action,JSONObject data){
        if("leave".equals(action)){stop("",false);return;}
        if("cancel-find".equals(action)){cancelFind();return;}
        if(!action.matches("host|join|find|browse"))return;
        try{
            String next=data.has("connectionMode")?data.getString("connectionMode"):"lan";
            LanPolicy.require(next.matches("lan|stun-only|turn-fallback"),"Invalid co-op connection mode.");
            if("lan".equals(next)){
                if(internet){LanPolicy.require(!occupied(),"Leave the current room first.");stop("",false);internet=false;}
                local.command(action,data);return;
            }
            LanPolicy.require(gateway!=null,"Internet co-op service has not been configured. LAN remains available.");
            LanPolicy.require(!disposed&&!occupied(),"Leave the current room or cancel the search first.");
            if(!internet){local.stop("",false);internet=true;}
            stop("",false);mode=next;
            starting=true;finding="find".equals(action)||"browse".equals(action);
            // Publish before native disk/profile work so a tap cannot silently
            // disappear while startup is pending. Failures below are durable
            // room-state feedback, not a brief notice behind the co-op screen.
            JSONObject initial=new JSONObject().put("phase","browse".equals(action)?"idle":"connecting").put("members",new org.json.JSONArray()).put("linked",false)
                .put("discovery",new JSONObject().put("status","find".equals(action)?"searching":"idle").put("rooms",0));
            if("browse".equals(action))initial.put("roomListing",new JSONObject().put("status","loading").put("rooms",new org.json.JSONArray()));
            current=initial.toString();publish();
            final long generation=epoch;
            io.execute(()->{
                try{
                    JSONObject p=profile.get();if(generation!=epoch||disposed)return;
                    LanPolicy.require(!p.getBoolean("unfinished"),"Finish or explicitly end the preserved run before joining co-op.");
                    int species=data.getInt("species");LanPolicy.require(owned(p,species),"Choose an owned Pokémon.");
                    CoopRules.destination(data.optString("destination"));
                    if("join".equals(action))LanPolicy.require(data.optString("invitation").matches("(?:[A-Z0-9]{6}|[A-Z2-7]{8}#[A-Za-z0-9_-]{43})"),"Enter the 6-character Internet room code.");
                    synchronized(CoopNetwork.this){
                        if(generation!=epoch||disposed)return;
                        String name=p.optString("name").replaceAll("[\\x00-\\x1f\\x7f]","");if(name.length()>24)name=name.substring(0,24);
                        input(new JSONObject().put("type",action).put("gateway",gateway).put("identity",identity)
                            .put("player",new JSONObject().put("name",name).put("maps",CoopRules.maps(p.optJSONObject("maps")))).put("data",data));
                    }
                }catch(Exception error){
                    synchronized(CoopNetwork.this){
                        if(generation==epoch&&!disposed)stop(String.valueOf(error.getMessage()),true);
                    }
                }
                finally{starting=false;try{JSONObject state=new JSONObject(current),listing=state.optJSONObject("roomListing");
                    if(!"connecting".equals(state.optString("phase"))&&(listing==null||!"loading".equals(listing.optString("status"))))finding=false;
                }catch(Exception ignored){}}
            });
        }catch(Exception error){notice(String.valueOf(error.getMessage()));}
    }
    private static boolean owned(JSONObject profile,int species)throws Exception {
        org.json.JSONArray list=profile.getJSONArray("league");
        for(int i=0;i<list.length();i++)if(list.getInt(i)==species)return true;return false;
    }
    void fromGame(String channel,String text){
        if(!internet){local.fromGame(channel,text);return;}
        if("refresh".equals(channel)){publish();return;}
        if("leave".equals(channel)){stop("",false);return;}
        if("cancel-find".equals(channel)){cancelFind();return;}
        final long generation=epoch;
        io.execute(()->{
            try{
                if(disposed||!internet||generation!=epoch)return;
                Object data=new org.json.JSONTokener(text).nextValue();JSONObject state=new JSONObject(current);String phase=state.optString("phase");
                if("failed".equals(channel)){stop("Co-op preparation failed. Your save is preserved.",true);return;}
                if("room-return".equals(channel)){
                    CoopRules.returned(profile.get(),state,data);
                }else if("prepared".equals(channel)){
                    JSONObject ticket=profile.get().optJSONObject("ticket"),match=state.optJSONObject("match");
                    LanPolicy.require("preparing".equals(phase)&&ticket!=null&&match!=null&&data.equals(match.getString("party"))&&
                        data.equals(ticket.getString("party"))&&ticket.getLong("seed")==match.getLong("seed")&&
                        ticket.getJSONObject("lan").getString("me").equals(state.getString("me"))&&
                        ticket.getJSONObject("lan").getInt("size")==state.getJSONArray("members").length()&&
                        !ticket.getJSONObject("lan").getBoolean("launched"),"Co-op run was not durably committed.");
                }else if(channel.matches("room-start|room-ready|room-pick|room-chat|room-settings|room-seats|room-loadout")){
                    if(!phase.matches("hosting|lobby"))return;
                    if("room-pick".equals(channel)){
                        JSONObject p=profile.get();
                        LanPolicy.require(!p.getBoolean("unfinished")&&data instanceof Number&&((Number)data).doubleValue()==((Number)data).intValue()&&owned(p,((Number)data).intValue()),"Choose an owned Pokémon.");
                    }
                    if("room-chat".equals(channel)&&(!(data instanceof String)||((String)data).length()>140))return;
                    if("room-loadout".equals(channel))data=CoopRules.loadout((JSONObject)data);
                    if(channel.matches("room-settings|room-seats"))CoopRules.action(channel,data,state);
                }else{
                    if(!"playing".equals(phase)||!(data instanceof JSONObject)||!channel.matches("ctl|snap"))return;
                    JSONObject frame=(JSONObject)data;boolean member=false;
                    for(int i=0;i<state.getJSONArray("members").length();i++)if(state.getJSONArray("members").getJSONObject(i).getString("id").equals(frame.optString("to")))member=true;
                    if(!member||frame.optString("to").equals(state.optString("me"))||!LanPolicy.frame(channel,frame.opt("payload")))return;
                }
                synchronized(CoopNetwork.this){
                    if(!disposed&&internet&&generation==epoch)input(new JSONObject().put("type","action").put("channel",channel).put("data",data));
                }
            }catch(Exception error){notice("Could not process co-op action. Your save is preserved.");}
        });
    }
    void fromBroker(String text){
        try{
            JSONObject value=LanPolicy.parse(text,48000);
            if(!"internet".equals(value.optString("scope"))){if(!internet)local.fromBroker(text);return;}
            if(!internet||value.optLong("epoch",-1)!=epoch)return;
            String type=value.optString("type");JSONObject state=new JSONObject(current);
            if("state".equals(type)){
                JSONObject next=InternetPolicy.state(value.getJSONObject("value"),mode);current=next.toString();
                JSONObject search=next.optJSONObject("discovery"),listing=next.optJSONObject("roomListing");
                finding=search!=null&&search.optString("status").matches("searching|joining")||listing!=null&&"loading".equals(listing.optString("status"));publish();
            }
            else if("frame".equals(type)&&"playing".equals(state.optString("phase"))&&LanPolicy.frame(value.optString("channel"),value.opt("data"))){
                for(int i=0;i<state.getJSONArray("members").length();i++)if(state.getJSONArray("members").getJSONObject(i).getString("id").equals(value.optString("peer")))event.accept(value);
            }else if("peer-closed".equals(type)&&LanPolicy.id(value.optString("peer")))event.accept(value);
            else if("notice".equals(type)&&value.opt("message") instanceof String)notice(value.getString("message"));
        }catch(Exception error){stop("Invalid Internet room state. Your save is preserved.",true);}
    }
    @Override public void close(){disposed=true;stop("",false);local.close();io.shutdownNow();}
}
