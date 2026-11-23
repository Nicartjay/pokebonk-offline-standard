package dev.nicartjay.pokebonk.offline.standard;

/** Fixed user-clicked UI actions only. Never accepts a destination or a path. */
final class NativeMenuAction {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String PREFIX = ORIGIN + "/__native__/";
    static boolean reserved(String url) {
        return url != null && url.startsWith(PREFIX);
    }
    static String resolve(String url, String method, boolean mainFrame, boolean gesture) {
        if (!mainFrame || !gesture || !"GET".equals(method) || !reserved(url)) return null;
        for (String action : new String[]{"check-for-updates", "export-backup", "import-backup", "report-bug"}) {
            if ((PREFIX + action).equals(url)) return action;
        }
        return null;
    }
    static boolean recoveryReady(boolean resumed, boolean focused, boolean dialogOpen) {
        return resumed && focused && !dialogOpen;
    }
    private NativeMenuAction() {}
}
