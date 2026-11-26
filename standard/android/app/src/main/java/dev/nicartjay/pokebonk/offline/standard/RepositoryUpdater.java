package dev.nicartjay.pokebonk.offline.standard;

import android.content.Intent;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.storage.StorageManager;
import android.provider.Settings;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

/** Trusted host only: not exposed through a JavascriptInterface. */
final class RepositoryUpdater {
    static final String REPOSITORY = BuildConfig.RELEASE_REPOSITORY;
    static final String ENDPOINT = "https://github.com/" + REPOSITORY + "/releases/download/standard-channel/standard-update.json";
    static final long INTERVAL = 24L * 60 * 60 * 1000;
    private final MainActivity activity;
    private final NativeSaveStore saves;
    private final JSONObject config;
    private final SharedPreferences preferences;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile JSONObject candidate;
    private volatile byte[] candidateSigned;
    private volatile File ready;
    private volatile JSONObject readyManifest;
    private volatile HttpsURLConnection transfer;
    private volatile String event;
    private volatile JSONObject feedback;
    private boolean checking, reportCheck;
    RepositoryUpdater(MainActivity activity, NativeSaveStore saves, JSONObject config) {
        this.activity = activity; this.saves = saves; this.config = config;
        preferences = activity.getSharedPreferences("standard-native-updater-v1", 0);
    }
    void close() { worker.shutdownNow(); HttpsURLConnection active = transfer; if (active != null) active.disconnect(); }
    synchronized String takeEvent() { String value = event; event = null; return value; }
    JSONObject feedback() { return feedback; }
    synchronized void retryFeedback(JSONObject value) {
        if (feedback == value && event == null) event = "feedback";
    }
    private synchronized void showLatestFeedback() {
        if (feedback == null) return;
        try {
            // Manual actions reopen hidden progress; later byte updates do
            // not carry this flag, so Hide can still keep the download hidden.
            feedback = new JSONObject(feedback.toString()).put("open", true);
            event = "feedback"; activity.updateChanged();
        } catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
    }
    synchronized void resumed() {
        if (ready != null && !busy.get() && feedback != null && "installing".equals(feedback.optString("state")))
            emitState("ready", readyManifest, 0, null, null, null);
    }
    static void require(boolean ok, String message) throws IOException { if (!ok) throw new IOException(message); }
    static boolean allowedURL(URL url) {
        String host = url.getHost();
        return "https".equals(url.getProtocol()) && url.getUserInfo() == null && url.getRef() == null &&
            (url.getPort() == -1 || url.getPort() == 443) &&
            ("github.com".equals(host) || "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host));
    }
    private static HttpsURLConnection open(URL url) throws Exception {
        for (int redirects = 0; redirects <= 5; redirects++) {
            require(allowedURL(url), "Blocked update redirect.");
            HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000); connection.setReadTimeout(20000);
            connection.setRequestProperty("User-Agent", "Pokebonk-Offline-Standard/" + BuildConfig.VERSION_NAME);
            connection.setRequestProperty("Accept", "application/octet-stream");
            int code = connection.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String target = connection.getHeaderField("Location");
                connection.disconnect(); require(target != null, "Missing update redirect.");
                url = new URL(url, target); continue;
            }
            if (code != 200) { connection.disconnect(); throw new IOException("Update service unavailable (" + code + ")."); }
            return connection;
        }
        throw new IOException("Too many update redirects.");
    }
    private static byte[] readMetadata(HttpsURLConnection connection) throws Exception {
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) >= 0) {
                require(out.size() + count <= 256 * 1024, "Manifest is too large.");
                out.write(buffer, 0, count);
            }
            return out.toByteArray();
        } finally { connection.disconnect(); }
    }
    static int compare(String left, String right) throws Exception {
        require(left.matches("\\d+\\.\\d+\\.\\d+") && right.matches("\\d+\\.\\d+\\.\\d+"), "Invalid update version.");
        String[] a = left.split("\\."), b = right.split("\\.");
        for (int i = 0; i < 3; i++) {
            int value = Long.compare(Long.parseLong(a[i]), Long.parseLong(b[i]));
            if (value != 0) return value;
        }
        return 0;
    }
    private JSONObject verifyManifest(byte[] bytes) throws Exception {
        require(bytes.length <= 256 * 1024, "Manifest is too large.");
        JSONObject signed = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        require("ECDSA-P256-SHA256-DER".equals(signed.getString("algorithm")) &&
            config.getString("updateKeyId").equals(signed.getString("keyId")), "Unknown update signing key.");
        byte[] payload = Base64.getDecoder().decode(signed.getString("payload"));
        require(payload.length <= 256 * 1024, "Manifest payload is too large.");
        SignatureVerifier.verify(payload, Base64.getDecoder().decode(signed.getString("signature")), config.getString("updatePublicKey"));
        JSONObject m = new JSONObject(new String(payload, StandardCharsets.UTF_8));
        require(m.getInt("manifestVersion") == 1 && "standard".equals(m.getString("edition")) &&
            activity.getPackageName().equals(m.getString("applicationId")) && REPOSITORY.equals(m.getString("repository")), "Wrong update edition or publisher.");
        String version = m.getString("version"); compare(version, version);
        JSONObject upstream = m.getJSONObject("upstream");
        compare(upstream.getString("version"), upstream.getString("version"));
        require(upstream.getString("build").matches("[\\w-]{4,80}"), "Invalid upstream build.");
        JSONObject save = m.getJSONObject("save");
        require(save.getInt("schema") > 0 && save.getInt("minReader") > 0 &&
            save.getInt("minReader") <= save.getInt("schema") && save.getInt("maxReader") >= save.getInt("schema"), "Invalid save compatibility.");
        save.getJSONArray("compatibleRunBuilds");
        JSONObject source = m.getJSONObject("source");
        require(source.getString("commit").matches("[a-f0-9]{40}") && source.getString("pristineDigest").matches("[a-f0-9]{64}") &&
            source.getString("gameDigest").matches("[a-f0-9]{64}"), "Invalid release provenance.");
        require(m.getString("notes").length() <= 20000, "Release notes are too long.");
        java.time.Instant.parse(m.getString("publishedAt"));
        JSONObject artifacts = m.getJSONObject("artifacts");
        JSONObject distributions = config.getJSONObject("updateDistributions");
        require(artifacts.length() == distributions.length(), "Incomplete update distribution set.");
        java.util.Iterator<String> ids = distributions.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            JSONObject a = artifacts.getJSONObject(id), spec = distributions.getJSONObject(id);
            String name = a.getString("name");
            require(spec.getString("platform").equals(a.getString("platform")) && spec.getString("kind").equals(a.getString("kind")) &&
                name.matches("[A-Za-z0-9_.-]+") && name.equals("pokebonk-offline-" + version + "-" + spec.getString("suffix")) &&
                ("https://github.com/" + REPOSITORY + "/releases/download/standard-v" + version + "/" + name).equals(a.getString("url")) &&
                a.getLong("bytes") > 0 && a.getLong("bytes") <= 1024L * 1024 * 1024 &&
                a.getString("sha256").matches("[a-f0-9]{64}"), "Wrong-platform or invalid update artifact.");
        }
        JSONObject android = artifacts.getJSONObject("android-universal");
        require(activity.getPackageName().equals(android.getString("applicationId")) &&
            android.getLong("versionCode") > 0 && android.getLong("versionCode") <= 2100000000L &&
            BuildConfig.RELEASE_CERTIFICATE.equals(android.getString("signingCertificateSha256")), "Incompatible Android identity.");
        return m;
    }
    private void compatibleSave(JSONObject manifest) throws Exception {
        JSONObject saved = saves.load();
        if (saved == null) return;
        JSONObject compatibility = manifest.getJSONObject("save");
        int schema = saved.getInt("schemaVersion");
        require(schema >= compatibility.getInt("minReader") && schema <= compatibility.getInt("maxReader"), "This update cannot read your save schema. Keep the previous app.");
        JSONObject state = saved.getJSONObject("state");
        require((state.isNull("suspended") && state.isNull("activeRun")) ||
            NativeSaveStore.contains(compatibility.getJSONArray("compatibleRunBuilds"), saved.getJSONObject("upstream").getString("build")),
            "Finish the unfinished run in this app version before updating. The checkpoint will not be discarded.");
    }
    private synchronized void emitFeedback(String state, String latest, String detail) {
        JSONObject value = new JSONObject();
        try {
            value.put("state", state);
            if (latest != null) value.put("latestVersion", latest);
            if (detail != null) value.put("detail", detail);
        } catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
        feedback = value; event = "feedback"; activity.updateChanged();
    }
    private synchronized void emitState(String state, JSONObject manifest, long received, String stage, String detail, String retry) {
        try {
            JSONObject value = new JSONObject().put("state", state);
            if (manifest != null) {
                JSONObject artifact = manifest.getJSONObject("artifacts").getJSONObject("android-universal");
                value.put("latestVersion", manifest.getString("version")).put("notes", manifest.getString("notes"))
                    .put("upstreamVersion", manifest.getJSONObject("upstream").getString("version"))
                    .put("upstreamBuild", manifest.getJSONObject("upstream").getString("build"))
                    .put("kind", "apk").put("totalBytes", artifact.getLong("bytes")).put("receivedBytes", received);
            }
            if (stage != null) value.put("errorStage", stage);
            if (detail != null) value.put("detail", detail);
            if (retry != null) value.put("retryAction", retry);
            feedback = value; event = "feedback"; activity.updateChanged();
        } catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
    }
    synchronized void check(boolean manual) {
        if (ready != null && !busy.get()) {
            if (manual) { emitState("ready", readyManifest, 0, null, null, null); showLatestFeedback(); }
            return;
        }
        long now = System.currentTimeMillis(), last = preferences.getLong("lastCheck", 0);
        if (!manual && last <= now && now - last < INTERVAL) return;
        if (!busy.compareAndSet(false, true)) {
            if (manual && checking) { reportCheck = true; emitFeedback("checking", null, null); }
            else if (manual && feedback != null) showLatestFeedback();
            return;
        }
        checking = true; reportCheck = manual;
        if (manual) emitFeedback("checking", null, null);
        worker.execute(() -> {
            JSONObject checked = null; byte[] signed = null; Exception failure = null;
            try {
                require(preferences.edit().putLong("lastCheck", System.currentTimeMillis()).commit(), "Cannot store update check time.");
                signed = readMetadata(open(new URL(ENDPOINT)));
                JSONObject m = verifyManifest(signed);
                // A local test version is not a previously verified public
                // release. Only signed manifests advance the rollback floor.
                String version = m.getString("version"), highest = preferences.getString("highestSeen", "0.0.0");
                require(compare(version, highest) >= 0, "Rejected a rolled-back update manifest.");
                require(preferences.edit().putString("highestSeen", version).commit(), "Cannot store verified version.");
                if (compare(version, BuildConfig.VERSION_NAME) > 0)
                    require(m.getJSONObject("artifacts").getJSONObject("android-universal").getInt("versionCode") > BuildConfig.VERSION_CODE, "Android version code is not an upgrade.");
                checked = m;
            } catch (Exception error) { failure = error; }
            finally { completeCheck(checked, signed, failure); }
        });
    }
    private synchronized void completeCheck(JSONObject checked, byte[] signed, Exception failure) {
        checking = false; busy.set(false);
        boolean report = reportCheck; reportCheck = false;
        if (failure != null) { if (report) emitFeedback("error", null, failure.getMessage()); return; }
        String version = checked.optString("version");
        try {
            int order = compare(version, BuildConfig.VERSION_NAME);
            if (order <= 0) {
                candidate = null; candidateSigned = null;
                if (report) emitFeedback(order < 0 ? "ahead" : "current", version, null);
            } else { candidate = checked; candidateSigned = signed; emitState("available", checked, 0, null, null, null); }
        } catch (Exception error) { if (report) emitFeedback("error", null, error.getMessage()); }
    }
    synchronized void download() {
        final byte[] signed = candidateSigned;
        if (signed == null || ready != null || !busy.compareAndSet(false, true)) return;
        emitState("downloading", candidate, 0, null, null, null);
        worker.execute(() -> {
            File temporary = new File(activity.getCacheDir(), "standard-update.apk.part");
            try {
                JSONObject m = verifyManifest(signed);
                require(compare(m.getString("version"), preferences.getString("highestSeen", "0.0.0")) >= 0, "Rejected a rolled-back update.");
                compatibleSave(m);
                JSONObject artifact = m.getJSONObject("artifacts").getJSONObject("android-universal");
                long size = artifact.getLong("bytes");
                StorageManager storage = (StorageManager) activity.getSystemService(Context.STORAGE_SERVICE);
                require(storage != null && storage.getAllocatableBytes(storage.getUuidForPath(activity.getCacheDir())) > size + 64L * 1024 * 1024, "Not enough space for the APK.");
                HttpsURLConnection connection = open(new URL(artifact.getString("url"))); transfer = connection;
                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                long count = 0, lastProgress = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[64 * 1024]; int n;
                    while ((n = input.read(buffer)) >= 0) {
                        count += n; require(count <= size && !Thread.currentThread().isInterrupted(), "Download interrupted or oversized.");
                        sha.update(buffer, 0, n); output.write(buffer, 0, n);
                        long now = android.os.SystemClock.elapsedRealtime();
                        if (now - lastProgress >= 200) { lastProgress = now; emitState("downloading", m, count, null, null, null); }
                    }
                    output.getFD().sync();
                } finally { connection.disconnect(); transfer = null; }
                emitState("verifying", m, count, null, null, null);
                require(count == size && hex(sha.digest()).equals(artifact.getString("sha256")), "Update size or SHA-256 mismatch.");
                verifyAPK(temporary, artifact, m.getString("version"));
                compatibleSave(m);
                require(!Thread.currentThread().isInterrupted(), "Download interrupted.");
                File target = new File(activity.getCacheDir(), "verified-update.apk");
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
                ready = target; readyManifest = m; emitState("ready", m, size, null, null, null);
            } catch (Exception error) { emitState("error", candidate, 0, "download", error.getMessage(), "download-update"); }
            finally { try { Files.deleteIfExists(temporary.toPath()); } catch (IOException ignored) {} busy.set(false); }
        });
    }
    static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    @SuppressWarnings("deprecation")
    private static Signature[] signers(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) return info.signingInfo.getApkContentsSigners();
        return info.signatures;
    }
    @SuppressWarnings("deprecation")
    private void verifyAPK(File file, JSONObject artifact, String version) throws Exception {
        require(file.length() == artifact.getLong("bytes"), "APK size changed.");
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024]; int n;
            while ((n = input.read(buffer)) >= 0) sha.update(buffer, 0, n);
        }
        require(hex(sha.digest()).equals(artifact.getString("sha256")), "APK checksum changed.");
        PackageManager manager = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo apk = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags), installed = manager.getPackageInfo(activity.getPackageName(), flags);
        require(apk != null && activity.getPackageName().equals(apk.packageName) && apk.versionCode == artifact.getInt("versionCode") &&
            apk.versionCode > BuildConfig.VERSION_CODE && version.equals(apk.versionName) &&
            apk.applicationInfo != null && apk.applicationInfo.minSdkVersion <= Build.VERSION.SDK_INT &&
            (apk.splitNames == null || apk.splitNames.length == 0), "Incompatible APK package, SDK, split, or version.");
        Signature[] proposed = signers(apk), current = signers(installed);
        require(proposed != null && current != null && proposed.length == 1 && current.length == 1 &&
            proposed[0].equals(current[0]) && BuildConfig.RELEASE_CERTIFICATE.equals(hex(MessageDigest.getInstance("SHA-256").digest(proposed[0].toByteArray()))),
            "APK signing identity differs from this installed Standard app.");
    }
    synchronized void install() {
        final byte[] signed = candidateSigned; final File file = ready;
        if (signed == null || file == null || !busy.compareAndSet(false, true)) return;
        emitState("installing", readyManifest, 0, null, null, null);
        worker.execute(() -> {
            try {
                final JSONObject m = verifyManifest(signed);
                require(compare(m.getString("version"), preferences.getString("highestSeen", "0.0.0")) >= 0, "Rejected a rolled-back update.");
                compatibleSave(m); verifyAPK(file, m.getJSONObject("artifacts").getJSONObject("android-universal"), m.getString("version"));
                activity.runOnUiThread(() -> activity.whenUpdateIdle(() -> {
                    try {
                        if (!activity.getPackageManager().canRequestPackageInstalls()) {
                            emitState("ready", m, 0, null, null, null);
                            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                        } else {
                            Uri uri = Uri.parse("content://" + activity.getPackageName() + ".updates/update.apk");
                            activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                        }
                    } catch (Exception error) { emitState("error", m, 0, "install", error.getMessage(), "install-update"); }
                    finally { busy.set(false); }
                }, () -> {
                    busy.set(false);
                    emitState("error", m, 0, "install", "Return to the homepage and leave your co-op room before installing.", "install-update");
                }));
            } catch (Exception error) {
                ready = null; readyManifest = null; busy.set(false);
                emitState("error", candidate, 0, "install", error.getMessage(), "download-update");
            }
        });
    }
}
