import {requestUpstream} from './upstream-request.ts';
import type {AnyNode} from 'acorn';
import {ast,literal,maybeName,nodesOf} from './source.ts';
import {buildId,version} from '../types/release.ts';

export function versionForBuild(tree:AnyNode,build:string) {
  const matches=nodesOf(tree,'ObjectExpression',n=>n.properties.some(p=>p.type==='Property'&&maybeName(p.key)==='build'&&literal(p.value)===build));
  const versions=matches.map(n=>{
    const entry=n.properties.find(p=>p.type==='Property'&&maybeName(p.key)==='version');
    return version(entry?.type==='Property'?literal(entry.value):undefined);
  });
  // 0.10.x exports adjacent build/version constants instead of a metadata
  // object. Require both exports and the asset-version catalog so changelog
  // strings or unrelated modules cannot be mistaken for the current version.
  if (!versions.length) {
    const exported = new Set(nodesOf(tree, 'ExportSpecifier').map(node => maybeName(node.local)));
    const catalog = nodesOf(tree, 'ObjectExpression', node =>
      ['models', 'pmd', 'data/pokemon.json'].every(key =>
        node.properties.some(property => property.type === 'Property' && maybeName(property.key) === key)));
    if (catalog.length === 1) for (const declaration of nodesOf(tree, 'VariableDeclaration')) {
      for (let i = 0; i < declaration.declarations.length - 1; i++) {
        const entry = declaration.declarations[i], next = declaration.declarations[i + 1];
        if (entry && next && literal(entry.init) === build && exported.has(maybeName(entry.id))
          && exported.has(maybeName(next.id)) && typeof literal(next.init) === 'string'
          && /^\d+\.\d+\.\d+$/.test(String(literal(next.init)))) versions.push(version(literal(next.init)));
      }
    }
  }
  const unique=[...new Set(versions)];
  if(unique.length>1)throw new Error('Conflicting upstream versions for build');
  return unique[0];
}
export async function discoverUpstream(request:(url:string)=>Promise<Response>=requestUpstream) {
  const origin='https://pokebonk.com';
  const get=async(url:string)=>{
    const response=await request(url);
    if(!response.ok)throw new Error(`Upstream request: ${response.status}`);
    if(Number(response.headers.get('content-length'))>4*1024*1024)throw new Error('Upstream module too large');
    const source=await response.text();
    if(Buffer.byteLength(source)>4*1024*1024)throw new Error('Upstream module too large');
    return source;
  };
  const html=await get(origin+'/index.html?offline-check='+Date.now());
  const build=buildId(html.match(/name="pokebonk-build" content="([\w-]+)"/)?.[1]);
  const urls=[...html.matchAll(/(?:src|href)=["']([^"']+\.js)["']/g)].map(match=>new URL(match[1]??'',origin).href);
  const seen=new Set<string>();
  while(urls.length) {
    const url=urls.shift();if(!url||seen.has(url))continue;
    const parsed=new URL(url);
    if(parsed.origin!==origin||!/^\/assets\/[\w.-]+\.js$/.test(parsed.pathname))throw new Error('Unsupported upstream module URL');
    seen.add(url);if(seen.size>48)throw new Error('Upstream module graph exceeded limit');
    const tree=ast(await get(url));
    const upstreamVersion=versionForBuild(tree,build);
    if(upstreamVersion)return {build,upstreamVersion};
    for(const node of nodesOf(tree,'ImportDeclaration')) {
      const target=literal(node.source);if(typeof target==='string')urls.push(new URL(target,url).href);
    }
    for(const node of nodesOf(tree,'ImportExpression')) {
      const target=literal(node.source);if(typeof target==='string')urls.push(new URL(target,url).href);
    }
  }
  throw new Error('No upstream version matches HTML build');
}
