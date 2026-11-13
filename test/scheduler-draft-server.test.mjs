import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createSchedulerRequestIdentity,createDraftOnlySchedulerServer} from '../api/_scheduler-draft-server.mjs';
import {createSchedulerIdentityReader} from '../api/_scheduler-authorization.mjs';
import dormant,{createSchedulerDraftEndpoint} from '../api/scheduler.mjs';
import {originalC113} from '../api/_scheduler-c113.mjs';

const ACTOR='00000000-0000-4000-8000-000000000001',OTHER='00000000-0000-4000-8000-000000000002';
const URL='https://dydfevdnpppvxgdptiwv.supabase.co';
const ENV=Object.freeze({SCHEDULER_DRAFT_PILOT_ACTOR_ID:ACTOR,SCHEDULER_DRAFT_PILOT_STORE_ID:'alpha',
 SCHEDULER_SUPABASE_URL:URL,SCHEDULER_SUPABASE_ANON_KEY:'synthetic-anon',
 SCHEDULER_DATABASE_URL:'postgresql://scheduler_runtime:synthetic@db.dydfevdnpppvxgdptiwv.supabase.co:5432/postgres?sslmode=verify-full'});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
const scope={storeId:'alpha',month:'2026-11'};
const read=()=>({op:'read',...scope,input:{kind:'draft'}});
const draft=()=>({...scope,store:{timezone:'America/New_York',
 people:[{id:'a',name:'Synthetic A',off:null,start:null,end:null,maxHours:null,hiredAt:'2010-02-01',departedAt:null}],
 rules:[],teams:[],memberships:[]},overrides:{}});
const save=(id='save-1',baseRev=0)=>({op:'save',...scope,requestId:id,input:{baseRev,draft:draft()}});
const latch=()=>{let release;const promise=new Promise(r=>{release=r;});return {promise,release};};
const req=body=>({method:'POST',headers:{authorization:'Bearer tokenA'},body});
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
function fixture(){
 const f={constructs:0,ends:0,releases:[],queries:[],network:[],states:new Map(),receipts:new Map(),granted:true,
  profile:{id:ACTOR,role:'manager',stores:[],active:true,pending:false},user:ACTOR};
 f.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input.url,headers=new Headers(init?.headers);
  f.network.push({url,bearer:headers.get('authorization'),redirect:init.redirect,signal:init.signal});
  if(f.networkGate)await f.networkGate.promise;
  if(url.startsWith(URL+'/auth/v1/user'))return json({id:f.user,aud:'authenticated',role:'authenticated'});
  if(url.startsWith(URL+'/rest/v1/profiles'))return json(f.profile);
  throw Error('Unexpected synthetic network route');
 };
 f.Pool=class{
  constructor(config){f.constructs++;f.config=config;}
  on(){}
  async connect(){
   return {release:destroy=>f.releases.push(destroy),query:async q=>{
    f.queries.push(q);
    if(q.text==='BEGIN'||q.text==='COMMIT'||q.text.startsWith('SET LOCAL'))return {};
    if(q.text.includes('draft_permission'))return {rows:[{data:f.granted}]};
    const args=q.values.map(v=>typeof v==='string'&&v.startsWith('{')?JSON.parse(v):v);
    const authority=args[0],s={storeId:authority.storeId,month:authority.month},key=JSON.stringify(s);
    const current=f.states.get(key)||{scope:s,head:null,draftText:null,publishedText:null,prevAuditHash:null,auditRevision:0};
    if(q.text.includes('scheduler_snapshot')){f.afterSnapshot?.();return {rows:[{data:{snapshot:structuredClone(current),receipt:structuredClone(f.receipts.get(args[1])||null)}}]};}
    if(q.text.includes('scheduler_commit')){
     const [,expected,plan,receipt]=args,prior=f.receipts.get(receipt.key);
     if(prior){if(prior.fingerprint!==receipt.fingerprint)throw Object.assign(Error('scheduler:idempotency-conflict'),{code:'P0001'});return {rows:[{data:{result:prior.result,replayed:true}}]};}
     if(JSON.stringify(expected)!==JSON.stringify({head:current.head,prevAuditHash:current.prevAuditHash,auditRevision:current.auditRevision}))
      throw Object.assign(Error('scheduler:conflict'),{code:'P0001'});
     if(!plan)throw Error('Missing plan');
     f.states.set(key,{scope:s,head:plan.resultingHead,draftText:plan.ops[0].text,publishedText:current.publishedText,prevAuditHash:plan.auditEntry.hash,auditRevision:current.auditRevision+1});
     f.receipts.set(receipt.key,receipt);
     return {rows:[{data:{result:receipt.result,replayed:false}}]};
    }
    throw Error('Unexpected synthetic SQL route');
   }};
  }
  async end(){f.ends++;}
 };
 f.server=(options={})=>createDraftOnlySchedulerServer({enabled:true,env:ENV,Pool:f.Pool,fetchImpl:f.fetch,now:()=> '2026-11-12T12:00:00.000Z',...options});
 f.run=async(server,body,headers)=>{const res=response();await server.handler({...req(body),...(headers?{headers}: {})},res);return res;};
 return f;
}

