package dev.nicartjay.pokebonk.offline.standard;
import java.net.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
public final class LanWirePeer {
  public static void main(String[] args)throws Exception{
    ServerSocket server=null;Socket socket;
    if("server".equals(args[0])){server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"));System.out.println("PORT "+server.getLocalPort());System.out.flush();socket=server.accept();}
    else socket=new Socket("127.0.0.1",Integer.parseInt(args[1]));
    CountDownLatch done=new CountDownLatch(1);AtomicReference<LanWire> ref=new AtomicReference<>();
    LanWire wire=new LanWire(socket,"server".equals(args[0]),args[3],args[2],new LanWire.Listener(){
      public void open(){ref.get().send("{\"op\":\"java\"}");}
      public void message(String text){if(text.contains("\"op\":\"node\""))ref.get().send("{\"op\":\"ack\"}");if(text.contains("\"op\":\"done\""))done.countDown();}
      public void closed(String reason){done.countDown();}
    });ref.set(wire);wire.start();
    if(!done.await(15,TimeUnit.SECONDS))throw new Exception("Interop timeout");wire.close();if(server!=null)server.close();
  }
}
