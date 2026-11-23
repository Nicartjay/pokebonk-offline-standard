package dev.nicartjay.pokebonk.offline.standard;

/** Pure validation for the native-only, link-scoped discovery protocol. */
final class LanDiscoveryPolicy {
    static final String GROUP="239.255.80.66",MAGIC="PBLAND1";
    static final int PORT=48124,MAX_BYTES=1400,SEARCH_MS=4000;
    static boolean nonce(String value){return value!=null&&value.matches("[a-f0-9]{32}");}
    static boolean room(String remote,String invite,String id,String name,int count){
        if(!LanPolicy.privateAddress(remote)||!LanPolicy.id(id)||name==null||name.length()>24||
            name.matches("(?s).*[\\x00-\\x1f\\x7f].*")||count<1||count>=4||invite==null||
            !invite.matches("[\\d.]+:\\d{1,5}#[a-f0-9]{32}"))return false;
        int colon=invite.indexOf(':'),hash=invite.indexOf('#');
        try{int port=Integer.parseInt(invite.substring(colon+1,hash));
            return remote.equals(invite.substring(0,colon))&&port>=1024&&port<=65535;
        }catch(NumberFormatException error){return false;}
    }
    private LanDiscoveryPolicy(){}
}
