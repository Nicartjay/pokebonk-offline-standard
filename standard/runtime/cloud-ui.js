// Cloud-save presentation only. The native host will own authentication,
// networking and restore decisions. Never pass tokens, paths or URLs here.
// Not imported by production until the optional native service is integrated.
export function createCloudSaveUI({modal, el, button, action, config, preview = false}) {
  let current, latest = {state: "off", connected: false, automatic: false};
  const icon = () => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("viewBox", "0 0 32 32");
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("class", "offline-cloud-icon");
    const path = document.createElementNS(node.namespaceURI, "path");
    path.setAttribute("d", "M9 24H8a6 6 0 0 1-1-12 9 9 0 0 1 17-1 6.5 6.5 0 0 1 0 13h-1M16 27V15m-4 4 4-4 4 4");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    node.append(path);
    return node;
  };
  const btn = (label, command, style = "btn blue") =>
    button(label, () => action(command), style);
  const pill = (text, on = false) => el("span", text, "offline-cloud-pill" + (on ? " on" : ""));
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : "—";
  const summary = (title, save, className = "") => {
    const card = el("section", null, "offline-cloud-save " + className);
    card.append(el("h4", title), el("strong", save?.name ?? "Your trainer"));
    const rows = el("dl");
    for (const [label, text] of [
      ["Usable Pokémon", number(save?.usable)],
      ["Stardust", number(save?.stardust)],
      ["Saved", save?.savedLabel ?? "On this device"],
    ]) {
      const row = el("div");
      row.append(el("dt", label), el("dd", text)); rows.append(row);
    }
    card.append(rows);
    return card;
  };
  const note = (text, className = "") => el("p", text, "offline-cloud-note " + className);
  const footer = body => {
    body.append(note("Graphics, audio, touch controls and other device settings stay on this device."));
    if (preview) body.append(el("small", "DESIGN PREVIEW · sample data · no account or cloud service connected",
      "offline-cloud-preview-label"));
  };
  function open(value = latest) {
    if (globalThis.PokeBonkNativeApp?.run) return false;
    latest = value;
    current?.close();
    const dialog = modal("Cloud saves", () => { if (current === dialog) current = null; });
    current = dialog;
    const {panel, close} = dialog;
    panel.classList.add("offline-player-card", "offline-cloud-card");
    panel.dataset.cloudState = value.state;
    const body = el("div", null, "offline-player-body offline-cloud-body");
    const hero = el("div", null, "offline-cloud-hero");
    const title = el("div");
    title.append(el("h3", value.state === "conflict" ? "Two different saves" :
      value.state === "off" ? "Your progress. Your devices." :
      value.state === "offline" ? "Saved here. Sync later." :
      value.state === "connecting" ? "Finish signing in" :
      value.state === "checking" ? "Checking your cloud save…" :
      value.state === "syncing" ? "Syncing completed progress…" :
      value.state === "error" ? "Couldn’t sync right now" :
      value.state === "unavailable" ? "Cloud saves aren’t available yet" : "Your progress is backed up"),
      el("p", value.state === "conflict" ? "Both devices have progress the other one doesn’t. Nothing has been replaced." :
        value.state === "off" ? "Entirely optional. Keep playing offline, or connect to carry your progress between devices." :
        value.state === "offline" ? "Your local save is safe. We’ll try again when you’re online and back at the homepage." :
        value.state === "connecting" ? "Use the sign-in page in your browser. Never enter your password inside the game." :
        value.state === "unavailable" ? "The installed app is not connected to a configured cloud-save service. Local saves work normally." :
        value.state === "error" ? "The cloud service could not be reached or verified. Your local progress is unchanged." :
        ["checking", "syncing"].includes(value.state) ? "Playing offline and local saving do not depend on this request." :
        "Continue on another device with the same connected account."));
    const symbol = el("span", null, "offline-cloud-symbol");
    symbol.append(icon());
    hero.append(symbol, title);
    const status = el("div", null, "offline-cloud-status");
    status.append(pill(value.state === "off" ? "OFF" : value.state === "conflict" ? "NEEDS YOUR CHOICE" :
      value.state === "offline" ? "WAITING FOR INTERNET" :
      value.state === "unavailable" ? "NOT CONFIGURED" :
      value.state === "error" ? "RETRY LATER" :
      ["connecting", "checking", "syncing"].includes(value.state) ? "IN PROGRESS" : "CONNECTED",
      value.state === "synced"),
      el("span", "Optional · local saves always stay on", "offline-cloud-status-text"));
    body.append(hero, status);

    if (value.state === "off") {
      const steps = el("div", null, "offline-cloud-benefits");
      for (const [label, text] of [
        ["Play offline", "Local saves remain the main copy."],
        ["Sync when ready", "Manual sync first. Auto-sync is your choice."],
        ["Stay protected", "Choose between conflicting saves. Never merge balances."],
      ]) {
        const row = el("div"); row.append(el("i", "✓"), el("div"));
        row.lastChild.append(el("strong", label), el("span", text)); steps.append(row);
      }
      body.append(steps, note("Cloud saves store completed progress in the project’s private Cloudflare storage, not Google Drive. Unfinished runs and live co-op sessions stay on this device."));
      const consent = el("div", null, "offline-cloud-consent");
      consent.append(el("strong", "You’re in control"),
        el("span", "No account is required to play. Connecting starts sign-in only; automatic syncing remains off until you enable it."));
      body.append(consent);
      const actions = el("div", null, "offline-cloud-actions");
      actions.append(button("Keep playing offline", close, "btn ghost"),
        btn("Connect account", "connect"));
      body.append(actions);
    } else if (value.state === "conflict") {
      const saves = el("div", null, "offline-cloud-compare");
      saves.append(summary("THIS DEVICE", value.local, "local"),
        summary("CLOUD SAVE", value.cloud, "remote"));
      body.append(saves, note("A newer timestamp doesn’t always mean more progress. Choose a complete save—Stardust, inventory and rewards won’t be added together.", "offline-cloud-warning"));
      const actions = el("div", null, "offline-cloud-actions offline-cloud-conflict-actions");
      actions.append(btn("Use this device", "confirm-keep-local"),
        btn("Use cloud save", "confirm-use-cloud", "btn green"),
        button("Decide later", close, "btn ghost"));
      body.append(note("Choosing opens a confirmation. A recovery copy is kept before anything is replaced."), actions);
    } else if (value.connected === true) {
      const account = el("div", null, "offline-cloud-account");
      const details = el("div");
      details.append(el("strong", value.accountLabel ?? "Connected account"),
        el("span", "Last synced: " + (value.lastSyncedLabel ?? "Not yet")));
      account.append(details, btn("Disconnect", "confirm-disconnect", "btn ghost small"));
      const automatic = el("label", null, "offline-cloud-auto");
      const toggle = el("input"); toggle.type = "checkbox"; toggle.checked = value.automatic === true;
      toggle.setAttribute("role", "switch");
      toggle.addEventListener("change", () => action(toggle.checked ? "auto-on" : "auto-off"));
      const words = el("span");
      words.append(el("strong", "Automatically sync completed progress"),
        el("small", "Only while online at the homepage, after your local save is safely written."));
      automatic.append(words, toggle);
      body.append(account, automatic);
      const saves = el("div", null, "offline-cloud-compare");
      saves.append(summary("THIS DEVICE", value.local, "local"),
        summary("CLOUD SAVE", value.cloud, "remote"));
      body.append(saves);
      const actions = el("div", null, "offline-cloud-actions");
      actions.append(btn("Sync now", "sync"), btn("Restore a backup", "backups", "btn ghost"));
      body.append(actions, note("Restores ask first and keep a local recovery copy. Active runs and unresolved Expedition item returns must finish before syncing."));
    } else {
      const actions = el("div", null, "offline-cloud-actions");
      if (value.state === "connecting") actions.append(btn("Cancel sign-in", "cancel", "btn ghost"));
      else if (value.state === "error") actions.append(btn("Try again", "sync"));
      actions.append(button("Keep playing offline", close, "btn ghost"));
      body.append(actions);
    }
    footer(body);
    panel.append(body);
    return true;
  }
  function confirm(kind) {
    const restoring = kind === "use-cloud", disconnecting = kind === "disconnect";
    const {panel, close} = modal(disconnecting ? "Disconnect cloud saves?" :
      restoring ? "Restore cloud progress?" : "Replace the cloud save?");
    panel.classList.add("offline-player-card", "offline-cloud-card", "offline-cloud-confirm");
    const body = el("div", null, "offline-player-body offline-cloud-body");
    body.append(el("h3", disconnecting ? "Your local progress stays here." :
      restoring ? "This changes progress on this device." : "This makes this device’s progress the cloud copy."),
      el("p", disconnecting ?
        "Signing out stops automatic syncing on this device. It doesn’t erase this device’s save or the existing cloud backups." :
        restoring ? "A recovery copy of your current local save is created first. The selected cloud save must pass compatibility checks. Your device settings are kept." :
        "The existing cloud version is kept as a backup first. If another device changes the cloud save before confirmation finishes, you’ll be asked again."));
    const actions = el("div", null, "offline-cloud-actions");
    actions.append(button("Cancel", close, "btn ghost"), button(disconnecting ? "Disconnect" :
      restoring ? "Restore cloud save" : "Use this device", () => {
      close(); action(disconnecting ? "disconnect" : restoring ? "use-cloud" : "keep-local");
    }, "btn " + (restoring ? "green" : "blue")));
    body.append(actions);footer(body);panel.append(body);
  }
  function entry(value = latest) {
    const card = el("section", null, "offline-cloud-entry");
    const info = el("div");
    const title = el("h3", "Cloud saves");
    title.append(pill(value.connected ? "CONNECTED" : "OPTIONAL"));
    info.append(title, el("p", value.connected ? "Sync between your devices. Local saves always stay on." :
      "Off by default. Carry completed progress between your devices."));
    card.append(info, button(value.connected ? "Manage" : "Set up", () => open(value), "btn blue"));
    return card;
  }
  return {open, confirm, entry, close: () => current?.close()};
}
