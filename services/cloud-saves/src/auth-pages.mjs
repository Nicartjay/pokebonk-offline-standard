import {cloudReturnURL,cloudLoopbackURL,cloudAndroidReturnURL,cloudAndroidActivationURL} from "../../../standard/common/cloud-return.mjs";
export const escape=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
export function page(title,body,cookie,script=""){
  const nonce=script?crypto.randomUUID().replaceAll("-",""):"";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · PokéBonk Offline</title><style>
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;padding:24px;min-height:100svh;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 0%,#3c2c60,transparent 70%),#171626;color:#eee;font:16px/1.55 system-ui,-apple-system,sans-serif}
main{width:100%;max-width:560px;padding:32px;border:1px solid #7773;border-radius:22px;background:#26283d;box-shadow:0 20px 60px #0004}h1{font-size:28px;line-height:1.2;margin:18px 0 12px}
button,a.action{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(#89e9a5,#56bd7c);color:#123523;border:0;border-radius:24px;padding:14px 24px;font:800 16px system-ui;text-decoration:none;box-shadow:0 5px 0 #2b704c;cursor:pointer}
button:hover,a.action:hover{filter:brightness(1.08)}button:focus-visible,a:focus-visible{outline:3px solid #c9b2ff;outline-offset:5px}code{color:#c9b2ff}small,.muted{color:#c6c2d7}.eyebrow{font-size:11px;letter-spacing:1.4px;font-weight:800}
.success{text-align:center}.success .check{margin:26px auto 18px;width:70px;height:70px;display:grid;place-items:center;border:1px solid #80d99c77;border-radius:50%;background:#69cf8a19;color:#a0f2b7;font-size:38px;font-weight:700}
.success p{margin:12px 0}.success .action{width:100%;margin:18px 0 14px}.success .countdown{min-height:48px;font-size:14px}.success .footnote{border-top:1px solid #7773;padding-top:18px;margin-top:18px;font-size:13px}
.alternate{display:inline-block;color:#c9b2ff;font-size:14px;text-underline-offset:4px;margin:0 0 10px}
@media(max-width:420px){body{padding:16px}main{padding:26px 22px}h1{font-size:25px}}
</style></head><body><main><small class="eyebrow">POKÉBONK OFFLINE · OPTIONAL CLOUD SAVES</small>${body.startsWith('<div class="success">')?"":`<h1>${escape(title)}</h1>`}${body}</main>${script?`<script nonce="${nonce}">${script}</script>`:""}</body></html>`,{headers:{
    // Keep the real same-HTTPS Origin on confirmation form POSTs, without
    // referring Google codes or query strings to another site.
    "Content-Type":"text/html;charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"strict-origin",
    "X-Content-Type-Options":"nosniff",
    "Content-Security-Policy":`default-src 'none'; style-src 'unsafe-inline'; ${script?`script-src 'nonce-${nonce}'; `:""}form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    ...(cookie?{"Set-Cookie":cookie}:{})}});
}
export function connectedPage(id,cookie,returnTo,platform){
  const sessionOnly=returnTo!==undefined;
  if(platform!==undefined&&platform!=="android"||sessionOnly&&platform)throw new TypeError("Invalid return flow.");
  const android=platform==="android";
  const activation=android?cloudAndroidActivationURL(id):cloudReturnURL(id);
  const target=activation&&(sessionOnly?cloudLoopbackURL(returnTo):android?cloudAndroidReturnURL(id):activation);
  if(!target)throw new TypeError("Invalid return flow.");
  return page("Device connected",`<div class="success">
<div class="check" aria-hidden="true">✓</div><h1>You’re connected!</h1>
<p>Your Google account is linked to this device.<br>Head back to PokéBonk Offline to continue.</p>
<a class="action" id="return-button" href="${escape(target)}">Return to game <span aria-hidden="true">↗</span></a>
<p class="muted countdown" id="return-status" role="status" aria-live="polite">${android?
    "Tap Return to game to open the Android app.":"Returning to the game in <b id=\"countdown\">5</b> seconds…"}</p>
${android?`<a class="alternate" id="alternate-return" href="${escape(activation)}">Try the alternate return link</a>
<p class="muted">Chrome needs your tap to open the app.<br>If it is still blocked, use your launcher. Sign-in can finish without this button.</p>`:""}
${sessionOnly?'<p class="muted footnote"><strong>Signed in for this Mac session only.</strong><br>No cloud login token is saved to disk or Keychain.<br>Connect again after fully quitting. Local game progress stays saved.</p>':""}
<p class="muted ${sessionOnly?"":"footnote"}">Automatic sync is still off. Choose <strong>Sync now</strong> or enable it in <strong>Player &amp; saves → Cloud saves</strong>.<br>You can close this browser tab after returning.</p>
</div>`,cookie,`
(()=>{
  const button=document.getElementById("return-button"),status=document.getElementById("return-status");
  let seconds=5,timer;
  const attempted=()=>{
    clearInterval(timer);
    status.textContent=${JSON.stringify(sessionOnly?
      "If the game didn’t come forward, tap Return to game or select PokéBonk Offline in the Dock.":
      android?"Tap Return to game to open the installed app. If your browser blocks it, try the alternate link or use your launcher.":
      "If the game didn’t open, tap Return to game and allow your browser to open PokéBonk Offline.")};
  };
  button.addEventListener("click",attempted);
  document.getElementById("alternate-return")?.addEventListener("click",attempted);
  ${android?"":`timer=setInterval(()=>{
    seconds--;
    if(seconds<=0){
      attempted();
      // Only a validated activation/loopback notification. The native
      // verifier/session never passes through this browser return.
      try{window.location.assign(button.href);}catch{/* The visible button is the fallback. */}
    }else document.getElementById("countdown").textContent=String(seconds);
  },1000);`}
  document.addEventListener("visibilitychange",()=>{if(document.hidden)attempted();});
})();
`);
}
export function returnHelpPage(){
  return page("Open PokéBonk Offline",`<p>Your browser could not open the installed app automatically.</p>
<p>Switch back to <strong>PokéBonk Offline</strong> using your device’s launcher or recent apps. If you just approved sign-in, the game can finish checking it without this browser button.</p>
<p>No password, token or save is carried by this help page. If the game says sign-in expired, start one new connection attempt from <strong>Player &amp; saves → Cloud saves</strong>.</p>`);
}
