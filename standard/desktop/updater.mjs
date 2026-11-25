import {readFile} from "node:fs/promises";
import path from "node:path";
import {atomicWrite} from "../common/store.mjs";
import {verifyManifest, compareVersions, selectArtifact, checkSaveCompatibility} from "../common/manifest.mjs";
import {fetchManifest, downloadArtifact, verifyArtifactFile} from "../common/network.mjs";
export const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export class StandardUpdater {
  constructor({config, directory, platform, distribution = platform, loadSave, now = Date.now, fetch = fetchManifest, download = downloadArtifact, onFeedback = () => {}}) {
    Object.assign(this, {config, directory, platform, distribution, loadSave, now, fetch, download, onFeedback});
    this.statusFile = path.join(directory, "update-status.json");
    this.checking = null;
    this.pending = null;
    this.ready = null;
  }
  information(pending = this.pending) {
    if (!pending) return {};
    const {manifest, artifact} = pending;
    return {latestVersion: manifest.version, upstreamVersion: manifest.upstream.version, upstreamBuild: manifest.upstream.build,
      notes: manifest.notes, kind: artifact.kind, totalBytes: artifact.bytes};
  }
  publish(state, extra = {}) {
    this.feedback = {state, ...this.information(), ...extra};
    try { this.onFeedback(this.feedback); }
    catch { /* Rendering failures do not alter verification or the transfer. */ }
    return this.feedback;
  }
  async status() {
    try {
      const value = JSON.parse(await readFile(this.statusFile, "utf8"));
      return {lastCheck: Number.isFinite(value.lastCheck) ? value.lastCheck : 0,
        highestSeen: /^\d+\.\d+\.\d+$/.test(value.highestSeen) ? value.highestSeen : "0.0.0"};
    } catch { return {lastCheck: 0, highestSeen: "0.0.0"}; }
  }
  async check(manual = false) {
    if (this.downloading || this.installing || this.ready) return {active: true};
    if (this.checking) return this.checking;
    this.checking = this.doCheck(manual).finally(() => { this.checking = null; });
    return this.checking;
  }
  async doCheck(manual) {
    const status = await this.status(), now = this.now();
    if (!manual && status.lastCheck <= now && now - status.lastCheck < CHECK_INTERVAL) return {skipped: true};
    // Record attempts, including offline failures. Never retry every focus event.
    await atomicWrite(this.statusFile, JSON.stringify({...status, lastCheck: now}));
    const signed = await this.fetch(this.config.channelUrl);
    const manifest = verifyManifest(signed, this.config);
    if (compareVersions(manifest.version, status.highestSeen) < 0) throw new Error("Rejected a rolled-back update manifest.");
    await atomicWrite(this.statusFile, JSON.stringify({lastCheck: now, highestSeen: manifest.version}));
    if (compareVersions(manifest.version, this.config.version) <= 0) {
      this.pending = null;
      return {current: true, latestVersion: manifest.version, ahead: compareVersions(this.config.version, manifest.version) > 0};
    }
    const artifact = selectArtifact(manifest, this.platform, this.config, this.distribution);
    this.pending = {manifest, artifact, signed};
    return this.pending;
  }
  async downloadPending() {
    if (this.downloading || this.installing) throw new Error("An update is already being processed.");
    if (!this.pending) throw new Error("Check for an update first.");
    if (this.ready) { this.publish("ready"); return this.ready; }
    const pending = this.pending;
    // Take the lock before any await, including the save compatibility read.
    this.downloading = true;
    try {
      // Verify again at use time; do not trust mutable UI metadata.
      const manifest = verifyManifest(pending.signed, this.config);
      checkSaveCompatibility(manifest, await this.loadSave());
      const artifact = selectArtifact(manifest, this.platform, this.config, this.distribution);
      this.publish("downloading", {receivedBytes: 0});
      const file = await this.download(artifact, path.join(this.directory, "updates"), undefined, {
        onProgress: value => this.publish(value.phase === "verifying" ? "verifying" : "downloading", {receivedBytes: value.receivedBytes}),
      });
      checkSaveCompatibility(manifest, await this.loadSave());
      this.ready = {file, manifest, artifact, signed: pending.signed};
      this.publish("ready", {receivedBytes: artifact.bytes});
      return this.ready;
    } catch (error) {
      this.publish("error", {errorStage: "download", detail: error.message, retryAction: "download-update"});
      throw error;
    } finally { this.downloading = false; }
  }
  async prepareInstall() {
    if (!this.ready || this.downloading) throw new Error("Download and verify an update first.");
    const ready = this.ready, manifest = verifyManifest(ready.signed, this.config);
    const artifact = selectArtifact(manifest, this.platform, this.config, this.distribution);
    if (compareVersions(manifest.version, this.config.version) <= 0 ||
        compareVersions(manifest.version, (await this.status()).highestSeen) < 0 ||
        path.resolve(ready.file) !== path.resolve(this.directory, "updates", artifact.name)) {
      this.ready = null;
      throw new Error("The downloaded update no longer matches the verified release. Check for updates again.");
    }
    checkSaveCompatibility(manifest, await this.loadSave());
    try { await verifyArtifactFile(artifact, ready.file); }
    catch (error) { this.ready = null; throw error; }
    return {...ready, manifest, artifact};
  }
}
