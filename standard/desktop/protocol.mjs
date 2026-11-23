import path from "node:path";
export const ORIGIN = "pokebonk-standard://game";
export const CSP = "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".txt": "text/plain", ".ico": "image/x-icon", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".glb": "model/gltf-binary", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
};
export function isGameURL(value) {
  try { const u = new URL(value); return u.protocol === "pokebonk-standard:" && u.host === "game" && !u.username && !u.password; }
  catch { return false; }
}
// A loading spinner is not proof of a page reload. In-document navigation
// (including the original menus' history changes) must keep the room alive.
// Positional arguments support Electron's older event signature as well.
export function endsLanSessionForNavigation(details,legacySameDocument,legacyMainFrame) {
  const main=typeof details?.isMainFrame==="boolean"?details.isMainFrame:legacyMainFrame;
  const same=typeof details?.isSameDocument==="boolean"?details.isSameDocument:legacySameDocument;
  return main===true&&same===false;
}
export function allowLanBrokerPermission(permission,origin,{trusted,isMainFrame,phase}){
  return trusted===true&&isMainFrame===true&&isGameURL(origin)&&
    ["local-network","local-network-access"].includes(permission)&&
    ["connecting","hosting","lobby","preparing","playing"].includes(phase);
}
export function resolveAsset(root, value) {
  if (!isGameURL(value)) throw new Error("Blocked origin.");
  const raw = decodeURIComponent(new URL(value).pathname);
  if (raw.includes("\\") || raw.includes("\0") || raw.split("/").some(p => p === ".." || p === ".")) throw new Error("Invalid asset path.");
  const relative = raw.replace(/^\/+/, "").replace(/^assets\/assets\//, "assets/") || "index.html";
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error("Asset path escape.");
  return resolved;
}
export function byteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error("Invalid byte range.");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error("Unsatisfiable range.");
  return {start, end: Math.min(end, size - 1)};
}
