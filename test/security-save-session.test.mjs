// Synthetic source-extracted regressions: no browser, database, or report fixtures.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
function extract(start,end='\n}\n') {
 const i=source.indexOf(start); assert.ok(i>=0,`missing ${start}`);
 assert.equal(source.indexOf(start,i+1),-1,`ambiguous ${start}`);
 const j=source.indexOf(end,i); assert.ok(j>i,`missing end ${start}`);
 return source.slice(i,j+end.length);
}
const activity=extract('async function loadActivityRows(storeId) {');
const shared=extract('async function saveShared(');
const cas=extract('async function saveStoreCAS(');
const persist=extract('  const persistStoreNow = async (','\n  };');
const run=(text,name,ctx)=>new Function('ctx',`with(ctx){ ${text}; return ${name}; }`)(ctx);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const silent={error(){},info(){}};
test('activity successful absent RPC is empty, genuine RPC errors reject',async()=>{
 const ctx={supabase:{rpc:async()=>({data:null,error:null})}};const fn=run(activity,'loadActivityRows',ctx);
 assert.deepEqual(await fn('synthetic'),{});
 ctx.supabase.rpc=async()=>({data:null,error:{message:'synthetic denial'}});
 await assert.rejects(fn('synthetic'),/Activity/);
 ctx.supabase.rpc=async()=>{throw new Error('synthetic transport');};
 await assert.rejects(fn('synthetic'),/synthetic transport/);
});
for(const change of ['auth','baseline'])for(const outcome of ['response','error','throw'])test(`config late ${outcome} after ${change} change cannot alter current state`,async()=>{
 const gate=deferred(),before={stores:[]},newer={stores:[{id:'new'}]},buzz=[];
 const ctx={authEpoch:1,CONFIG_KEY:'config',sharedVersions:new Map([['config',before]]),lastSaveError:'current session message',supabase:{rpc:()=>gate.promise},crypto:{randomUUID:()=> 'synthetic-operation'},structuredClone,buzz:x=>buzz.push(x),console:silent};
 const pending=run(shared,'saveShared',ctx)('config',{stores:[{id:'old'}]},false);
 if(change==='auth')ctx.authEpoch++;else ctx.sharedVersions.set('config',newer);
 if(outcome==='throw')gate.reject(new Error('old transport error'));else gate.resolve(outcome==='error'?{error:{message:'old response error'}}:{data:{value:{stores:[{id:'old response'}]}}});
 assert.equal(await pending,false);assert.equal(ctx.sharedVersions.get('config'),change==='auth'?before:newer);
 assert.equal(ctx.lastSaveError,'current session message');assert.deepEqual(buzz,[]);
});
test('current config response installs baseline and acknowledges once',async()=>{
 const buzz=[],ctx={authEpoch:1,CONFIG_KEY:'config',sharedVersions:new Map([['config',{}]]),lastSaveError:'before',supabase:{rpc:async()=>({data:{value:{stores:[]}}})},crypto:{randomUUID:()=> 'synthetic'},structuredClone,buzz:x=>buzz.push(x),console:silent};
 assert.equal(await run(shared,'saveShared',ctx)('config',{},false),true);assert.deepEqual(ctx.sharedVersions.get('config'),{stores:[]});assert.equal(ctx.lastSaveError,null);assert.deepEqual(buzz,['taken']);
});
function persistHarness(){
 const effects=[];let screen={__storeId:'alpha',roster:[{id:'self'}]},cache={};
 const ctx={authEpoch:1,session:{id:'actor',name:'Synthetic'},sessionIdRef:{current:'actor'},configSubject:'subject',configSubjectRef:{current:'subject'},viewRef:{current:'alpha'},saveSeq:{current:1},storeLoadFailed:false,adminData:{},storeData:screen,savingRef:{current:false},storeStampRef:{current:'initial'},config:{},console:silent,alert:()=>effects.push('alert'),setStoreData:f=>{effects.push('screen');screen=typeof f==='function'?f(screen):f;},setAdminData:f=>{effects.push('cache');cache=f(cache);},setSaving:x=>effects.push('saving:'+x),saveActivityDays:async()=>effects.push('activity'),saveStoreCAS:async()=>{effects.push('cas');return {ok:true,value:{__storeId:'alpha',roster:[{id:'saved'}]}};},storeKey:x=>'store:'+x,proofHolds:()=>false,mergeAgainstServer:x=>x,recordFailedSave:()=>effects.push('failed'),publishBoard:()=>effects.push('publish'),loadStoreStamp:async()=>{effects.push('stamp');return 'new';},appendAudit:async()=>effects.push('audit')};
 return {ctx,effects,fn:run(persist,'persistStoreNow',ctx),screen:()=>screen,cache:()=>cache,next:()=>({__storeId:'alpha',roster:[{id:'next'}]}),switchActor(){ctx.sessionIdRef.current='other';ctx.authEpoch++;screen={__storeId:'beta'};cache={beta:{}};effects.length=0;}};
}
test('queued old actor exits before optimistic writes or network calls',async()=>{
 const h=persistHarness();h.switchActor();assert.equal(await h.fn('alpha',h.next(),{},1,null,[],null,1,'actor'),false);assert.deepEqual(h.effects,[]);
});
for(const stage of ['activity','cas'])for(const change of ['actor','subject'])test(`late ${stage} result after ${change} change has no continuation effects`,async()=>{
 const h=persistHarness(),gate=deferred(),entered=deferred();
 h.ctx[stage==='activity'?'saveActivityDays':'saveStoreCAS']=()=>{entered.resolve();return gate.promise;};
 const p=h.fn('alpha',h.next(),{action:'synthetic'});await entered.promise;
 if(change==='actor')h.switchActor();else{h.ctx.configSubjectRef.current='replacement';h.effects.length=0;}
 const beforeScreen=h.screen(),beforeCache=h.cache();gate.resolve(stage==='activity'?undefined:{ok:true,value:{__storeId:'alpha',roster:[{id:'late'}]}});
 assert.equal(await p,false);assert.deepEqual(h.effects,[]);assert.equal(h.screen(),beforeScreen);assert.equal(h.cache(),beforeCache);
});
test('same actor view switch never installs alpha result into beta screen',async()=>{
 const h=persistHarness(),gate=deferred(),entered=deferred();h.ctx.saveStoreCAS=()=>{entered.resolve();return gate.promise;};const p=h.fn('alpha',h.next(),{action:'synthetic'});await entered.promise;
 h.ctx.viewRef.current='beta';h.effects.length=0;const screen=h.screen();gate.resolve({ok:true,value:{__storeId:'alpha',roster:[{id:'saved'}]}});
 assert.equal(await p,true);assert.equal(h.screen(),screen);assert.ok(!h.effects.includes('screen'));assert.equal(h.ctx.storeStampRef.current,'initial');assert.equal(h.cache().alpha.roster[0].id,'saved');
});
function casHarness(){
 const read=deferred(),write=deferred(),writing=deferred(),effects=[];let valid=true;
 const ctx={supabase:{from:()=>{let mutation=false;const q={select:()=>mutation?write.promise:q,eq:()=>q,is:()=>q,maybeSingle:()=>read.promise,update:()=>{mutation=true;effects.push('write');writing.resolve();return q;},insert:()=>{effects.push('write');writing.resolve();return write.promise;}};return q;}},lastSaveError:'current message',casCache:new Map(),observeRowPresent:()=>effects.push('present'),buzz:x=>effects.push('buzz:'+x),console:silent};
 return {ctx,read,write,writing,effects,fn:run(cas,'saveStoreCAS',ctx),current:()=>valid,cancel(){valid=false;}};
}
test('CAS cancelled after deferred read does not write or cache',async()=>{
 const h=casHarness(),p=h.fn('store:alpha',()=>({}),8,h.current);h.cancel();h.read.resolve({data:{value:{rev:1}},error:null});assert.equal((await p).stale,true);assert.deepEqual(h.effects,[]);assert.equal(h.ctx.casCache.size,0);assert.equal(h.ctx.lastSaveError,'current message');
});
for(const kind of ['insert','update'])for(const outcome of ['success','error'])test(`CAS stale ${kind} ${outcome} after commit cannot cache or buzz`,async()=>{
 const h=casHarness(),p=h.fn('store:alpha',()=>({synthetic:true}),8,h.current);h.read.resolve({data:kind==='insert'?null:{value:{rev:1}},error:null});await h.writing.promise;
 h.cancel();h.ctx.casCache.clear();h.effects.length=0;h.write.resolve(outcome==='error'?{error:{message:'late denial'}}:{data:[{key:'store:alpha'}],error:null});assert.equal((await p).stale,true);assert.deepEqual(h.effects,[]);assert.equal(h.ctx.casCache.size,0);assert.equal(h.ctx.lastSaveError,'current message');
});
const publish=extract('async function publishBoard(');
const prune=extract('async function pruneBoardDays(');
for(const change of ['auth','caller'])test(`publication stops after deferred history read and ${change} change`,async()=>{
 const gate=deferred(),effects=[];let valid=true;
 const ctx={authEpoch:1,today:()=> '2026-10-26',DEFAULT_ACTIVITY_STANDARDS:{rockEdStars:1},floorStatsKey:()=> 'day-key',slimFloorStats:x=>x,withChannels:x=>x,withRocked:(_d,_t,r)=>r,loadShared:()=>gate.promise,stampHours:()=>{effects.push('hours');return {};},publicDay:x=>x,saveShared:async()=>{effects.push('save');return true;},pruneBoardDays:async()=>effects.push('prune'),boardKey:()=> 'board',buildBoardPayload:()=>({}),console:silent,lastSaveError:null};
 const p=run(publish,'publishBoard',ctx)({stores:[{id:'alpha'}]},'alpha',{activity:{'2026-10-26':{synthetic:{calls:1}}}},()=>valid);
 if(change==='auth')ctx.authEpoch++;else valid=false;gate.resolve({__hours:{}});
 assert.equal((await p).ok,false);assert.deepEqual(effects,[]);
});
test('pruning cancelled during row listing performs no tombstone write',async()=>{
 const gate=deferred(),writes=[],ctx={authEpoch:1,supabase:{from:()=>({select:()=>({like:()=>gate.promise})})},boardPruned:new Set(),BOARD_DAYS:45,dayIn:()=> '2026-09-01',saveShared:async(...args)=>writes.push(args),console:silent};
 const p=run(prune,'pruneBoardDays',ctx)('alpha');ctx.authEpoch++;gate.resolve({data:[{key:'lpc:board:alpha:act:2026-01-01'}],error:null});await p;assert.deepEqual(writes,[]);
});
test('pruning cancelled during first tombstone never starts second tombstone',async()=>{
 const gate=deferred(),entered=deferred(),writes=[];let valid=true;
 const ctx={authEpoch:1,supabase:{from:()=>({select:()=>({like:async()=>({data:[{key:'lpc:board:alpha:act:2026-01-01'},{key:'lpc:board:alpha:act:2026-01-02'}],error:null})})})},boardPruned:new Set(),BOARD_DAYS:45,dayIn:()=> '2026-09-01',saveShared:async(...args)=>{writes.push(args);entered.resolve();await gate.promise;},console:silent};
 const p=run(prune,'pruneBoardDays',ctx)('alpha',()=>valid);await entered.promise;valid=false;gate.resolve();await p;assert.equal(writes.length,1);assert.equal(writes[0][0],'lpc:board:alpha:act:2026-01-01');assert.equal(writes[0][3](),false);
});
