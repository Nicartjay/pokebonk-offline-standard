import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoverGraphAssets} from '../../scripts/upstream-graph.ts';

test('Vite tables and ESM/CSS references resolve to their actual public paths', () => {
  const source = `import "./menus.js"; const deps=["assets/main.css","assets/font.woff2"];url('./tile.webp?v=1')`;
  assert.deepEqual(discoverGraphAssets(source, '/assets/main.js').sort(), [
    '/assets/font.woff2', '/assets/main.css', '/assets/menus.js', '/assets/tile.webp',
  ]);
});

test('source discovery excludes foreign hosts and non-static URLs', () => {
  assert.deepEqual(discoverGraphAssets(`"https://other.example/assets/a.js" "javascript:alert(1)"`, '/index.html'), []);
});
