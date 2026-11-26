import {requireValue,Fault} from "./policy.mjs";
import {cloudHash} from "../../../standard/common/cloud-save.mjs";
let keys,until=0;
const decode=value=>{
  requireValue(typeof value==="string"&&/^[A-Za-z0-9_-]+$/.test(value),"invalid_identity_token",401);
  return Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0));
};
async function limitedJSON(response,maximum=65536){
  requireValue(response.ok,"identity_service_unavailable",503);
  const text=await response.text();requireValue(text.length<=maximum,"identity_response_too_large",503);return JSON.parse(text);
}
export async function exchangeGoogle(code,verifier,env,request=fetch){
  requireValue(typeof code==="string"&&code.length<=4096,"invalid_oauth_code");
  // Workers does not implement redirect:"error". Manual mode plus the
  // response.ok check above rejects redirects without forwarding credentials.
  return limitedJSON(await request("https://oauth2.googleapis.com/token",{method:"POST",redirect:"manual",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,
      redirect_uri:env.PUBLIC_ORIGIN+"/auth/callback",grant_type:"authorization_code",code_verifier:verifier}),
    signal:AbortSignal.timeout(15000)}));
}
export async function verifyGoogle(token,nonce,env,request=fetch){
  requireValue(typeof token==="string"&&token.length<=16384,"invalid_identity_token",401);
  const parts=token.split(".");requireValue(parts.length===3,"invalid_identity_token",401);
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  requireValue(header.alg==="RS256"&&typeof header.kid==="string"&&header.kid.length<=128,"invalid_identity_token",401);
  if(!keys||Date.now()>=until){
    const value=await limitedJSON(await request("https://www.googleapis.com/oauth2/v3/certs",
      {redirect:"manual",signal:AbortSignal.timeout(15000)}));
    requireValue(Array.isArray(value.keys)&&value.keys.length<=10,"identity_service_unavailable",503);
    keys=value.keys;until=Date.now()+300000;
  }
  const jwk=keys.find(key=>key.kid===header.kid&&key.kty==="RSA"&&(!key.alg||key.alg==="RS256"));
  requireValue(jwk,"unknown_identity_key",401);
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  requireValue(await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decode(parts[2]),
    new TextEncoder().encode(parts[0]+"."+parts[1])),"invalid_identity_signature",401);
  const now=Date.now()/1000;
  requireValue(["https://accounts.google.com","accounts.google.com"].includes(claims.iss)&&claims.aud===env.GOOGLE_CLIENT_ID&&
    (!claims.azp||claims.azp===env.GOOGLE_CLIENT_ID)&&claims.nonce===nonce&&
    (claims.nbf===undefined||Number.isFinite(claims.nbf)&&claims.nbf<=now+30)&&
    Number.isFinite(claims.exp)&&claims.exp>now&&Number.isFinite(claims.iat)&&claims.iat<=now+30&&now-claims.iat<600&&
    typeof claims.sub==="string"&&claims.sub.length>0&&claims.sub.length<=255&&
    claims.email_verified===true&&typeof claims.email==="string"&&claims.email.length<=120,
  "invalid_identity_claims",401);
  return {account:await cloudHash("google|"+claims.sub),label:claims.email};
}
