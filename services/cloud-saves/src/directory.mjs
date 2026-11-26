import {cloudHash} from "../../../standard/common/cloud-save.mjs";
import {cloudLoopbackURL} from "../../../standard/common/cloud-return.mjs";
import {Fault,requireValue,random,secret,json,readBody,equal,internal,accountToken} from "./policy.mjs";
export class CloudDirectory{
  constructor(ctx,env){Object.assign(this,{ctx,env});this.queue=Promise.resolve();}
  fetch(request){
    const task=this.queue.catch(()=>{}).then(()=>this.route(request)).catch(error=>json({error:error instanceof Fault?error.code:"authentication_unavailable"},error.status??503));
    this.queue=task;return task;
  }
  async route(request){
    const path=new URL(request.url).pathname,value=await readBody(request,16384),now=Date.now();
    const state=await this.ctx.storage.get("directory")??{logins:{},rates:{},accounts:[]};
    for(const [id,login]of Object.entries(state.logins))if(login.expires<=now)delete state.logins[id];
    for(const [key,rate]of Object.entries(state.rates))if(now-rate.at>3600000)delete state.rates[key];
    const persist=()=>this.ctx.storage.put("directory",state);
    if(path==="/start"){
      requireValue(/^[a-f0-9]{64}$/.test(value.challenge)&&/^[a-f0-9]{64}$/.test(value.client),"invalid_login");
      const returnTo=value.returnTo===undefined?undefined:cloudLoopbackURL(value.returnTo);
      requireValue(returnTo!==null,"invalid_return_destination");
      requireValue(value.clientPlatform===undefined||value.clientPlatform==="android","invalid_client_platform");
      requireValue(!returnTo||value.clientPlatform===undefined,"invalid_return_destination");
      requireValue(Object.keys(state.logins).length<500&&Object.keys(state.rates).length<2000,"login_capacity",429);
      const rate=state.rates[value.client]??{at:now,count:0};
      requireValue(rate.count<10,"rate_limited",429);rate.count++;state.rates[value.client]=rate;
      const id=random(),login={challenge:value.challenge,expires:now+10*60000,oauthState:secret(),oauthVerifier:secret(),nonce:secret(),
        ...(returnTo?{returnTo}:{}),...(value.clientPlatform?{clientPlatform:value.clientPlatform}:{})};
      state.logins[id]=login;await persist();return json({id,expiresAt:login.expires,...(returnTo?{returnMode:"loopback"}:{})});
    }
    requireValue(/^[a-f0-9]{32}$/.test(value.id),"invalid_login");
    const login=state.logins[value.id];requireValue(login&&login.expires>now,"login_expired",410);
    if(path==="/browser"){
      requireValue(/^[a-f0-9]{64}$/.test(value.cookie),"browser_required");
      if(login.browser)requireValue(equal(login.browser,value.cookie),"another_browser",403);
      else login.browser=value.cookie;
      await persist();return json({oauthState:login.oauthState,oauthVerifier:login.oauthVerifier,nonce:login.nonce});
    }
    if(path==="/callback"){
      requireValue(equal(login.browser,value.cookie)&&equal(login.oauthState,value.state)&&!login.identity,"invalid_oauth_state",403);
      return json({oauthVerifier:login.oauthVerifier,nonce:login.nonce});
    }
    if(path==="/identity"){
      requireValue(equal(login.browser,value.cookie)&&/^[a-f0-9]{64}$/.test(value.account)&&typeof value.label==="string","invalid_identity",403);
      requireValue(!login.identity,"login_already_used",409);
      login.identity={account:value.account,label:value.label.slice(0,120)};login.csrf=secret();
      await persist();return json({csrf:login.csrf,label:login.identity.label});
    }
    if(path==="/review"){
      requireValue(equal(login.browser,value.cookie)&&login.identity,"invalid_confirmation",403);
      return json(login.approved?{approved:true,...(login.returnTo?{returnTo:login.returnTo}:{}),
        ...(login.clientPlatform?{clientPlatform:login.clientPlatform}:{})}:
        {label:login.identity.label,csrf:login.csrf,...(login.returnTo?{sessionOnly:true}:{})});
    }
    if(path==="/approve"){
      requireValue(equal(login.browser,value.cookie)&&equal(login.csrf,value.csrf)&&login.identity&&!login.approved,"invalid_confirmation",403);
      login.approved=true;await persist();return json({ok:true,...(login.returnTo?{returnTo:login.returnTo}:{}),
        ...(login.clientPlatform?{clientPlatform:login.clientPlatform}:{})});
    }
    requireValue(path==="/poll","not_found",404);
    requireValue(typeof value.verifier==="string"&&/^[A-Za-z0-9_-]{43}$/.test(value.verifier)&&
      equal(await cloudHash(value.verifier),login.challenge),"invalid_login_proof",403);
    if(!login.approved)return json({pending:true});
    if(login.result)return json(login.result);
    const {account,label}=login.identity;
    if(!state.accounts.includes(account)){
      requireValue(state.accounts.length<Number(this.env.MAX_ACCOUNTS),"account_capacity",429);
      state.accounts.push(account);
    }
    const session=secret(),days=Math.max(1,Math.min(30,Number(this.env.SESSION_DAYS)||30)),expires=now+days*86400000;
    const result=await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(account)).fetch(internal("/session",
      {sessionHash:await cloudHash(session),expires,label}));
    if(!result.ok)return result;
    // Burn the login before returning its one-time session response.
    login.result={token:await accountToken(this.env,account,session,expires),accountId:account,accountLabel:label,expiresAt:expires};
    delete login.oauthVerifier;delete login.csrf;await persist();
    return json(login.result);
  }
}
