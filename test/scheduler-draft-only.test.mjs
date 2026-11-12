import {createDraftOnlyScheduler} from '../api/_scheduler-draft-only.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createAuthorizedSchedulerHandler, createSchedulerIdentityReader, resolveSchedulerAuthority } from '../api/_scheduler-authorization.mjs';
import { createSchedulerContract } from '../api/_scheduler-contract.mjs';
import dormant from '../api/scheduler.mjs';
const hash = v => createHash('sha256').update(v).digest('hex');
const pins = {
'audit-entry.mjs':'4955fe594bb3736c0525f3c9975dfd43f53b4bc14394b6ced1a9dd0cc1b06300',
'cas.mjs':'35de09c8e30a22272b61c051d45464fae5be0c076f1b30fe7fba7484d40929e6',
'deserialize.mjs':'2d7a0c11148bbb90317805f750e792e5ae427a8eeafe4a26ba0ce985c1126ac8',
'envelope.mjs':'c7df30414b4a37190c5bbf1e160cee877eefffb4fc54cdba4a4ea10c09a141e9',
'identity.mjs':'2c5839019f28c8675d8f8e23e8d8eca5f0d72fcf41c40fa5e6a49a56b0accd1e',
'publish-plan.mjs':'fbe774b576f3661c8b5db56d5be46a71a4929e4816827bc9fdad49e98695a0ba',
'serialize.mjs':'5867e828fedf730c79b62d218af8ca8da3c3827f28e9b109cb142c3d04a55905',
'validate.mjs':'bbdc8c822079691649c7cf5a7bfb364b2ab82ea85e3d8ce34827be1e6170e7ad',
};
assert.equal(hash(fs.readFileSync(new URL('../fixtures/c113-r1.tar.gz',import.meta.url))),'909b442cebe6c9dec1c870b9cde96baf1f40582b97cfc0744a3fac127c58b622');
const c113={};
for (const [name,pin] of Object.entries(pins)) {
 const url=new URL('../fixtures/c113-r1/scripts/scheduler-performance/persistence/'+name,import.meta.url);
 assert.equal(hash(fs.readFileSync(url)),pin); Object.assign(c113,await import(url));
}
const copy=structuredClone, scope={storeId:'alpha',month:'2026-10'};
const read=(kind='published',storeId='alpha')=>({op:'read',storeId,month:scope.month,input:{kind}});
const draft=(storeId='alpha',name='DRAFT-ONLY')=>({storeId,month:scope.month,store:{timezone:'America/New_York',people:[{id:'person-a',name,start:9,end:17,off:[],maxHours:40}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[0],holidays:{}}],teams:[{id:'team-a',name:'Team'}],memberships:[{storeId,personId:'person-a',teamIds:['team-a'],from:'2014-01-01',to:'2100-12-31',unknown:false}]},overrides:{}});
const save=(id='request-1',baseRev=0,storeId='alpha')=>({op:'save',storeId,month:scope.month,requestId:id,input:{baseRev,draft:draft(storeId)}});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(v){this.body=v;return this;}});
const empty=s=>({scope:s,head:null,draftText:null,publishedText:null,prevAuditHash:null,auditRevision:0});
function fixture() {
 const f={profile:{id:'manager-1',role:'manager',stores:['alpha'],active:true,pending:false},grant:true,user:{id:'manager-1'},calls:[],grantCalls:[],identityCalls:0,states:new Map(),receipts:new Map()};
 const unsupported=()=>{throw Error('publication provider must not run');};
 f.contract=createSchedulerContract({c113,sha256:hash,reviewProvider:{REVIEW_DEFINITION:'month-review/1',validateReviewInput:unsupported,verifyReview:unsupported,reviewMonth:unsupported,reviewSpan:unsupported,canonicalJson:unsupported}});
 f.identity={verifyToken:async token=>{f.identityCalls++; if(f.identityError)throw Error('private identity error');return token==='valid'?copy(f.user):null;},profileOf:async()=>{if(f.profileError)throw Error('private policy error');return copy(f.profile);}};
 f.grantFor=async a=>{f.grantCalls.push(copy(a));if(f.grantError)throw Error('private grant error');return f.grant;};
 f.transport={capabilities:{'scheduler-postgres-save-read/1':true},rpc:async(name,args)=>{
  f.calls.push({name,args:copy(args)});
  const s={storeId:args.p_authority.storeId,month:args.p_authority.month}, k=JSON.stringify(s);
  const snapshot=f.states.get(k)||empty(s);
  if(name==='scheduler_snapshot'){
   const data=copy({snapshot,receipt:f.receipts.get(args.p_key)||null});
   if(f.afterSnapshot)await f.afterSnapshot();
   return {data,error:null};
  }
  const receipt=args.p_receipt, prior=f.receipts.get(receipt.key);
  if(prior){
   if(prior.fingerprint!==receipt.fingerprint)return {data:null,error:{code:'P0001',message:'scheduler:idempotency-conflict'}};
   return {data:{result:copy(prior.result),replayed:true},error:null};
  }
  if(JSON.stringify(args.p_expected)!==JSON.stringify({head:snapshot.head,prevAuditHash:snapshot.prevAuditHash,auditRevision:snapshot.auditRevision}))return {data:null,error:{code:'P0001',message:'scheduler:conflict'}};
  f.states.set(k,{scope:s,head:copy(args.p_plan.resultingHead),draftText:args.p_plan.ops[0].text,publishedText:snapshot.publishedText,prevAuditHash:args.p_plan.auditEntry.hash,auditRevision:snapshot.auditRevision+1});
  f.receipts.set(receipt.key,copy(receipt));
  if(f.afterCommit)await f.afterCommit();
  return {data:{result:copy(receipt.result),replayed:false},error:null};
 }};
 f.handler=createAuthorizedSchedulerHandler({identity:f.identity,grantFor:f.grantFor,contract:f.contract,c113,transport:f.transport,now:()=> '2026-10-19T17:13:00.000Z'});
 f.run=async(body,authorization='Bearer valid')=>{const res=response();await f.handler({method:'POST',headers:{authorization},body},res);return res;};
 return f;
}
function deny(r,code,error){assert.equal(r.code,code);assert.deepEqual(r.body,{error});}


