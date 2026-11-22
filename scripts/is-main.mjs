import path from "node:path";
import {pathToFileURL} from "node:url";
// Works with Windows argv paths as well as POSIX paths.
export function isMain(url) {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === url;
}
