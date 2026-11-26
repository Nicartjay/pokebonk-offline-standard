import {Fault,requireValue,json,readBody,internal,hmac,secret,configured,parseToken} from "./policy.mjs";
import {cloudHash} from "../../../standard/common/cloud-save.mjs";
import {exchangeGoogle,verifyGoogle} from "./google.mjs";
import {reserveCloudUsage} from "./budget.mjs";
import {publicPage} from "./public-pages.mjs";
import {page,connectedPage,returnHelpPage,escape} from "./auth-pages.mjs";
export {CloudDirectory} from "./directory.mjs";
export {CloudAccount} from "./account.mjs";
export {CloudBudget} from "./budget.mjs";
const directory=env=>env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
async function operation(env,path,value){
  const response=await directory(env).fetch(internal(path,value));
  const result=await response.json();requireValue(response.ok,result.error??"authentication_unavailable",response.status);return result;
}
function browserCookie(request){
  const match=/(?:^|;\s*)pb_cloud_login=([A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.get("Cookie")??"");
  requireValue(match,"browser_cookie_required",403);return match[1];
}
async function route(request,env){
  const url=new URL(request.url);
  requireValue(url.origin===env.PUBLIC_ORIGIN,"wrong_origin",403);
  configured(env);
  await reserveCloudUsage(env,"request");
  if(url.pathname==="/v1/login/start"&&request.method==="POST"){
    const data=await readBody(request,4096),address=request.headers.get("CF-Connecting-IP");
    requireValue(address&&address.length<80,"edge_identity_required",403);
    return json(await operation(env,"/start",{challenge:data.challenge,...(data.returnTo===undefined?{}:{returnTo:data.returnTo}),
      ...(data.clientPlatform===undefined?{}:{clientPlatform:data.clientPlatform}),
      client:await hmac(env.IP_HASH_SECRET,address)}));
  }
  if(url.pathname==="/v1/login/poll"&&request.method==="POST"){
    const data=await readBody(request,4096);return json(await operation(env,"/poll",data));
  }
  const start=/^\/auth\/start\/([a-f0-9]{32})$/.exec(url.pathname);
  if(start&&request.method==="GET"){
    const browser=secret(),cookie="pb_cloud_login="+browser+"; Path=/auth/; Secure; HttpOnly; SameSite=Lax; Max-Age=600";
    const data=await operation(env,"/browser",{id:start[1],cookie:await cloudHash(browser)});
    const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(data.oauthVerifier)))))
      .replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
    const auth=new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:env.PUBLIC_ORIGIN+"/auth/callback",
      response_type:"code",scope:"openid email",nonce:data.nonce,state:start[1]+"."+data.oauthState,
      code_challenge:challenge,code_challenge_method:"S256",prompt:"select_account"}).toString();
    return new Response(null,{status:302,headers:{Location:auth.href,"Set-Cookie":cookie,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }
  if(url.pathname==="/auth/callback"&&request.method==="GET"){
    const state=url.searchParams.get("state"),match=/^([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(state??"");
    requireValue(match&&!url.searchParams.has("error"),"sign_in_cancelled");
    const cookie=await cloudHash(browserCookie(request));
    const data=await operation(env,"/callback",{id:match[1],state:match[2],cookie});
    const tokens=await exchangeGoogle(url.searchParams.get("code"),data.oauthVerifier,env);
    const identity=await verifyGoogle(tokens.id_token,data.nonce,env);
    await operation(env,"/identity",{id:match[1],cookie,...identity});
    // Remove the one-use Google authorization code from the visible URL.
    return new Response(null,{status:303,headers:{Location:"/auth/confirm/"+match[1],
      "Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }
  const confirm=/^\/auth\/confirm\/([a-f0-9]{32})$/.exec(url.pathname);
  if(confirm&&request.method==="GET"){
    const review=await operation(env,"/review",{id:confirm[1],cookie:await cloudHash(browserCookie(request))});
    if(review.approved)return connectedPage(confirm[1],undefined,review.returnTo,review.clientPlatform);
    return page("Connect this device?",`<p>Google account: <b>${escape(review.label)}</b></p>
<p>Check that the app shows device code <code>${escape(confirm[1].slice(0,8).toUpperCase())}</code>. Only approve if you started this sign-in in your own app.</p>
<p>This shares completed game progress across macOS, Windows, Linux and Android. It does not grant Google Drive access. Local play remains available without signing in.</p>
${review.sessionOnly?"<p><strong>This Mac signs in for this app session only.</strong> No cloud login token is saved to disk or Keychain. Connect again after fully quitting; local game progress stays saved.</p>":""}
<p><small>The project operator stores your account’s email label, hashed account identity and completed saves in private Cloudflare storage. Backups are not end-to-end encrypted. Automatic sync is off until you enable it in the app.</small></p>
<form method="post" action="/auth/confirm/${confirm[1]}"><input type="hidden" name="csrf" value="${escape(review.csrf)}"><button>Connect this device</button></form>`);
  }
  if(confirm&&request.method==="POST"){
    requireValue(request.headers.get("Origin")===env.PUBLIC_ORIGIN,"invalid_confirmation",403);
    requireValue(Number(request.headers.get("Content-Length")??0)<=4096,"body_too_large",413);
    const text=await request.text();requireValue(text.length<=4096,"body_too_large",413);
    const form=new URLSearchParams(text);
    const approved=await operation(env,"/approve",{id:confirm[1],cookie:await cloudHash(browserCookie(request)),csrf:form.get("csrf")});
    return connectedPage(confirm[1],
      "pb_cloud_login=; Path=/auth/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",approved.returnTo,approved.clientPlatform);
  }
  const endpoint=/^\/v1\/(head|history|read|commit|logout)$/.exec(url.pathname);
  requireValue(endpoint&&request.method==="POST"&&!url.search,"not_found",404);
  const auth=await parseToken(request,env),value=await readBody(request);
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(auth.account)).fetch(internal("/"+endpoint[1],{...value,auth}));
}
export default {async fetch(request,env){
  if(new URL(request.url).pathname==="/auth/return-help"&&request.method==="GET")return returnHelpPage();
  const information=publicPage(request);
  if(information)return information;
  if(new URL(request.url).pathname==="/health"&&request.method==="GET"){
    let ready=false;try{configured(env);ready=true;}catch{/* No secret values in health feedback. */}
    return json({service:"pokebonk-private-cloud-saves",protocol:1,ready});
  }
  try{return await route(request,env);}
  catch(error){
    if(new URL(request.url).pathname.startsWith("/auth/")){
      const reason=error instanceof Fault&&/^[a-z_]{1,64}$/.test(error.code)?error.code:"service_unavailable";
      return page("Sign-in did not finish","<p>No local game save was changed. Return to the app and try connecting again.</p>"+
        `<p><small>Reference: <code>${escape(reason)}</code>. No password, token or game progress is included in this reference.</small></p>`);
    }
    return json({error:error instanceof Fault?error.code:"service_unavailable"},error.status??503);
  }
}};
