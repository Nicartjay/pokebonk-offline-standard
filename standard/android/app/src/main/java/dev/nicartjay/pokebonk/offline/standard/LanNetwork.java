package dev.nicartjay.pokebonk.offline.standard;

import android.content.Context;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/** Private native sockets only. Shared bundled broker owns the room/RTC mesh. */
final class LanNetwork implements AutoCloseable {
    interface Profile { JSONObject get() throws Exception; }
    static final class Network {
        final String label,address;final int prefix;
        Network(String label,String address,int prefix){this.label=label;this.address=address;this.prefix=prefix;}
    }
    private final String identity;
    private final Profile profile;
    private final LanDiscovery discovery;
    private final Consumer<JSONObject> broker,event;
    private final ExecutorService commands=Executors.newSingleThreadExecutor(),acceptor=Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService retries=Executors.newSingleThreadScheduledExecutor();
    private ScheduledFuture<?> retryTask;
    private volatile String resumeAddress,resumeSecret;
    private volatile int resumePort,retryCount;
    private volatile long resumeEpoch,retryUntil;
    private final Map<String,LanWire> wires=new ConcurrentHashMap<>();
    private volatile ServerSocket server;
    private volatile Socket connecting;
    private volatile long epoch;
    private final AtomicInteger pending=new AtomicInteger();
    private volatile String current="{\"phase\":\"idle\",\"members\":[],\"linked\":false}",phase="idle";
    private volatile boolean disposed,starting;
    private final AtomicInteger findSerial=new AtomicInteger();
    private volatile boolean finding;
    private volatile String findState="{\"status\":\"idle\",\"rooms\":0}";
    private volatile String listingState="{\"status\":\"idle\",\"rooms\":[]}",findingKind="find";
    LanNetwork(Context context,String identity,Profile profile,Consumer<JSONObject> broker,Consumer<JSONObject> event){
        this.identity=identity;this.profile=profile;this.broker=broker;this.event=event;
        discovery=new LanDiscovery(context,identity);publish();
    }
    private static JSONObject object(String key,Object value){try{return new JSONObject().put(key,value);}catch(Exception impossible){throw new IllegalStateException(impossible);}}
    static List<Network> networks(){
        List<Network> result=new ArrayList<>();
        try{for(NetworkInterface ni:Collections.list(NetworkInterface.getNetworkInterfaces())){
            if(!ni.isUp()||ni.isLoopback()||ni.getName().matches("(?i)^(utun|tun|tap|wg|tailscale|docker|veth|br-).*"))continue;
            for(InterfaceAddress a:ni.getInterfaceAddresses())if(a.getAddress() instanceof Inet4Address&&LanPolicy.privateAddress(a.getAddress().getHostAddress()))result.add(new Network(ni.getName(),a.getAddress().getHostAddress(),a.getNetworkPrefixLength()));
        }}catch(Exception ignored){}return result;
    }
    String state(){
        try{JSONObject value=LanPolicy.parse(current,24000);value.remove("invitation");
            JSONArray list=new JSONArray();for(Network n:networks())if(list.length()<32)list.put(new JSONObject().put("label",n.label).put("address",n.address));
            return value.put("interfaces",list).put("discovery",new JSONObject(findState)).put("roomListing",LanPolicy.listing(new JSONObject(listingState),"lan")).toString();}
        catch(Exception error){return "{\"phase\":\"error\",\"members\":[],\"interfaces\":[],\"linked\":false}";}
    }
    void publish(){try{event.accept(new JSONObject().put("type","state").put("value",new JSONObject(state())));}catch(Exception ignored){}}
    private void input(JSONObject value){if(!disposed)broker.accept(value);}
    private void notice(Exception error){try{event.accept(new JSONObject().put("type","notice").put("message",String.valueOf(error.getMessage()).substring(0,Math.min(240,String.valueOf(error.getMessage()).length()))));}catch(Exception ignored){}}
    private void fail(Exception error){stop(String.valueOf(error.getMessage()),true);}
    private void findStatus(String status,int rooms,String message){
        try{JSONObject value=new JSONObject().put("status",status).put("rooms",rooms);
            if(message!=null)value.put("message",message.substring(0,Math.min(160,message.length())));
            findState=value.toString();publish();
        }catch(Exception ignored){}
    }
    private void cancelFind(boolean notify){
        if("code".equals(findingKind)&&"connecting".equals(phase)&&server==null&&wires.isEmpty()){
            epoch++;Socket pendingSocket=connecting;connecting=null;if(pendingSocket!=null)try{pendingSocket.close();}catch(Exception ignored){}
            try{input(new JSONObject().put("type","reset"));}catch(Exception ignored){}
            phase="idle";current="{\"phase\":\"idle\",\"members\":[],\"linked\":false}";
        }
        findSerial.incrementAndGet();finding=false;discovery.cancel();
        findState="{\"status\":\"idle\",\"rooms\":0}";listingState="{\"status\":\"idle\",\"rooms\":[]}";if(notify)publish();
    }
    boolean busy(){return starting||finding||phase.matches("hosting|connecting|lobby|preparing|playing");}
    private void find(JSONObject data,int serial,String kind,String code){
      try{
        if(disposed||serial!=findSerial.get())return;
        LanPolicy.require(server==null&&wires.isEmpty()&&!phase.matches("hosting|connecting|lobby|preparing|playing"),
            "Leave the current room or cancel the search first.");
        JSONObject p=profile.get();int species=data.getInt("species");
        if(serial!=findSerial.get())return;
        LanPolicy.require(!p.getBoolean("unfinished"),"Finish or explicitly end your preserved run before finding a local room.");
        LanPolicy.require(owned(p,species),"Choose an owned Pokémon.");
        LanPolicy.require(!networks().isEmpty(),"Connect to a private Wi-Fi or local hotspot first.");
        phase="code".equals(kind)?"connecting":"idle";
        current=new JSONObject().put("phase",phase).put("members",new JSONArray()).put("linked",false).toString();
        if("browse".equals(kind))listingState="{\"status\":\"loading\",\"rooms\":[]}";
        findStatus("find".equals(kind)?"searching":"code".equals(kind)?"joining":"idle",0,null);
        discovery.find("code".equals(kind)?code:null,count->{if(serial==findSerial.get()&&"find".equals(kind))findStatus("searching",count,null);},
            rooms->{
                if(disposed||serial!=findSerial.get())return;
                finding=false;
                try{
                    if("browse".equals(kind)){
                        Map<String,Integer> counts=new HashMap<>();
                        for(JSONObject room:rooms){String key=CoopCodes.lan(room.getString("id"));counts.put(key,counts.getOrDefault(key,0)+1);}
                        JSONArray listed=new JSONArray();
                        for(JSONObject room:rooms){String key=CoopCodes.lan(room.getString("id"));if(counts.get(key)==1&&CoopRules.matches(room.optJSONObject("settings"),data.optString("destination")))
                            {JSONObject entry=new JSONObject().put("code",key).put("name",room.getString("name")).put("players",room.getInt("count"))
                                .put("capacity",room.optInt("capacity",4)).put("settings",CoopRules.settings(room.optJSONObject("settings")));
                              if(room.has("rulesAt"))entry.put("rulesAt",CoopRules.time(room.get("rulesAt")));listed.put(entry);}}
                        listingState=LanPolicy.listing(new JSONObject().put("status",listed.length()>0?"ready":"empty").put("rooms",listed),"lan").toString();publish();return;
                    }
                    List<JSONObject> candidates=new ArrayList<>();
                    for(JSONObject room:rooms)if("code".equals(kind)?CoopCodes.lan(room.getString("id")).equals(code):CoopRules.matches(room.optJSONObject("settings"),data.optString("destination")))candidates.add(room);
                    if("code".equals(kind))LanPolicy.require(candidates.size()==1,candidates.isEmpty()?
                        "No compatible LAN room has that code. Check the host and Wi-Fi.":"More than one host has that code. Ask them to create a new room.");
                    if(candidates.isEmpty()){findStatus("empty",0,null);return;}
                    findStatus("joining",rooms.size(),null);
                    if("code".equals(kind)){phase="idle";current="{\"phase\":\"idle\",\"members\":[],\"linked\":false}";}
                    command("join",new JSONObject().put("species",species).put("invitation",candidates.get(0).getString("invitation")),serial);
                }catch(Exception error){searchFailure(serial,kind,error.getMessage());}
            },message->searchFailure(serial,kind,message));
      }catch(Exception error){searchFailure(serial,kind,error.getMessage());}
    }
    private void searchFailure(int serial,String kind,String message){
        if(serial!=findSerial.get())return;
        finding=false;
        if("browse".equals(kind))listingState="{\"status\":\"error\",\"rooms\":[]}";
        if("code".equals(kind)){
            phase="error";
            try{current=new JSONObject().put("phase",phase).put("members",new JSONArray()).put("linked",false).put("error",message).toString();}catch(Exception ignored){}
        }
        findStatus("error",0,message);
    }
    synchronized void stop(String reason,boolean error){
        if(retryTask!=null)retryTask.cancel(false);
        resumeAddress=resumeSecret=null;retryUntil=0;retryCount=0;
        cancelFind(false);discovery.advertise(null);
        epoch++;
        Socket pendingSocket=connecting;connecting=null;if(pendingSocket!=null)try{pendingSocket.close();}catch(Exception ignored){}
        ServerSocket old=server;server=null;if(old!=null)try{old.close();}catch(Exception ignored){}
        List<LanWire> oldWires=new ArrayList<>(wires.values());wires.clear();
        boolean leaving=false;try{leaving=!disposed&&!error&&"playing".equals(phase)&&"client".equals(new JSONObject(current).optString("role"));}catch(Exception ignored){}
        for(LanWire wire:oldWires){
            if(leaving){try{wire.send("{\"op\":\"leave\"}");retries.schedule(wire::close,40,TimeUnit.MILLISECONDS);}
                catch(Exception ignored){wire.close();}}
            else wire.close();
        }
        try{
            phase=error?"error":"closed";JSONObject value=new JSONObject().put("phase",phase).put("members",new JSONArray()).put("linked",false);
            if(reason!=null&&!reason.isEmpty())value.put("error",reason.substring(0,Math.min(240,reason.length())));current=value.toString();publish();
            input(new JSONObject().put("type","reset").put("reason",reason==null?"":reason).put("error",error));
        }catch(Exception ignored){}
    }
    synchronized void command(String action,JSONObject data){
        if("host".equals(action)||"join".equals(action)||"find".equals(action)||"browse".equals(action)){
            try{LanPolicy.requireLanConnectionMode(data);}catch(Exception error){notice(error);return;}
        }
        String code=data.optString("invitation").trim().toUpperCase(java.util.Locale.ROOT);
        boolean byCode="join".equals(action)&&CoopCodes.valid(code,"lan");
        if("find".equals(action)||"browse".equals(action)||byCode){
            if(disposed||busy())return;
            int serial=findSerial.incrementAndGet();finding=true;
            String kind=byCode?"code":action;findingKind=kind;commands.execute(()->find(data,serial,kind,code));return;
        }
        if("host".equals(action)||"join".equals(action)){
            if(disposed||busy())return;
            starting=true;
        }
        command(action,data,-1);
    }
    private void command(String action,JSONObject data,int expectedSearch){
        if("cancel-find".equals(action)){cancelFind(true);return;}
        final long requestedEpoch=epoch;
        starting=true;
        commands.execute(()->{
        long operationEpoch=requestedEpoch;
        try{
            if(disposed||requestedEpoch!=epoch)return;
            if(expectedSearch>=0&&expectedSearch!=findSerial.get())return;
            if("leave".equals(action)){stop("",false);return;}
            LanPolicy.require(!disposed&&("host".equals(action)||"join".equals(action)),"Unknown local action.");
            LanPolicy.require(server==null&&wires.isEmpty()&&!phase.matches("hosting|connecting|lobby|preparing|playing"),"Leave the current local room first.");
            JSONObject p=profile.get();if(disposed||requestedEpoch!=epoch)return;
            if(expectedSearch>=0&&expectedSearch!=findSerial.get())return;
            LanPolicy.require(!p.getBoolean("unfinished"),"Finish or explicitly end your preserved run before joining local co-op.");
            int species=data.getInt("species");LanPolicy.require(owned(p,species),"Choose an owned Pokémon.");
            String name=p.optString("name").replaceAll("[\\x00-\\x1f\\x7f]","");if(name.length()>24)name=name.substring(0,24);
            JSONObject member=new JSONObject().put("id","lan-"+UUID.randomUUID()).put("name",name).put("species",species).put("maps",CoopRules.maps(p.optJSONObject("maps")));
            stop("",false);operationEpoch=epoch;phase="connecting";
            if("host".equals(action)){
                String address=data.optString("address");Network selected=null;for(Network n:networks())if(n.address.equals(address))selected=n;
                LanPolicy.require(selected!=null,"Choose a private local network interface.");
                byte[]key=new byte[16];new SecureRandom().nextBytes(key);StringBuilder hex=new StringBuilder();for(byte b:key)hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));String secret=hex.toString();
                ServerSocket listening=new ServerSocket();listening.setReuseAddress(true);listening.bind(new InetSocketAddress(InetAddress.getByName(address),0));
                if(disposed){listening.close();return;}server=listening;
                input(new JSONObject().put("type","enter").put("role","host").put("member",member).put("settings",CoopRules.destination(data.optString("destination"))).put("invitation",address+":"+listening.getLocalPort()+"#"+secret));
                Network network=selected;long generation=epoch;acceptor.execute(()->accept(listening,network,secret,generation));
            }else{
                String invite=data.optString("invitation").trim();LanPolicy.require(invite.matches("[\\d.]+:\\d{1,5}#[a-fA-F0-9]{32}"),"Paste the complete host invitation: address:port#pairing-key.");
                int colon=invite.indexOf(':'),hash=invite.indexOf('#'),port=Integer.parseInt(invite.substring(colon+1,hash));String address=invite.substring(0,colon),secret=invite.substring(hash+1).toLowerCase(java.util.Locale.ROOT);
                LanPolicy.require(port>=1024&&port<=65535&&LanPolicy.privateAddress(address),"Use a private LAN invitation.");
                boolean local=false;for(Network n:networks())if(LanPolicy.subnet(address,n.address,n.prefix))local=true;LanPolicy.require(local,"The host must be on your current private LAN.");
                input(new JSONObject().put("type","enter").put("role","client").put("member",member));
                resumeAddress=address;resumePort=port;resumeSecret=secret;resumeEpoch=epoch;
                Socket socket=new Socket();connecting=socket;long generation=epoch;
                try{socket.connect(new InetSocketAddress(address,port),10000);attach(socket,false,secret,generation);}
                catch(Exception error){try{socket.close();}catch(Exception ignored){}throw error;}finally{if(connecting==socket)connecting=null;}
            }
        }catch(Exception error){if("find".equals(action)){finding=false;findStatus("error",0,error.getMessage());}else if(operationEpoch==epoch)fail(error);}
        finally{starting=false;}
    });}
    private void accept(ServerSocket listening,Network network,String secret,long generation){
        try{while(!disposed&&server==listening){
            Socket socket=listening.accept();String remote=socket.getInetAddress().getHostAddress();
            if(wires.size()>=6||!LanPolicy.subnet(remote,network.address,network.prefix)){socket.close();continue;}
            if(server!=listening){socket.close();return;}attach(socket,true,secret,generation);
        }}catch(Exception error){if(server==listening&&!disposed)fail(error);}
    }
    private void attach(Socket socket,boolean host,String secret,long generation)throws Exception {
        if(disposed||epoch!=generation){socket.close();return;}
        String connection=UUID.randomUUID().toString();
        LanWire wire=new LanWire(socket,host,identity,secret,new LanWire.Listener(){
            @Override public void open(){try{input(new JSONObject().put("type","open").put("connection",connection));}catch(Exception error){fail(error);}}
            @Override public void message(String text){try{JSONObject value=LanPolicy.parse(text,48000);if("signal".equals(value.optString("op")))value.put("description",LanPolicy.description(value.getJSONObject("description")));input(new JSONObject().put("type","message").put("connection",connection).put("value",value));}catch(Exception error){LanWire current=wires.get(connection);if(current!=null)current.close();}}
            @Override public void closed(String reason){
                LanWire gone=wires.remove(connection);if(gone==null)return;
                try{input(new JSONObject().put("type","closed").put("connection",connection).put("reason",reason));}
                catch(Exception error){fail(error);}
                if(!host&&"playing".equals(phase)&&epoch==generation)retryNetwork();
            }
        });wires.put(connection,wire);
        if(disposed||epoch!=generation){wires.remove(connection);wire.close();return;}wire.start();
    }
    private synchronized void retryNetwork(){
        if(disposed||resumeSecret==null||resumeEpoch!=epoch)return;
        if(retryTask!=null)retryTask.cancel(false);
        if(retryUntil==0)retryUntil=System.currentTimeMillis()+90000L;
        if(System.currentTimeMillis()>=retryUntil){stop("Reconnection timed out. Ending this run.",true);return;}
        final long generation=resumeEpoch;
        final String address=resumeAddress,secret=resumeSecret;final int port=resumePort;
        long delay=Math.min(8000L,500L<<Math.min(4,++retryCount));
        retryTask=retries.schedule(()->{
            if(disposed||epoch!=generation||resumeSecret==null)return;
            boolean local=false;for(Network network:networks())if(LanPolicy.subnet(address,network.address,network.prefix))local=true;
            if(!local){retryNetwork();return;}
            Socket socket=new Socket();connecting=socket;
            try{socket.connect(new InetSocketAddress(address,port),8000);attach(socket,false,secret,generation);}
            catch(Exception error){try{socket.close();}catch(Exception ignored){}if(epoch==generation)retryNetwork();}
            finally{if(connecting==socket)connecting=null;}
        },delay,TimeUnit.MILLISECONDS);
    }
    private static boolean owned(JSONObject profile,int species)throws Exception {JSONArray list=profile.getJSONArray("league");for(int i=0;i<list.length();i++)if(list.getInt(i)==species)return true;return false;}
    void fromGame(String channel,String json){
        if(disposed)return;
        if("cancel-find".equals(channel)){cancelFind(true);return;}
        if("leave".equals(channel)){stop("",false);return;}
        if(pending.incrementAndGet()>128){pending.decrementAndGet();return;}
        commands.execute(()->{
        try{
            if("refresh".equals(channel)){publish();return;}
            if("leave".equals(channel)){stop("",false);return;}
            JSONObject wrapper=LanPolicy.parse("{\"data\":"+json+"}",49000);Object data=wrapper.opt("data");
            if("room-return".equals(channel)){
                CoopRules.returned(profile.get(),LanPolicy.parse(current,24000),data);
                input(new JSONObject().put("type","action").put("action","return").put("data",data));return;
            }
            if(channel.matches("room-ready|room-start|room-pick|room-chat|room-settings|room-seats|room-loadout")){
                if(!phase.matches("hosting|lobby"))return;
                if("room-pick".equals(channel)){JSONObject p=profile.get();LanPolicy.require(!p.getBoolean("unfinished")&&data instanceof Number&&owned(p,((Number)data).intValue()),"Choose an owned Pokémon.");}
                if("room-chat".equals(channel))LanPolicy.require(data instanceof String&&((String)data).length()<=140,"Keep local chat under 140 characters.");
                if("room-loadout".equals(channel))data=CoopRules.loadout((JSONObject)data);
                if(channel.matches("room-settings|room-seats"))CoopRules.action(channel,data,LanPolicy.parse(current,24000));
                input(new JSONObject().put("type","action").put("action",channel.substring(5)).put("data",data));return;
            }
            if("prepared".equals(channel)){
                JSONObject state=LanPolicy.parse(current,24000),match=state.optJSONObject("match"),ticket=profile.get().optJSONObject("ticket"),lan=ticket==null?null:ticket.optJSONObject("lan");
                LanPolicy.require("preparing".equals(phase)&&match!=null&&ticket!=null&&lan!=null&&match.optString("party").equals(data)&&ticket.optString("party").equals(data)&&ticket.getLong("seed")==match.getLong("seed")&&lan.getString("me").equals(state.getString("me"))&&lan.getInt("size")==state.getJSONArray("members").length()&&!lan.getBoolean("launched"),"The LAN run has not been durably committed.");
            }else if("failed".equals(channel)){stop("The local run could not be committed or launched. Your save is preserved.",true);return;}
            else{
                if(!"playing".equals(phase)||!(data instanceof JSONObject))return;JSONObject frame=(JSONObject)data,state=LanPolicy.parse(current,24000);boolean peer=false;JSONArray members=state.getJSONArray("members");
                for(int i=0;i<members.length();i++)if(members.getJSONObject(i).optString("id").equals(frame.optString("to"))&&!state.optString("me").equals(frame.optString("to")))peer=true;
                if(!peer||!LanPolicy.frame(channel,frame.opt("payload")))return;
            }
            input(new JSONObject().put("type","game").put("channel",channel).put("data",data));
        }catch(Exception error){notice(error);if("prepared".equals(channel))fail(error);}
        finally{pending.decrementAndGet();}
    });}
    void fromBroker(String text){
        try{
            JSONObject value=LanPolicy.parse(text,48000);String type=value.optString("type");
            if("state".equals(type)){
                JSONObject state=LanPolicy.state(value.getJSONObject("value"));current=state.toString();phase=state.getString("phase");
                if("playing".equals(phase)&&state.optBoolean("linked")){
                    synchronized(this){if(retryTask!=null)retryTask.cancel(false);retryUntil=0;retryCount=0;}
                }
                discovery.advertise(state);publish();
            }
            else if("send".equals(type)){LanWire wire=wires.get(value.optString("connection"));if(wire==null)return;JSONObject message=value.getJSONObject("value");if("signal".equals(message.optString("op")))message.put("description",LanPolicy.description(message.getJSONObject("description")));wire.send(message.toString());}
            else if("reject".equals(type)){LanWire wire=wires.get(value.optString("connection"));if(wire!=null){wire.send(new JSONObject().put("op","rejected").put("reason",value.optString("reason")).toString());commands.execute(()->{try{Thread.sleep(40);}catch(InterruptedException error){Thread.currentThread().interrupt();}wire.close();});}}
            else if("terminate".equals(type))stop(value.optString("reason"),true);
            else if("frame".equals(type)&&"playing".equals(phase)&&LanPolicy.id(value.optString("peer"))&&LanPolicy.frame(value.optString("channel"),value.opt("data")))event.accept(value);
            else if("peer-closed".equals(type)||"notice".equals(type))event.accept(value);
        }catch(Exception error){fail(error);}
    }
    @Override public synchronized void close(){disposed=true;stop("",false);discovery.close();commands.shutdownNow();acceptor.shutdownNow();retries.shutdownNow();}
}
