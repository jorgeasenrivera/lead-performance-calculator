import {Pool as PgPool} from 'pg';
import {SchedulerError} from './_scheduler-store.mjs';
const unavailable=()=>new SchedulerError('storage-not-configured');
const calls=Object.freeze({
 scheduler_snapshot:{keys:['p_authority','p_key'],text:'SELECT scheduler_gateway.scheduler_snapshot($1::jsonb,$2::text) AS data'},
 scheduler_commit:{keys:['p_authority','p_expected','p_plan','p_receipt'],text:'SELECT scheduler_gateway.scheduler_commit($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) AS data'},
 draft_permission:{keys:['p_actor_id','p_store_id','p_permission'],text:'SELECT scheduler_gateway.draft_permission($1::uuid,$2::text,$3::text) AS data'},
});
const safeMessages=new Set(['scheduler:conflict','scheduler:idempotency-conflict','scheduler:forbidden']);
const errorResult=e=>({data:null,error:e?.code==='P0001'&&safeMessages.has(e.message)?{code:'P0001',message:e.message}:{code:'SCHEDULER_STORAGE_UNAVAILABLE',message:'scheduler:storage-unavailable'}});
// Parse fields separately so URI SSL options cannot replace verified TLS settings.
// No environment connection or pool is created until this server factory is called.
export function schedulerConnectionConfig(env={}){
 try{
  if(typeof window!=='undefined'||[env,process.env].some(e=>Object.entries(e).some(([k,v])=>k.startsWith('PG')&&v))||typeof env.SCHEDULER_DATABASE_URL!=='string')throw unavailable();
  const u=new URL(env.SCHEDULER_DATABASE_URL),host=u.hostname,user=decodeURIComponent(u.username),password=decodeURIComponent(u.password);
  const pooled=host.endsWith('.pooler.supabase.com');
  if(!['postgres:','postgresql:'].includes(u.protocol)||u.hash||u.pathname!=='/postgres'||!password||
   !(pooled||host==='db.dydfevdnpppvxgdptiwv.supabase.co')||
   user!==(pooled?'scheduler_runtime.dydfevdnpppvxgdptiwv':'scheduler_runtime')||
   !['5432','6543'].includes(u.port)||
   [...u.searchParams].some(([k,v])=>k!=='sslmode'||!['require','verify-full'].includes(v)))throw unavailable();
  return {host,port:Number(u.port),database:'postgres',user,password,ssl:{rejectUnauthorized:true,servername:host},max:1,min:0,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,maxLifetimeSeconds:60,query_timeout:6000,application_name:'sage-scheduler-draft',options:'',allowExitOnIdle:true};
 }catch{throw unavailable();}
}
// Pool injection is a trusted server seam, never request-controlled. It permits
// credential-free local socket verification without weakening the env factory.
export function createSchedulerPgTransport({pool}={}){
 if(typeof pool?.connect!=='function'||typeof pool?.on!=='function'||typeof pool?.end!=='function')throw unavailable();
 let pending=0,closed=false;
 pool.on('error',()=>{}); // Driver errors can carry secrets; never forward/log them.
 return Object.freeze({capabilities:Object.freeze({'scheduler-postgres-save-read/1':true}),
  rpc: async (name,args)=>{
   let client,destroy=false;
   if(closed||pending>=16)return errorResult();
   pending++;
   try{
    const call=Object.hasOwn(calls,name)?calls[name]:null;
    if(!call||!args||typeof args!=='object'||Object.keys(args).length!==call.keys.length||call.keys.some(k=>!Object.hasOwn(args,k)))return errorResult();
    if(name==='draft_permission'&&call.keys.some(k=>typeof args[k]!=='string'))return errorResult();
    if(name==='scheduler_snapshot'&&args.p_key!==null&&typeof args.p_key!=='string')return errorResult();
    if(name!=='draft_permission'&&call.keys.filter(k=>k!=='p_key').some(k=>!(k==='p_plan'&&args[k]===null)&&(!args[k]||typeof args[k]!=='object')))return errorResult();
    // Serialize JSON ourselves: no driver toPostgres callback from input objects.
    const values=call.keys.map(k=>k==='p_key'||name==='draft_permission'?args[k]:args[k]===null?null:JSON.stringify(args[k]));
    client=await pool.connect();
    await client.query({text:'BEGIN',query_timeout:6000});
    await client.query({text:"SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'; SET LOCAL idle_in_transaction_session_timeout='8000ms'",query_timeout:6000});
    const result=await client.query({text:call.text,values,query_timeout:6000});
    if(result.rows?.length!==1||!Object.hasOwn(result.rows[0],'data'))throw Error('invalid result');
    await client.query({text:'COMMIT',query_timeout:6000});
    return {data:result.rows[0].data,error:null};
   }catch(e){destroy=true;return errorResult(e);}
   finally{if(client)client.release(destroy);pending--;}
  },
  close: async ()=>{closed=true;try{await pool.end();}catch{throw new SchedulerError('storage-unavailable');}},
 });
}
export function createSchedulerPgTransportFromEnv({env=process.env,Pool=PgPool}={}){
 try{return createSchedulerPgTransport({pool:new Pool(schedulerConnectionConfig(env))});}catch{throw unavailable();}
}
export function createDraftPermissionFor(transport){
 return async ({actorId,storeId,permission})=>{
  const r=await transport.rpc('draft_permission',{p_actor_id:actorId,p_store_id:storeId,p_permission:permission});
  if(r.error?.code==='P0001'&&r.error.message==='scheduler:forbidden')return false;
  if(r.error||typeof r.data!=='boolean')throw new SchedulerError('storage-unavailable');
  return r.data;
 };
}
