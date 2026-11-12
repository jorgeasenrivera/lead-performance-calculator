// Disabled injected composition. No environment, pool, pilot or public route setup.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { originalC113 as c113 } from './_scheduler-c113.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const fields=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const hash=x=>createHash('sha256').update(x).digest('hex');
export function createPublicationV2({enabled=false,identity,transport,capturedContextFor}={}){
 if(enabled!==true||typeof identity?.verifyToken!=='function'||transport?.capabilities?.['scheduler-publication/2']!==true||typeof capturedContextFor!=='function')fail('storage-not-configured');
 async function actor(token){let user;try{user=await identity.verifyToken(token);}catch{fail('storage-unavailable');}if(typeof user?.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id))fail('unauthenticated');return user.id;}
 async function rpc(name,args){let result;try{result=await transport.rpc(name,args);}catch{fail('storage-unavailable');}if(!result||typeof result!=='object')fail('storage-unavailable');if(result?.error){const known={'scheduler:forbidden':'forbidden','scheduler:conflict':'conflict','scheduler:idempotency-conflict':'idempotency-conflict'};fail(known[result.error.message]||'storage-unavailable');}return result.data;}
 const scope=r=>{if(!c113.validStoreId(r?.storeId)||!c113.validMonth(r?.month))fail('invalid-request');};
 return Object.freeze({
  publish: async function publish(token,request){
   scope(request);if(!fields(request,['storeId','month','contextId','requestId'])||!/^[0-9a-f]{64}$/.test(request.contextId)||typeof request.requestId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(request.requestId))fail('invalid-request');
   const id=await actor(token);let captured;try{captured=await capturedContextFor(request.contextId);}catch{fail('storage-unavailable');}
   if(!captured||typeof captured.contextText!=='string'||hash(captured.contextText)!==request.contextId)fail('conflict');
   let c;try{c=JSON.parse(captured.contextText);}catch{fail('storage-unavailable');}
   if(c?.version!=='scheduler-publication-context/2'||c.scope?.storeId!==request.storeId||c.scope?.month!==request.month||c.plan?.auditEntry?.actor?.id!==id)fail('forbidden');
   if(!Array.isArray(c.plan.ops))fail('storage-unavailable');
   for(const op of c.plan.ops)if(op.op==='put-version'&&!c113.deserializeVersion(op.text,{storeId:request.storeId,month:request.month,kind:op.kind,rev:op.rev}).ok)fail('storage-unavailable');
   if(!c113.verifyEntry(c.plan.auditEntry).ok)fail('storage-unavailable');
   const key=JSON.stringify([id,request.storeId,request.month,request.requestId]);
   const result=await rpc('publish_v2',{p_authority:{actorId:id,action:'publish',storeId:request.storeId,month:request.month,readKind:null},p_context_id:request.contextId,p_plan:c.plan,p_receipt:{key,fingerprint:hash(c113.canonicalize(request).text),result:{head:c.plan.resultingHead}}});
   if(!fields(result,['result','replayed'])||typeof result.replayed!=='boolean'||!fields(result.result,['head'])||!isDeepStrictEqual(result.result.head,c.plan.resultingHead))fail('storage-unavailable');
   return result;
  },
  own: async function own(token,request){
   scope(request);if(!fields(request,['storeId','month']))fail('invalid-request');
   const result=await rpc('own_published_v2',{p_actor_id:await actor(token),p_store_id:request.storeId,p_month:request.month});
   if(!fields(result,['version','revision','days'])||result.version!=='scheduler-own/2'||!c113.validRev(result.revision,0)||!Array.isArray(result.days)||result.days.length>31)fail('storage-unavailable');
   validateOwnDays(result.days,request.month);
   return result;
  },
 });
}

// C113 legacy store hours retain fractional minutes; never round or truncate.
export function validateOwnDays(days,month){
   const seen=new Set();
   for(const day of days){
    if(!fields(day,['date','status','intervals','timezone'])||!c113.validDate(day.date)||!day.date.startsWith(month+'-')||seen.has(day.date)||day.timezone!=='America/New_York'||!['working','off','vacation','unavailable','unknown','closed','unentered'].includes(day.status)||!Array.isArray(day.intervals)||day.intervals.length>200)fail('storage-unavailable');
    seen.add(day.date);
    if((day.status!=='working'&&day.intervals.length)||(day.status==='working'&&!day.intervals.length))fail('storage-unavailable');
    for(const pair of day.intervals)if(!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isFinite)||pair[0]<0||pair[1]>1440||pair[1]<=pair[0])fail('storage-unavailable');
   }
}
