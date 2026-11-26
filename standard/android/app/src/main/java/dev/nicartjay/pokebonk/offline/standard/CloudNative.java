package dev.nicartjay.pokebonk.offline.standard;

import android.content.Intent;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;

/** Native-only fixed capabilities for the isolated cloud broker. */
final class CloudNative {
    static final int MAX=512*1024+65536, CHUNK=32*1024;
    private final MainActivity activity;
    private final NativeSaveStore saves;
    private final JSONObject config;
    private final AtomicFile auth,preferences;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Map<String,Parts> parts=new HashMap<>();
    private volatile long loginGeneration;
    private volatile String returnId;
    private volatile long returnExpires;
    private volatile boolean closed;
    private volatile HttpsURLConnection active;
    private static final class Parts {
        final String[] data;final long created=System.currentTimeMillis();
        int bytes;
        Parts(int count){data=new String[count];}
    }
    CloudNative(MainActivity activity,NativeSaveStore saves,JSONObject config){
        this.activity=activity;this.saves=saves;this.config=config;
        auth=new AtomicFile(new File(activity.getFilesDir(),"cloud-account-v1.bin"));
        preferences=new AtomicFile(new File(activity.getFilesDir(),"cloud-sync-v1.json"));
    }
    static String origin(JSONObject config){
        try{
            JSONObject cloud=config.optJSONObject("cloudSaves");
            if(cloud==null||!cloud.optBoolean("enabled"))return null;
            String value=cloud.getString("url");
            if(value.endsWith("/"))value=value.substring(0,value.length()-1);
            return value.matches("https://[a-z0-9-]+\\.[a-z0-9-]+\\.workers\\.dev")?value:null;
        }catch(Exception ignored){return null;}
    }
    static String returnLoginId(String value){
        return value!=null&&value.matches("(?:pokebonk-offline|pokebonk-offline-standard)://cloud/return/[a-f0-9]{32}")?
            value.substring(value.lastIndexOf('/')+1):null;
    }
    boolean acceptsReturn(String value){
        String id=returnLoginId(value);
        return !closed&&id!=null&&id.equals(returnId)&&returnExpires>System.currentTimeMillis();
    }
    synchronized void close(){closed=true;loginGeneration++;returnId=null;HttpsURLConnection connection=active;if(connection!=null)connection.disconnect();io.shutdownNow();parts.clear();}
    synchronized void accept(String packet){
        if(closed||packet==null||packet.length()>50000)return;
        try{
            long now=System.currentTimeMillis();
            parts.entrySet().removeIf(entry->now-entry.getValue().created>30000);
            JSONObject value=new JSONObject(packet);String id=value.getString("id");
            int count=value.getInt("total"),index=value.getInt("index");
            String data=value.getString("data");
            require(id.matches("c\\d{1,12}")&&count>0&&count<=32&&index>=0&&index<count&&
                data.length()<=45000&&data.matches("[A-Za-z0-9+/]*={0,2}"),"invalid_cloud_request");
            if(!parts.containsKey(id)){require(parts.size()<4,"cloud_busy");parts.put(id,new Parts(count));}
            Parts current=parts.get(id);
            require(current.data.length==count&&current.data[index]==null,"invalid_cloud_request");
            current.data[index]=data;current.bytes+=data.length();require(current.bytes<=MAX*2,"invalid_cloud_request");
            for(String item:current.data)if(item==null)return;
            parts.remove(id);
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            for(String item:current.data){byte[]bytes=Base64.decode(item,Base64.NO_WRAP);require(out.size()+bytes.length<=MAX,"invalid_cloud_request");out.write(bytes);}
            JSONObject command=new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            dispatch(id,command.getString("op"),command.optJSONObject("data"));
        }catch(Exception ignored){/* Malformed partial packets never gain native capabilities. */}
    }
    private void dispatch(String id,String op,JSONObject data){
        if(data==null)data=new JSONObject();final JSONObject value=data;
        if("cancel".equals(op)){loginGeneration++;returnId=null;reply(id,true,Boolean.TRUE);return;}
        if("ready".equals(op)){activity.cloudReady();reply(id,true,Boolean.TRUE);return;}
        if("feedback".equals(op)){if(value.toString().length()<=24000)activity.cloudFeedback(value);reply(id,true,Boolean.TRUE);return;}
        if("idle".equals(op)){activity.cloudIdle(allowed->reply(id,true,allowed));return;}
        if("restore".equals(op)){
            activity.cloudIdle(allowed->{
                if(!allowed){reply(id,false,"room_active");return;}
                io.execute(()->{
                    try{saves.restoreCloud(value);reply(id,true,Boolean.TRUE);activity.reloadAfterCloud();}
                    catch(Exception error){reply(id,false,code(error));}
                });
            });return;
        }
        if(!op.matches("status|configuration|preferences|save-preferences|snapshot|connect|disconnect|api")){reply(id,false,"invalid_cloud_action");return;}
        io.execute(()->{
            try{
                Object result;
                switch(op){
                    case "configuration":result=config;break;
                    case "status":result=status();break;
                    case "preferences":result=readPreferences();break;
                    case "save-preferences":write(preferences,cleanPreferences(value).toString().getBytes(StandardCharsets.UTF_8));result=Boolean.TRUE;break;
                    case "snapshot":result=saves.cloudSnapshot();break;
                    case "connect":result=connect();break;
                    case "disconnect":disconnect();result=Boolean.TRUE;break;
                    case "api":
                        String operation=value.getString("operation");
                        require(operation.matches("head|history|read|commit"),"invalid_cloud_action");
                        JSONObject session=loadSession();require(session!=null,"unauthorized");
                        result=call(operation,value.optJSONObject("value"),session.getString("token"));break;
                    default:throw new Exception("invalid_cloud_action");
                }
                reply(id,true,result);
            }catch(Exception error){reply(id,false,code(error));}
        });
    }
    private static void require(boolean ok,String code)throws Exception{if(!ok)throw new Exception(code);}
    private static String code(Exception error){String value=error.getMessage();return value!=null&&value.matches("[a-z_]{1,64}")?value:"cloud_unavailable";}
    static long loginRetryDelay(int consecutiveFailures){
        return consecutiveFailures>=1&&consecutiveFailures<=3?1000L<<(consecutiveFailures-1):-1;
    }
    static boolean transientLoginStatus(int status){return status>=500&&status<=599;}
    private void reply(String id,boolean ok,Object value){
        try{
            JSONObject response=new JSONObject().put("ok",ok).put(ok?"value":"error",value==null?JSONObject.NULL:value);
            byte[] bytes=response.toString().getBytes(StandardCharsets.UTF_8);
            if(bytes.length>MAX)bytes=new JSONObject().put("ok",false).put("error","cloud_save_too_large").toString().getBytes(StandardCharsets.UTF_8);
            int count=(bytes.length+CHUNK-1)/CHUNK;
            for(int index=0;index<count;index++){
                int start=index*CHUNK,length=Math.min(CHUNK,bytes.length-start);
                activity.cloudReply(id,index,count,Base64.encodeToString(bytes,start,length,Base64.NO_WRAP));
            }
        }catch(Exception ignored){/* Shutdown/lost broker never affects local progression. */}
    }
    private SecretKey key()throws Exception{
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);
        String alias=activity.getPackageName()+".cloud-auth-v1";
        if(!keys.containsAlias(alias)){
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey)keys.getKey(alias,null);
    }
    private JSONObject loadSession()throws Exception{
        if(!auth.getBaseFile().exists()&&!new File(auth.getBaseFile()+".bak").exists())return null;
        try{
            byte[] bytes=auth.readFully();require(bytes.length>12&&bytes.length<=8192,"secure_storage_unavailable");
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,bytes,0,12));
            cipher.updateAAD((activity.getPackageName()+":cloud-auth-v1").getBytes(StandardCharsets.UTF_8));
            JSONObject value=new JSONObject(new String(cipher.doFinal(bytes,12,bytes.length-12),StandardCharsets.UTF_8));
            if(!String.valueOf(origin(config)).equals(value.optString("origin"))||
                value.optLong("expiresAt")<=System.currentTimeMillis())return null;
            require(validSession(value),"secure_storage_unavailable");return value;
        }catch(Exception error){throw new Exception("secure_storage_unavailable");}
    }
    private static boolean validSession(JSONObject value){
        String account=value.optString("accountId");
        return account.matches("[a-f0-9]{64}")&&value.optString("accountLabel").length()<=120&&
            value.optString("token").matches(account+"\\.[A-Za-z0-9_-]{43}\\.\\d{13}\\.[a-f0-9]{64}");
    }
    private void saveSession(JSONObject value)throws Exception{
        try{
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
            cipher.updateAAD((activity.getPackageName()+":cloud-auth-v1").getBytes(StandardCharsets.UTF_8));
            byte[] encrypted=cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)),iv=cipher.getIV();
            require(iv.length==12,"secure_storage_unavailable");byte[]bytes=new byte[iv.length+encrypted.length];
            System.arraycopy(iv,0,bytes,0,iv.length);System.arraycopy(encrypted,0,bytes,iv.length,encrypted.length);write(auth,bytes);
        }catch(Exception error){throw new Exception("secure_storage_unavailable");}
    }
    private Object status()throws Exception{
        JSONObject value=loadSession();
        return value==null?JSONObject.NULL:new JSONObject().put("accountId",value.getString("accountId")).put("accountLabel",value.getString("accountLabel"));
    }
    private JSONObject call(String route,JSONObject data,String token)throws Exception{
        String endpoint=origin(config);require(endpoint!=null,"not_configured");
        require(route.matches("login/start|login/poll|head|history|read|commit|logout"),"invalid_cloud_action");
        HttpsURLConnection connection=null;
        try{
            connection=(HttpsURLConnection)new URL(endpoint+"/v1/"+route).openConnection();active=connection;
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(20000);
            connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");
            if(token!=null)connection.setRequestProperty("Authorization","Bearer "+token);
            byte[]body=(data==null?"{}":data.toString()).getBytes(StandardCharsets.UTF_8);
            require(body.length<=MAX,"cloud_save_too_large");connection.setFixedLengthStreamingMode(body.length);
            try(java.io.OutputStream stream=connection.getOutputStream()){stream.write(body);}
            int status=connection.getResponseCode();require(status<300||status>=400,"invalid_cloud_response");
            if(transientLoginStatus(status))throw new CloudFailure("cloud_unavailable",true);
            InputStream input=status>=200&&status<300?connection.getInputStream():connection.getErrorStream();
            require(input!=null,"network");byte[]bytes;
            try(InputStream stream=input){bytes=MainActivity.readBounded(stream,MAX);}
            JSONObject value;
            try{value=new JSONObject(new String(bytes,StandardCharsets.UTF_8));}
            catch(org.json.JSONException error){throw new CloudFailure("invalid_cloud_response");}
            if(status<200||status>=300){String error=value.optString("error");throw new CloudFailure(error.matches("[a-z_]{1,64}")?error:"cloud_unavailable");}
            return value;
        }catch(CloudFailure error){throw error;}
        catch(javax.net.ssl.SSLHandshakeException|javax.net.ssl.SSLPeerUnverifiedException error){throw new CloudFailure("secure_connection_failed");}
        catch(Exception error){String value=error.getMessage();if(value!=null&&value.matches("invalid_cloud_.*|cloud_save_too_large"))throw error;throw new CloudFailure("network",true);}
        finally{if(connection!=null)connection.disconnect();active=null;}
    }
    private static final class CloudFailure extends Exception {
        private static final long serialVersionUID=1L;
        final boolean retryable;
        CloudFailure(String code){this(code,false);}
        CloudFailure(String code,boolean retryable){super(code);this.retryable=retryable;}
    }
    private JSONObject connect()throws Exception{
        returnId=null;
        key();final long generation=++loginGeneration;
        byte[]random=new byte[32];new SecureRandom().nextBytes(random);
        String verifier=Base64.encodeToString(random,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
        JSONObject login=call("login/start",new JSONObject().put("clientPlatform","android").put("challenge",RepositoryUpdater.hex(
            MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.UTF_8)))),null);
        String id=login.getString("id");long expires=login.getLong("expiresAt");
        require(id.matches("[a-f0-9]{32}")&&expires>System.currentTimeMillis()&&expires<=System.currentTimeMillis()+660000,"invalid_cloud_response");
        require(generation==loginGeneration&&!closed,"cancelled");
        returnId=id;returnExpires=expires;
        activity.cloudFeedback(new JSONObject().put("state","connecting").put("connected",false).put("automatic",false)
            .put("loginCode",id.substring(0,8).toUpperCase(java.util.Locale.ROOT)).put("open",true));
        CountDownLatch opened=new CountDownLatch(1);AtomicReference<Exception>failed=new AtomicReference<>();
        activity.runOnUiThread(()->{
            try{activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(origin(config)+"/auth/start/"+id)).addCategory(Intent.CATEGORY_BROWSABLE));}
            catch(Exception error){failed.set(error);}finally{opened.countDown();}
        });
        require(opened.await(5,TimeUnit.SECONDS)&&failed.get()==null,"browser_unavailable");
        int failures=0;
        while(System.currentTimeMillis()<expires){
            require(generation==loginGeneration&&!closed,"cancelled");Thread.sleep(2500);
            require(generation==loginGeneration&&!closed,"cancelled");
            JSONObject result;
            try{
                result=call("login/poll",new JSONObject().put("id",id).put("verifier",verifier),null);failures=0;
            }catch(CloudFailure error){
                // Retry only the idempotent proof poll for this same login.
                // Do not open another browser, create another session or
                // replay saves/commits/security errors/quota rejections.
                long delay=error.retryable?loginRetryDelay(++failures):-1;
                if(delay<0)throw error;
                require(generation==loginGeneration&&!closed,"cancelled");
                require(System.currentTimeMillis()+delay<expires,"login_expired");
                activity.cloudFeedback(new JSONObject().put("state","connecting").put("connected",false).put("automatic",false)
                    .put("reason","retrying_sign_in").put("loginCode",id.substring(0,8).toUpperCase(java.util.Locale.ROOT)).put("open",true));
                Thread.sleep(delay);continue;
            }
            if(result.optBoolean("pending"))continue;
            require(validSession(result)&&result.getLong("expiresAt")>System.currentTimeMillis(),"invalid_cloud_response");
            if(generation!=loginGeneration||closed){call("logout",new JSONObject(),result.getString("token"));throw new Exception("cancelled");}
            result.put("origin",origin(config));saveSession(result);
            if(generation!=loginGeneration||closed){auth.delete();call("logout",new JSONObject(),result.getString("token"));throw new Exception("cancelled");}
            return new JSONObject().put("accountId",result.getString("accountId")).put("accountLabel",result.getString("accountLabel"));
        }
        throw new Exception("login_expired");
    }
    private void disconnect()throws Exception{
        loginGeneration++;returnId=null;JSONObject session=null;
        try{session=loadSession();}catch(Exception ignored){}
        auth.delete();
        if(session!=null)try{call("logout",new JSONObject(),session.getString("token"));}catch(Exception ignored){}
    }
    private static JSONObject cleanPreferences(JSONObject value)throws Exception{
        JSONObject out=new JSONObject().put("automatic",value.optBoolean("automatic",false));
        for(String name:new String[]{"accountId","baseHash"})if(value.optString(name).matches("[a-f0-9]{64}"))out.put(name,value.getString(name));
        if(value.optString("base").matches("[a-f0-9]{32}"))out.put("base",value.getString("base"));
        if(value.opt("syncedAt") instanceof Number&&value.getLong("syncedAt")>=0)out.put("syncedAt",value.getLong("syncedAt"));
        return out;
    }
    private JSONObject readPreferences()throws Exception{
        try{byte[]bytes=preferences.readFully();require(bytes.length<=4096,"invalid_preferences");return cleanPreferences(new JSONObject(new String(bytes,StandardCharsets.UTF_8)));}
        catch(Exception ignored){return new JSONObject().put("automatic",false);}
    }
    private static void write(AtomicFile file,byte[]bytes)throws Exception{
        FileOutputStream stream=null;
        try{stream=file.startWrite();stream.write(bytes);stream.getFD().sync();file.finishWrite(stream);}
        catch(Exception error){if(stream!=null)file.failWrite(stream);throw error;}
    }
}
