import {createClient as supabaseClient} from '@supabase/supabase-js';
import {originalC113} from './_scheduler-c113.mjs';
import {createDraftOnlyScheduler} from './_scheduler-draft-only.mjs';
import {createSchedulerPgTransportFromEnv,createDraftPermissionFor} from './_scheduler-pg-transport.mjs';
import {SchedulerError} from './_scheduler-store.mjs';
const unavailable=()=>new SchedulerError('storage-not-configured');
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const bearer=headers=>typeof headers?.authorization==='string'&&headers.authorization.length<=16384
 ? /^Bearer\x20([^\s]+)$/i.exec(headers.authorization)?.[1]||null:null;
const reject=(res,status,error)=>{res.setHeader?.('Cache-Control','no-store');return res.status(status).json({error});};

// Profile reads and getUser share one immutable request bearer. No shared SDK
// session is mutated, and no client or credential is initialized on import.
export function createSchedulerRequestIdentity({headers,url,anonKey,createClient=supabaseClient,fetchImpl=fetch,signal}={}){
 const token=bearer(headers);
 if(!token)throw new SchedulerError('unauthenticated');
 if(url!=='https://dydfevdnpppvxgdptiwv.supabase.co'||typeof anonKey!=='string'||!anonKey
   ||typeof createClient!=='function'||typeof fetchImpl!=='function')throw unavailable();
 const origin=new URL(url).origin;
 const boundedFetch=(input,init={})=>{
  const target=new URL(typeof input==='string'?input:input.url);
  if(target.origin!==origin)throw new SchedulerError('storage-unavailable');
  const signals=[signal,init.signal,globalThis.AbortSignal.timeout(5000)].filter(Boolean);
  return fetchImpl(input,{...init,redirect:'error',signal:globalThis.AbortSignal.any(signals)});
 };
 return createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{headers:{Authorization:'Bearer '+token},fetch:boundedFetch}});
}

// A server owns one bounded pool. Each request owns its identity and authority.
export function createDraftOnlySchedulerServer({enabled=false,env=process.env,c113=originalC113,now=()=>new Date().toISOString(),Pool,
 createClient=supabaseClient,fetchImpl=fetch,maxRequests=8}={}){
 if(enabled!==true)throw unavailable();
 const actorId=env.SCHEDULER_DRAFT_PILOT_ACTOR_ID,storeId=env.SCHEDULER_DRAFT_PILOT_STORE_ID;
 const url=env.SCHEDULER_SUPABASE_URL,anonKey=env.SCHEDULER_SUPABASE_ANON_KEY;
 if(!uuid(actorId)||!c113?.validStoreId(storeId)||url!=='https://dydfevdnpppvxgdptiwv.supabase.co'||typeof anonKey!=='string'||!anonKey
   ||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>16||typeof now!=='function')throw unavailable();
 const transport=createSchedulerPgTransportFromEnv({env,Pool}),permission=createDraftPermissionFor(transport);
 let closed=false,active=0,drained,closePromise;
 const controllers=new Set();
 return Object.freeze({
  async handler(req,res){
   if(closed)return reject(res,503,'storage-not-configured');
   if(active>=maxRequests)return reject(res,503,'storage-unavailable');
   active++;const controller=new globalThis.AbortController();controllers.add(controller);
   try{
    const identityDb=createSchedulerRequestIdentity({headers:req.headers,url,anonKey,createClient,fetchImpl,signal:controller.signal});
    const handler=createDraftOnlyScheduler({identityDb,c113,now,transport,
     draftPermissionFor:a=>a.actorId===actorId&&a.storeId===storeId?permission(a):false});
    return await handler(req,res);
   }catch(error){return reject(res,error instanceof SchedulerError?error.status:503,error instanceof SchedulerError?error.code:'storage-unavailable');}
   finally{controllers.delete(controller);controller.abort();if(--active===0)drained?.();}
  },
  close(){
   if(closePromise)return closePromise;
   closed=true;for(const c of controllers)c.abort();
   closePromise=(async()=>{if(active)await new Promise(resolve=>{drained=resolve;});await transport.close();})();
   return closePromise;
  },
 });
}
