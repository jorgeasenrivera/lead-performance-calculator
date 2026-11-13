/**
 * The editor's draft bridge: detached per-month state, a saved baseline per month that moves only to what was
 * submitted, change notices, and hydration that checks everything first. Every record is synthetic, nothing here
 * sends, stores or reads from anywhere, and the codec is the test's own stand-in: this file defines no wire format.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlanner } from "../scripts/scheduler-performance/month-model.mjs";
import { mountMonthApp } from "../scripts/scheduler-performance/month-app-core.mjs";
import {schedulerDraftCodec} from '../src/scheduler-draft-codec.mjs';
import {createSchedulerDraftTransport} from '../src/scheduler-draft-transport.mjs';
import {createSchedulerDraftBinding} from '../src/scheduler-draft-binding.mjs';
import {manualDraftFetch} from '../src/scheduler-manual-setup.mjs';

const SOURCE = { on: ["b"], off: ["a"], absences: { a: { kind: "legacy-off", source: { file: "original.csv", line: 4 } } }, teamSnapshot: { a: { teamIds: ["old"], unknown: false } }, shifts: [{ personId: "b", startMinute: 540, endMinute: 600 }], unknownNotes: { c: { source: "keep" } }, generationLocks: ["b"] };
const people = () => ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase(), off: [], start: 9, end: 17, maxHours: 40 }));
const baseStore = () => ({
  id: "store-a", name: "Store A", timezone: "America/New_York", people: people(),
  rules: [{ effective: "2014-01-01", open: 9, close: 17, minimum: 1, closedDays: [], holidays: {} }],
  history: [], teams: [{ id: "old", name: "Old" }, { id: "new", name: "New" }],
  memberships: [{ storeId: "store-a", personId: "a", teamIds: ["old"], from: "2014-01-01", to: "2026-11-30" }, { storeId: "store-a", personId: "a", teamIds: ["new"], from: "2026-12-01", to: "2100-12-31" }],
});
const make = () => createPlanner([baseStore()], { assignmentForDay: (day) => (day === "2026-11-30" ? SOURCE : null) });
// The editor wraps the draft map's `set` to give each NEW month its own roster; this does the same, with a roster of
// people who have no availability, so a hydration that went through it would show.
const withSeededRoster = (planner) => {
  const set = planner.drafts.set.bind(planner.drafts);
  planner.drafts.set = (key, draft) => {
    if (!planner.drafts.has(key)) draft.store.people = people().map((p) => ({ ...p, start: null, end: null, maxHours: null, off: null }));
    return set(key, draft);
  };
  return planner;
};
const allow = (projection) => projection;
const EDIT = { on: ["b"], off: ["a"] };
const SHAPE_KEYS = ["month", "overrides", "storeId", "store"].sort();

const wireStore=()=>{
  const store=baseStore();store.rules=store.rules.map(rule=>({...rule,capacity:8,useCapacity:false}));
  store.people[0].hiredAt='2008-05-15';store.people[1].departedAt='2026-11-03';
  Object.assign(store.people[2],{start:null,end:null,off:null,maxHours:null,hiredAt:null});return store;
};
const wireRecord=()=>({on:['a'],off:['b'],breaksKnown:false,
  shifts:[{storeId:'store-a',personId:'a',date:'2026-11-02',endDate:'2026-11-02',timezone:'America/New_York',startMinute:555,endMinute:1005,source:{kind:'CSV',file:'synthetic.csv',line:2}}],
  absences:{b:{kind:'vacation',source:{kind:'manual',at:null}}},unknownNotes:{c:{source:{kind:'hours unavailable'}}},
  teamSnapshot:{a:{storeId:'store-a',personId:'a',date:'2026-11-02',teamIds:['old']}},
  generation:{unlocked:['a'],signatures:{a:'synthetic retained signature'}},generationLocks:['b']});
const wirePlanner=(source={})=>createPlanner([wireStore()],{strictHours:true,requireMaterializedSources:true,
  explicitAssignmentForDay:day=>source[day]?{storeId:'store-a',day,record:source[day]}:null});
const savedWire=()=>{const p=wirePlanner();p.setAssignment(0,'2026-11-02',wireRecord());return p.exportMonth(0,'2026-11').projection;};
const answer=(status,payload)=>({status,json:async()=>structuredClone(payload)});
const held=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const bindingFixture=(planner,respond=()=>answer(200,{result:{kind:'draft',revision:0,schedule:null}}))=>{
  const calls=[],listeners=new Set();let pending=false,epoch=1,sequence=0,hydrations=0,acks=0,applies=0;
  const auth={getSnapshot:()=>({principalEpoch:epoch,sessionReady:true,disposed:false}),getAccessToken:async()=> 'synthetic-bearer',subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const transport=createSchedulerDraftTransport({auth,codec:schedulerDraftCodec,requestId:()=> 'fixture-'+(++sequence),fetchImpl:manualDraftFetch(async(url,init)=>{const command=JSON.parse(init.body);calls.push({url,command});return respond(command);})});
  const editor={
    exportMonth:(month,index)=>{try{return{ok:true,...planner.exportMonth(index,month)};}catch(error){return{ok:false,reason:error.code||'scope'};}},
    reviewMaterialization:(month,index)=>{if(pending)return{ok:false,reason:'pending-choices'};try{return{ok:true,review:planner.reviewMaterialization(index,month)};}catch{return{ok:false,reason:'source-unavailable'};}},
    applyMaterialization:token=>{applies++;return planner.applyMaterialization(token);},
    hydrateMonth:(projection,index,scope)=>{hydrations++;return planner.hydrateMonth(index,projection,schedulerDraftCodec.verify,scope);},
    acknowledgeMonth:(month,token,index)=>{acks++;return planner.acknowledgeMonth(index,month,token);},
    draftStatus:index=>({ok:true,...planner.draftStatus(index),pending}),hasDraft:()=>planner.unsaved||pending,
  };
  const binding=createSchedulerDraftBinding({auth,transport,getEditor:()=>editor,storeId:'store-a',lifetime:'synthetic-mounted-editor'});
  const off=planner.subscribe(event=>binding.onDraftChange(event));
  return{binding,calls,editor,setPending:value=>pending=value,setEpoch:value=>{epoch=value;for(const fn of listeners)fn();},
    counts:()=>({hydrations,acks,applies}),dispose:()=>{off();binding.dispose();}};
};

test('actual draft codec round-trip and hydration preserve employment, unknowns, minute shifts and complete provenance',()=>{
  const original=savedWire(),scope={storeId:'store-a',month:'2026-11'},decoded=schedulerDraftCodec.decode(schedulerDraftCodec.encode(original,scope),scope);
  assert.deepEqual(decoded,original);assert.equal(decoded.store.people[0].hiredAt,'2008-05-15');assert.equal(decoded.store.people[2].maxHours,null);
  const p=wirePlanner();assert.equal(p.hydrateMonth(0,decoded,schedulerDraftCodec.verify,scope).ok,true);assert.deepEqual(p.exportMonth(0,scope.month).projection,original);
  assert.deepEqual(p.record(0,'2026-11-02'),original.overrides['2026-11-02']);
  assert.equal(p.record(0,'2026-11-02').teamSnapshot.c.unknown,true);assert.equal(p.unsaved,false);
});
test('employment storage bounds support real Gregorian dates and preserve unknowns without widening other schema fields',()=>{
  const scope={storeId:'store-a',month:'2026-11'};
  for(const bounds of [{hiredAt:'0001-01-01'},{hiredAt:'2000-02-29'},{hiredAt:'1600-02-29'},{hiredAt:null,departedAt:null},{hiredAt:'2008-05-15',departedAt:'2008-05-15'}]){
    const p=savedWire();Object.assign(p.store.people[0],bounds);assert.deepEqual(schedulerDraftCodec.decode(schedulerDraftCodec.encode(p,scope),scope),p);
  }
  for(const bounds of [{hiredAt:'0000-01-01'},{hiredAt:'1900-02-29'},{hiredAt:'1700-02-29'},{hiredAt:'2008-13-01'},{hiredAt:'2008-04-31'},{hiredAt:''},{hiredAt:false},{hiredAt:0},{hiredAt:'2008-01-01T00:00:00Z'},{hiredAt:'2008-05-16',departedAt:'2008-05-15'},{employmentApproved:true}]){
    const p=savedWire();Object.assign(p.store.people[0],bounds);assert.throws(()=>schedulerDraftCodec.encode(p,scope),{code:'unsupported-data'});
  }
  const p=savedWire();p.store.rules[0].effective='2008-05-15';assert.throws(()=>schedulerDraftCodec.encode(p,scope),{code:'unsupported-data'},'schedule-date range remains unchanged');
});
test('manual request-ID boundaries refuse malformed identities before any dispatch and preserve valid prepared bytes',async()=>{
  const projection=savedWire(),scope={storeId:'store-a',month:'2026-11'};let calls=0;
  const make=id=>createSchedulerDraftTransport({auth:{getSnapshot:()=>({principalEpoch:1}),getAccessToken:async()=> 'synthetic'},codec:schedulerDraftCodec,requestId:()=>id,fetchImpl:async()=>{calls++;return answer(200,{result:{head:{draftRev:1,publishedRev:0}},replayed:false});}});
  for(const id of ['', 'a'.repeat(81),' has-space','has space','slash/id','dot.id','a\n','é',null,1])assert.throws(()=>make(id).prepareSave(scope,0,projection),{code:'unsupported-data'});
  assert.equal(calls,0);
  for(const id of ['a','A0_-','a'.repeat(80)]){const t=make(id),command=t.prepareSave(scope,0,projection);assert.equal(JSON.parse(command.body).requestId,id);await t.send(command,{expectedEpoch:1});assert.equal(JSON.parse(command.body).requestId,id);}
  assert.equal(calls,3);
});
test('pristine source loading accepts a complete saved projection without applying or acknowledging seed facts',async()=>{
  const source={'2026-11-02':wireRecord()},remote=savedWire(),p=wirePlanner(source),f=bindingFixture(p,()=>answer(200,{result:{kind:'draft',revision:7,schedule:remote}}));
  await f.binding.load('2026-11');assert.equal(f.binding.getSnapshot().months[0].loadAccepted,true);
  assert.deepEqual(p.exportMonth(0,'2026-11').projection,remote);assert.deepEqual(f.counts(),{hydrations:1,acks:0,applies:0});assert.equal(p.unsaved,false);f.dispose();
});
test('confirmed absence keeps source facts unmaterialized; unavailable load cannot establish revision zero',async()=>{
  for(const unavailable of [false,true]){
    const p=wirePlanner({'2026-11-02':wireRecord()}),f=bindingFixture(p,()=>unavailable?answer(503,{error:'storage-not-configured'}):answer(200,{result:{kind:'draft',revision:0,schedule:null}}));
    await f.binding.load('2026-11');const entry=f.binding.getSnapshot().months[0];assert.equal(entry.loadAccepted,!unavailable);assert.equal(entry.controller.draftRev,unavailable?null:0);
    assert.deepEqual(p.get(0,'2026-11').overrides,{});assert.deepEqual(f.counts(),{hydrations:0,acks:0,applies:0});assert.equal(p.unsaved,false);
    assert.throws(()=>f.binding.save('2026-11'),{code:unavailable?'load-not-accepted':'source-not-materialized'});f.dispose();
  }
});
test('dirty and pending pristine source drafts refuse before starting a load',()=>{
  for(const pending of [true,false]){const p=wirePlanner({'2026-11-02':wireRecord()}),f=bindingFixture(p);if(pending)f.setPending(true);else p.setAssignment(0,'2026-11-03',{on:[],off:['a']});
    assert.throws(()=>f.binding.load('2026-11'));assert.equal(f.calls.length,0);assert.deepEqual(f.counts(),{hydrations:0,acks:0,applies:0});f.dispose();}
});
for(const race of ['source-change','new-source','pending','edit','edit-and-revert','principal'])test(`pristine load fences ${race} before any hydration or acknowledgement`,async()=>{
  const source={'2026-11-02':wireRecord()},p=wirePlanner(source),gate=held(),f=bindingFixture(p,()=>gate.promise);
  const loading=f.binding.load('2026-11');for(let i=0;i<20&&!f.calls.length;i++)await Promise.resolve();assert.equal(f.calls.length,1);
  if(race==='source-change')source['2026-11-02'].shifts[0].source.file='changed.csv';
  if(race==='new-source')source['2026-11-04']={on:[],off:['c']};
  if(race==='pending')f.setPending(true);
  if(race==='edit'||race==='edit-and-revert'){p.setAssignment(0,'2026-11-03',{on:[],off:['a']});if(race==='edit-and-revert')p.reset(0,'2026-11');}
  if(race==='principal')f.setEpoch(2);
  gate.resolve(answer(200,{result:{kind:'draft',revision:3,schedule:savedWire()}}));await loading;
  const snapshot=f.binding.getSnapshot();assert.equal(snapshot.active?snapshot.months[0].loadAccepted:false,false);
  assert.deepEqual(f.counts(),{hydrations:0,acks:0,applies:0});if(race==='edit')assert.deepEqual(p.record(0,'2026-11-03').off,['a']);f.dispose();
});

test('hydration captures requested scope before codec code and refuses redirects without any month mutation',()=>{
  for(const redirect of ['2026-12','other-store']){
    const p=make(),input=p.exportMonth(0,'2026-11').projection;
    p.setAssignment(0,'2026-12-10',EDIT);
    const before=['2026-11','2026-12'].map(month=>p.exportMonth(0,month).projection),status=p.draftStatus(0);
    const scope={storeId:'store-a',month:'2026-11'};
    const result=p.hydrateMonth(0,input,value=>{scope.month='2026-12';return redirect==='other-store'?{...value,storeId:redirect}:{...value,month:redirect};},scope);
    assert.deepEqual(result,{ok:false,reason:'scope'});
    assert.deepEqual(['2026-11','2026-12'].map(month=>p.exportMonth(0,month).projection),before);
    assert.deepEqual(p.draftStatus(0),status);
  }
});
test('raw hydration scope mismatch refuses before verifier and implicit scope also fences transformation',()=>{
  const p=make(),input=p.exportMonth(0,'2026-11').projection;let calls=0;
  assert.equal(p.hydrateMonth(0,input,()=>{calls++;return true;},{storeId:'store-a',month:'2026-12'}).reason,'scope');assert.equal(calls,0);
  assert.equal(p.hydrateMonth(0,input,value=>({...value,month:'2026-12'})).reason,'scope');
  assert.equal(p.drafts.has('0:2026-12'),false);
});

const explicitFixture=()=>{
  const store=baseStore(),source={
    '2026-11-02':{on:[],off:['a'],absences:{a:{kind:'off',source:{kind:'legacy schedule',snapshotRevision:'r1',file:'fictional.csv'}}},unknownNotes:{b:{source:{kind:'hours unknown'}}}},
    '2026-11-03':{on:[],off:['b'],absences:{b:{kind:'off',source:{kind:'manager historical mark'}}}}
  };
  const planner=createPlanner([store],{strictHours:true,requireMaterializedSources:true,assignmentForDay:()=>{throw Error('No implicit source');},explicitAssignmentForDay:day=>source[day]?{storeId:store.id,day,record:source[day]}:null});
  return {store,source,planner};
};
test('reviewed local materialization exports detached explicit facts and rehydrates without original resolver',()=>{
  const {store,source,planner:p}=explicitFixture();assert.throws(()=>p.exportMonth(0,'2026-11'),e=>e.code==='source-not-materialized');
  const notices=[];p.subscribe(e=>notices.push(e));const token=p.reviewMaterialization(0,'2026-11');assert.deepEqual(token.dates,['2026-11-02','2026-11-03']);assert.equal(p.unsaved,false);assert.equal(token.unavailableDates.length,28);
  const before=p.record(0,'2026-11-02');assert.equal(token.records['2026-11-02'].absences.a.source.file,'fictional.csv');token.records['2026-11-02'].absences.a.source.file='review display mutation';assert.equal(p.applyMaterialization(token).changed,2);assert.equal(notices.length,1);assert.equal(p.unsaved,true);assert.deepEqual(p.record(0,'2026-11-02'),before);
  const out=p.exportMonth(0,'2026-11');assert.equal(out.projection.overrides['2026-11-02'].shifts,undefined);assert.deepEqual(out.projection.overrides['2026-11-02'].absences,source['2026-11-02'].absences);
  const q=createPlanner([store],{strictHours:true,requireMaterializedSources:true});assert.equal(q.hydrateMonth(0,out.projection,allow).ok,true);assert.deepEqual(q.record(0,'2026-11-02'),before);assert.deepEqual(q.exportMonth(0,'2026-11').projection,out.projection);
  out.projection.overrides['2026-11-02'].absences.a.source.file='mutated';assert.equal(p.record(0,'2026-11-02').absences.a.source.file,'fictional.csv');assert.equal(q.record(0,'2026-11-02').absences.a.source.file,'fictional.csv');
});
test('materialization honors manager overrides without consulting their external source',()=>{
  const {planner:p,source}=explicitFixture();p.setAssignment(0,'2026-11-02',{on:[],off:[],unknownNotes:{a:{source:'manager choice'}}});source['2026-11-02']={get on(){throw Error('Overridden source must not be read');}};
  const token=p.reviewMaterialization(0,'2026-11');assert.deepEqual(token.dates,['2026-11-03']);p.applyMaterialization(token);assert.deepEqual(p.record(0,'2026-11-02').off,[]);assert.equal(p.exportMonth(0,'2026-11').projection.overrides['2026-11-02'].unknownNotes.a.source,'manager choice');
});
test('changed or newly appearing sources and concurrent draft edits stale the entire materialization',()=>{
  for(const mutate of [(s,p)=>s['2026-11-02'].absences.a.source.snapshotRevision='r2',(s,p)=>s['2026-11-04']={on:[],off:['c']},(s,p)=>p.setAssignment(0,'2026-11-05',{on:[],off:['c']})]){
    const {planner:p,source}=explicitFixture(),token=p.reviewMaterialization(0,'2026-11');mutate(source,p);const before=structuredClone(p.get(0,'2026-11').overrides);assert.throws(()=>p.applyMaterialization(token),/changed/);assert.deepEqual(p.get(0,'2026-11').overrides,before);
  }
});
test('materialization failure is atomic and no-op preserves acceptance, fingerprint and revision',()=>{
  const {planner:p,source}=explicitFixture();source['2026-11-03'].unknownNotes={b:{source:1n}};assert.throws(()=>p.reviewMaterialization(0,'2026-11'));assert.deepEqual(p.get(0,'2026-11').overrides,{});delete source['2026-11-03'].unknownNotes;
  p.applyMaterialization(p.reviewMaterialization(0,'2026-11'));const d=p.get(0,'2026-11');d.accepted=true;d.reviewFingerprint='retained';const revision=p.revision,token=p.reviewMaterialization(0,'2026-11');assert.equal(p.applyMaterialization(token).changed,0);assert.equal(p.revision,revision);assert.equal(d.accepted,true);assert.equal(d.reviewFingerprint,'retained');assert.throws(()=>p.applyMaterialization(token),/Unknown/);
});
test('gated sparse hydration refuses before any draft or baseline change',()=>{
  const {planner:p,store}=explicitFixture();const sparse={storeId:store.id,month:'2026-11',store:{people:store.people,rules:store.rules,teams:store.teams,memberships:store.memberships,timezone:store.timezone},overrides:{}};
  assert.deepEqual(p.hydrateMonth(0,sparse,allow),{ok:false,reason:'source-not-materialized'});assert.equal(p.drafts.size,0);assert.equal(p.unsaved,false);
});
test('source callback reentry cannot overwrite a concurrent manager choice during review or apply',()=>{
  for(const phase of ['review','apply']){const s=baseStore();let p,armed=false;p=createPlanner([s],{strictHours:true,requireMaterializedSources:true,explicitAssignmentForDay:day=>{if(day!=='2026-11-02')return null;if(armed){armed=false;p.setAssignment(0,day,{on:[],off:[],unknownNotes:{a:{source:'new manager choice'}}});}return {storeId:s.id,day,record:{on:[],off:['a']}};}});
    if(phase==='review'){armed=true;assert.throws(()=>p.reviewMaterialization(0,'2026-11'),/changed/);}else{const t=p.reviewMaterialization(0,'2026-11');armed=true;assert.throws(()=>p.applyMaterialization(t),/changed/);}assert.deepEqual(p.record(0,'2026-11-02').off,[]);assert.equal(p.record(0,'2026-11-02').unknownNotes.a.source,'new manager choice');
  }
});

test("an export is exactly the persistable shape, a copy, and leaves out what is not saved", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const d = p.get(0, "2026-11");
  d.accepted = true; d.reviewFingerprint = "fp";
  const { projection, token } = p.exportMonth(0, "2026-11");
  assert.deepEqual(Object.keys(projection).sort(), SHAPE_KEYS);
  assert.deepEqual(Object.keys(projection.store).sort(), ["memberships", "people", "rules", "teams", "timezone"]);
  assert.equal(projection.storeId, "store-a");
  assert.equal(projection.month, "2026-11");
  assert.ok(projection.overrides["2026-11-10"]);
  assert.equal(JSON.stringify(projection).includes("reviewFingerprint"), false);
  assert.equal(JSON.stringify(projection).includes("accepted"), false);
  assert.equal(Object.isFrozen(token), true);
  // Detached both ways.
  projection.overrides["2026-11-10"].on.push("zz");
  projection.store.people[0].name = "changed";
  assert.deepEqual(p.get(0, "2026-11").overrides["2026-11-10"].on, ["b"]);
  assert.equal(p.get(0, "2026-11").store.people[0].name, "A");
  const again = p.exportMonth(0, "2026-11");
  p.setAssignment(0, "2026-11-11", EDIT);
  assert.equal(again.projection.overrides["2026-11-11"], undefined);
});

test("unsaved means different from what was saved, not edited at some point", () => {
  const p = make();
  assert.equal(p.unsaved, false);
  p.get(0, "2026-11");
  assert.equal(p.unsaved, false, "looking at a month changes nothing");
  p.setAssignment(0, "2026-11-10", EDIT);
  assert.equal(p.unsaved, true);
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11"]);
  p.reset(0, "2026-11");
  assert.equal(p.unsaved, false, "put back as it began, it is clean");
});

test("an acknowledgment moves the baseline to exactly what was submitted, and edits made during the save stay unsaved", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const first = p.exportMonth(0, "2026-11");
  p.setAssignment(0, "2026-11-11", EDIT);   // typed while the first was being sent
  const ok = p.acknowledgeMonth(0, "2026-11", first.token);
  assert.equal(ok.ok, true);
  assert.equal(ok.clean, false);
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11"], "the later edit is still unsaved");
  const second = p.exportMonth(0, "2026-11");
  assert.equal(p.acknowledgeMonth(0, "2026-11", second.token).clean, true);
  assert.equal(p.unsaved, false);
  // Edited back past the baseline is unsaved again.
  p.reset(0, "2026-11");
  assert.equal(p.unsaved, true, "the saved state had two edits; none is different");
});

test("stale, out-of-order, unknown and wrong-scope acknowledgments change nothing", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const older = p.exportMonth(0, "2026-11");
  p.setAssignment(0, "2026-11-11", EDIT);
  const newer = p.exportMonth(0, "2026-11");
  assert.equal(p.acknowledgeMonth(0, "2026-11", newer.token).ok, true);
  const before = JSON.stringify(p.draftStatus(0));
  assert.deepEqual(p.acknowledgeMonth(0, "2026-11", older.token), { ok: false, reason: "stale" });
  assert.deepEqual(p.acknowledgeMonth(0, "2026-11", { ...newer.token }).reason, "unknown-submission", "a copy of a token is not the token");
  assert.equal(p.acknowledgeMonth(0, "2026-11", null).reason, "unknown-submission");
  const other = make();
  other.setAssignment(0, "2026-11-10", EDIT);
  const foreign = other.exportMonth(0, "2026-11");
  assert.equal(p.acknowledgeMonth(0, "2026-11", foreign.token).reason, "unknown-submission", "another planner's token");
  p.setAssignment(0, "2026-12-03", EDIT);
  const dec = p.exportMonth(0, "2026-12");
  assert.equal(p.acknowledgeMonth(0, "2026-11", dec.token).reason, "wrong-scope", "December's token does not save November");
  assert.equal(JSON.stringify(p.draftStatus(0).dirtyMonths), JSON.stringify(["2026-12"]));
  assert.notEqual(before, "", "nothing above threw");
});

test("changes are announced with a rising token, a listener's failure is its own, and unsubscribing stops them", () => {
  const p = make();
  const seen = [];
  const off = p.subscribe((e) => seen.push(e));
  p.subscribe(() => { throw new Error("listener broke"); });
  p.setAssignment(0, "2026-11-10", EDIT);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].months, [{ index: 0, month: "2026-11" }]);
  p.setAssignment(0, "2026-11-11", EDIT);
  assert.ok(seen[1].token > seen[0].token);
  off();
  p.setAssignment(0, "2026-11-12", EDIT);
  assert.equal(seen.length, 2);
  // A change that was made to the draft directly is noticed when asked.
  const quiet = make();
  const heard = [];
  quiet.subscribe((e) => heard.push(e));
  quiet.get(0, "2026-11").store.people[0].start = 10;
  assert.equal(heard.length, 0);
  quiet.observe();
  assert.equal(heard.length, 1);
  assert.equal(quiet.unsaved, true);
});

test("hydration needs the caller's codec and refuses without changing anything when it, or the shape, says no", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const { projection } = p.exportMonth(0, "2026-12");
  const snapshot = () => JSON.stringify([p.exportMonth(0, "2026-11").projection, p.exportMonth(0, "2026-12").projection, p.draftStatus(0)]);
  const before = snapshot();
  assert.equal(p.hydrateMonth(0, projection, undefined).reason, "codec-missing");
  assert.equal(p.hydrateMonth(0, projection, () => false).reason, "codec-refused");
  assert.equal(p.hydrateMonth(0, projection, () => { throw new Error("no"); }).reason, "codec-refused");
  const bad = (change, reason) => assert.equal(p.hydrateMonth(0, change(structuredClone(projection)), allow).reason, reason, reason);
  bad((x) => ({ ...x, extra: 1 }), "shape");
  bad((x) => { delete x.overrides; return x; }, "shape");
  bad((x) => ({ ...x, storeId: "store-b" }), "scope");
  bad((x) => ({ ...x, month: "2026-13" }), "shape");
  bad((x) => ({ ...x, overrides: { "2026-11-05": EDIT } }), "shape");   // a day outside the month
  bad((x) => ({ ...x, overrides: { "2026-12-05": 5 } }), "shape");
  bad((x) => { x.store.people.push({ ...x.store.people[0] }); return x; }, "shape");   // duplicate id
  bad((x) => { x.store.timezone = "Not/AZone"; return x; }, "shape");
  bad((x) => { x.store.extra = 1; return x; }, "shape");
  bad((x) => ({ ...x, store: { ...x.store, people: "none" } }), "shape");
  assert.equal(p.hydrateMonth(0, () => {}, allow).ok, false, "a value that cannot be copied");
  assert.equal(p.hydrateMonth(5, projection, allow).reason, "scope", "no such store");
  assert.equal(snapshot(), before, "nothing was changed by any refusal");
});

test("a hydrated month is a copy of what the caller gave, and the codec's own answer is what is used", () => {
  const p = make();
  const { projection } = make().exportMonth(0, "2026-12");
  projection.overrides["2026-12-02"] = { on: ["a"], off: ["b"] };
  const given = structuredClone(projection);
  const result = p.hydrateMonth(0, projection, (x) => { const y = structuredClone(x); y.overrides["2026-12-03"] = { on: ["c"], off: [] }; return y; });
  assert.equal(result.ok, true);
  projection.overrides["2026-12-02"].on.push("hijack");
  assert.deepEqual(p.get(0, "2026-12").overrides["2026-12-02"], given.overrides["2026-12-02"], "later changes to the caller's object do not reach the planner");
  assert.ok(p.get(0, "2026-12").overrides["2026-12-03"], "the codec's normalized value was taken");
  assert.equal(p.unsaved, false, "a month just loaded is not unsaved");
  assert.equal(p.draftStatus(0).dirtyMonths.length, 0);
  assert.equal(p.revision, 0, "loading is not an edit");
});

test("hydration keeps saved availability; months nobody saved still get the editor's seeded roster", () => {
  const p = withSeededRoster(make());
  const saved = baseStore();
  saved.people = saved.people.map((x, i) => ({ ...x, start: 8 + i, end: 12 + i, maxHours: 20 + i, off: ["2026-12-24"] }));
  const projection = { storeId: "store-a", month: "2026-12", store: { people: saved.people, rules: saved.rules, teams: saved.teams, memberships: saved.memberships, timezone: "America/New_York" }, overrides: {} };
  const out = p.hydrateMonth(0, projection, allow);
  assert.equal(out.ok, true);
  const got = p.get(0, "2026-12").store.people;
  assert.deepEqual(got.map((x) => [x.start, x.end, x.maxHours, x.off]), saved.people.map((x) => [x.start, x.end, x.maxHours, x.off]), "availability survived");
  assert.deepEqual(p.exportMonth(0, "2026-12").projection.store.people, saved.people);
  const fresh = p.get(0, "2026-10").store.people;
  assert.equal(fresh[0].start, null, "a month that was never saved is seeded as before");
});

test("hydration will not overwrite a month that has unsaved changes", () => {
  const p = make();
  const { projection } = p.exportMonth(0, "2026-11");
  p.setAssignment(0, "2026-11-10", EDIT);
  const before = JSON.stringify(p.exportMonth(0, "2026-11").projection);
  assert.equal(p.hydrateMonth(0, projection, allow).reason, "unsaved-changes");
  assert.equal(JSON.stringify(p.exportMonth(0, "2026-11").projection), before);
});

test("shared teams change every month, none is saved by another's success, and the boundary is stated", () => {
  const p = make();
  p.get(0, "2026-10"); p.get(0, "2026-11"); p.get(0, "2026-12");
  assert.equal(p.unsaved, false);
  const events = [];
  p.subscribe((e) => events.push(e));
  p.addTeam(0, "Third");
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-10", "2026-11", "2026-12"], "every month that has a draft carries the new team");
  assert.equal(events.length, 1);
  assert.equal(events[0].months.length, 3);
  const status = p.draftStatus(0);
  assert.equal(status.atomic, false);
  assert.deepEqual(status.unresolved.map((u) => [u.reason, u.months, u.complete]), [["shared-teams", ["2026-10", "2026-11", "2026-12"], false]]);
  const oct = p.exportMonth(0, "2026-10");
  assert.deepEqual(oct.token.linked, ["2026-11", "2026-12"]);
  const ack = p.acknowledgeMonth(0, "2026-10", oct.token);
  assert.equal(ack.clean, true);
  assert.deepEqual(ack.stillLinked, ["2026-11", "2026-12"], "October's success does not stand for the others");
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11", "2026-12"]);
  for (const m of ["2026-11", "2026-12"]) p.acknowledgeMonth(0, m, p.exportMonth(0, m).token);
  assert.deepEqual(p.draftStatus(0).unresolved, []);
  assert.equal(p.unsaved, false);
});

test("a move across a month boundary is two unsaved months until each is acknowledged", () => {
  const p = make();
  const undo = p.applyOffDay(p.reviewOffDay({ index: 0, personId: "a", from: "2026-11-30", to: "2026-12-01", mode: "move" }));
  assert.ok(undo);
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11", "2026-12"]);
  const nov = p.exportMonth(0, "2026-11");
  assert.deepEqual(nov.token.linked, ["2026-12"]);
  const ack = p.acknowledgeMonth(0, "2026-11", nov.token);
  assert.equal(ack.clean, true);
  assert.deepEqual(ack.stillLinked, ["2026-12"]);
  const status = p.draftStatus(0);
  assert.deepEqual(status.dirtyMonths, ["2026-12"], "the other month keeps its change");
  assert.equal(status.atomic, false);
  assert.deepEqual(status.unresolved.map((u) => [u.reason, u.complete]), [["cross-month-move", false]]);
  p.acknowledgeMonth(0, "2026-12", p.exportMonth(0, "2026-12").token);
  assert.deepEqual(p.draftStatus(0).unresolved, []);
});

test("saved teams from one month are not written under another month that is unsaved or already saved", () => {
  const p = make();
  const decExport = make().exportMonth(0, "2026-12").projection;
  p.setAssignment(0, "2026-11-10", EDIT);                       // November is unsaved
  const different = structuredClone(decExport);
  different.store.teams = [{ id: "old", name: "Old" }, { id: "other", name: "Other" }];
  different.store.memberships = different.store.memberships.map((m) => ({ ...m, teamIds: ["old"] }));
  const before = JSON.stringify([p.teamState[0], p.draftStatus(0)]);
  assert.equal(p.hydrateMonth(0, different, allow).reason, "shared-teams");
  assert.equal(JSON.stringify([p.teamState[0], p.draftStatus(0)]), before);
  // The same teams are fine.
  assert.equal(p.hydrateMonth(0, decExport, allow).ok, true);
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11"], "November's own edit is untouched");
  // With nothing else depending on them, different teams are simply what the store has.
  const q = make();
  q.get(0, "2026-10");
  assert.equal(q.hydrateMonth(0, different, allow).ok, true);
  assert.deepEqual(q.teamState[0].teams.map((t) => t.id), ["old", "other"]);
  assert.equal(q.unsaved, false, "a month that was only ever as it began is still clean under the loaded teams");
});

test("a month that goes away with its editor leaves nothing behind that could be saved", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const { token } = p.exportMonth(0, "2026-11");
  // A fresh planner (a reopened editor) does not know the old one's tokens.
  const reopened = make();
  reopened.get(0, "2026-11");
  assert.equal(reopened.acknowledgeMonth(0, "2026-11", token).reason, "unknown-submission");
  assert.equal(reopened.unsaved, false);
});

test("the editor refuses a codec that cannot verify, and takes no default", () => {
  const root = { nodeType: 1 };
  const base = { root, stores: [baseStore()], assignmentForDay: () => null };
  for (const bad of [null, 5, {}, { verify: "x" }]) assert.throws(() => mountMonthApp({ ...base, draftCodec: bad }), /draftCodec needs a verify function/);
});

test("what is inside the lists is checked here too, so a lax codec cannot poison the planner", () => {
  const p = make();
  const { projection } = p.exportMonth(0, "2026-12");
  const lax = () => true;
  const before = JSON.stringify([p.teamState[0], p.exportMonth(0, "2026-12").projection]);
  const bad = (change, why) => assert.equal(p.hydrateMonth(0, change(structuredClone(projection)), lax).reason, "shape", why);
  bad((x) => { x.store.rules = [null]; return x; }, "a rule that is not an object");
  bad((x) => { x.store.rules = [{ open: 9 }]; return x; }, "a rule with no effective date");
  bad((x) => { x.store.memberships = [7]; return x; }, "a membership that is not an object");
  bad((x) => { x.store.teams = [{ id: "x" }]; return x; }, "a team with no name");
  bad((x) => { x.store.teams.push({ ...x.store.teams[0] }); return x; }, "a duplicate team");
  bad((x) => { x.store.memberships[0].personId = ""; return x; }, "a membership with no person");
  bad((x) => { x.store.memberships[0].teamIds = ["unknown"]; return x; }, "a membership in a team that is not there");
  bad((x) => { x.store.memberships[0].storeId = "store-b"; return x; }, "a membership for another store");
  assert.equal(JSON.stringify([p.teamState[0], p.exportMonth(0, "2026-12").projection]), before, "nothing was taken in");
  assert.doesNotThrow(() => p.rows(0, "2026-12"));
});

test("a move that made its own months is clean again once it is undone, and notices the changes it made", () => {
  const p = make();
  const heard = [];
  p.subscribe((e) => heard.push(e.months.map((m) => m.month).sort().join()));
  const undo = p.applyOffDay(p.reviewOffDay({ index: 0, personId: "a", from: "2026-11-30", to: "2026-12-01", mode: "move" }));
  assert.deepEqual(heard, ["2026-11,2026-12"]);
  assert.equal(p.unsaved, true);
  p.undoOffDay(undo);
  assert.equal(p.unsaved, false, "the months began without those days");
  assert.deepEqual(p.draftStatus(0).unresolved, []);
});

test("a membership for someone who is not on that month's roster is saved data, and a hydrated member does not hide its dirty partner", () => {
  const p = make();
  const { projection } = make().exportMonth(0, "2026-03");
  projection.store.memberships.push({ storeId: "store-a", personId: "left-in-february", teamIds: ["old"], from: "2014-01-01", to: "2026-02-28" });
  assert.equal(p.hydrateMonth(0, projection, allow).ok, true);
  // A group of two months; one of them is loaded from saved state while the other is still unsaved.
  const q = make();
  q.get(0, "2026-10"); q.get(0, "2026-11");
  q.addTeam(0, "Third");
  const clean = q.exportMonth(0, "2026-10");
  q.acknowledgeMonth(0, "2026-10", clean.token);
  assert.deepEqual(q.draftStatus(0).dirtyMonths, ["2026-11"]);
  assert.equal(q.hydrateMonth(0, clean.projection, allow).ok, true);
  assert.deepEqual(q.draftStatus(0).unresolved.map((u) => u.months), [["2026-10", "2026-11"]], "the boundary is still stated");
});