test('real SDK identity client binds getUser and profile RLS reads to the same fresh request bearer',async()=>{
 const f=fixture();
 const a=createSchedulerIdentityReader(createSchedulerRequestIdentity({headers:{authorization:'Bearer tokenA'},url:URL,anonKey:'synthetic',fetchImpl:f.fetch}));
 const b=createSchedulerIdentityReader(createSchedulerRequestIdentity({headers:{authorization:'Bearer tokenB'},url:URL,anonKey:'synthetic',fetchImpl:f.fetch}));
 await Promise.all([a.verifyToken('tokenA'),b.verifyToken('tokenB')]);
 await Promise.all([a.profileOf(ACTOR),b.profileOf(ACTOR)]);
 assert.equal(f.network.length,4);
 for(const kind of ['/auth/v1/user','/rest/v1/profiles']){
  assert.deepEqual(f.network.filter(x=>x.url.includes(kind)).map(x=>x.bearer).sort(),['Bearer tokenA','Bearer tokenB']);
 }
 assert.ok(f.network.every(x=>x.redirect==='error'&&x.signal instanceof AbortSignal));
});
test('identity configuration is pinned and malformed or duplicate bearers never construct a client',()=>{
 let called=0;const createClient=()=>{called++;};
 for(const authorization of [undefined,['Bearer a','Bearer b'],'Bearer a b','Bearer\ta','Bearer a\n']){
  assert.throws(()=>createSchedulerRequestIdentity({headers:{authorization},url:URL,anonKey:'x',createClient}),e=>e.code==='unauthenticated');
 }
 assert.throws(()=>createSchedulerRequestIdentity({headers:{authorization:'Bearer a'},url:'https://other.supabase.co',anonKey:'x',createClient}));
 assert.equal(called,0);
});
test('request fetch refuses another origin without leaking a bearer',async()=>{
 let options,calls=0;
 createSchedulerRequestIdentity({headers:{authorization:'Bearer a'},url:URL,anonKey:'x',createClient:(_u,_k,o)=>{options=o;},fetchImpl:async()=>{calls++;}});
 assert.throws(()=>options.global.fetch('https://other.invalid/auth/v1/user'),e=>e.code==='storage-unavailable');
 assert.equal(calls,0);assert.equal(options.auth.persistSession,false);assert.equal(options.auth.autoRefreshToken,false);
});
test('request retirement and the actual five-second deadline abort identity fetches',async()=>{
 let options;
 const fetchImpl=(_input,init)=>new Promise((_,reject)=>{
  if(init.signal.aborted)reject(init.signal.reason);
  else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
 });
 const controller=new AbortController();
 createSchedulerRequestIdentity({headers:{authorization:'Bearer a'},url:URL,anonKey:'x',signal:controller.signal,
  createClient:(_u,_k,o)=>{options=o;},fetchImpl});
 const retiring=options.global.fetch(URL+'/auth/v1/user');controller.abort();
 await assert.rejects(retiring,e=>e.name==='AbortError');
 createSchedulerRequestIdentity({headers:{authorization:'Bearer a'},url:URL,anonKey:'x',
  createClient:(_u,_k,o)=>{options=o;},fetchImpl});
 const keepAlive=setTimeout(()=>{},6000),started=Date.now();
 try{await assert.rejects(options.global.fetch(URL+'/auth/v1/user'),e=>e.name==='TimeoutError');assert.ok(Date.now()-started>=4900);}
 finally{clearTimeout(keepAlive);}
});
test('missing explicit actor/store/configuration refuses before owning a pool',()=>{
 const f=fixture();
 for(const patch of [{SCHEDULER_DRAFT_PILOT_ACTOR_ID:undefined},{SCHEDULER_DRAFT_PILOT_STORE_ID:undefined},{SCHEDULER_DRAFT_PILOT_STORE_ID:['alpha']},{SCHEDULER_SUPABASE_URL:'https://other.supabase.co'}])
  assert.throws(()=>f.server({env:{...ENV,...patch}}));
 assert.throws(()=>createDraftOnlySchedulerServer({env:ENV,Pool:f.Pool}));
 assert.equal(f.constructs,0);
});
test('actual host C113 saves unknowns/employment and reads/replays via request identity and PG protocol double',async()=>{
 const f=fixture(),s=f.server();
 try{
  assert.equal(originalC113.validateDraft(draft(),scope).ok,true);
  const absent=await f.run(s,read());assert.equal(absent.code,200);assert.equal(absent.body.result.revision,0);
  const saved=await f.run(s,save());assert.equal(saved.code,200);assert.equal(saved.body.replayed,false);
  assert.equal((await f.run(s,save())).body.replayed,true);
  const loaded=await f.run(s,read());assert.equal(loaded.code,200);assert.deepEqual(loaded.body.result.schedule,draft());
  assert.equal(f.states.size,1);assert.equal(f.receipts.size,1);assert.equal(f.constructs,1);
  assert.ok(f.network.every(n=>n.bearer==='Bearer tokenA'));
 }finally{await s.close();await s.close();assert.equal(f.ends,1);}
});
test('singleton actor/store and grants are real boundaries; profile stores are not the pilot grant',async()=>{
 for(const change of ['actor','store','grant','overseer','salesperson','inactive','pending']){
  const f=fixture(),s=f.server();
  if(change==='actor'){f.user=OTHER;f.profile.id=OTHER;}
  if(change==='grant')f.granted=false;
  if(['overseer','salesperson'].includes(change))f.profile.role=change;
  if(change==='inactive')f.profile.active=false;
  if(change==='pending')f.profile.pending=true;
  try{
   const command=read();if(change==='store')command.storeId='other';
   const r=await f.run(s,command);assert.equal(r.code,403,change);
   assert.equal(f.states.size,0);assert.equal(f.queries.some(q=>q.text.includes('scheduler_snapshot')),false);
  }finally{await s.close();}
 }
});
test('publish, published read and body identity stay forbidden without storage operations',async()=>{
 const f=fixture(),s=f.server();
 try{
  for(const body of [{...read(),input:{kind:'published'}},{...save(),op:'publish'},{...save(),actor:{id:ACTOR}}])
   assert.notEqual((await f.run(s,body)).code,200);
  assert.equal(f.queries.length,0);
 }finally{await s.close();}
});
test('fresh profile/grant reads fence commit and historical replay after revocation',async()=>{
 const f=fixture(),s=f.server();
 try{
  f.afterSnapshot=()=>{f.profile.active=false;};
  assert.equal((await f.run(s,save())).code,403);assert.equal(f.states.size,0);
  f.afterSnapshot=null;f.profile.active=true;
  assert.equal((await f.run(s,save())).code,200);
  f.granted=false;assert.equal((await f.run(s,save())).code,403);
  assert.equal(f.receipts.size,1);
 }finally{await s.close();}
});
test('server limits whole requests and closes its owned pool once after pending identity work settles',async()=>{
 const f=fixture();f.networkGate=latch();const s=f.server({maxRequests:1}),pending=f.run(s,read());
 const excess=await f.run(s,read());assert.equal(excess.code,503);
 const closing=s.close();assert.equal((await f.run(s,read())).code,503);assert.equal(f.ends,0);
 f.networkGate.release();await pending;await closing;assert.equal(f.ends,1);assert.equal(f.constructs,1);
});
test('endpoint defaults off without inspecting configuration or initializing a server',async()=>{
 let n=0;
 for(const enabled of [undefined,false,null,'1',1,{}]){
  const endpoint=createSchedulerDraftEndpoint({enabled,serverFactory:()=>{n++;throw Error();}}),r=response();
  await endpoint.handler(req(read()),r);assert.equal(r.code,503);assert.equal(n,0);await endpoint.close();
 }
 assert.notEqual(process.env.SCHEDULER_DRAFT_PILOT_ENABLED,'1','Default endpoint check requires activation OFF');
 const d=response();await dormant(req(read()),d);assert.equal(d.code,503);
});
test('a populated synthetic database setting cannot activate the default endpoint or initialize any service',async()=>{
 const effects={pool:0,connect:0,query:0,auth:0,profile:0,writes:0,config:0};
 const env=new Proxy({SCHEDULER_DATABASE_URL:'postgresql://synthetic:synthetic@invalid.example:5432/postgres'},{get(){effects.config++;throw Error('Disabled configuration read');}});
 const endpoint=createSchedulerDraftEndpoint({env,serverFactory:()=>{
  effects.pool++;effects.connect++;effects.query++;effects.auth++;effects.profile++;effects.writes++;
  throw Error('Disabled service initialization');
 }});
 const r=response();await endpoint.handler(req(read()),r);await endpoint.close();
 assert.equal(r.code,503);assert.deepEqual(r.body,{error:'storage-not-configured'});
 assert.deepEqual(effects,{pool:0,connect:0,query:0,auth:0,profile:0,writes:0,config:0});
 // A fresh child exercises the actual default export with only synthetic env.
 // Poisoned service imports make an activation regression fail before networking.
 const script=`
  import assert from 'node:assert/strict';
  import {registerHooks} from 'node:module';
  let serviceImports=0,configReads=0;
  registerHooks({resolve(specifier,context,next){
   if(specifier==='pg'||specifier==='@supabase/supabase-js'||specifier.endsWith('_scheduler-draft-server.mjs')){
    serviceImports++;throw Error('Unexpected service import');
   }
   return next(specifier,context);
  }});
  assert.equal(Object.hasOwn(process.env,'SCHEDULER_DATABASE_URL'),true);
  process.env=new Proxy(process.env,{get(target,key){
   if(typeof key==='string'&&key.startsWith('SCHEDULER_')&&key!=='SCHEDULER_DRAFT_PILOT_ENABLED'){
    configReads++;throw Error('Unexpected configuration read');
   }
   return Reflect.get(target,key);
  }});
  const {default:handler}=await import(${JSON.stringify(new globalThis.URL('../api/scheduler.mjs',import.meta.url).href)});
  const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  await handler({method:'POST',headers:{},body:{}},res);
  assert.equal(res.code,503);assert.deepEqual(res.body,{error:'storage-not-configured'});
  assert.equal(serviceImports,0);assert.equal(configReads,0);
  console.log(JSON.stringify({serviceImports,configReads,status:res.code}));
 `;
 const childEnv={LANG:'C',SCHEDULER_DATABASE_URL:'postgresql://synthetic:synthetic@invalid.example:5432/postgres'};
 const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{env:childEnv,encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);
 assert.deepEqual(JSON.parse(child.stdout),{serviceImports:0,configReads:0,status:503});
 const control=spawnSync(process.execPath,['--input-type=module','--eval',script],{env:{...childEnv,SCHEDULER_DRAFT_PILOT_ENABLED:'1'},encoding:'utf8',timeout:10000});
 assert.equal(control.status,1,'Instrumentation must detect activation instead of merely observing unavailable');
 assert.match(control.stderr,/AssertionError/);
});
test('endpoint shares initialization, caps requests, drains close and never executes after close during initialization',async()=>{
 const gate=latch();let init=0,runs=0,closes=0;
 const e=createSchedulerDraftEndpoint({enabled:true,maxRequests:2,serverFactory:async()=>{init++;await gate.promise;return {handler:async(_q,r)=>{runs++;r.status(200).json({});},close:async()=>{closes++;}};}});
 const a=e.handler(req(read()),response()),b=e.handler(req(read()),response());
 const over=response();await e.handler(req(read()),over);assert.equal(over.code,503);
 const closing=e.close();gate.release();await Promise.all([a,b,closing]);assert.equal(init,1);assert.equal(runs,0);assert.equal(closes,1);
 await e.close();assert.equal(closes,1);
});
test('failed initialization permits a fresh later attempt; method and request bounds remain fail closed',async()=>{
 let calls=0;const e=createSchedulerDraftEndpoint({enabled:true,serverFactory:()=>{calls++;if(calls===1)throw Error('private');return {handler:async(_q,r)=>r.status(200).json({}),close:async()=>{}};}});
 const wrong=response();await e.handler({method:'GET'},wrong);assert.equal(wrong.code,405);assert.equal(calls,0);
 const first=response();await e.handler(req(read()),first);assert.equal(first.code,503);
 const next=response();await e.handler(req(read()),next);assert.equal(next.code,200);assert.equal(calls,2);await e.close();
});
test('invalid initialized server releases an available owner cleanup before refusing',async()=>{
 let closed=0;
 const endpoint=createSchedulerDraftEndpoint({enabled:true,serverFactory:()=>({close:async()=>{closed++;}})});
 const r=response();await endpoint.handler(req(read()),r);assert.equal(r.code,503);assert.equal(closed,1);await endpoint.close();assert.equal(closed,1);
});
