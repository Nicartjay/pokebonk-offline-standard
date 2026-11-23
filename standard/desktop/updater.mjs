import {readFile} from "node:fs/promises";
import path from "node:path";
import {atomicWrite} from "../common/store.mjs";
import {verifyManifest, compareVersions, selectArtifact, checkSaveCompatibility} from "../common/manifest.mjs";
import {fetchManifest, downloadArtifact} from "../common/network.mjs";
export const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export class StandardUpdater {
  constructor({config, directory, platform, distribution = platform, loadSave, now = Date.now, fetch = fetchManifest, download = downloadArtifact}) {
    Object.assign(this, {config, directory, platform, distribution, loadSave, now, fetch, download});
    this.statusFile = path.join(directory, "update-status.json");
    this.checking = null;
    this.pending = null;
  }
  async status() {
    try {
      const value = JSON.parse(await readFile(this.statusFile, "utf8"));
      return {lastCheck: Number.isFinite(value.lastCheck) ? value.lastCheck : 0,
        highestSeen: /^\d+\.\d+\.\d+$/.test(value.highestSeen) ? value.highestSeen : "0.0.0"};
    } catch { return {lastCheck: 0, highestSeen: "0.0.0"}; }
  }
  async check(manual = false) {
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
    if (this.downloading) throw new Error("An update is already downloading.");
    if (!this.pending) throw new Error("Check for an update first.");
    const pending = this.pending;
    // Verify again at use time; do not trust mutable UI metadata.
    const manifest = verifyManifest(pending.signed, this.config);
    checkSaveCompatibility(manifest, await this.loadSave());
    const artifact = selectArtifact(manifest, this.platform, this.config, this.distribution);
    this.downloading = true;
    try {
      const file = await this.download(artifact, path.join(this.directory, "updates"));
      checkSaveCompatibility(manifest, await this.loadSave());
      return {file, manifest, artifact};
    } finally { this.downloading = false; }
  }
}
