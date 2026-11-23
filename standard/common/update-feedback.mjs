// Presentation only. No requests, updater commands, URLs or native APIs.
export function updateFeedbackView(value, config) {
  if (!value || !["checking", "current", "ahead", "error"].includes(value.state)) return null;
  const version = text => typeof text === "string" && /^\d+\.\d+\.\d+$/.test(text) ? `v${text}` : null;
  const latest = version(value.latestVersion);
  if (["current", "ahead"].includes(value.state) && !latest) return null;
  const text = {
    checking: ["Checking for updates…", "Looking for the latest verified PokéBonk Offline app release on GitHub."],
    current: ["You’re up to date", "Your installed app matches the latest public release. No update is needed."],
    ahead: ["No newer public release", "You’re using a newer test build than the latest public release. There’s no newer published version to download."],
    error: ["Couldn’t check for updates", "We couldn’t reach the update service or verify its response. Check your connection and try again."],
  }[value.state];
  return {
    state: value.state, title: text[0], summary: text[1], checking: value.state === "checking",
    rows: [
      ["Installed app", version(config.version)],
      ["Latest public release", latest ?? (value.state === "checking" ? "Checking…" : "Not available")],
      ["Bundled game", `${version(config.upstream.version)} (${config.upstream.build})`],
    ],
    detail: value.state === "error" && typeof value.detail === "string" ? value.detail.slice(0, 600) : "",
    note: value.state === "checking" ? "Nothing is being downloaded or installed. You can close this window while the check continues." :
      value.state === "error" ? "You can keep playing offline. Your installed app and saves have not changed." :
      "This checks offline app releases—not changes on the live game website. Website changes arrive after they’re included in an app release.",
  };
}
