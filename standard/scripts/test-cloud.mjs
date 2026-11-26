import {readdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
const clients=(await readdir("standard/test")).filter(name=>/^cloud-.*\.test\.mjs$/.test(name)).map(name=>"standard/test/"+name);
const service=(await readdir("services/cloud-saves/test")).filter(name=>/\.test\.mjs$/.test(name)).map(name=>"services/cloud-saves/test/"+name);
execFileSync(process.execPath,["--test",...clients,...service],{stdio:"inherit"});
