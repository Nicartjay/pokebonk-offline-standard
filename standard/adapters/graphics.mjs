import {nodesOf, one, maybeName, literal} from "../../scripts/source.ts";

// Insert into the original renderer, retaining its canvas/composer sizing,
// WebGL recovery, camera, explicit pixel-art mode and adaptive-resolution code.
export function graphicsEdits(source, tree) {
  const renderer = one([...nodesOf(tree,"ClassExpression"), ...nodesOf(tree,"ClassDeclaration")]
    .filter(node => ["setQuality","resize","setDynRes"].every(key =>
      node.body.body.some(method => maybeName(method.key) === key))), "graphics renderer contract");
  const method = key => one(renderer.body.body.filter(node => maybeName(node.key) === key), "graphics " + key);
  const resize = method("resize"), quality = method("setQuality");
  const input = maybeName(quality.value.params[0]);
  const call = one(nodesOf(resize,"CallExpression",node =>
    node.callee.type === "MemberExpression" && maybeName(node.callee.property) === "setPixelRatio" &&
    node.callee.object.type === "MemberExpression" && maybeName(node.callee.object.property) === "renderer"),
  "graphics drawing-buffer scale");
  const ratio = maybeName(call.arguments[0]);
  const dimension = key => maybeName(one(nodesOf(resize,"VariableDeclarator",node =>
    node.init?.type === "MemberExpression" && maybeName(node.init.object) === "window" &&
    maybeName(node.init.property) === key), "graphics viewport " + key).id);
  const width = dimension("innerWidth"), height = dimension("innerHeight");
  if (!input || !ratio || !width || !height) throw Error("Unsupported graphics renderer bindings.");
  const size = one(nodesOf(resize,"VariableDeclaration",node => node.declarations.some(declaration => {
    const value = declaration.init;
    return value?.type === "TemplateLiteral" && value.expressions.length === 3 &&
      [width,height,ratio].every((name,index) => maybeName(value.expressions[index]) === name);
  })), "graphics size-cache key");
  if (!source.slice(quality.start,quality.end).includes("this.quality") || size.start > call.start)
    throw Error("Unsupported graphics quality/resize order.");
  const apply = one(nodesOf(tree,"MethodDefinition",node => maybeName(node.key) === "applySettings"),
    "graphics settings application");
  return [
    {start: quality.value.body.start + 1, end: quality.value.body.start + 1,
      text: `${input}=globalThis.PokeBonkOfflineUI.graphicsQuality(${input});`},
    {start: size.start, end: size.start,
      text: `${ratio}=globalThis.PokeBonkOfflineUI.renderPixelRatio(this,${width},${height},${ratio});`},
    {start: apply.value.body.end - 1, end: apply.value.body.end - 1,
      text: ";globalThis.PokeBonkOfflineUI.syncGraphicsSettings(this);"},
  ];
}

export function fpsSettingsReplacements(source, owner) {
  const app = maybeName(owner.params[0]);
  const binding = "__offlineGraphicsApp";
  if (nodesOf(owner,"Identifier",node => node.name === binding).length)
    throw Error("Unsupported FPS settings binding collision.");
  const control = one(nodesOf(owner,"VariableDeclarator",node =>
    node.init?.type === "ArrowFunctionExpression" && node.init.body.type === "BlockStatement" &&
    node.init.body.body.some(statement => statement.type === "ReturnStatement") &&
    nodesOf(node.init,"AssignmentExpression",assignment =>
      assignment.left.type === "MemberExpression" && maybeName(assignment.left.property) === "fpsLimit").length === 1),
  "FPS setting renderer");
  const returned = one(control.init.body.body.filter(node => node.type === "ReturnStatement"),
    "FPS setting row").argument;
  const options = one(nodesOf(control.init,"ArrayExpression",node =>
    node.elements.every(value => typeof literal(value) === "string" && /^\d+$/.test(literal(value))) &&
    node.elements.some(value => literal(value) === "30") && node.elements.some(value => literal(value) === "0")),
  "FPS setting options");
  if (!app || !returned) throw Error("Unsupported FPS settings bindings.");
  // The inner FPS renderer commonly shadows the outer app's minified name
  // with its own rebuild callback. Capture app once outside that scope.
  return [
    {node:{start:owner.body.start+1,end:owner.body.start+1},raw:true,
      text:`const ${binding}=${app};`},
    {node:returned,raw:true,
      text:`globalThis.PokeBonkOfflineUI.fpsSettingsRow(${binding},(${source.slice(returned.start,returned.end)}),${source.slice(options.start,options.end)})`},
  ];
}
