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

test('verified identity reader uses getUser and exact current profile lookup, ignores metadata',async()=>{
 const calls=[];const db={auth:{getUser:async t=>{calls.push(['getUser',t]);return {data:{user:{id:'manager-1',user_metadata:{role:'admin'}}},error:null};}},from(table){calls.push(['from',table]);return {select(s){calls.push(['select',s]);return this;},eq(k,v){calls.push(['eq',k,v]);return this;},async maybeSingle(){return {data:{id:'manager-1'},error:null};}};}};
 const reader=createSchedulerIdentityReader(db);assert.deepEqual(await reader.verifyToken('token'),{id:'manager-1'});await reader.profileOf('manager-1');
 assert.deepEqual(calls,[['getUser','token'],['from','profiles'],['select','id,role,stores,active,pending'],['eq','id','manager-1']]);
 db.auth.getUser=async()=>({error:{status:401}});assert.equal(await reader.verifyToken('expired'),null);
 db.auth.getUser=async()=>({error:{status:500}});await assert.rejects(reader.verifyToken('valid'),{code:'storage-unavailable'});
});

test('missing, expired, ambiguous and body-only identities deny without storage',async()=>{
 for(const header of [undefined,'','Bearer expired',['Bearer valid'],'Basic valid','Bearer valid extra']){
  const f=fixture();const r=await f.run(read(),header===undefined?null:header);deny(r,401,'unauthenticated');assert.equal(f.calls.length,0);
 }
 const f=fixture();deny(await f.run({...read(),actor:{id:'manager-1'},role:'admin'},null),401,'unauthenticated');assert.equal(f.calls.length,0);
});

test('missing, mismatched, inactive, pending or malformed current profiles deny',async()=>{
 for(const patch of [null,{id:'other'},{active:false},{active:null},{pending:true},{pending:undefined},{stores:null},{role:'unknown'}]){
  const f=fixture();f.profile=patch===null?null:{...f.profile,...patch};deny(await f.run(read()),403,'forbidden');assert.equal(f.calls.length,0);
 }
});

test('cross-store denial applies to staff and admin without global bypass',async()=>{
 for(const role of ['overseer','manager','admin']){const f=fixture();f.profile.role=role;deny(await f.run(read('published','beta')),403,'forbidden');assert.equal(f.calls.length,0);}
});

test('active approved assigned staff read only published projection without privileged grant',async()=>{
 const f=fixture();assert.equal((await f.run(save())).code,200);
 const stored=f.states.get(JSON.stringify(scope));
 const published=c113.serializeVersion({...scope,kind:'published',rev:1,draft:draft('alpha','PUBLISHED-ONLY'),meta:{sourceDraftRev:1,supersedes:0,reviewDigest:'0'.repeat(16),adjacent:{prev:0,next:0}}});assert.equal(published.ok,true);
 stored.head.publishedRev=1;stored.publishedText=published.text;
 f.profile.role='overseer';f.grant=false;f.grantCalls=[];
 const r=await f.run(read());assert.equal(r.code,200);assert.match(JSON.stringify(r.body),/PUBLISHED-ONLY/);assert.doesNotMatch(JSON.stringify(r.body),/DRAFT-ONLY|draftText|prevAuditHash|receipt/);assert.equal(f.grantCalls.length,0);
 for(const request of [read('draft'),save('staff-write',1)]){const n=f.calls.length;deny(await f.run(request),403,'forbidden');assert.equal(f.calls.length,n);}
});

test('manager/admin require exact true explicit grant for draft/save/publication policy',async()=>{
 for(const role of ['manager','admin'])for(const grant of [false,null,undefined,1,'true',{}]){
  const f=fixture();f.profile.role=role;f.grant=grant;deny(await f.run(read('draft')),403,'forbidden');deny(await f.run(save()),403,'forbidden');assert.equal(f.calls.length,0);
 }
 const f=fixture();const noGrant=createAuthorizedSchedulerHandler({identity:f.identity,contract:f.contract,c113,transport:f.transport});const r=response();await noGrant({method:'POST',headers:{authorization:'Bearer valid'},body:save()},r);deny(r,403,'forbidden');
});

test('explicit grant is bound to actor/store/month/action/projection and cannot cross actions',async()=>{
 const f=fixture();await f.run(read('draft'));
 assert.deepEqual(f.grantCalls[0],{actorId:'manager-1',action:'read',storeId:'alpha',month:'2026-10',readKind:'draft'});
 const handler=createAuthorizedSchedulerHandler({identity:f.identity,grantFor:async a=>a.action==='read'&&a.readKind==='draft',contract:f.contract,c113,transport:f.transport});
 const r=response();await handler({method:'POST',headers:{authorization:'Bearer valid'},body:save()},r);deny(r,403,'forbidden');
});

test('client role/profile/grant injection rejected by unchanged request contract',async()=>{
 for(const extra of [{role:'admin'},{actorId:'manager-1'},{grant:true},{profile:{active:true}}]){
  const f=fixture();deny(await f.run({...read(),...extra}),400,'invalid-request');assert.equal(f.calls.length,0);
 }
});

test('identity/profile/grant provider failures sanitize errors and prevent storage',async()=>{
 for(const field of ['identityError','profileError','grantError']){const f=fixture();f[field]=true;deny(await f.run(read('draft')),503,'storage-unavailable');assert.equal(f.calls.length,0);}
});

