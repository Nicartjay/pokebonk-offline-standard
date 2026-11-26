// Presentation data only. Never includes account credentials, service URLs,
// save contents, file paths, or an authority to replace either save.
const states=new Set(["off","unavailable","connecting","connected","checking","syncing","synced","offline","conflict","review","backups","confirm-upload","confirm-restore","blocked","error"]);
export const CLOUD_ACTIONS=new Set(["connect","cancel","sync","auto-on","auto-off","disconnect","backups","review-local","review-cloud","confirm-local","confirm-cloud","review-backup"]);
export const cloudActionAllowed=(action,selection)=>CLOUD_ACTIONS.has(action)&&
  (action==="review-backup"?typeof selection==="string"&&/^[a-f0-9]{32}$/.test(selection):selection===undefined);
const text=(value,max)=>typeof value==="string"&&!/[\u0000-\u001f\u007f]/.test(value)?value.slice(0,max):undefined;
export const unavailableCloudFeedback=()=>({state:"unavailable",connected:false,automatic:false,reason:"not-configured"});
export function cloudFeedbackView(value){
  if(!value||!states.has(value.state)||typeof value.connected!=="boolean"||typeof value.automatic!=="boolean"||
    (["off","unavailable","connecting"].includes(value.state)&&value.connected)||
    (!value.connected&&value.automatic)||
    (["connected","synced","conflict","review","backups","confirm-upload","confirm-restore","syncing"].includes(value.state)&&!value.connected))return null;
  const summary=save=>{
    if(!save||typeof save!=="object")return undefined;
    const result={name:text(save.name,80),savedLabel:text(save.savedLabel,100)};
    for(const key of ["usable","stardust"])
      if(Number.isSafeInteger(save[key])&&save[key]>=0&&save[key]<=(key==="usable"?10000:Number.MAX_SAFE_INTEGER))
        result[key]=save[key];
    return result;
  };
  return {state:value.state,connected:value.connected,automatic:value.automatic,
    ...(value.sessionOnly===true?{sessionOnly:true}:{}),
    ...(typeof value.reason==="string"&&/^[a-z_-]{1,64}$/.test(value.reason)?{reason:value.reason}:{}),
    ...(typeof value.loginCode==="string"&&/^[A-F0-9]{8}$/.test(value.loginCode)?{loginCode:value.loginCode}:{}),
    ...(Array.isArray(value.backups)?{backups:value.backups.slice(0,10).filter(row=>row&&/^[a-f0-9]{32}$/.test(row.revision)&&
      Number.isSafeInteger(row.createdAt)&&row.createdAt>=0).map(row=>({revision:row.revision,createdAt:row.createdAt,summary:summary(row.summary)}))}:{}),
    accountLabel:value.connected?text(value.accountLabel,120):undefined,
    lastSyncedLabel:text(value.lastSyncedLabel,100),local:summary(value.local),cloud:summary(value.cloud)};
}
