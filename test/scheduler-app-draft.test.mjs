import test from 'node:test';
import assert from 'node:assert/strict';
import {localManualDraftSelected,createLocalManualDraftConnection,pilotDraftSelected,createPilotDraftConnection,manualDraftView} from '../src/scheduler-manual-setup.mjs';

const selected={mode:'scheduler-local-test',calendarFlag:'1',draftFlag:'1',origin:'http://127.0.0.1:5178'};
const pilot={mode:'production',calendarFlag:'1',pilotFlag:'1',pilotStoreId:'alpha',storeId:'alpha',origin:'https://sage.example'};
test('pilot requires separate explicit flags and one exact store without widening the local selector',()=>{
  assert.equal(pilotDraftSelected(pilot),true);
  assert.equal(localManualDraftSelected(pilot),false);
  assert.equal(pilotDraftSelected({...pilot,mode:'scheduler-pilot-test',origin:'http://127.0.0.1:5178'}),true);
  for(const patch of [{pilotFlag:undefined},{pilotFlag:'0'},{calendarFlag:'0'},{pilotStoreId:undefined},{pilotStoreId:['alpha']},{storeId:'other'},
    {mode:'development'},{mode:'scheduler-local-test'},{origin:'http://sage.example'},{origin:'https://sage.example/path'},
    {mode:'scheduler-pilot-test',origin:'http://sage.example'}])assert.equal(pilotDraftSelected({...pilot,...patch}),false);
  assert.equal(createPilotDraftConnection({selection:{...pilot,pilotFlag:'0'}}),null);
});
test('pilot uses the existing scheduler envelope, preserves the prepared command and gets a fresh bearer on retry',async()=>{
  let token=0;const seen=[];
  const auth={getSnapshot:()=>({principalEpoch:3,disposed:false}),getAccessToken:async()=> 'token'+(++token)};
  const c=createPilotDraftConnection({selection:pilot,auth,requestId:()=> 'pilot_request-1',fetchImpl:async(url,init)=>{
    seen.push({url,body:init.body,bearer:init.headers.Authorization});
    return {status:200,json:async()=>({result:{head:{draftRev:1,publishedRev:0}},replayed:seen.length>1})};
  }});
  const projection={storeId:'alpha',month:'2026-11',store:{timezone:'America/New_York',people:[{id:'a',name:'A',off:null,start:null,end:null,maxHours:null,hiredAt:'2010-02-01'}],rules:[],teams:[],memberships:[]},overrides:{}};
  const prepared=c.transport.prepareSave({storeId:'alpha',month:'2026-11'},0,projection);
  await c.transport.send(prepared,{expectedEpoch:3});await c.transport.send(prepared,{expectedEpoch:3});
  assert.ok(seen.every(r=>r.url==='/api/scheduler'));
  assert.equal(seen[0].body,seen[1].body);assert.notEqual(seen[0].bearer,seen[1].bearer);
  assert.deepEqual(JSON.parse(seen[0].body),{op:'save',storeId:'alpha',month:'2026-11',requestId:'pilot_request-1',input:{baseRev:0,draft:projection}});
});
test('draft app connection requires explicit local mode, both flags and an exact loopback origin',()=>{
  assert.equal(localManualDraftSelected(selected),true);
  for(const origin of ['http://localhost:1','http://[::1]:5178'])assert.equal(localManualDraftSelected({...selected,origin}),true);
  for(const mode of [undefined,'production','development','test'])assert.equal(localManualDraftSelected({...selected,mode}),false);
  for(const flag of [undefined,'0','true',true])for(const field of ['calendarFlag','draftFlag'])assert.equal(localManualDraftSelected({...selected,[field]:flag}),false);
  for(const origin of ['https://localhost','http://localhost.evil','http://example.com','http://0.0.0.0','http://127.0.0.1/path','http://u:p@127.0.0.1','file:///tmp'])assert.equal(localManualDraftSelected({...selected,origin}),false);
  assert.equal(createLocalManualDraftConnection({selection:{...selected,mode:'production'}}),null,'disabled production selector does not inspect auth or create a client');
});