function draftFixture(permissions=['draft-read','draft-save']){const f=fixture();f.permissionCalls=[];const identityDb={auth:{getUser:async t=>({data:{user:await f.identity.verifyToken(t)},error:null})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:await f.identity.profileOf(),error:null})})})})};f.handler=createDraftOnlyScheduler({identityDb,draftPermissionFor:async a=>{f.permissionCalls.push(a);return permissions.includes(a.permission);},c113,transport:f.transport,now:()=> '2026-10-19T18:00:00.000Z'});return f;}
test('draft-only save/read and exact receipt replay through verified identity',async()=>{const f=draftFixture();assert.equal((await f.run(save())).code,200);const r=await f.run(read('draft'));assert.equal(r.code,200);assert.equal(r.body.result.kind,'draft');assert.equal((await f.run(save())).body.replayed,true);assert.ok(f.permissionCalls.some(x=>x.permission==='draft-read'));assert.ok(f.permissionCalls.some(x=>x.permission==='draft-save'));});
test('read and save permissions are distinct and roles do not grant either',async()=>{for(const role of ['manager','admin'])for(const permissions of [[],['draft-read'],['draft-save']]){const f=draftFixture(permissions);f.profile.role=role;assert.equal((await f.run(read('draft'))).code,permissions.includes('draft-read')?200:403);assert.equal((await f.run(save())).code,permissions.includes('draft-save')?200:403);}});
test('publication, capture and published reads unavailable before any storage RPC',async()=>{const f=draftFixture();for(const r of [read('published'),{...save(),op:'publish'},{...save(),op:'capture'}])assert.notEqual((await f.run(r)).code,200);assert.equal(f.calls.length,0);});
test('inactive pending and non-manager profiles fail closed',async()=>{for(const patch of [{active:false},{pending:true},{role:'overseer'}]){const f=draftFixture();Object.assign(f.profile,patch);assert.equal((await f.run(save())).code,403);assert.equal(f.calls.length,0);}});
test('revocation after snapshot blocks commit; replay rechecks policy',async()=>{const f=draftFixture();f.afterSnapshot=()=>{f.profile.active=false;};assert.equal((await f.run(save())).code,403);assert.equal(f.calls.filter(x=>x.name==='scheduler_commit').length,0);const g=draftFixture();await g.run(save());g.profile.active=false;assert.equal((await g.run(save())).code,403);});
test('missing draft permission provider denies and default endpoint remains dormant',async()=>{const f=draftFixture();const identityDb={auth:{getUser:async()=>({data:{user:{id:'manager-1'}},error:null})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:f.profile,error:null})})})})};f.handler=createDraftOnlyScheduler({identityDb,c113,transport:f.transport,now:()=> '2026-10-19T18:00:00Z'});assert.equal((await f.run(save())).code,403);assert.equal(f.calls.length,0);const r=response();await dormant({},r);assert.equal(r.code,503);});

test('explicit draft grant can authorize empty profile stores but missing grant denies',async()=>{const permissions=['draft-read','draft-save'],f=draftFixture(permissions);f.profile.role='admin';f.profile.stores=[];assert.equal((await f.run(save())).code,200);permissions.length=0;assert.equal((await f.run(save())).code,403);assert.deepEqual(f.profile.stores,[]);});
