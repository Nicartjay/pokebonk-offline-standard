package dev.nicartjay.pokebonk.offline.standard;

import org.junit.Test;
import static org.junit.Assert.*;

public final class NativeMenuActionTest {
    @Test public void recoveryWaitsForDialogDismissalAndActivityFocus() {
        for (boolean resumed : new boolean[]{false,true}) for (boolean focused : new boolean[]{false,true})
            for (boolean dialogOpen : new boolean[]{false,true}) {
                assertEquals(resumed && focused && !dialogOpen, NativeMenuAction.recoveryReady(resumed, focused, dialogOpen));
            }
    }
    @Test public void onlyExactUserClickedMainFrameActionsAreAccepted() {
        for (String action : new String[]{"check-for-updates", "export-backup", "import-backup", "report-bug"}) {
            String url = NativeMenuAction.ORIGIN + "/__native__/" + action;
            assertEquals(action, NativeMenuAction.resolve(url, "GET", true, true));
            assertNull(NativeMenuAction.resolve(url, "GET", false, true));
            assertNull(NativeMenuAction.resolve(url, "GET", true, false));
            assertNull(NativeMenuAction.resolve(url, "POST", true, true));
            for (String suffix : new String[]{"?url=https://example.invalid", "#x", "/", "/../export-backup"}) {
                assertNull(NativeMenuAction.resolve(url + suffix, "GET", true, true));
            }
        }
    }
    @Test public void arbitraryOriginsPathsAndCommandsAreNeverNativeOperations() {
        for (String url : new String[]{null, "", "https://example.invalid/__native__/check-for-updates",
            "https://appassets.androidplatform.net.evil.invalid/__native__/check-for-updates",
            "https://appassets.androidplatform.net:443/__native__/check-for-updates",
            "https://user@appassets.androidplatform.net/__native__/check-for-updates",
            NativeMenuAction.ORIGIN + "/__native__/execute",
            NativeMenuAction.ORIGIN + "/__native__/../../state.json",
            "file:///__native__/import-backup"}) {
            assertNull(NativeMenuAction.resolve(url, "GET", true, true));
        }
    }
}
