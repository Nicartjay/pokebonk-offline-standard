// Review tooling only. This captures public source; it never accepts/promotes it.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {requestUpstream} from './upstream-request.ts';
import {discoverGraphAssets} from './upstream-graph.ts';
import {record, list, text, finite} from '../types/data.ts';

const origin = 'https://pokebonk.com';
const root = path.resolve('upstream');
const output = path.resolve(process.argv[2] ?? 'upstream/live-review');
if (!output.startsWith(root + path.sep)) throw new Error('Review output must stay inside this checkout’s upstream directory');
const files = new Map<string, Buffer>();
const reused = new Map<string, {name:string;bytes:number;sha256:string}>();
// Immutable Vite filenames may be reused only after checking the previous
// capture's exact bytes. Always re-request HTML/legal and new hashed modules.
const previous = path.resolve('upstream/live-review');
try {
  const cache = record(JSON.parse(await readFile(path.join(previous, 'graph.json'), 'utf8')));
  for (const entry of list(cache['files'], value => {
    const item = record(value);
    return {name:text(item['name']),bytes:finite(item['bytes']),sha256:text(item['sha256'])};
  })) {
    if (/^assets\/[\w-]+-[\w-]+\.(?:woff2?|css|js)$/.test(entry.name)) reused.set('/'+entry.name,entry);
  }
} catch {}
const pending = new Set(['/index.html', '/legal.html']);
let bytes = 0;
while (pending.size) {
  const batch = [...pending].slice(0, 8);
  batch.forEach(name => pending.delete(name));
  await Promise.all(batch.map(async name => {
    if (files.has(name)) return;
    let data:Buffer|undefined;
    const cached=reused.get(name);
    if(cached)try{
      const bytes=await readFile(path.join(previous,cached.name));
      if(bytes.length===cached.bytes&&createHash('sha256').update(bytes).digest('hex')===cached.sha256)data=bytes;
    }catch{}
    if(!data){
      const response = await requestUpstream(new URL(name, origin), {maxBytes: 32 * 1024 * 1024});
      if (!response.ok) throw new Error(`Public source ${response.status}: ${name}`);
      data = Buffer.from(await response.arrayBuffer());
    }
    files.set(name, data);
    bytes += data.length;
    if (files.size > 3000 || bytes > 256 * 1024 * 1024) throw new Error('Source review budget exceeded');
    if (/\.(?:html|js|css|webmanifest)$/.test(name)) {
      for (const asset of discoverGraphAssets(data.toString(), name)) {
        if (!files.has(asset)) pending.add(asset);
      }
    }
  }));
  console.log(`Reviewed ${files.size} source/font files (${(bytes / 1024 / 1024).toFixed(1)} MiB)`);
}
const build = files.get('/index.html')?.toString().match(/name="pokebonk-build" content="([\w-]+)"/)?.[1];
if (!build) throw new Error('Missing current build identifier');
if (process.env['EXPECTED_BUILD'] && process.env['EXPECTED_BUILD'] !== build) throw new Error('Live build changed during review');
for (const [name, data] of files) {
  const target = path.join(output, name.slice(1));
  await mkdir(path.dirname(target), {recursive: true});
  await writeFile(target, data);
}
await writeFile(path.join(output, 'graph.json'), JSON.stringify({
  origin, build, capturedAt: new Date().toISOString(),
  files: [...files].map(([name, data]) => ({
    name: name.slice(1), bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  })).sort((a, b) => a.name.localeCompare(b.name)),
}, null, 2) + '\n');
console.log(`Captured ${build} for review only at ${output}`);
