package dev.nicartjay.pokebonk.offline.standard;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.RoundedCorner;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressWarnings("deprecation")
public final class MainActivity extends Activity {
    private static final int IMPORT = 1101, EXPORT = 1102, WEB_FILE = 1103;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private TextView menu;
    private WebView web;
    private GameSafeArea safeArea;
    private NativeSaveStore saves;
    private RepositoryUpdater updater;
    private boolean resumed, dialogOpen;
    private byte[] pendingExport;
    private ValueCallback<Uri[]> fileCallback;
    private static final String IDLE = "!globalThis.PokeBonkNativeApp?.run && Boolean(document.querySelector('.offline-menu,.offline-card,.offline-boot-error'))";
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (resumed && hasWindowFocus() && web != null) web.evaluateJavascript(IDLE, value -> {
                boolean idle = "true".equals(value);
                menu.setVisibility(idle ? View.VISIBLE : View.GONE);
                if (idle && !dialogOpen) presentUpdate();
            });
            handler.postDelayed(this, 2000);
        }
    };
    @Override @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            JSONObject config;
            try (InputStream input = getAssets().open("standard-config.json")) {
                config = new JSONObject(new String(readBounded(input, 256 * 1024), StandardCharsets.UTF_8));
            }
            saves = new NativeSaveStore(this, config);
            updater = new RepositoryUpdater(this, saves, config);
        } catch (Exception error) { throw new IllegalStateException("Bundled Standard configuration is missing.", error); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowContentAccess(false); settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true); settings.setSafeBrowsingEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true); settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false); settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(false);
        web.addJavascriptInterface(new StorageBridge(), "PokeBonkStandardAndroid");
        web.setWebViewClient(new OfflineAssetWebViewClient(getAssets(), () -> applySafeArea(root.getRootWindowInsets())));
        web.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) publishSafeArea();
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"), WEB_FILE);
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, size) ->
            Toast.makeText(this, "Use the native ⋮ menu → Export backup.", Toast.LENGTH_LONG).show());
        root = new FrameLayout(this); root.setBackgroundColor(Color.BLACK);
        // Match the game's physical canvas coordinates regardless of the
        // Android locale. Native dialogs still use the system layout direction.
        root.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        menu = new TextView(this); menu.setText("⋮"); menu.setTextSize(26); menu.setTextColor(Color.WHITE);
        menu.setBackgroundColor(0xAA231C37); menu.setGravity(Gravity.CENTER); menu.setContentDescription("PokéBonk Offline app menu");
        // Physical right matches the game's CSS coordinates, including on an
        // RTL device. Never put this native button in a cutout/rounded corner.
        FrameLayout.LayoutParams position = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.END);
        menu.setVisibility(View.GONE); menu.setOnClickListener(view -> whenIdle(this::showNativeMenu));
        root.addView(menu, position);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            applySafeArea(insets);
            return insets;
        });
        setContentView(root);
        applySafeArea(root.getRootWindowInsets());
        if (Build.VERSION.SDK_INT >= 33) registerBack();
        // Always bootstrap from native disk, not a WebView history restoration.
        web.loadUrl(OfflineAssetWebViewClient.APP_ORIGIN + "/index.html?lang=en");
        handler.post(poll);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void applySafeArea(WindowInsets insets) {
        int[] blocked = new int[4], radii = new int[4];
        if (insets != null) {
            blocked = new int[]{insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()};
            if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                android.view.DisplayCutout cutout = insets.getDisplayCutout();
                int[] cutouts = {cutout.getSafeInsetLeft(), cutout.getSafeInsetTop(), cutout.getSafeInsetRight(), cutout.getSafeInsetBottom()};
                for (int i = 0; i < 4; i++) blocked[i] = Math.max(blocked[i], cutouts[i]);
            }
            if (Build.VERSION.SDK_INT >= 29) {
                Insets gestures = insets.getMandatorySystemGestureInsets();
                int[] edges = {gestures.left, gestures.top, gestures.right, gestures.bottom};
                for (int i = 0; i < 4; i++) blocked[i] = Math.max(blocked[i], edges[i]);
            }
            if (Build.VERSION.SDK_INT >= 31) {
                int[] corners = {RoundedCorner.POSITION_TOP_LEFT, RoundedCorner.POSITION_TOP_RIGHT,
                    RoundedCorner.POSITION_BOTTOM_RIGHT, RoundedCorner.POSITION_BOTTOM_LEFT};
                for (int i = 0; i < 4; i++) {
                    RoundedCorner corner = insets.getRoundedCorner(corners[i]);
                    radii[i] = corner == null ? 0 : corner.getRadius();
                }
            }
        }
        safeArea = GameSafeArea.calculate(dp(GameSafeArea.MINIMUM_DP), dp(GameSafeArea.GAP_DP), blocked, radii);
        FrameLayout.LayoutParams position = (FrameLayout.LayoutParams) menu.getLayoutParams();
        position.topMargin = safeArea.top + dp(GameSafeArea.MENU_GAP_DP);
        position.setMarginEnd(safeArea.right + dp(GameSafeArea.MENU_GAP_DP));
        menu.setLayoutParams(position);
        publishSafeArea();
    }
    private void publishSafeArea() {
        if (safeArea == null || web == null || web.getWidth() <= 0 || web.getHeight() <= 0) return;
        // One-way numeric presentation metadata, not an additional JS bridge.
        // The renderer still has exactly two callable native storage methods.
        web.evaluateJavascript("dispatchEvent(new CustomEvent('standard:android-insets',{detail:{left:" + safeArea.left +
            ",top:" + safeArea.top + ",right:" + safeArea.right + ",bottom:" + safeArea.bottom +
            ",menuSize:" + dp(48) + ",menuGap:" + dp(GameSafeArea.MENU_GAP_DP) +
            ",width:" + web.getWidth() + ",height:" + web.getHeight() + "}}))", null);
    }
    @SuppressLint("NewApi")
    private void registerBack() { getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back); }
    @Override @SuppressLint("GestureBackNavigation") public void onBackPressed() { back(); }
    private void back() {
        web.evaluateJavascript("if(globalThis.PokeBonkNativeApp?.run?.state==='play')globalThis.PokeBonkNativeApp.run.pause()", null);
        if (dialogOpen) return;
        showDialog(new AlertDialog.Builder(this).setTitle(R.string.exit_dialog_title)
            .setMessage(R.string.exit_dialog_message)
            .setNegativeButton("Keep playing", null).setPositiveButton(R.string.exit_dialog_confirm, (dialog, which) -> finishAndRemoveTask()));
    }
    void whenIdle(Runnable action) {
        if (isFinishing() || isDestroyed() || !resumed || !hasWindowFocus()) return;
        web.evaluateJavascript(IDLE, value -> { if ("true".equals(value) && !isFinishing() && resumed) action.run(); });
    }
    private void showDialog(AlertDialog.Builder builder) {
        if (isFinishing() || isDestroyed() || dialogOpen) return;
        dialogOpen = true;
        AlertDialog dialog = builder.create();
        dialog.setOnDismissListener(ignored -> { dialogOpen = false; hideBars(); });
        dialog.show();
    }
    private void showNativeMenu() {
        showDialog(new AlertDialog.Builder(this).setTitle(getString(R.string.app_name))
            .setItems(new String[]{"Check for updates", "Export backup", "Import backup"}, (dialog, which) -> {
                if (which == 0) updater.check(true);
                if (which == 1) exportSave();
                if (which == 2) startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"), IMPORT);
            }).setNegativeButton("Close", null));
    }
    private void presentUpdate() {
        String event = updater.takeEvent();
        if (event == null) return;
        if ("message".equals(event)) showDialog(new AlertDialog.Builder(this).setTitle("PokéBonk Offline updates").setMessage(updater.message()).setPositiveButton("OK", null));
        if ("available".equals(event)) {
            JSONObject candidate = updater.candidate();
            showDialog(new AlertDialog.Builder(this).setTitle("PokéBonk Offline " + candidate.optString("version") + " available")
                .setMessage(candidate.optString("notes") + "\n\nDownload only; installation needs a separate confirmation.")
                .setNegativeButton("Later", null).setPositiveButton("Download update", (dialog, which) -> {
                    updater.download(); Toast.makeText(this, "Downloading and verifying update…", Toast.LENGTH_LONG).show();
                }));
        }
        if ("ready".equals(event)) showDialog(new AlertDialog.Builder(this).setTitle("Verified APK ready")
            .setMessage("Open Android’s system installer? Installation is optional. Your app identity and native saves are retained.")
            .setNegativeButton("Later", null).setPositiveButton("Open installer", (dialog, which) -> updater.install()));
    }
    private void exportSave() {
        io.execute(() -> {
            try {
                JSONObject value = saves.load();
                if (value == null) throw new Exception("No save exists yet.");
                pendingExport = value.toString(2).getBytes(StandardCharsets.UTF_8);
                runOnUiThread(() -> startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE).setType("application/json")
                    .putExtra(Intent.EXTRA_TITLE, "pokebonk-standard-save.json"), EXPORT));
            } catch (Exception error) { notice(error.getMessage()); }
        });
    }
    static byte[] readBounded(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int n;
        while ((n = input.read(buffer)) >= 0) {
            if (out.size() + n > limit) throw new Exception("File is too large.");
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }
    private void notice(String message) { runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (request == WEB_FILE && fileCallback != null) { fileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri}); fileCallback = null; return; }
        if (request == EXPORT) {
            byte[] bytes = pendingExport; pendingExport = null;
            if (uri != null && bytes != null) io.execute(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new Exception("Cannot open destination.");
                    output.write(bytes); notice("Backup exported.");
                } catch (Exception error) { notice("Export failed: " + error.getMessage()); }
            });
        }
        if (request == IMPORT && uri != null) io.execute(() -> {
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) throw new Exception("Cannot read backup.");
                JSONObject value = saves.parseImport(new String(readBounded(input, NativeSaveStore.MAX_BYTES), StandardCharsets.UTF_8));
                runOnUiThread(() -> whenIdle(() -> showDialog(new AlertDialog.Builder(this).setTitle("Import this backup?")
                    .setMessage("Replace local progress? A pre-import native copy will be retained. No unlocked save is converted.")
                    .setNegativeButton("Cancel", null).setPositiveButton("Import backup", (dialog, which) -> io.execute(() -> {
                        try { saves.importState(value); runOnUiThread(() -> web.reload()); }
                        catch (Exception error) { notice("Backup not imported: " + error.getMessage()); }
                    })))));
            } catch (Exception error) { notice("Backup not imported: " + error.getMessage()); }
        });
    }
    @Override protected void onResume() {
        super.onResume(); resumed = true; hideBars();
        if (web != null) web.onResume();
        if (updater != null) updater.check(false);
    }
    @Override protected void onPause() {
        resumed = false;
        if (web != null) {
            web.evaluateJavascript("(()=>{const r=globalThis.PokeBonkNativeApp?.run;if(r?.state==='play')r.pause();r?.autosave?.(true)})()", null);
            web.onPause(); // Timers are not globally suspended; in-flight native commits can finish.
        }
        super.onPause();
    }
    @Override public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) { hideBars(); if (resumed && updater != null) updater.check(false); }
    }
    @Override public void onConfigurationChanged(Configuration config) { super.onConfigurationChanged(config); root.requestApplyInsets(); hideBars(); }
    private void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) { controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); controller.hide(WindowInsets.Type.systemBars()); }
        } else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if (root != null) root.requestApplyInsets();
    }
    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null); io.shutdownNow();
        if (updater != null) updater.close();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (web != null) { web.removeJavascriptInterface("PokeBonkStandardAndroid"); web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
    public final class StorageBridge {
        private String failure(Exception error) {
            try { return new JSONObject().put("ok", false).put("error", error.getMessage()).toString(); }
            catch (Exception impossible) { return "{\"ok\":false,\"error\":\"Native storage failed.\"}"; }
        }
        @JavascriptInterface public String loadState() {
            try {
                JSONObject value = saves.load();
                return new JSONObject().put("ok", true).put("value", value == null ? JSONObject.NULL : value).toString();
            } catch (Exception error) { return failure(error); }
        }
        @JavascriptInterface public String saveState(String text) {
            try {
                if (text == null || text.length() > NativeSaveStore.MAX_BYTES) throw new Exception("Invalid native save.");
                saves.save(text); return "{\"ok\":true,\"value\":true}";
            } catch (Exception error) { return failure(error); }
        }
    }
}
