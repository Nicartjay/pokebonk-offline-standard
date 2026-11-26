// Private, serialized admission before provider operations. Failed/abandoned
// reservations are deliberately not refunded. This bounds this service only,
// not unrelated usage on the owner's Cloudflare account.
import {Fault,requireValue,json,readBody,internal} from "./policy.mjs";
export const CLOUD_USAGE_LIMITS=Object.freeze({
  requestsPerDay:5000,commitsPerDay:500,classA:50000,classB:100000,accounts:100,
});
const DAY=86400000,WINDOW_DAYS=32;
const COSTS=Object.freeze({request:{requests:1},commit:{commits:1,classA:2},read:{classB:1}});
export async function reserveCloudUsage(env,kind){
  requireValue(Object.hasOwn(COSTS,kind),"invalid_budget_operation",503);
  requireValue(env.BUDGET,"budget_unavailable",503);
  const response=await env.BUDGET.get(env.BUDGET.idFromName("cloud-save-budget-v1"))
    .fetch(internal("/reserve",{kind}));
  requireValue(response.ok,response.status===429?"cloud_limit_reached":"budget_unavailable",response.status===429?429:503);
}
export class CloudBudget{
  constructor(ctx,env,now=Date.now){Object.assign(this,{ctx,env,now});this.queue=Promise.resolve();}
  fetch(request){
    const operation=this.queue.catch(()=>{}).then(()=>this.reserve(request)).catch(error=>
      json({error:error instanceof Fault?error.code:"budget_unavailable"},error.status??503));
    this.queue=operation;return operation;
  }
  async reserve(request){
    requireValue(request.method==="POST"&&new URL(request.url).pathname==="/reserve","not_found",404);
    const {kind}=await readBody(request,1024);
    requireValue(Object.hasOwn(COSTS,kind),"invalid_budget_operation");
    const stored=await this.ctx.storage.get("meter");
    const meter=stored??{version:1,days:{}},day=Math.floor(this.now()/DAY);
    requireValue(meter.version===1&&meter.days&&typeof meter.days==="object"&&!Array.isArray(meter.days)&&
      Object.keys(meter.days).length<=64,"budget_unavailable",503);
    for(const [key,row]of Object.entries(meter.days)){
      requireValue(/^\d{1,10}$/.test(key)&&row&&typeof row==="object"&&
        ["requests","commits","classA","classB"].every(field=>Number.isSafeInteger(row[field])&&row[field]>=0),"budget_unavailable",503);
      // Retain 32 full preceding UTC days plus today's partial day, rather
      // than assuming the R2 billing period begins on the first of a month.
      // Future entries also remain counted if the clock moves backwards.
      if(Number(key)<day-WINDOW_DAYS)delete meter.days[key];
    }
    const today=meter.days[day]??{requests:0,commits:0,classA:0,classB:0};
    const total=Object.values(meter.days).reduce((sum,row)=>({classA:sum.classA+row.classA,classB:sum.classB+row.classB}),{classA:0,classB:0});
    const cost=COSTS[kind];
    requireValue(today.requests+(cost.requests??0)<=CLOUD_USAGE_LIMITS.requestsPerDay&&
      today.commits+(cost.commits??0)<=CLOUD_USAGE_LIMITS.commitsPerDay&&
      total.classA+(cost.classA??0)<=CLOUD_USAGE_LIMITS.classA&&
      total.classB+(cost.classB??0)<=CLOUD_USAGE_LIMITS.classB,"cloud_limit_reached",429);
    for(const [field,amount]of Object.entries(cost))today[field]+=amount;
    meter.days[day]=today;
    // A failed durable write rejects admission. Callers cannot touch R2 until
    // this promise succeeds, including after retries, eviction or concurrency.
    await this.ctx.storage.put("meter",meter);
    return json({ok:true});
  }
}
