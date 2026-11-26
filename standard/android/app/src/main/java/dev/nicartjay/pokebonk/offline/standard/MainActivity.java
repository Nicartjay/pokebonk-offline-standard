package dev.nicartjay.pokebonk.offline.standard;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

@SuppressWarnings("deprecation")
public final class MainActivity extends Activity {
    private static final int IMPORT = 1101, EXPORT = 1102, WEB_FILE = 1103;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private WebView web;
    private GameSafeArea safeArea;
    private NativeSaveStore saves;
    private RepositoryUpdater updater;
    private CloudNative cloud;
    private JSONObject configForCloud;
    private WebView cloudBroker;
    private boolean cloudReady;
    private JSONObject pendingCloudFeedback;
    private final List<String> cloudQueue=new ArrayList<>();
    private CoopNetwork lan;
    private String coopGateway;
    private WebView lanBroker;
    private boolean lanBrokerReady;
    private final List<String> lanBrokerQueue=new ArrayList<>();
    private final AtomicInteger pendingLan=new AtomicInteger();
    private boolean resumed, dialogOpen, recoveryMode;
    private String pendingRecoveryAction;
    private byte[] pendingExport;
    private ValueCallback<Uri[]> fileCallback;
    private static final String IDLE = "!globalThis.PokeBonkNativeApp?.run && Boolean(document.querySelector('.offline-menu,.offline-card,.offline-boot-error'))";
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (resumed && hasWindowFocus() && web != null) web.evaluateJavascript(recoveryMode ? "!globalThis.PokeBonkNativeApp?.run" : IDLE, value -> {
                boolean idle = "true".equals(value);
                if (idle && !dialogOpen) presentUpdate();
                if(idle&&!dialogOpen)presentCloud();
                if(cloudBroker!=null&&cloudReady)cloudBroker.evaluateJavascript("globalThis.PokeBonkCloudInput('tick')",null);
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
            configForCloud=config;
            updater = new RepositoryUpdater(this, saves, config);
            cloud=new CloudNative(this,saves,config);
            String digest;
            try(InputStream input=getAssets().open("www/asset-manifest.json")){
                digest=new JSONObject(new String(readBounded(input,4*1024*1024),StandardCharsets.UTF_8)).getString("gameDigest");
            }
            if(!digest.matches("[a-f0-9]{64}"))throw new Exception("Invalid game identity.");
            String identity="PB-LAN2|"+config.getString("applicationId")+"|"+config.getString("version")+"|"+
                config.getJSONObject("upstream").getString("build")+"|"+digest;
            coopGateway=InternetPolicy.gateway(config);
            lan=new CoopNetwork(this,config,identity,()->{
                JSONObject envelope=saves.load();
                if(envelope==null)throw new Exception("Choose your starters first.");
                JSONObject value=envelope.getJSONObject("state");
                return new JSONObject().put("name",value.getJSONObject("profile").getString("name"))
                    .put("league",value.getJSONObject("profile").getJSONArray("league"))
                    .put("completedParties",CoopRules.completed(value))
                    .put("maps",CoopRules.maps(value.getJSONObject("profile").optJSONObject("biomes")))
                    .put("unfinished",!value.isNull("activeRun")||!value.isNull("suspended"))
                    .put("ticket",value.optJSONObject("activeRun")==null?JSONObject.NULL:value.getJSONObject("activeRun").getJSONObject("ticket"));
            },this::lanBrokerInput,this::lanEvent);
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
        // The game owns its light/dark palette. Some tablet WebViews otherwise
        // recolor title fills independently of the outlined text.
        if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        if (Build.VERSION.SDK_INT >= 29) settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        settings.setUseWideViewPort(true); settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false); settings.setSupportMultipleWindows(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE); // Bundled assets must follow the installed APK, including fixed offline/*.js paths.
        CookieManager.getInstance().setAcceptCookie(false);
        web.addJavascriptInterface(new StorageBridge(), "PokeBonkStandardAndroid");
        web.addJavascriptInterface(new LanBridge(),"PokeBonkLANAndroid");
        web.setWebViewClient(new OfflineAssetWebViewClient(getAssets(),
            () -> { recoveryMode = false; publishSystemTheme(); applySafeArea(root.getRootWindowInsets()); lan.publish();
                if(CloudNative.origin(configForCloud)!=null&&cloudBroker==null)createCloudBroker();
            }, this::nativeMenuAction));
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
            Toast.makeText(this, "Use Player & saves → Export save backup.", Toast.LENGTH_LONG).show());
        root = new FrameLayout(this); root.setBackgroundColor(Color.BLACK);
        // Match the game's physical canvas coordinates regardless of the
        // Android locale. Native dialogs still use the system layout direction.
        root.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        // No overlay/three-dot button. Fixed native actions now live inside
        // the game's Player & saves dialog, with real document-picker backups.
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
        publishSafeArea();
    }
    private void publishSafeArea() {
        if (safeArea == null || web == null || web.getWidth() <= 0 || web.getHeight() <= 0) return;
        // One-way numeric presentation metadata, not an additional JS bridge.
        // The renderer still has exactly two callable native storage methods.
        web.evaluateJavascript("dispatchEvent(new CustomEvent('standard:android-insets',{detail:{left:" + safeArea.left +
            ",top:" + safeArea.top + ",right:" + safeArea.right + ",bottom:" + safeArea.bottom +
            ",menuSize:0,menuGap:0" +
            ",width:" + web.getWidth() + ",height:" + web.getHeight() + "}}))", null);
    }
    private void publishSystemTheme() {
        if (web == null) return;
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        // One-way boolean, no native methods, preferences, URLs or paths.
        web.evaluateJavascript("dispatchEvent(new CustomEvent('standard:system-theme',{detail:{dark:" + dark + "}}))", null);
    }
    @SuppressLint("NewApi")
    private void registerBack() { getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back); }
    @Override @SuppressLint("GestureBackNavigation") public void onBackPressed() { back(); }
    private void back() {
        if (dialogOpen) return;
        web.evaluateJavascript("(globalThis.PokeBonkOfflineUI?.dismissUpdate?.() || globalThis.PokeBonkOfflineUI?.dismissCloud?.() || globalThis.PokeBonkOfflineUI?.lanBack?.())===true",handled->{
            if(!"true".equals(handled))backOutsideRoom();
        });
    }
    private void backOutsideRoom() {
        web.evaluateJavascript("(()=>{const a=globalThis.PokeBonkNativeApp;if(a?.run?.state==='play')a.run.pause();" +
            "return !a?.run&&(!a?.r||Boolean(document.querySelector('.offline-startup-recovery,.offline-boot-error')))})()", failed -> {
                if ("true".equals(failed)) { recoveryMode = true; showRecoveryMenu(); }
                else showDialog(new AlertDialog.Builder(this).setTitle(R.string.exit_dialog_title)
                    .setMessage(R.string.exit_dialog_message)
                    .setNegativeButton("Keep playing", null).setPositiveButton(R.string.exit_dialog_confirm, (dialog, which) -> finishAndRemoveTask()));
            });
    }
    void whenIdle(Runnable action) {
        if (isFinishing() || isDestroyed() || !resumed || !hasWindowFocus()) return;
        String allowed = recoveryMode ? "!globalThis.PokeBonkNativeApp?.run" : IDLE;
        web.evaluateJavascript(allowed, value -> { if ("true".equals(value) && !isFinishing() && resumed) action.run(); });
    }
    void whenUpdateIdle(Runnable action, Runnable deferred) {
        if (isFinishing() || isDestroyed() || !resumed || !hasWindowFocus() || web == null) { deferred.run(); return; }
        web.evaluateJavascript(IDLE, value -> {
            boolean room = true;
            try { room = new JSONObject(lan.state()).optString("phase").matches("connecting|hosting|lobby|preparing|playing"); }
            catch (Exception ignored) { /* Failed state reads cannot authorize installation. */ }
            if ("true".equals(value) && !room && !isFinishing() && !isDestroyed() && resumed && hasWindowFocus()) action.run();
            else deferred.run();
        });
    }
    void updateChanged() {
        handler.post(() -> {
            if (web != null && resumed && hasWindowFocus() && !dialogOpen && !isFinishing() && !isDestroyed())
                whenIdle(this::presentUpdate);
        });
    }
    private void showDialog(AlertDialog.Builder builder) {
        if (isFinishing() || isDestroyed() || dialogOpen) return;
        dialogOpen = true;
        AlertDialog dialog = builder.create();
        dialog.setOnDismissListener(ignored -> { dialogOpen = false; hideBars(); dispatchRecoveryWhenFocused(); });
        dialog.show();
    }
    private void showRecoveryMenu() {
        // Back offers recovery only when the game cannot boot. It is not a
        // second everyday app menu and never exposes filesystem paths to JS.
        showDialog(new AlertDialog.Builder(this).setTitle("Startup recovery")
            .setItems(new String[]{"Check for updates", "Export backup", "Import backup", "Close app"}, (dialog, which) -> {
                if (which == 3) finishAndRemoveTask();
                else pendingRecoveryAction = new String[]{"check-for-updates", "export-backup", "import-backup"}[which];
            }).setNegativeButton("Cancel", null));
    }
    private void dispatchRecoveryWhenFocused() {
        // AlertDialog owns focus while its item callback runs. Defer the fixed
        // action until dismissal/focus restoration rather than silently losing it.
        if (pendingRecoveryAction == null || isFinishing() || isDestroyed() ||
            !NativeMenuAction.recoveryReady(resumed, hasWindowFocus(), dialogOpen)) return;
        String action = pendingRecoveryAction; pendingRecoveryAction = null;
        nativeMenuAction(action);
    }
    private void nativeMenuAction(String action) {
        if(action.startsWith("cloud/")){
            String[] pieces=action.substring(6).split("/");
            whenIdle(()->cloudInput(pieces[0],pieces.length==2?pieces[1]:null));return;
        }
        if ("download-update".equals(action) || "install-update".equals(action)) {
            whenIdle(() -> web.evaluateJavascript("Boolean(document.querySelector('.offline-update-card a[data-standard-native-action=\"" +
                action + "\"][href=\"/__native__/" + action + "\"]'))", visible -> {
                if (!"true".equals(visible) || !resumed || !hasWindowFocus()) return;
                if ("download-update".equals(action)) updater.download(); else updater.install();
            }));
            return;
        }
        if(action.startsWith("lan/")){
            if(!resumed||!hasWindowFocus()||dialogOpen)return;
            if("lan/leave".equals(action)){lan.command("leave",new JSONObject());return;}
            if("lan/cancel-find".equals(action)){lan.command("cancel-find",new JSONObject());return;}
            if("lan/copy".equals(action)){
                try{
                    JSONObject state=new JSONObject(lan.state());String code=state.optString("code");
                    if(CoopCodes.valid(code,state.optString("connectionMode","lan"))){
                        getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Co-op room code",code));Toast.makeText(this,"Room code copied",Toast.LENGTH_SHORT).show();
                    }
                }catch(Exception error){notice("Could not copy the room code.");}
                return;
            }
            final String code=NativeMenuAction.joinCode(action),verb=code==null?action.substring(4):"join";
            final String form="(()=>{if(globalThis.PokeBonkNativeApp?.run)return null;const r=document.querySelector('.offline-lan-rooms')||document.querySelector('.offline-lan-home,.offline-lan-card');"+
                "if(!r)return null;const f=n=>r.querySelector('[data-lan-field=\"'+n+'\"]')?.value??'';"+
                "return {species:Number(f('species')),address:f('address'),invitation:f('invitation'),connectionMode:f('connection-mode')||'lan',destination:f('destination')}})()";
            web.evaluateJavascript(form,text->{
                try{if(text.length()<=512&&!"null".equals(text)){
                    JSONObject fields=new JSONObject(text);if(code!=null)fields.put("invitation",code);lan.command(verb,fields);
                }}
                catch(Exception error){notice("Could not read the local lobby fields.");}
            });
            return;
        }
        whenIdle(() -> {
            if ("check-for-updates".equals(action)) updater.check(true);
            else if ("cloud-saves".equals(action))
                cloudInput("open",null);
            else if ("export-backup".equals(action)) exportSave();
            else if ("import-backup".equals(action)) startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"), IMPORT);
            else if ("report-bug".equals(action)) {
                Uri issue = Uri.parse("https://github.com/" + RepositoryUpdater.REPOSITORY + "/issues/new").buildUpon()
                    .appendQueryParameter("title", "[Bug] PokéBonk Offline v" + BuildConfig.VERSION_NAME)
                    .appendQueryParameter("body", "Offline app: v" + BuildConfig.VERSION_NAME +
                        "\nBundled game: v" + BuildConfig.UPSTREAM_VERSION + " (" + BuildConfig.UPSTREAM_BUILD + ")" +
                        "\nPlatform: Android\n\n## What happened?\n\n## Steps to reproduce\n1. \n\n## What did you expect?\n\n## Screenshots (optional)\n\nDo not attach private information unless you choose to share it.")
                    .build();
                try { startActivity(new Intent(Intent.ACTION_VIEW, issue).addCategory(Intent.CATEGORY_BROWSABLE)); }
                catch (android.content.ActivityNotFoundException error) { notice("No browser is available to open GitHub Issues."); }
            }
        });
    }
    private void presentUpdate() {
        String event = updater.takeEvent();
        if (event == null) return;
        if ("feedback".equals(event)) presentUpdateFeedback(updater.feedback());
    }
    private void presentUpdateFeedback(JSONObject value) {
        if (value == null) return;
        web.evaluateJavascript("globalThis.PokeBonkOfflineUI?.updateFeedback(" + value + ") ?? false", handled -> {
            // Queue until the game can display it. No native update alerts,
            // toasts or silent loss of feedback while gameplay owns the screen.
            if (!"true".equals(handled)) updater.retryFeedback(value);
        });
    }
    void cloudIdle(Consumer<Boolean> callback){
        handler.post(()->{
            if(isFinishing()||isDestroyed()||!resumed||!hasWindowFocus()||web==null){callback.accept(false);return;}
            web.evaluateJavascript(IDLE,value->{
                boolean room=true;
                try{room=new JSONObject(lan.state()).optString("phase").matches("connecting|hosting|lobby|preparing|playing");}catch(Exception ignored){}
                callback.accept("true".equals(value)&&!room&&resumed&&!isFinishing());
            });
        });
    }
    void cloudFeedback(JSONObject value){
        handler.post(()->{
            if(isFinishing()||isDestroyed()||value.toString().length()>24000)return;
            pendingCloudFeedback=value;whenIdle(this::presentCloud);
        });
    }
    private void presentCloud(){
        JSONObject value=pendingCloudFeedback;
        if(value==null||web==null)return;
        web.evaluateJavascript("globalThis.PokeBonkOfflineUI?.cloudFeedback("+value+") ?? false",handled->{
            if("true".equals(handled)&&pendingCloudFeedback==value)pendingCloudFeedback=null;
        });
    }
    void cloudReply(String id,int index,int total,String data){
        handler.post(()->{
            if(cloudBroker!=null&&!isFinishing()&&!isDestroyed())
                cloudBroker.evaluateJavascript("globalThis.PokeBonkCloudReply("+JSONObject.quote(id)+","+index+","+total+","+JSONObject.quote(data)+")",null);
        });
    }
    void cloudReady(){
        handler.post(()->{
            if(cloudBroker==null||isFinishing()||isDestroyed())return;
            cloudReady=true;
            for(String command:cloudQueue)cloudBroker.evaluateJavascript(command,null);
            cloudQueue.clear();
        });
    }
    void reloadAfterCloud(){handler.post(()->{if(web!=null&&!isFinishing()&&!isDestroyed())web.reload();});}
    private void cloudInput(String action,String selection){
        if(isFinishing()||isDestroyed())return;
        if(cloudBroker==null)createCloudBroker();
        String script="globalThis.PokeBonkCloudInput("+JSONObject.quote(action)+","+(selection==null?"undefined":JSONObject.quote(selection))+")";
        if(cloudReady)cloudBroker.evaluateJavascript(script,null);
        else if(cloudQueue.size()<16)cloudQueue.add(script);
    }
    @SuppressLint({"SetJavaScriptEnabled","AddJavascriptInterface"})
    private void createCloudBroker(){
        cloudBroker=new WebView(this);WebSettings settings=cloudBroker.getSettings();
        settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(false);
        settings.setAllowContentAccess(false);settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        cloudBroker.setFocusable(false);cloudBroker.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        cloudBroker.setAlpha(0);cloudBroker.addJavascriptInterface(new CloudBridge(),"PokeBonkCloudNative");
        cloudBroker.setWebViewClient(new OfflineAssetWebViewClient(getAssets(),()->{},ignored->{},true));
        root.addView(cloudBroker,new FrameLayout.LayoutParams(1,1));
        cloudBroker.loadUrl(OfflineAssetWebViewClient.APP_ORIGIN+"/offline/cloud-broker.html");
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
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // singleTask returns to the current WebViews/room, never recreates the
        // game or trusts browser-supplied tokens, commands or destinations.
        if(intent!=null&&Intent.ACTION_VIEW.equals(intent.getAction())&&cloud!=null&&
            cloud.acceptsReturn(intent.getDataString())) {
            whenIdle(this::presentCloud);
        }
    }
    @Override protected void onResume() {
        super.onResume(); resumed = true; hideBars();
        if (web != null) { web.onResume(); publishSystemTheme(); }
        if (updater != null) { updater.resumed(); updater.check(false); }
        dispatchRecoveryWhenFocused();
    }
    @Override protected void onPause() {
        resumed = false;
        if(lan!=null)lan.fromGame("cancel-find","null");
        if (web != null) {
            web.evaluateJavascript("(()=>{const r=globalThis.PokeBonkNativeApp?.run;if(r?.state==='play')r.pause();dispatchEvent(new Event('standard:checkpoint'))})()", null);
            web.onPause(); // Timers are not globally suspended; in-flight native commits can finish.
        }
        super.onPause();
    }
    @Override public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) { hideBars(); if (resumed && updater != null) updater.check(false); dispatchRecoveryWhenFocused(); }
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config); publishSystemTheme(); root.requestApplyInsets(); hideBars();
    }
    private void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) { controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); controller.hide(WindowInsets.Type.systemBars()); }
        } else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if (root != null) root.requestApplyInsets();
    }
    @Override protected void onDestroy() {
        if(cloud!=null)cloud.close();
        if(cloudBroker!=null){cloudBroker.removeJavascriptInterface("PokeBonkCloudNative");cloudBroker.destroy();cloudBroker=null;}
        cloudQueue.clear();
        if(lan!=null)lan.close();
        if(lanBroker!=null){lanBroker.removeJavascriptInterface("PokeBonkLanBrokerNative");lanBroker.stopLoading();lanBroker.destroy();lanBroker=null;}
        lanBrokerQueue.clear();
        handler.removeCallbacksAndMessages(null); io.shutdownNow();
        if (updater != null) updater.close();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (web != null) { web.removeJavascriptInterface("PokeBonkStandardAndroid"); web.removeJavascriptInterface("PokeBonkLANAndroid"); web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
    private void lanEvent(JSONObject value){
        handler.post(()->{
            if(web==null||isFinishing()||isDestroyed())return;
            String type=value.optString("type"),suffix;
            if("state".equals(type))suffix="state";
            else if("frame".equals(type))suffix="frame";
            else if("peer-closed".equals(type))suffix="peer-closed";
            else if("notice".equals(type))suffix="notice";else return;
            Object detail="state".equals(type)?value.opt("value"):value;
            web.evaluateJavascript("document.dispatchEvent(new CustomEvent('standard:lan-"+suffix+"',{detail:"+
                JSONObject.quote(String.valueOf(detail))+"}))",null);
        });
    }
    private void lanBrokerInput(JSONObject value){
        final String text=value.toString();
        handler.post(()->{
            if(isFinishing()||isDestroyed())return;
            if(lanBroker==null&&"reset".equals(value.optString("type")))return;
            if(lanBroker==null)createLanBroker();
            if(lanBrokerReady)lanBroker.evaluateJavascript("globalThis.PokeBonkLanBrokerInput("+text+")",null);
            else if(lanBrokerQueue.size()<128)lanBrokerQueue.add(text);
            else lan.stop("The local transport queue exceeded its limit.",true);
        });
    }
    @SuppressLint({"SetJavaScriptEnabled","AddJavascriptInterface"})
    private void createLanBroker(){
        lanBroker=new WebView(this);WebSettings s=lanBroker.getSettings();s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);
        // This separate trusted broker needs peer transport. Its asset client
        // and CSP allow only the native-pinned gateway when configured.
        // LAN still admits private host candidates only. The GAME WebView
        // above retains setBlockNetworkLoads(true).
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setBlockNetworkLoads(false);s.setSupportMultipleWindows(false);s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        lanBroker.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT,false);
        lanBroker.addJavascriptInterface(new BrokerBridge(),"PokeBonkLanBrokerNative");
        lanBroker.setWebViewClient(new OfflineAssetWebViewClient(getAssets(),()->{},ignored->{},true,coopGateway));
        lanBroker.setAlpha(0);root.addView(lanBroker,new FrameLayout.LayoutParams(1,1));
        lanBroker.loadUrl(OfflineAssetWebViewClient.APP_ORIGIN+"/offline/lan-broker.html");
    }
    public final class LanBridge{
        @JavascriptInterface public String state(){return lan.state();}
        @JavascriptInterface public void send(String channel,String text){
            if(channel==null||!channel.matches("ctl|snap|prepared|failed|leave|refresh|cancel-find|room-ready|room-start|room-pick|room-chat|room-settings|room-seats|room-loadout|room-return")||text==null||text.length()>48000)return;
            if(pendingLan.incrementAndGet()>96){pendingLan.decrementAndGet();return;}
            handler.post(()->{pendingLan.decrementAndGet();if(!isFinishing()&&!isDestroyed())lan.fromGame(channel,text);});
        }
    }
    public final class BrokerBridge{
        @JavascriptInterface public void emit(String text){
            if(text==null||text.length()>48000)return;
            handler.post(()->{
                if(isFinishing()||isDestroyed()||lanBroker==null)return;
                try{
                    JSONObject value=LanPolicy.parse(text,48000);
                    if("ready".equals(value.optString("type"))){
                        lanBrokerReady=true;for(String queued:lanBrokerQueue)lanBroker.evaluateJavascript("globalThis.PokeBonkLanBrokerInput("+queued+")",null);lanBrokerQueue.clear();
                    }else lan.fromBroker(text);
                }catch(Exception error){lan.stop("Invalid local transport message.",true);}
            });
        }
    }
    public final class StorageBridge {
        private String failure(Exception error) {
            try { return new JSONObject().put("ok", false).put("error", error.getMessage()).toString(); }
            catch (Exception impossible) { return "{\"ok\":false,\"error\":\"Native storage failed.\"}"; }
        }
        @JavascriptInterface public String loadState() {
            try {
                return new JSONObject().put("ok", true).put("value",saves.clientLoad()).toString();
            } catch (Exception error) { return failure(error); }
        }
        @JavascriptInterface public String saveState(String text) {
            try {
                if (text == null || text.length() > NativeSaveStore.MAX_BYTES) throw new Exception("Invalid native save.");
                saves.clientSave(text); return "{\"ok\":true,\"value\":true}";
            } catch (Exception error) { return failure(error); }
        }
    }
    public final class CloudBridge {
        @JavascriptInterface public void request(String packet){cloud.accept(packet);}
    }
}
