import {mkdir, open, readFile, rename, copyFile, rm, lstat} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {validateEnvelope, MAX_STATE_BYTES} from "./state.mjs";

export async function atomicWrite(file, bytes) {
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
    // fsync the directory where supported, so a power loss cannot lose the rename.
    try { const directory = await open(path.dirname(file), "r"); try { await directory.sync(); } finally { await directory.close(); } } catch {}
  } finally { await rm(temporary, {force: true}); }
}

export class StateStore {
  constructor(directory, config) {
    this.directory = directory;
    this.config = config;
    this.file = path.join(directory, "state.json");
    this.backup = path.join(directory, "previous.json");
    this.queue = Promise.resolve();
    this.readFailed = false;
  }
  async read(file) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > MAX_STATE_BYTES) throw new Error("Invalid native save file.");
    return validateEnvelope(JSON.parse(await readFile(file, "utf8")), this.config);
  }
  async loadState() {
    await this.queue.catch(() => {});
    try { const state = await this.read(this.file); this.readFailed = false; return state; }
    catch (error) {
      if (error.code === "ENOENT") {
        // A missing primary with a backup is NOT a fresh install.
        try { await lstat(this.backup); } catch (missing) { if (missing.code === "ENOENT") return null; throw missing; }
      }
      this.readFailed = true;
      throw new Error(`${error.message} No save was replaced. Restore previous.json or an exported backup through the native Saves menu.`);
    }
  }
  saveState(value) {
    const next = structuredClone(validateEnvelope(value, this.config));
    const operation = this.queue.catch(() => {}).then(async () => {
      if (this.readFailed) throw new Error("Save is locked after a read failure. Explicitly import a backup first.");
      // Never overwrite a damaged/incompatible primary with a fresh save.
      let previous;
      try { previous = await this.read(this.file); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (previous) await atomicWrite(this.backup, JSON.stringify(previous));
      await atomicWrite(this.file, JSON.stringify(next));
      return true;
    });
    this.queue = operation;
    return operation;
  }
  // Native-menu-only recovery. The renderer does not receive a recovery bypass.
  importState(value) {
    const next = structuredClone(validateEnvelope(value, this.config));
    const operation = this.queue.catch(() => {}).then(async () => {
      await mkdir(this.directory, {recursive: true, mode: 0o700});
      // Keep an immutable pre-import copy, even when the old primary is corrupt.
      try { await copyFile(this.file, path.join(this.directory, `before-import-${Date.now()}-${randomUUID()}.json`)); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await atomicWrite(this.file, JSON.stringify(next));
      this.readFailed = false;
      return true;
    });
    this.queue = operation;
    return operation;
  }
}
