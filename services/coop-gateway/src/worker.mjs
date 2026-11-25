import {POLICY, STUN_SERVERS, Fault, requireValue, json, body, authorized, privateAddressKey, acceptedBuild, internetMode, coopProtocol, randomToken, profile} from "./policy.mjs";
import {coopDestination} from "../../../standard/common/coop-rules.mjs";
export {CoopControl} from "./control.mjs";
export {CoopRoom} from "./room.mjs";
const ORIGINS=new Set(["pokebonk-standard://game","https://appassets.androidplatform.net"]);
const internal=(route,value)=>new Request("https://internal"+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
const control=env=>env.CONTROL.get(env.CONTROL.idFromName("account"));
const room=(env,code)=>env.ROOMS.get(env.ROOMS.idFromName(code));
const roomCode=length=>[...crypto.getRandomValues(new Uint8Array(length))].map(byte=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte&31]).join("");
async function admission(request,env,header="Authorization"){
  if(env.PUBLIC_MATCHMAKING_ENABLED==="true")return;
  requireValue(await authorized(request.headers.get(header),env.PRIVATE_BETA_TOKEN),401,"private_beta_required");
}
async function route(request,env){
  const url=new URL(request.url),pathname=url.pathname;
  requireValue(url.protocol==="https:"||url.hostname==="localhost"||url.hostname==="127.0.0.1",400,"https_required");
  requireValue(!url.search,400,"query_tokens_not_allowed");
  const origin=request.headers.get("Origin");
  requireValue(!origin||ORIGINS.has(origin),403,"origin_not_allowed");
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{
    "Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type, X-Coop-Access",
    "Access-Control-Max-Age":"600"}});
  if(pathname==="/health"&&request.method==="GET")return json({service:"pokebonk-coop",enabled:env.SERVICE_ENABLED==="true",
    turn:env.TURN_MODE==="guarded-payg"?"guarded-payg":"disabled",hardBillingCap:false,maxPlayers:POLICY.maxPlayers});
  if(pathname.startsWith("/admin/")){
    requireValue(await authorized(request.headers.get("Authorization"),env.ADMIN_TOKEN),401,"admin_required");
    if(pathname==="/admin/status"&&request.method==="GET")return control(env).fetch("https://internal/status");
    if(pathname==="/admin/refresh-usage"&&request.method==="POST")return control(env).fetch(internal("/refresh",{}));
    if(pathname==="/admin/resume-relay"&&request.method==="POST")return control(env).fetch(internal("/resume",{}));
    if(pathname==="/admin/disable-relay"&&request.method==="POST")return control(env).fetch(internal("/disable",{}));
    throw new Fault(404,"not_found");
  }
  requireValue(env.SERVICE_ENABLED==="true",503,"service_disabled");
  if(pathname==="/v1/connection-policy"&&request.method==="GET")return json({strategy:"stun-first",
    directAttemptMs:POLICY.directAttemptMs,iceServers:STUN_SERVERS,
    relayEnabled:env.TURN_MODE==="guarded-payg"&&env.TURN_PAYG_RISK_ACCEPTED==="true"});
  if(["/v1/rooms","/v1/matchmaking/find","/v1/matchmaking/rooms"].includes(pathname)&&request.method==="POST"){
    await admission(request,env);
    const listing=pathname==="/v1/matchmaking/rooms";
    const value=await body(request),player=listing?null:profile(value),buildId=acceptedBuild(value.buildId,env),protocolVersion=coopProtocol(value.protocolVersion);
    try{coopDestination(value.destination??"");}catch{throw new Fault(400,"invalid_destination");}
    if(listing)requireValue(protocolVersion>=2,400,"invalid_coop_protocol");
    const connectionMode=internetMode(value.connectionMode),client=await privateAddressKey(request,env.IP_HASH_SECRET);
    if(pathname==="/v1/matchmaking/find"||listing){
      const list=await control(env).fetch(internal("/matchmaking",{client,buildId,connectionMode,protocolVersion,exclude:listing?[]:value.exclude??[]}));
      if(!list.ok)return list;
      const {rooms}=await list.json(),visible=[];
      for(const code of rooms){
        // Directory data can be stale; only the room's serialized operation
        // may reserve a seat. It counts unconfirmed seats toward capacity.
        const attempt=await room(env,code).fetch(internal(listing?"/listing":"/reserve",{...player,buildId,connectionMode,protocolVersion,destination:value.destination??""}));
        if(attempt.ok){if(!listing)return attempt;visible.push(await attempt.json());continue;}
        if(![403,409,410].includes(attempt.status))return attempt;
      }
      if(listing)return json({rooms:visible});
      return json({error:"no_matching_room"},404);
    }
    requireValue(value.discoverable===undefined||typeof value.discoverable==="boolean",400,"invalid_visibility");
    const generation=randomToken(16),discoverable=value.discoverable??(protocolVersion<3);
    let code,registration;
    for(let retry=0;retry<3;retry++){
      code=roomCode(protocolVersion>=2?6:8);
      registration=await control(env).fetch(internal("/register-room",{code,generation,client,buildId,connectionMode,discoverable,protocolVersion}));
      if(registration.ok||registration.status!==409||(await registration.clone().json()).error!=="code_collision")break;
    }
    if(!registration.ok)return registration;
    let response;
    try{response=await room(env,code).fetch(internal("/initialize",{code,generation,buildId,connectionMode,discoverable,protocolVersion,...player,destination:value.destination??""}));}
    catch{await control(env).fetch(internal("/unregister-room",{code,generation}));throw new Fault(503,"room_unavailable");}
    if(!response.ok)await control(env).fetch(internal("/unregister-room",{code,generation}));
    return response;
  }
  const match=/^\/v1\/rooms\/([A-Z2-7]{6}|[A-Z2-7]{8})\/(join|socket|turn|leave)$/.exec(pathname);
  requireValue(match,404,"not_found");const [,code,action]=match;
  requireValue(request.method===(action==="socket"?"GET":"POST"),405,"method_not_allowed");
  if(action==="join"){
    await admission(request,env,"X-Coop-Access");
    const value=await body(request),buildId=acceptedBuild(value.buildId,env),connectionMode=internetMode(value.connectionMode),protocolVersion=coopProtocol(value.protocolVersion);
    if(value.joinSecret===undefined){
      requireValue(protocolVersion>=2&&code.length===6,403,"invitation_required");
      const client=await privateAddressKey(request,env.IP_HASH_SECRET);
      const listing=await control(env).fetch(internal("/matchmaking",{client,buildId,connectionMode,protocolVersion,exclude:[],codeLookup:protocolVersion>=3}));
      if(!listing.ok)return listing;
      if(protocolVersion<3)requireValue((await listing.json()).rooms.includes(code),409,"room_not_open");
    }
    return room(env,code).fetch(internal("/join",value));
  }
  return room(env,code).fetch(new Request("https://internal/"+action,request));
}
export default {
  async fetch(request,env){
    let response;
    try{response=await route(request,env);}
    catch(error){response=json({error:error instanceof Fault?error.code:"service_unavailable"},error.status??503);}
    if(response.status===101)return response;
    const headers=new Headers(response.headers),origin=request.headers.get("Origin");
    if(ORIGINS.has(origin)){headers.set("Access-Control-Allow-Origin",origin);headers.set("Vary","Origin");}
    return new Response(response.body,{status:response.status,headers});
  },
  async scheduled(_event,env,ctx){
    if(env.TURN_MODE!=="guarded-payg")return;
    ctx.waitUntil(control(env).fetch(internal("/refresh",{})));
  },
};
