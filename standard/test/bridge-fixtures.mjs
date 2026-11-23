import assert from "node:assert/strict";

export function androidBridgeMethods(source, name) {
  const declaration = `    public final class ${name}`;
  const bridge = source.split(/(?=^    public final class )/m)
    .filter(part => part.startsWith(declaration + " ") || part.startsWith(declaration + "{"));
  assert.equal(bridge.length, 1, `Expected one ${name} bridge.`);
  return [...bridge[0].matchAll(/@JavascriptInterface\s+public\s+\w+\s+(\w+)\s*\(/g)].map(match => match[1]);
}
