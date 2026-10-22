import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareManualServerAdapter} from './server-adapter.mjs';
import publicHandler from '../../api/scheduler-manual.mjs';
import {MANUAL_SCHEDULER_ENABLED} from '../../src/scheduler-manual-client.mjs';
const id='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const request=(action='own',token='fake-a')=>({method:'POST',headers:{authorization:`Bearer ${token}`},body:{action,storeId:'pilot-a',month:'2026-10',...(action==='review'?{requestId:'fake-review'}:{})}});
async function call(handler,req=request()){
 const r={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(body){this.body=body;return this;}};
 await handler(req,r);return r;
}
function fixture({pending=false,active=true,stores=['pilot-a'],grant=true}={}){
 const clients=[],rpc=[],captures=[];
 const deps={enabled:true,now:()=> '2026-10-22T00:00:00Z',
  createRequestClient:async token=>{
   clients.push(token);const actor=token==='fake-a'?id:other;
   return {auth:{getUser:async supplied=>{assert.equal(supplied,token);return {data:{user:token==='invalid'?null:{id:actor}},error:null};}},from:table=>{
    assert.equal(table,'profiles');return {select:columns=>{assert.equal(columns,'id,role,stores,active,pending');return {eq:(key,value)=>{assert.equal(key,'id');assert.equal(value,actor);return {maybeSingle:async()=>({data:{id:actor,role:'manager',stores,active,pending},error:null})};}};}};
   }};
  },
  transport:{capabilities:{'scheduler-postgres-save-read/1':true,'scheduler-publication/2':true},rpc:async(name,args)=>{
   rpc.push({name,args});if(name==='own_published_v2')return {data:{version:'scheduler-own/2',revision:0,days:[]},error:null};
   if(name==='draft_permission')return {data:false,error:null};throw Error('unexpected call');
  }},
  capturePortFor:()=>({snapshot:async()=>{captures.push('snapshot');throw Error('synthetic stop');},register:async()=>{throw Error('unexpected');},context:async()=>{throw Error('unexpected');},putPolicy:()=>{throw Error('maintenance must not run');}}),
  publishPermissionFor:async()=>grant};
 return {deps,clients,rpc,captures};
}
test('disabled adapter and public endpoint do not inspect dependencies or request',async()=>{
 const req=new Proxy({},{get(){throw Error('must not read');}});
 const disabled=prepareManualServerAdapter({createRequestClient:()=>{throw Error('must not call');}});
 for(const handler of [disabled,publicHandler]){const r=await call(handler,req);assert.equal(r.code,503);assert.deepEqual(r.body,{error:'storage-not-configured'});assert.equal(r.headers['Cache-Control'],'no-store');}
 assert.equal(MANUAL_SCHEDULER_ENABLED,false);
});
test('missing capabilities refuse construction without invoking providers',()=>{
 for(const key of ['createRequestClient','transport','capturePortFor','publishPermissionFor','now']){const f=fixture();delete f.deps[key];assert.throws(()=>prepareManualServerAdapter(f.deps),/storage-not-configured/);assert.deepEqual(f.clients,[]);}
});
test('method and malformed bearer refused before client allocation',async()=>{
 const f=fixture(),h=prepareManualServerAdapter(f.deps);
 assert.equal((await call(h,{method:'GET'})).code,405);
 for(const authorization of [undefined,['Bearer fake-a'],'Bearer a b','Bearer '+ 'a'.repeat(16384)])assert.equal((await call(h,{...request(),headers:{authorization}})).code,401);
 assert.deepEqual(f.clients,[]);
});
test('independent requests bind verified actor to own RPC; no person selector admitted',async()=>{
 const f=fixture(),h=prepareManualServerAdapter(f.deps);
 const responses=await Promise.all([call(h,request('own','fake-a')),call(h,request('own','fake-b'))]);
 assert.deepEqual(responses.map(x=>x.code),[200,200]);assert.deepEqual(f.clients,['fake-a','fake-b']);
 assert.deepEqual(f.rpc.map(x=>x.args),[id,other].map(p_actor_id=>({p_actor_id,p_store_id:'pilot-a',p_month:'2026-10'})));
 const forged=request();forged.body.personId='someone-else';assert.equal((await call(h,forged)).code,400);assert.equal(f.rpc.length,2);
});
test('invalid verified identity cannot reach own transport',async()=>{
 const f=fixture();assert.equal((await call(prepareManualServerAdapter(f.deps),request('own','invalid'))).code,401);assert.deepEqual(f.rpc,[]);
});
test('pending, inactive, wrong store or missing explicit publish grant refuses review before capture',async()=>{
 for(const opts of [{pending:true},{active:false},{stores:['other-store']},{grant:false}]){
  const f=fixture(opts);assert.equal((await call(prepareManualServerAdapter(f.deps),request('review'))).code,403);assert.deepEqual(f.captures,[]);
 }
});
test('draft authority uses existing explicit permission RPC, not role alone',async()=>{
 const f=fixture();assert.equal((await call(prepareManualServerAdapter(f.deps),request('load'))).code,403);
 assert.deepEqual(f.rpc,[{name:'draft_permission',args:{p_actor_id:id,p_store_id:'pilot-a',p_permission:'draft-read'}}]);
});
test('provider exception yields fixed unavailable output',async()=>{
 const f=fixture();f.deps.createRequestClient=async()=>{throw Error('synthetic-private-marker');};
 const r=await call(prepareManualServerAdapter(f.deps));assert.equal(r.code,503);assert.deepEqual(r.body,{error:'storage-unavailable'});
});
test('invalid JSON and scope retain 400 without allocating a capture capability',async()=>{
 const f=fixture();f.deps.capturePortFor=()=>{throw Error('must not allocate');};const h=prepareManualServerAdapter(f.deps);
 for(const body of ['{bad', {...request().body,storeId:'BAD'}, {...request().body,month:'invalid'}])assert.equal((await call(h,{...request(),body})).code,400);
});
test('verified identity switch refuses before actor-bound capture access',async()=>{
 const f=fixture();let calls=0;f.deps.createRequestClient=async()=>({auth:{getUser:async()=>({data:{user:{id:++calls===1?id:other}},error:null})},from:()=>{throw Error('must not read profile');}});
 f.deps.capturePortFor=()=>{throw Error('must not capture');};
 assert.equal((await call(prepareManualServerAdapter(f.deps),request('review'))).code,401);assert.deepEqual(f.rpc,[]);
});
