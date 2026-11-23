// Called only by the trusted host following a user-clicked, fixed UI action.
// Never includes a save, account name, logs, arbitrary URL or renderer text.
export function issueFormURL(config, platform) {
  if (config.repository !== "Nicartjay/pokebonk-offline-standard") throw new Error("Unknown issue destination.");
  const url = new URL(`https://github.com/${config.repository}/issues/new`);
  url.search = new URLSearchParams({
    title: `[Bug] PokéBonk Offline v${config.version}`,
    body: `Offline app: v${config.version}\nBundled game: v${config.upstream.version} (${config.upstream.build})\nPlatform: ${platform}\n\n## What happened?\n\n## Steps to reproduce\n1. \n\n## What did you expect?\n\n## Screenshots (optional)\n\nDo not attach your save or other private information unless you choose to share it.`,
  }).toString();
  return url.href;
}
