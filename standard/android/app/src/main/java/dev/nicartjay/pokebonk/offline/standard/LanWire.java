package dev.nicartjay.pokebonk.offline.standard;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Native TCP pairing/signaling only. Wire-compatible with desktop lan-wire.mjs. */
final class LanWire implements AutoCloseable {
    interface Listener { void open(); void message(String text); void closed(String reason); }
    private static final int MAX=48*1024;
    private final Socket socket;
    private final boolean host;
    private final String identity;
    private final byte[] secret;
    private final Listener listener;
    private final AtomicBoolean ended=new AtomicBoolean();
    private final ArrayBlockingQueue<String> output=new ArrayBlockingQueue<>(32);
    private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor();
    private final Thread reader;
    private Thread writer;
    private byte[] hostNonce,clientNonce,sendKey,receiveKey;
    private long tx,rx;
    private volatile boolean ready;
    LanWire(Socket socket,boolean host,String identity,String secret,Listener listener) throws Exception {
        if(!secret.matches("[a-f0-9]{32}")||identity.getBytes(StandardCharsets.UTF_8).length>1024)throw new IOException("Invalid local pairing identity.");
        this.socket=socket;this.host=host;this.identity=identity;this.listener=listener;this.secret=new byte[16];
        for(int i=0;i<16;i++)this.secret[i]=(byte)Integer.parseInt(secret.substring(i*2,i*2+2),16);
        socket.setTcpNoDelay(true);socket.setSoTimeout(10000);
        reader=new Thread(this::read,"pokebonk-lan-pair");reader.setDaemon(true);
    }
    void start(){reader.start();}
    private static byte[] join(byte[]...parts) {
        int n=0;for(byte[]p:parts)n+=p.length;byte[] result=new byte[n];int i=0;
        for(byte[]p:parts){System.arraycopy(p,0,result,i,p.length);i+=p.length;}return result;
    }
    private static byte[] text(String value){return value.getBytes(StandardCharsets.UTF_8);}
    private static byte[] mac(byte[]key,byte[]...parts)throws Exception {
        Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));for(byte[]part:parts)mac.update(part);return mac.doFinal();
    }
    private static byte[] nonce(){byte[]value=new byte[16];new SecureRandom().nextBytes(value);return value;}
    private byte[] proof(String label)throws Exception{return mac(secret,text(label),text(identity),hostNonce,clientNonce);}
    private void packet(DataOutputStream out,byte[]value)throws Exception {
        if(value.length<1||value.length>MAX)throw new IOException("Invalid local packet size.");
        out.writeInt(value.length);out.write(value);out.flush();
    }
    private byte[] packet(DataInputStream in)throws Exception {
        int n=in.readInt();if(n<1||n>MAX)throw new IOException("Invalid local packet size.");byte[]value=new byte[n];in.readFully(value);return value;
    }
    private static byte[] slice(byte[]value,int from,int to){return Arrays.copyOfRange(value,from,to);}
    private void require(boolean condition,String reason)throws IOException{if(!condition)throw new IOException(reason);}
    private void read() {
        try {
            DataInputStream in=new DataInputStream(socket.getInputStream());DataOutputStream out=new DataOutputStream(socket.getOutputStream());
            if(host){
                hostNonce=nonce();byte[]id=text(identity);
                packet(out,join(new byte[]{1},hostNonce,ByteBuffer.allocate(2).putShort((short)id.length).array(),id));
                byte[]auth=packet(in);require(auth.length==49&&auth[0]==2,"Invalid pairing response.");
                clientNonce=slice(auth,1,17);require(MessageDigest.isEqual(slice(auth,17,49),proof("client")),"Incorrect pairing key.");
                packet(out,join(new byte[]{3},proof("server")));
            }else{
                byte[]hello=packet(in),id=text(identity);
                require(hello.length==19+id.length&&hello[0]==1&&ByteBuffer.wrap(hello,17,2).getShort()==id.length&&
                    MessageDigest.isEqual(slice(hello,19,hello.length),id),"Different app/game builds. Install the same LAN build on both devices.");
                hostNonce=slice(hello,1,17);clientNonce=nonce();packet(out,join(new byte[]{2},clientNonce,proof("client")));
                byte[]accept=packet(in);require(accept.length==33&&accept[0]==3&&MessageDigest.isEqual(slice(accept,1,33),proof("server")),"The host did not prove its pairing identity.");
            }
            byte[]master=proof("key");sendKey=mac(master,text(host?"host":"client"));receiveKey=mac(master,text(host?"client":"host"));
            socket.setSoTimeout(15000);ready=true;
            writer=new Thread(()->write(out),"pokebonk-lan-send");writer.setDaemon(true);writer.start();
            clock.scheduleAtFixedRate(()->send("{\"op\":\"ping\"}"),3,3,TimeUnit.SECONDS);listener.open();
            while(!ended.get()){
                byte[]bytes=packet(in);require(bytes.length>=25&&bytes[0]==4&&ByteBuffer.wrap(bytes,1,8).getLong()==rx+1,"Invalid or replayed local message.");
                byte[]iv=new byte[12];System.arraycopy(bytes,1,iv,4,8);
                Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(receiveKey,"AES"),new GCMParameterSpec(128,iv));cipher.updateAAD(text(identity));
                String value=new String(cipher.doFinal(slice(bytes,9,bytes.length)),StandardCharsets.UTF_8);rx++;
                if(!"{\"op\":\"ping\"}".equals(value))listener.message(value);
            }
        }catch(Exception error){stop(error.getMessage()==null?"The local connection closed.":error.getMessage());}
    }
    private void write(DataOutputStream out){
        try{while(!ended.get()){
            byte[]plain=text(output.take());byte[]iv=ByteBuffer.allocate(12).putInt(0).putLong(++tx).array();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(sendKey,"AES"),new GCMParameterSpec(128,iv));cipher.updateAAD(text(identity));
            packet(out,join(new byte[]{4},slice(iv,4,12),cipher.doFinal(plain)));
        }}catch(Exception error){if(!ended.get())stop("The local signaling connection stopped.");}
    }
    boolean send(String text){
        if(!ready||ended.get())return false;
        if(text==null||text.getBytes(StandardCharsets.UTF_8).length>MAX-64||!output.offer(text)){stop("Local signaling queue exceeded its limit.");return false;}return true;
    }
    private void stop(String reason){
        if(!ended.compareAndSet(false,true))return;ready=false;clock.shutdownNow();output.clear();
        try{socket.close();}catch(IOException ignored){}if(writer!=null)writer.interrupt();reader.interrupt();listener.closed(reason);
    }
    @Override public void close(){stop("The local connection closed.");}
}
