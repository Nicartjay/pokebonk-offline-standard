// External app activation only. No credentials, OAuth codes or save commands
// belong in this URL; the native proof/poll remains the authentication path.
export const CLOUD_RETURN_SCHEME="pokebonk-offline-standard";
export const ANDROID_CLOUD_RETURN_SCHEME="pokebonk-offline";
export function cloudAndroidActivationURL(id){
  return cloudReturnURL(id)?`${ANDROID_CLOUD_RETURN_SCHEME}://cloud/return/${id}`:null;
}
export function cloudAndroidReturnURL(id){
  if(!cloudReturnURL(id))return null;
  const fallback=encodeURIComponent("https://pokebonk-offline-cloud.nicartjay.workers.dev/auth/return-help");
  return `intent://cloud/return/${id}#Intent;scheme=${ANDROID_CLOUD_RETURN_SCHEME};package=dev.nicartjay.pokebonk.offline.standard;S.browser_fallback_url=${fallback};end`;
}
export function cloudReturnURL(id){
  if(typeof id!=="string"||!/^[a-f0-9]{32}$/.test(id))return null;
  return `${CLOUD_RETURN_SCHEME}://cloud/return/${id}`;
}
export function cloudReturnId(value){
  if(typeof value!=="string")return null;
  const match=/^pokebonk-offline-standard:\/\/cloud\/return\/([a-f0-9]{32})$/.exec(value);
  return match?.[0]===value?match[1]:null;
}
// A return notification, never a bearer/token endpoint. Limit the destination
// to one literal loopback address, an unprivileged port and one random path.
export function cloudLoopbackURL(value){
  if(typeof value!=="string")return null;
  const match=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/cloud\/return\/([A-Za-z0-9_-]{43})$/.exec(value);
  return match?.[0]===value&&Number(match[1])>=1024&&Number(match[1])<=65535?value:null;
}
