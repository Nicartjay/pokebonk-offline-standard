// Native-owned, one-use notification listener. No renderer bridge, account
// token, OAuth authorization code, file access, proxying or arbitrary routes.
import http from "node:http";
import {randomBytes} from "node:crypto";
import {cloudLoopbackURL} from "../common/cloud-return.mjs";
export function loopbackPage(){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Back to the game · PokéBonk Offline</title><style>
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;padding:24px;min-height:100svh;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 0%,#3c2c60,transparent 70%),#171626;color:#eee;font:16px/1.55 system-ui,-apple-system,sans-serif}
main{width:100%;max-width:560px;padding:32px;border:1px solid #7773;border-radius:22px;background:#26283d;text-align:center;box-shadow:0 20px 60px #0004}
small{color:#c6c2d7;font-size:11px;letter-spacing:1.4px;font-weight:800}h1{font-size:28px;line-height:1.2;margin:22px 0 12px}p{color:#c6c2d7}
.check{margin:26px auto 18px;width:70px;height:70px;display:grid;place-items:center;border:1px solid #80d99c77;border-radius:50%;background:#69cf8a19;color:#a0f2b7;font-size:38px;font-weight:700}
.note{border-top:1px solid #7773;padding-top:18px;margin-top:24px;font-size:13px}
</style></head><body><main><small>POKÉBONK OFFLINE · OPTIONAL CLOUD SAVES</small><div class="check" aria-hidden="true">✓</div>
<h1>Back to the game</h1><p>The sign-in handoff has returned to PokéBonk Offline.<br>You can close this browser tab.</p>
<p class="note">This Mac keeps its cloud sign-in only while the app is open.<br>Connect again after fully quitting. Your local game progress stays saved.</p>
</main></body></html>`;
}
export async function createCloudLoopback({onReturn,origin,timeoutMs=11*60000}){
  const nonce=randomBytes(32).toString("base64url"),route="/cloud/return/"+nonce;
  let timer,closed=false,used=false,url;
  const close=()=>{
    if(closed)return;
    closed=true;clearTimeout(timer);
    server.close(()=>{});server.closeAllConnections();
  };
  const server=http.createServer({maxHeaderSize:4096},(request,response)=>{
    const valid=!closed&&!used&&request.method==="GET"&&request.url===route&&
      request.socket.remoteAddress==="127.0.0.1"&&request.headers.host===new URL(url).host&&
      !request.headers["transfer-encoding"]&&Number(request.headers["content-length"]??0)===0&&
      (!request.headers.origin||request.headers.origin===origin);
    const headers={"Content-Type":"text/html;charset=utf-8","Cache-Control":"no-store","Connection":"close",
      "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
    if(!valid){response.writeHead(404,headers);response.end("Not found.");return;}
    used=true;clearTimeout(timer);
    // Send no personal data or credentials back through the browser. The
    // existing proof-bound HTTPS polling is still the only session exchange.
    response.writeHead(200,headers);response.end(loopbackPage());
    server.close(); // Stop accepting immediately; let the current reply drain.
    timer=setTimeout(close,1000);timer.unref();
    try{onReturn();}catch{/* Activation failure never changes local progress. */}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=1000;server.maxConnections=4;
  server.on("clientError",(_error,socket)=>socket.destroy());
  try{
    await new Promise((resolve,reject)=>{
      server.once("error",reject);server.listen(0,"127.0.0.1",resolve);
    });
    server.unref();
    url=`http://127.0.0.1:${server.address().port}${route}`;
    if(!cloudLoopbackURL(url))throw Error("Unsupported loopback address.");
    const lifetime=Math.max(1000,Math.min(11*60000,timeoutMs)),deadline=Date.now()+lifetime;
    timer=setTimeout(close,lifetime);timer.unref();
    return {url,close,finishLogin(){
      // Native polling can finish before the browser's countdown. Keep the
      // handoff alive briefly, but never indefinitely after authentication.
      if(closed||used)return;
      clearTimeout(timer);timer=setTimeout(close,Math.max(0,Math.min(60000,deadline-Date.now())));timer.unref();
    }};
  }catch{
    close();throw Object.assign(Error("browser_return_unavailable"),{code:"browser_return_unavailable"});
  }
}
