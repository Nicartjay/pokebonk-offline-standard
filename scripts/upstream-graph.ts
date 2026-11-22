/**
 * Vite dependency tables use root-relative `assets/...` entries as well as
 * normal ESM `./...` imports. Treat the former as site-root paths, not as
 * children of the importing /assets/ module.
 */
export function discoverGraphAssets(source: string, parent: string, origin = 'https://pokebonk.com') {
  const found = new Set<string>();
  const pattern = /["'`(]((?:\.?\.?\/|\/?(?:assets|icons)\/)[A-Za-z0-9_./-]+\.(?:js|css|png|svg|webp|woff2?|ico|webmanifest))(?:["'`)\s?])/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[1];
    if (!value) continue;
    const url = new URL(/^(?:assets|icons)\//.test(value) ? '/' + value : value, new URL(parent, origin));
    if (url.origin === origin && /^\/[\w./-]+$/.test(url.pathname)) found.add(url.pathname);
  }
  return [...found];
}
