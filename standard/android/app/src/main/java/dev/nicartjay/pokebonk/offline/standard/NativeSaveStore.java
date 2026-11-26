package dev.nicartjay.pokebonk.offline.standard;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Iterator;
import java.util.UUID;

/** Fixed private files only. No path/URL provided by JavaScript is ever used. */
final class NativeSaveStore {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    private final File directory;
    private final AtomicFile current;
    private final AtomicFile previous;
    private final JSONObject config;
    private boolean readFailed;
    private String epoch=UUID.randomUUID().toString();
    NativeSaveStore(Context context, JSONObject config) {
        this.config = config;
        directory = new File(context.getFilesDir(), "standard-saves-v1");
        current = new AtomicFile(new File(directory, "state.json"));
        previous = new AtomicFile(new File(directory, "previous.json"));
    }
    private static void require(boolean ok, String message) throws IOException { if (!ok) throw new IOException(message); }
    private static void safe(Object value, int depth) throws Exception {
        require(depth <= 100, "Save is nested too deeply.");
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                require(!"__proto__".equals(key) && !"prototype".equals(key) && !"constructor".equals(key), "Unsafe save property.");
                safe(object.get(key), depth + 1);
            }
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int i = 0; i < array.length(); i++) safe(array.get(i), depth + 1);
        }
    }
    static boolean contains(JSONArray array, String value) {
        if (array == null) return false;
        for (int i = 0; i < array.length(); i++) if (value.equals(array.optString(i))) return true;
        return false;
    }
    static void ticket(JSONObject value) throws Exception {
        require(value != null && value.getString("id").matches("offline-[\\w-]{1,160}"), "Invalid local ticket.");
        double seed = value.getDouble("seed");
        require(seed >= 0 && seed <= 4294967295L && seed == Math.floor(seed), "Invalid local seed.");
        if(value.has("lan")&&!value.isNull("lan")){
            JSONObject lan=value.getJSONObject("lan"),rules=value.getJSONObject("config");
            require((lan.optInt("version")==1||lan.optInt("version")==2)&&LanPolicy.id(lan.optString("party"))&&lan.optString("party").equals(value.optString("party"))&&
                LanPolicy.id(lan.optString("me"))&&lan.optInt("size")>=2&&lan.optInt("size")<=4&&lan.opt("launched") instanceof Boolean&&
                CoopRules.game(rules)&&(lan.optInt("version")!=1||
                "standard".equals(rules.optString("mode"))&&"forest".equals(rules.optString("biome"))&&rules.optInt("tier",-1)==0),
                "Unsupported local co-op ticket. Keep the original save.");
            if(lan.optInt("version")==2)CoopRules.time(value.get("coopRulesAt"));
        }
    }
    static JSONObject validateState(JSONObject state) throws Exception {
        safe(state, 0);
        require(state.optInt("version") == 1 && state.optString("playerId").matches("offline-[\\w-]{1,160}") &&
            state.getDouble("updatedAt") >= 0, "Not a compatible progression save.");
        JSONObject profile = state.getJSONObject("profile");
        require(!profile.optBoolean("localSandbox") && !"unlock-all".equals(state.optString("variant")) &&
            !"unlocked".equals(state.optString("edition")), "Unlocked saves are not Standard saves.");
        require(profile.getString("name").length() <= 200 && profile.opt("settings") instanceof JSONObject, "Invalid profile.");
        for (String key : new String[]{"league", "unlocked", "seen"}) {
            JSONArray ids = profile.getJSONArray(key);
            for (int i = 0; i < ids.length(); i++) {
                double id = ids.getDouble(i);
                require(id >= 1 && id <= 10000 && id == Math.floor(id), "Invalid Pokémon in save.");
            }
        }
        for (String key : new String[]{"stardust", "totalStardust", "bonk"}) {
            if (profile.has(key)) require(profile.getDouble(key) >= 0, "Invalid save balance.");
        }
        for (String key : new String[]{"stash", "finished", "spins"}) state.getJSONObject(key);
        if (state.has("onboarding") && !state.isNull("onboarding")) {
            JSONObject onboarding = state.optJSONObject("onboarding");
            require(onboarding != null, "Invalid first-use guide marker.");
            if (onboarding.has("trainerGuide")) require(onboarding.opt("trainerGuide") instanceof Number &&
                onboarding.getDouble("trainerGuide") == 1, "Unsupported first-use guide marker.");
            if (onboarding.has("playerName")) require(onboarding.opt("playerName") instanceof Number &&
                onboarding.getDouble("playerName") == 1, "Unsupported initial player-name marker.");
        }
        JSONObject active = state.optJSONObject("activeRun"), suspended = state.optJSONObject("suspended");
        if (!state.isNull("activeRun")) {
            require(active != null && ("running".equals(active.optString("status")) || "suspended".equals(active.optString("status"))), "Invalid active run.");
            ticket(active.getJSONObject("ticket"));
        }
        if (!state.isNull("suspended")) {
            require(suspended != null && suspended.opt("text") instanceof String &&
                suspended.opt("hash") instanceof String && suspended.getDouble("at") >= 0, "Invalid checkpoint.");
            ticket(suspended.getJSONObject("ticket"));
            require(active == null || active.getJSONObject("ticket").getString("id").equals(suspended.getJSONObject("ticket").getString("id")), "Checkpoint ticket mismatch.");
        }
        return state;
    }
    JSONObject validate(JSONObject value) throws Exception {
        require("pokebonk-offline-standard".equals(value.optString("format")) && "standard".equals(value.optString("edition")), "Wrong save edition.");
        require(value.getInt("schemaVersion") == config.getInt("saveSchema"), "Unsupported save schema. Use the previous app; the save is preserved.");
        JSONObject upstream = value.getJSONObject("upstream");
        upstream.getString("version");
        String build = upstream.getString("build");
        JSONObject state = validateState(value.getJSONObject("state"));
        require((state.isNull("suspended") && state.isNull("activeRun")) || contains(config.getJSONArray("compatibleRunBuilds"), build),
            "This unfinished run requires game " + upstream.getString("version") + " (" + build + "). Complete it in the previous app. The save is preserved.");
        require(value.toString().getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES, "Save exceeds 32 MiB.");
        return value;
    }
    JSONObject parseImport(String text) throws Exception {
        require(text.getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES, "Save exceeds 32 MiB.");
        JSONObject value = new JSONObject(text);
        if (value.has("format")) return validate(value);
        validateState(value);
        JSONObject legacy = new JSONObject().put("format", "pokebonk-offline-standard").put("edition", "standard").put("schemaVersion", 1)
            .put("upstream", new JSONObject().put("version", "0.10.20").put("build", "mwqb4pwz")).put("state", value);
        return validate(legacy);
    }
    synchronized JSONObject load() throws Exception {
        try {
            boolean exists = current.getBaseFile().exists() || new File(current.getBaseFile() + ".bak").exists();
            if (!exists) {
                require(!previous.getBaseFile().exists(), "Primary save is missing; import previous.json explicitly.");
                return null;
            }
            require(current.getBaseFile().length() <= MAX_BYTES, "Save exceeds 32 MiB.");
            JSONObject result = validate(new JSONObject(new String(current.readFully(), StandardCharsets.UTF_8)));
            readFailed = false;
            return result;
        } catch (Exception error) { readFailed = true; throw error; }
    }
    synchronized void save(String text) throws Exception {
        require(!readFailed, "Native save is locked after a read failure. Import a compatible backup explicitly.");
        require(text.getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES, "Save exceeds 32 MiB.");
        JSONObject value = validate(new JSONObject(text)), old = load();
        ensureDirectory();
        if (old != null) write(previous, old.toString());
        write(current, value.toString());
    }
    synchronized void importState(JSONObject value) throws Exception {
        validate(value);
        ensureDirectory();
        if (current.getBaseFile().exists()) Files.copy(current.getBaseFile().toPath(),
            new File(directory, "before-import-" + System.currentTimeMillis() + "-" + UUID.randomUUID() + ".json").toPath());
        write(current, value.toString());
        readFailed = false;
        epoch=UUID.randomUUID().toString();
    }
    synchronized JSONObject clientLoad()throws Exception{
        JSONObject value=load();
        return new JSONObject().put("nativeStorage",1).put("epoch",epoch).put("save",value==null?JSONObject.NULL:value);
    }
    synchronized void clientSave(String text)throws Exception{
        JSONObject value=new JSONObject(text);
        require(epoch.equals(value.optString("nativeEpoch")),"stale_native_save");
        value.remove("nativeEpoch");save(value.toString());
    }
    synchronized JSONObject cloudSnapshot()throws Exception{
        JSONObject value=load();require(value!=null,"no_local_save");
        return new JSONObject().put("save",value).put("stamp",RepositoryUpdater.hex(
            java.security.MessageDigest.getInstance("SHA-256").digest(current.readFully())));
    }
    synchronized void restoreCloud(JSONObject request)throws Exception{
        JSONObject local=load();require(local!=null,"no_local_save");
        String stamp=RepositoryUpdater.hex(java.security.MessageDigest.getInstance("SHA-256").digest(current.readFully()));
        require(stamp.equals(request.optString("stamp")),"local_changed");
        JSONObject state=local.getJSONObject("state");
        require(state.isNull("activeRun")&&state.isNull("suspended"),"unfinished_run");
        JSONObject exp=state.getJSONObject("profile").optJSONObject("exp");
        require(exp==null||exp.isNull("raid"),"unfinished_run");
        JSONObject book=state.optJSONObject("expeditionTeams"),parties=book==null?null:book.optJSONObject("parties");
        if(parties!=null){
            Iterator<String>keys=parties.keys();while(keys.hasNext()){
                JSONObject group=parties.getJSONObject(keys.next());JSONArray pending=group.optJSONArray("pending");
                require(group.optBoolean("settled")&&(pending==null||pending.length()==0),"pending_expedition_returns");
            }
        }
        JSONObject remote=new JSONObject(request.getJSONObject("save").toString());
        JSONObject incoming=remote.getJSONObject("state");
        require(incoming.isNull("activeRun")&&incoming.isNull("suspended")&&!incoming.has("expeditionTeams"),"invalid_cloud_save");
        incoming.put("playerId",state.getString("playerId")).put("updatedAt",System.currentTimeMillis());
        incoming.getJSONObject("profile").put("settings",new JSONObject(state.getJSONObject("profile").getJSONObject("settings").toString()));
        validate(remote);ensureDirectory();
        Files.copy(current.getBaseFile().toPath(),new File(directory,"before-cloud-"+System.currentTimeMillis()+"-"+UUID.randomUUID()+".json").toPath());
        write(previous,local.toString());write(current,remote.toString());epoch=UUID.randomUUID().toString();
    }
    private void ensureDirectory() throws IOException { require(directory.isDirectory() || directory.mkdirs(), "Cannot create Standard saves directory."); }
    private static void write(AtomicFile target, String text) throws IOException {
        FileOutputStream stream = null;
        try {
            stream = target.startWrite();
            stream.write(text.getBytes(StandardCharsets.UTF_8));
            stream.getFD().sync();
            target.finishWrite(stream);
        } catch (IOException error) { if (stream != null) target.failWrite(stream); throw error; }
    }
}
