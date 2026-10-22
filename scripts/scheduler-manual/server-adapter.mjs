// Preparation only. No production route imports this module.
import {createManualSchedulerServer} from '../../api/_scheduler-manual-server.mjs';
const fail=()=>{throw Object.assign(Error('storage-unavailable'),{code:'storage-unavailable'});};
const unavailable=()=>{throw Error('storage-not-configured');};

// All capabilities are trusted server dependencies, never request fields.
// createRequestClient must return a NEW publishable-key client scoped to this
// bearer, with persistence/refresh disabled. No service-role client is accepted
// by the deployment contract. Capability injection alone cannot prove its ACLs.
export function prepareManualServerAdapter({enabled=false,createRequestClient,transport,capturePortFor,publishPermissionFor,now}={}){
 if(enabled!==true)return (_req,res)=>{res.setHeader('Cache-Control','no-store');return res.status(503).json({error:'storage-not-configured'});};
 if(typeof createRequestClient!=='function'||typeof transport?.rpc!=='function'||
    transport.capabilities?.['scheduler-postgres-save-read/1']!==true||transport.capabilities?.['scheduler-publication/2']!==true||
    typeof capturePortFor!=='function'||typeof publishPermissionFor!=='function'||typeof now!=='function')unavailable();
 const draftPermissionFor=async({actorId,storeId,permission})=>{
  const r=await transport.rpc('draft_permission',{p_actor_id:actorId,p_store_id:storeId,p_permission:permission});
  if(r?.error?.code==='P0001'&&r.error.message==='scheduler:forbidden')return false;
  if(!r||r.error||typeof r.data!=='boolean')fail();
  return r.data;
 };
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'method-not-allowed'});
  const header=req.headers?.authorization;
  const token=typeof header==='string'&&header.length<=16384?/^Bearer\x20([^\s]+)$/i.exec(header)?.[1]:null;
  if(!token)return res.status(401).json({error:'unauthenticated'});
  try{
   // No cached session, client mutation, JWT decoding or client-provided actor.
   const identityDb=await createRequestClient(token);
   const verified=await identityDb.auth.getUser(token);
   const actorId=verified?.data?.user?.id;
   if(verified?.error&&![401,403].includes(verified.error.status))fail();
   if(verified?.error||typeof actorId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId))return res.status(401).json({error:'unauthenticated'});
   let port;
   const getPort=()=>{
    if(!port){
     // Invoked only after the existing handler has validated action/scope/body.
     const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
     port=capturePortFor(Object.freeze({actorId,storeId:body.storeId,month:body.month}));
     if(!['snapshot','register','context'].every(k=>typeof port?.[k]==='function'))unavailable();
    }
    return port;
   };
   const capture=Object.freeze(Object.fromEntries(['snapshot','register','context'].map(k=>[k,(...args)=>getPort()[k](...args)])));
   // A later verification cannot switch the actor bound to this capture port.
   const boundDb={from:(...args)=>identityDb.from(...args),auth:{getUser:async supplied=>{
    const r=await identityDb.auth.getUser(supplied);
    return r?.error||r?.data?.user?.id===actorId?r:{data:{user:null},error:null};
   }}};
   const handler=createManualSchedulerServer({enabled:true,identityDb:boundDb,transport,capturePort:capture,draftPermissionFor,publishPermissionFor,now});
   return await handler(req,res);
  }catch{return res.status(503).json({error:'storage-unavailable'});}
 };
}