test('authorized save records verified actor and repeat uses fresh authority before old receipt replay',async()=>{
 const f=fixture();const old=save();assert.equal((await f.run(old)).code,200);assert.equal((await f.run(save('newer',1))).code,200);
 const before=f.receipts.size;const r=await f.run(old);assert.equal(r.code,200);assert.deepEqual(r.body,{result:{head:{draftRev:1,publishedRev:0}},replayed:true});assert.equal(f.receipts.size,before);
 assert.equal(f.calls.find(c=>c.name==='scheduler_commit').args.p_plan.auditEntry.actor.id,'manager-1');assert.ok(f.identityCalls>=9);
});

test('revoked membership or action denies stale/old receipt retries before lookup',async()=>{
 for(const revoke of [f=>f.profile.stores=[],f=>f.grant=false,f=>f.profile.active=false,f=>f.profile.pending=true]){
  const f=fixture();const request=save();assert.equal((await f.run(request)).code,200);const before=copy([...f.states]);const n=f.calls.length;revoke(f);
  deny(await f.run(request),403,'forbidden');assert.equal(f.calls.length,n);assert.deepEqual([...f.states],before);
 }
});

test('revocation after snapshot blocks commit, including replay reconfirmation',async()=>{
 for(const replay of [false,true])for(const revoke of [f=>f.profile.stores=[],f=>f.grant=false,f=>f.user=null,f=>f.profileError=true,f=>f.grantError=true,f=>f.identityError=true]){
  const f=fixture();const request=save();if(replay)assert.equal((await f.run(request)).code,200);
  const before=copy([...f.states]);const n=f.calls.length;f.afterSnapshot=async()=>revoke(f);
  const r=await f.run(request);assert.ok([401,403,503].includes(r.code));assert.deepEqual(f.calls.slice(n).map(x=>x.name),['scheduler_snapshot']);assert.deepEqual([...f.states],before);
 }
});

test('identity changed between calls cannot substitute another actor',async()=>{
 const f=fixture();f.afterSnapshot=()=>{f.user={id:'manager-2'};f.profile.id='manager-2';};deny(await f.run(save()),403,'forbidden');assert.equal(f.receipts.size,0);
});

test('same handler supports concurrent request-scoped scopes and no authority carryover',async()=>{
 const f=fixture();f.profile.stores=['alpha','beta'];const results=await Promise.all([f.run(save('a',0,'alpha')),f.run(save('b',0,'beta'))]);assert.deepEqual(results.map(x=>x.code),[200,200]);
 const commits=f.calls.filter(x=>x.name==='scheduler_commit');assert.deepEqual(commits.map(x=>x.args.p_authority.storeId).sort(),['alpha','beta']);
 f.profile.stores=['alpha'];const n=f.calls.length;deny(await f.run(read('published','beta')),403,'forbidden');assert.equal(f.calls.length,n);
});

test('stale revision and changed command receipt conflict remain unchanged under current grant',async()=>{
 const f=fixture();assert.equal((await f.run(save())).code,200);deny(await f.run(save('stale',0)),409,'conflict');
 const changed=save();changed.input.draft.store.people[0].name='Changed';deny(await f.run(changed),409,'idempotency-conflict');assert.equal(f.receipts.size,1);
});

test('publication policy requires explicit grant but handler never enables publication storage',async()=>{
 const f=fixture();const request={op:'publish',...scope,requestId:'publish',input:{draftRev:1,review:{definition:'month-review/1',digest:'a'.repeat(64)}}};
 f.grant=false;deny(await f.run(request),403,'forbidden');f.grant=true;
 const authority=await resolveSchedulerAuthority({actor:f.user,request,profile:f.profile,grantFor:f.grantFor});assert.equal(authority.action,'publish');
 deny(await f.run(request),503,'storage-not-configured');assert.equal(f.calls.length,0);
});

test('default endpoint remains dormant and imports require no client or credentials',async()=>{const r=response();await dormant({},r);deny(r,503,'storage-not-configured');});


test('non-manager staff denied privileged actions even when provider would grant true',async()=>{
 const f=fixture();f.profile.role='overseer';f.grant=true;
 const publish={op:'publish',...scope,requestId:'pub',input:{draftRev:1,review:{definition:'month-review/1',digest:'a'.repeat(64)}}};
 for(const request of [read('draft'),save(),publish]) deny(await f.run(request),403,'forbidden');
 assert.equal(f.grantCalls.length,0);assert.equal(f.calls.length,0);
});

test('concurrent verified actors cannot share request-scoped authority or receipt identity',async()=>{
 const f=fixture();
 f.identity.verifyToken=async token=>({id:token==='second'?'manager-2':'manager-1'});
 f.identity.profileOf=async id=>({id,role:'manager',stores:[id==='manager-2'?'beta':'alpha'],active:true,pending:false});
 const results=await Promise.all([f.run(save('same',0,'alpha')),f.run(save('same',0,'beta'),'Bearer second')]);
 assert.deepEqual(results.map(x=>x.code),[200,200]);
 for(const call of f.calls.filter(x=>x.name==='scheduler_commit')){
  const a=call.args.p_authority;assert.equal(a.actorId,a.storeId==='alpha'?'manager-1':'manager-2');
  assert.equal(call.args.p_plan.auditEntry.actor.id,a.actorId);assert.equal(JSON.parse(call.args.p_receipt.key)[0],a.actorId);
 }
 deny(await f.run(read('published','alpha'),'Bearer second'),403,'forbidden');
});

test('documented revocation limit: change after dispatch cannot undo committed write, next retry denies',async()=>{
 const f=fixture();f.afterCommit=async()=>{f.grant=false;};const request=save();
 const r=await f.run(request);assert.equal(r.code,200);assert.equal(f.receipts.size,1);
 const n=f.calls.length;deny(await f.run(request),403,'forbidden');assert.equal(f.calls.length,n);
});
