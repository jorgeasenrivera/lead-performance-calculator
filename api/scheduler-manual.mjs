// Disabled public endpoint; injected composition is exercised only with fake data.
import {resolveSchedulerAuthority} from './_scheduler-authorization.mjs';
import {validStoreId,validMonth} from '../scripts/scheduler-performance/persistence/identity.mjs';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export function createManualSchedulerHandler({enabled=false,identity,draftHandler,publication,capture,grantFor,now}={}){
 if(enabled!==true||!identity?.verifyToken||!identity?.profileOf||typeof draftHandler!=='function'||!publication?.own||!publication?.publish||!capture?.capture||typeof grantFor!=='function'||typeof now!=='function')throw Error('storage-not-configured');
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'method-not-allowed'});
  try{
   if(Object.keys(req.query||{}).length)return res.status(400).json({error:'invalid-request'});
   if(typeof req.body==='string'&&Buffer.byteLength(req.body)>1048576)return res.status(413).json({error:'request-too-large'});
   let r;try{r=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({error:'invalid-request'});}
   if(Buffer.byteLength(JSON.stringify(r)||'')>1048576)return res.status(413).json({error:'request-too-large'});
   const keys={load:['action','storeId','month'],save:['action','storeId','month','draft','baseRev','requestId'],review:['action','storeId','month','requestId'],publish:['action','storeId','month','requestId','contextId'],own:['action','storeId','month']};
   if(!exact(r,keys[r?.action]||[])||!validStoreId(r.storeId)||!validMonth(r.month))return res.status(400).json({error:'invalid-request'});
   if(['save','review','publish'].includes(r.action)&&(typeof r.requestId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(r.requestId)))return res.status(400).json({error:'invalid-request'});
   const token=/^Bearer\x20([^\s]+)$/i.exec(req.headers?.authorization||'')?.[1];
   if(!token)return res.status(401).json({error:'unauthenticated'});
   const scope={storeId:r.storeId,month:r.month};
   if(r.action==='own')return res.status(200).json(await publication.own(token,scope));
   if(r.action==='publish')return res.status(200).json(await publication.publish(token,{...scope,contextId:r.contextId,requestId:r.requestId}));
   if(r.action==='load'||r.action==='save')return draftHandler({...req,body:r.action==='load'?{op:'read',...scope,input:{kind:'draft'}}:{op:'save',...scope,requestId:r.requestId,input:{baseRev:r.baseRev,draft:r.draft}}},res);
   const actor=await identity.verifyToken(token);if(!actor)return res.status(401).json({error:'unauthenticated'});
   await resolveSchedulerAuthority({actor,request:{op:'publish',...scope,input:{}},profile:await identity.profileOf(actor.id),grantFor});
   const prepared=await capture.capture({scope,actor,now:now(),requestId:r.requestId});
   // Recheck immediately before releasing the roster review after asynchronous capture.
   const current=await identity.verifyToken(token);if(current?.id!==actor.id)return res.status(401).json({error:'unauthenticated'});
   await resolveSchedulerAuthority({actor,request:{op:'publish',...scope,input:{}},profile:await identity.profileOf(actor.id),grantFor});
   return res.status(200).json({version:'scheduler-manual-review/1',contextId:prepared.contextId,draftRevision:prepared.context.expected.head.draftRev,days:prepared.context.projection.map(p=>({personId:p.personId,days:p.days}))});
  }catch(error){
   const code=error?.code;const known={forbidden:403,unauthenticated:401,conflict:409,'idempotency-conflict':409,'invalid-request':400};
   if(known[code])return res.status(known[code]).json({error:code});
   if(typeof code==='string'&&/^(MANUAL_|SOURCE_)/.test(code))return res.status(422).json({error:'review-incomplete'});
   return res.status(503).json({error:'storage-unavailable'});
  }
 };
}
export default function handler(_req,res){res.setHeader('Cache-Control','no-store');return res.status(503).json({error:'storage-not-configured'});}
