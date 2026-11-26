// Presentation only. No requests, file paths, URLs or callable native APIs.
export function updateFeedbackView(value, config) {
  if (!value || !["checking", "current", "ahead", "available", "downloading", "verifying", "ready", "installing", "error"].includes(value.state)) return null;
  const version = text => typeof text === "string" && /^\d+\.\d+\.\d+$/.test(text) ? `v${text}` : null;
  const latest = version(value.latestVersion);
  const transfer = ["available", "downloading", "verifying", "ready", "installing"].includes(value.state);
  if ((transfer || ["current", "ahead"].includes(value.state)) && !latest) return null;
  const kinds = {dmg: "macOS DMG", zip: "Application ZIP", nsis: "Windows installer", portable: "Windows portable",
    AppImage: "Linux AppImage", deb: "Linux package", apk: "Android APK"};
  const kind = typeof value.kind === "string" && Object.hasOwn(kinds, value.kind) ? value.kind : null;
  const total = Number.isSafeInteger(value.totalBytes) && value.totalBytes > 0 && value.totalBytes <= 1024 ** 3 ? value.totalBytes : null;
  if (transfer && (!kind || total === null)) return null;
  if (value.state === "downloading" && (!Number.isSafeInteger(value.receivedBytes) || value.receivedBytes < 0 || value.receivedBytes > total)) return null;
  const received = Number.isSafeInteger(value.receivedBytes) && value.receivedBytes >= 0 && total !== null
    ? Math.min(value.receivedBytes, total) : 0;
  const megabytes = bytes => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  const busy = ["checking", "downloading", "verifying", "installing"].includes(value.state);
  const installNote = {
    dmg: "The game will close and open the verified DMG. Drag PokéBonk Offline into Applications and replace the old app.",
    zip: "The game will close and show the verified ZIP. Extract it and replace the previous application folder.",
    nsis: "The game will close and open the verified setup program. Update the existing installation—do not uninstall first.",
    portable: "The game will close and show the verified EXE. Replace your previous portable EXE with this file.",
    AppImage: "The game will close and show the verified AppImage. Make it executable and replace the previous AppImage.",
    deb: "The game will close and open the verified package in your system’s package manager.",
    apk: "Android will ask you to confirm installation. If asked, allow updates from this app, then tap Install update again.",
  }[kind];
  const stage = ["check", "download", "install"].includes(value.errorStage) ? value.errorStage : "check";
  const retry = ["download-update", "install-update"].includes(value.retryAction) && latest && kind && total !== null
    ? value.retryAction : "check-for-updates";
  const text = {
    checking: ["Checking for updates…", "Looking for the latest verified PokéBonk Offline app release on GitHub."],
    current: ["You’re up to date", "Your installed app matches the latest public release. No update is needed."],
    ahead: ["No newer public release", "You’re using a newer test build than the latest public release. There’s no newer published version to download."],
    available: ["An update is available", `${latest} is ready to download. Nothing changes until you choose to install.`],
    downloading: ["Downloading update…", "You can hide this window and keep playing while the download continues."],
    verifying: ["Verifying your download…", "Checking the signed release, file size and checksum before enabling installation."],
    ready: ["Ready to install", "Your download passed verification. Install whenever you’re ready."],
    installing: [kind === "apk" ? "Opening Android installer…" : "Opening your update…",
      kind === "apk" ? "Complete the installation in Android’s confirmation screen." : "The game will close after your verified update is opened."],
    error: stage === "download" ? ["Download didn’t finish", "The download could not be completed or verified. Check your connection and try again."] :
      stage === "install" ? ["Installation didn’t start", "We couldn’t open the verified update. Your installed app is unchanged."] :
      ["Couldn’t check for updates", "We couldn’t reach the update service or verify its response. Check your connection and try again."],
  }[value.state];
  const rows = [
    ["Installed app", version(config.version)],
    ["Latest public release", latest ?? (value.state === "checking" ? "Checking…" : "Not available")],
    ["Bundled game", `${version(transfer && version(value.upstreamVersion) ? value.upstreamVersion : config.upstream.version)} (${transfer && typeof value.upstreamBuild === "string" && /^[\w-]{4,80}$/.test(value.upstreamBuild) ? value.upstreamBuild : config.upstream.build})`],
  ];
  if (kind && total !== null) rows.push(["Download", `${kinds[kind]} · ${megabytes(total)}`]);
  return {
    state: value.state, title: text[0], summary: text[1], checking: value.state === "checking", busy, rows,
    steps: ["Release", "Download", "Verify", "Install"].map((label,index)=>{
      const active=({checking:0,current:0,ahead:0,available:0,downloading:1,verifying:2,ready:3,installing:3,
        error:stage==="download"?1:stage==="install"?3:0})[value.state];
      return {label,state:index<active?"done":index===active?"active":"next"};
    }),
    ...(value.state === "downloading" ? {percent: Math.floor(received / total * 100),
      progressText: `${megabytes(received)} / ${megabytes(total)}`} : {}),
    notes: transfer && typeof value.notes === "string" ? value.notes.slice(0, 20000) : "",
    primary: value.state === "available" ? {label: "Download update", action: "download-update"} :
      value.state === "ready" ? {label: "Install update", action: "install-update"} :
      value.state === "error" ? {label: retry === "download-update" ? "Retry download" : retry === "install-update" ? "Try install again" : "Check again", action: retry} :
      ["current", "ahead"].includes(value.state) ? {label: "Check again", action: "check-for-updates"} : null,
    detail: value.state === "error" && typeof value.detail === "string" ? value.detail.slice(0, 600) : "",
    note: value.state === "checking" ? "Nothing is being downloaded or installed. You can close this window while the check continues." :
      value.state === "error" ? "You can keep playing offline. Your installed app and saves have not changed." :
      ["ready", "installing"].includes(value.state) ? `${installNote} Your saves are stored separately and are kept.` :
      value.state === "downloading" ? "The percentage is based on the signed download size. Installation stays disabled until verification is complete." :
      value.state === "verifying" ? "The file has finished downloading. Installation is not yet enabled." :
      value.state === "available" ? "No automatic installation. Back up your save before updating." :
      "This checks offline app releases—not changes on the live game website. Website changes arrive after they’re included in an app release.",
  };
}
// Keep only bounded, presentation-only fields when reopening a hidden update.
// No download URL, native file path, method or signed manifest enters the UI.
export function updateFeedbackSnapshot(value,config){
  const view=updateFeedbackView(value,config);if(!view)return null;
  const snapshot={state:view.state,notes:view.notes,detail:view.detail};
  for(const key of ["latestVersion","upstreamVersion"])
    if(typeof value[key]==="string"&&/^\d+\.\d+\.\d+$/.test(value[key])&&value[key].length<=48)snapshot[key]=value[key];
  if(typeof value.upstreamBuild==="string"&&/^[\w-]{4,80}$/.test(value.upstreamBuild))snapshot.upstreamBuild=value.upstreamBuild;
  if(["dmg","zip","nsis","portable","AppImage","deb","apk"].includes(value.kind))snapshot.kind=value.kind;
  if(Number.isSafeInteger(value.totalBytes)&&value.totalBytes>0&&value.totalBytes<=1024**3)snapshot.totalBytes=value.totalBytes;
  if(Number.isSafeInteger(value.receivedBytes)&&value.receivedBytes>=0&&value.receivedBytes<=snapshot.totalBytes)
    snapshot.receivedBytes=value.receivedBytes;
  if(["check","download","install"].includes(value.errorStage))snapshot.errorStage=value.errorStage;
  if(["download-update","install-update"].includes(value.retryAction))snapshot.retryAction=value.retryAction;
  return snapshot;
}
