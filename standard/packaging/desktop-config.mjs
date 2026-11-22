import path from "node:path";
import {artifactName} from "../common/manifest.mjs";

// No electron-updater or website publishing. The trusted native updater verifies
// our dedicated signed manifest and leaves installation to the user.
export function desktopConfiguration(config, {app, output, game, resources, electronVersion}) {
  const name = id => artifactName(config.version, id);
  return {
    appId: config.applicationId,
    productName: config.productName,
    electronVersion,
    directories: {app, output, buildResources: resources},
    files: ["standard/desktop/**", "standard/common/**", "standard/config.json", "package.json", "LICENSE", "NOTICE.md", "README.md"],
    extraResources: [{from: game, to: "game", filter: ["**/*"]}],
    asar: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    publish: null,
    copyright: "Original game: Charcher. Shell tooling: VdustR. Offline integration: Nicartjay.",
    mac: {
      target: ["dmg", "zip"],
      artifactName: `pokebonk-offline-${config.version}-darwin-\${arch}.\${ext}`,
      icon: path.join(resources, "icon.png"),
      category: "public.app-category.games",
      minimumSystemVersion: "13.0",
      identity: "-",
      hardenedRuntime: false,
      gatekeeperAssess: false,
      notarize: false,
      extendInfo: {CFBundleName: config.productName, CFBundleDisplayName: config.productName},
    },
    dmg: {
      title: config.productName,
      backgroundColor: "#1a1630",
      iconSize: 96,
      window: {width: 540, height: 380},
      contents: [{x: 140, y: 160}, {x: 400, y: 160, type: "link", path: "/Applications"}],
      writeUpdateInfo: false,
    },
    win: {
      target: ["nsis", "portable", "zip"],
      artifactName: name("win32-x64-zip"),
      icon: path.join(resources, "icon.png"),
      executableName: config.productName,
      signAndEditExecutable: true,
      signExecutable: false,
      requestedExecutionLevel: "asInvoker",
    },
    nsis: {
      artifactName: name("win32-x64"),
      oneClick: false,
      perMachine: false,
      allowElevation: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
      shortcutName: config.productName,
      uninstallDisplayName: config.productName,
      include: path.join(resources, "installer.nsh"),
    },
    portable: {
      artifactName: name("win32-x64-portable"),
      requestExecutionLevel: "user",
      unpackDirName: false,
    },
    linux: {
      target: ["AppImage", "deb"],
      executableName: "pokebonk-offline",
      syncDesktopName: true,
      icon: path.join(resources, "icon.png"),
      category: "Game",
      maintainer: "Nicartjay",
      desktop: {entry: {Name: config.productName, Comment: "Offline PokéBonk with normal progression"}},
    },
    // Linux targets otherwise substitute x86_64 / amd64 for ${arch}. Keep one
    // canonical x64 spelling across manifests, receipts and download filenames.
    appImage: {artifactName: name("linux-x64")},
    deb: {artifactName: name("linux-x64-deb"), packageName: "pokebonk-offline-standard", packageCategory: "games", priority: "optional"},
  };
}
