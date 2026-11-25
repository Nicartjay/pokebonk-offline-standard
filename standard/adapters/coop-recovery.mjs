import {nodesOf,maybeName,one,literal} from "../../scripts/source.ts";
// Reviewed semantic hooks from the bundled engine, not minified class names.
export function requireCoopRecoveryContract(tree) {
  const classes=nodesOf(tree,"ClassExpression");
  const network=one(classes.filter(node=>["recovered","lost","peerGone","sendState","sendTotals","sendSnapshots"]
    .every(name=>node.body.body.some(method=>maybeName(method.key)===name))),"co-op live recovery engine");
  const pause=one(classes.filter(node=>["ask","vote","settle","tick"].every(name=>node.body.body.some(method=>maybeName(method.key)===name))&&
    node.body.body.some(method=>method.kind==="get"&&maybeName(method.key)==="frozen")),"co-op pause/freeze contract");
  for(const property of ["known","peers","hbDirty","hbT","mapFullAt"])
    one(nodesOf(network,"MethodDefinition",node=>maybeName(node.key)==="constructor"&&
      [...nodesOf(node,"Literal"),...nodesOf(node,"TemplateLiteral")].some(value=>literal(value)===property)),`co-op ${property} state`);
  const run=one(classes.filter(node=>["result","leanResult","finish"].every(name=>
    node.body.body.some(method=>maybeName(method.key)===name))),"co-op abandonment lifecycle");
  const finish=one(run.body.body.filter(method=>maybeName(method.key)==="finish"),"run finish");
  for(const name of ["endRun","onFinish","releaseLock"])
    if(!nodesOf(finish,"CallExpression",node=>maybeName(node.callee.property)===name).length)
      throw Error(`Unsupported upstream: run finish ${name}`);
  return {network,pause,run};
}