test('selected app connection reuses exact manual request and bearer contracts without making an automatic request',async()=>{
  let calls=0;const requests=[];
  const auth={getSnapshot:()=>({principalEpoch:3,sessionReady:true,disposed:false}),getAccessToken:async()=> 'synthetic-bearer'};
  const connection=createLocalManualDraftConnection({selection:selected,auth,requestId:()=> 'local-only-1',fetchImpl:async(url,init)=>{
    calls++;requests.push({url,body:JSON.parse(init.body),bearer:init.headers.Authorization});
    return {status:200,json:async()=>({result:{kind:'draft',revision:0,schedule:null}})};
  }});
  assert.equal(calls,0);assert.equal(connection.auth,auth);
  const command=connection.transport.prepareRead({storeId:'sage-demo',month:'2026-11'});
  const result=await connection.transport.send(command,{expectedEpoch:3});
  assert.equal(result.revision,0);assert.equal(result.draft,null);
  assert.deepEqual(requests,[{url:'/api/scheduler-manual',body:{action:'load',storeId:'sage-demo',month:'2026-11'},bearer:'Bearer synthetic-bearer'}]);
});

const month='2026-11';
const snapshot=(status,{dirty=false,pending=false,accepted=true,error=null,awaiting=false,operation=null,other=[]}={})=>({
  active:true,editor:{dirtyMonths:dirty?[month]:[],pending},months:[{month,loadAccepted:accepted,error,awaitingAcknowledgement:awaiting,operation,controller:{status,draftRev:status==='absent'?0:1,error}},...other],
});
test('loaded data is distinguished from a saved receipt and pending or newer edits stay unsaved',()=>{
  assert.match(manualDraftView(snapshot('ready'),month).message,/loaded/);
  assert.doesNotMatch(manualDraftView(snapshot('ready'),month).message,/saved/);
  assert.match(manualDraftView(snapshot('saved'),month).message,/saved/);
  assert.match(manualDraftView(snapshot('saved',{dirty:true}),month).message,/not saved/);
  assert.match(manualDraftView(snapshot('saved',{pending:true}),month).message,/not saved/);
  assert.equal(manualDraftView(snapshot('saved',{pending:true}),month).canSave,false);
  assert.equal(manualDraftView(snapshot('ready'),month).canSave,false,'clean confirmed draft is not resubmitted');
  assert.equal(manualDraftView(snapshot('absent'),month).canSave,true,'confirmed absence may create its first draft');
  const unacknowledged=manualDraftView(snapshot('saved',{awaiting:true,error:'acknowledgement-refused',accepted:false}),month);
  assert.match(unacknowledged.message,/Save confirmed for the submitted draft/);
  assert.doesNotMatch(unacknowledged.message,/Draft saved/);assert.equal(unacknowledged.canSave,false);assert.equal(unacknowledged.canRetry,false);
});
test('uncertain and conflict states cannot become a fresh save or an implicit reload',()=>{
  const uncertain=manualDraftView(snapshot('uncertain',{awaiting:true,dirty:true}),month);
  assert.match(uncertain.message,/not confirmed/);assert.equal(uncertain.canRetry,true);assert.equal(uncertain.canSave,false);assert.equal(uncertain.canLoad,false);
  const running=manualDraftView(snapshot('saving',{operation:'retry',awaiting:true}),month);
  assert.equal(running.canRetry,false);assert.equal(running.canSave,false);
  const conflict=manualDraftView(snapshot('conflict',{dirty:true}),month);
  assert.match(conflict.message,/still here/);assert.equal(conflict.canLoad,false);assert.equal(conflict.canSave,false);assert.equal(conflict.canRetry,false);
});
test('status is scoped to its actual month and does not hide another retained save',()=>{
  const view=manualDraftView(snapshot('ready',{other:[{month:'2026-12',operation:null,awaitingAcknowledgement:true,controller:{status:'uncertain'}}]}),month);
  assert.match(view.message,/Another month/);assert.equal(view.month,month);
  for(const key of ['draft','projection','token','command'])assert.equal(Object.hasOwn(view,key),false);
  const stale=manualDraftView({active:false,months:[]},month);
  assert.equal(stale.canLoad,false);assert.equal(stale.canSave,false);assert.equal(stale.canRetry,false);
});
