// Trusted desktop host only. Distribution choice never accepts an arbitrary URL.
export function updateDistribution({platform, arch, packaged = true, env = {}, nsisInstalled = false}) {
  const native = `${platform}-${arch}`;
  if (native === "win32-x64") {
    if (env.PORTABLE_EXECUTABLE_FILE) return "win32-x64-portable";
    return nsisInstalled || !packaged ? native : "win32-x64-zip";
  }
  if (native === "linux-x64" && packaged && !env.APPIMAGE) return "linux-x64-deb";
  return native;
}
export function installationInstructions(kind) {
  const action = {
    dmg: "Quit the game, open the downloaded DMG, and drag PokéBonk Offline into Applications, replacing the previous app. This app is ad-hoc signed, not notarized; macOS may require your approval.",
    zip: "Quit the game, extract the downloaded ZIP into a new folder, and replace the previous application folder.",
    nsis: "Quit the game and run the downloaded setup EXE to update the existing installation. You do not need to uninstall first.",
    portable: "Quit the game and replace your previous portable EXE with the downloaded portable EXE.",
    AppImage: "Quit the game, mark the downloaded AppImage executable, and replace the previous AppImage.",
    deb: "Quit the game and install the downloaded DEB with your system's package manager to upgrade the existing installation.",
  }[kind];
  if (!action) throw new Error("Unsupported installation format.");
  return `${action}\n\nSaves are stored separately and are kept. Keep the previous app if you have an unfinished run. Nothing is installed automatically.`;
}
