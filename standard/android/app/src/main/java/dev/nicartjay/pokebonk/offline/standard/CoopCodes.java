package dev.nicartjay.pokebonk.offline.standard;

import java.util.Locale;

/** Public room lookup codes. Never derived from a pairing/TURN credential. */
final class CoopCodes {
    static int length(String mode) {
        if ("lan".equals(mode)) return 4;
        if ("stun-only".equals(mode) || "turn-fallback".equals(mode)) return 6;
        throw new IllegalArgumentException("Invalid co-op connection mode.");
    }
    static boolean valid(String code,String mode) {
        return code!=null&&code.matches("[A-Z0-9]{"+length(mode)+"}");
    }
    static String lan(String hostId) {
        if(hostId==null||!hostId.matches("lan-[\\w-]{1,80}"))throw new IllegalArgumentException("Invalid LAN host identity.");
        int hash=0x811c9dc5;
        for(int i=0;i<hostId.length();i++)hash=(hash^hostId.charAt(i))*16777619;
        String code=Long.toString(Integer.toUnsignedLong(hash)%1679616,36).toUpperCase(Locale.ROOT);
        return "0000".substring(code.length())+code;
    }
    private CoopCodes() {}
}
