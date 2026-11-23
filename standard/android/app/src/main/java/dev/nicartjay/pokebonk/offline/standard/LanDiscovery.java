package dev.nicartjay.pokebonk.offline.standard;

import android.content.Context;
import android.net.wifi.WifiManager;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.json.JSONObject;

/** UDP multicast questions, unicast answers; no address sweep or public service. */
final class LanDiscovery implements AutoCloseable {
    private final String identity;
    private final WifiManager.MulticastLock wifiLock;
    private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor();
    private final Map<String,Long> replies=new HashMap<>();
    private MulticastSocket host;
    private DatagramSocket search;
    private JSONObject room;
    private ScheduledFuture<?> deadline,repeat1,repeat2;
    private boolean disposed;
    LanDiscovery(Context context,String identity){
        this.identity=identity;
        WifiManager wifi=context.getApplicationContext().getSystemService(WifiManager.class);
        wifiLock=wifi==null?null:wifi.createMulticastLock("pokebonk-local-rooms");
        if(wifiLock!=null)wifiLock.setReferenceCounted(false);
    }
    private void lock(){if(wifiLock!=null&&!wifiLock.isHeld())wifiLock.acquire();}
    private void unlock(){if(wifiLock!=null&&wifiLock.isHeld())wifiLock.release();}
    synchronized void advertise(JSONObject state){
        try{
            JSONObject next=null;
            if(state!=null&&"host".equals(state.optString("role"))&&state.optString("phase").matches("hosting|lobby")){
                int count=state.getJSONArray("members").length();String me=state.optString("me"),invite=state.optString("invitation");
                for(int i=0;i<count;i++){JSONObject member=state.getJSONArray("members").getJSONObject(i);
                    if(me.equals(member.optString("id"))&&invite.contains(":")&&
                        LanDiscoveryPolicy.room(invite.substring(0,invite.indexOf(':')),invite,me,member.optString("name"),count))
                        next=new JSONObject().put("id",me).put("name",member.getString("name")).put("count",count).put("invitation",invite);
                }
            }
            room=next;
            if(next==null){if(host!=null)host.close();host=null;replies.clear();unlock();return;}
            if(host!=null||disposed)return;
            MulticastSocket socket=new MulticastSocket(null);host=socket;
            try{
                socket.setReuseAddress(true);socket.bind(new InetSocketAddress(LanDiscoveryPolicy.PORT));socket.setTimeToLive(1);
                lock();int joined=0;
                for(LanNetwork.Network n:LanNetwork.networks())try{
                    NetworkInterface ni=NetworkInterface.getByInetAddress(InetAddress.getByName(n.address));
                    socket.joinGroup(new InetSocketAddress(LanDiscoveryPolicy.GROUP,LanDiscoveryPolicy.PORT),ni);joined++;
                }catch(Exception ignored){}
                if(joined==0)throw new java.io.IOException("Local multicast is unavailable.");
                Thread listener=new Thread(()->listenHost(socket),"pokebonk-room-discovery");listener.setDaemon(true);listener.start();
            }catch(Exception error){socket.close();if(host==socket)host=null;unlock();}
        }catch(Exception ignored){/* Hosting and manual invitations remain available. */}
    }
    private void listenHost(MulticastSocket socket){
        byte[] bytes=new byte[LanDiscoveryPolicy.MAX_BYTES+1];
        try{while(!socket.isClosed()){
            DatagramPacket packet=new DatagramPacket(bytes,bytes.length);socket.receive(packet);reply(socket,packet);
        }}catch(Exception ignored){/* close() releases a blocked receive. */}
    }
    private synchronized void reply(MulticastSocket socket,DatagramPacket packet){
        try{
            if(host!=socket||room==null||packet.getLength()>LanDiscoveryPolicy.MAX_BYTES||packet.getPort()<1024)return;
            JSONObject query=LanPolicy.parse(new String(packet.getData(),packet.getOffset(),packet.getLength(),StandardCharsets.UTF_8),LanDiscoveryPolicy.MAX_BYTES);
            if(!LanDiscoveryPolicy.MAGIC.equals(query.optString("magic"))||!"find".equals(query.optString("op"))||
                !identity.equals(query.optString("identity"))||!LanDiscoveryPolicy.nonce(query.optString("nonce")))return;
            String address=room.getString("invitation").split(":")[0],remote=packet.getAddress().getHostAddress();boolean local=false;
            for(LanNetwork.Network n:LanNetwork.networks())if(n.address.equals(address)&&LanPolicy.subnet(remote,address,n.prefix))local=true;
            if(!local)return;
            long now=System.currentTimeMillis();if(now-replies.getOrDefault(remote,0L)<500)return;
            replies.entrySet().removeIf(e->now-e.getValue()>5000);
            if(replies.size()>=64&&!replies.containsKey(remote))return;replies.put(remote,now);
            JSONObject answer=new JSONObject(room.toString()).put("magic",LanDiscoveryPolicy.MAGIC).put("op","room")
                .put("identity",identity).put("nonce",query.getString("nonce"));
            byte[] out=answer.toString().getBytes(StandardCharsets.UTF_8);
            socket.send(new DatagramPacket(out,out.length,packet.getAddress(),packet.getPort()));
        }catch(Exception ignored){/* Invalid or unavailable peers are not game errors. */}
    }
    synchronized void find(Consumer<Integer> progress,Consumer<List<JSONObject>> done,Consumer<String> error){
        cancel();if(disposed)return;
        try{
            MulticastSocket socket=new MulticastSocket();search=socket;socket.setTimeToLive(1);
            String nonce=UUID.randomUUID().toString().replace("-","");Map<String,JSONObject> rooms=new HashMap<>();
            byte[] query=new JSONObject().put("magic",LanDiscoveryPolicy.MAGIC).put("op","find")
                .put("identity",identity).put("nonce",nonce).toString().getBytes(StandardCharsets.UTF_8);
            Runnable send=()->{
                synchronized(LanDiscovery.this){
                    if(search!=socket)return;
                    for(LanNetwork.Network n:LanNetwork.networks())try{
                        socket.setNetworkInterface(NetworkInterface.getByInetAddress(InetAddress.getByName(n.address)));
                        socket.send(new DatagramPacket(query,query.length,InetAddress.getByName(LanDiscoveryPolicy.GROUP),LanDiscoveryPolicy.PORT));
                    }catch(Exception ignored){}
                }
            };
            Thread listener=new Thread(()->{
                byte[] bytes=new byte[LanDiscoveryPolicy.MAX_BYTES+1];
                try{while(!socket.isClosed()){
                    DatagramPacket packet=new DatagramPacket(bytes,bytes.length);socket.receive(packet);
                    synchronized(LanDiscovery.this){
                        if(search!=socket||packet.getLength()>LanDiscoveryPolicy.MAX_BYTES)continue;
                        try{
                            JSONObject value=LanPolicy.parse(new String(bytes,packet.getOffset(),packet.getLength(),StandardCharsets.UTF_8),LanDiscoveryPolicy.MAX_BYTES);
                            String remote=packet.getAddress().getHostAddress();boolean local=false;
                            for(LanNetwork.Network n:LanNetwork.networks())if(LanPolicy.subnet(remote,n.address,n.prefix))local=true;
                            Object count=value.opt("count");
                            if(!local||!LanDiscoveryPolicy.MAGIC.equals(value.optString("magic"))||!"room".equals(value.optString("op"))||
                                !identity.equals(value.optString("identity"))||!nonce.equals(value.optString("nonce"))||
                                !(count instanceof Integer)||!LanDiscoveryPolicy.room(remote,value.optString("invitation"),
                                value.optString("id"),value.optString("name"),(Integer)count))continue;
                            if(rooms.size()>=32&&!rooms.containsKey(value.getString("id")))continue;
                            rooms.put(value.getString("id"),value);progress.accept(rooms.size());
                        }catch(Exception ignored){}
                    }
                }}catch(Exception ignored){/* Cancel/timeout closes the receive socket. */}
            },"pokebonk-find-room");listener.setDaemon(true);listener.start();
            clock.execute(send);repeat1=clock.schedule(send,800,TimeUnit.MILLISECONDS);repeat2=clock.schedule(send,1800,TimeUnit.MILLISECONDS);
            deadline=clock.schedule(()->{
                List<JSONObject> found;
                synchronized(LanDiscovery.this){
                    if(search!=socket)return;
                    found=new ArrayList<>(rooms.values());cancel();
                    found.sort(Comparator.<JSONObject>comparingInt(r->-r.optInt("count")).thenComparing(r->r.optString("id")));
                }
                done.accept(found);
            },LanDiscoveryPolicy.SEARCH_MS,TimeUnit.MILLISECONDS);
        }catch(Exception failure){cancel();error.accept("Local discovery is unavailable. Use a host invitation instead.");}
    }
    synchronized void cancel(){
        if(search!=null)search.close();search=null;
        if(deadline!=null)deadline.cancel(false);if(repeat1!=null)repeat1.cancel(false);if(repeat2!=null)repeat2.cancel(false);
        deadline=null;repeat1=null;repeat2=null;
    }
    @Override public synchronized void close(){disposed=true;cancel();advertise(null);clock.shutdownNow();}
}
