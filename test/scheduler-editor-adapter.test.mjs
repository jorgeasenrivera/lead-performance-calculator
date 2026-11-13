import test from 'node:test';
import assert from 'node:assert/strict';
import {editorProps,editorStore,monthPeople,zonedToday,EditorInputError,createLegacyScheduleResolver} from '../src/scheduler-editor-adapter.mjs';
import {createPlanner} from '../scripts/scheduler-performance/month-model.mjs';
import {employmentProblem} from '../scripts/scheduler-performance/shift-intervals.mjs';
const store={id:'fictional-a',name:'Fictional'}, day='2026-11-02';
const data=()=>({__storeId:store.id,roster:[{id:'a',name:'Alex',roleId:'sales'},{id:'b',name:'Blair',roleId:'sales',hiredAt:'2026-11-03'}],departed:[]});
const args=()=>({store,data:data(),timezone:'America/New_York',now:new Date('2026-11-02T03:00:00Z'),principalEpoch:2,dataEpoch:2});

test('unscoped or stale input refuses before assignment resolver is used',()=>{
  for(const over of [{store:{id:'bad id'}},{data:{...data(),__storeId:'other'}},{dataEpoch:1},{principalEpoch:undefined},{dataEpoch:-1},{timezone:'Bad/Zone'},{now:new Date('bad')},{explicitAssignmentForDay:true}]) {
    let calls=0;const p=editorProps({...args(),explicitAssignmentForDay:()=>calls++,...over});assert.equal(p.ok,false);assert.equal(calls,0);
  }
});
test('actual store-local clock refreshes without inferring timezone',()=>{
  let now=new Date('2026-11-02T03:00:00Z');const p=editorProps({...args(),now:()=>now});assert.equal(p.today(),'2026-11-01');now=new Date('2026-11-02T06:00:00Z');assert.equal(p.today(),day);now=null;assert.throws(()=>p.today(),EditorInputError);
  assert.equal(zonedToday('Pacific/Auckland',new Date('2026-11-02T03:00:00Z')),day);
});
test('roster settings and employment remain detached and unknown; no sample teams',()=>{
  const d=data(),s=editorStore(store,d,'America/New_York'),people=monthPeople(d);d.roster[0].name='changed';assert.equal(s.people[0].name,'Alex');assert.equal(people('2026-10').length,1);assert.equal(people('2026-11').length,2);
  assert.deepEqual([s.rules,s.history,s.teams,s.memberships],[[],[],[],[]]);assert.deepEqual([s.people[0].off,s.people[0].start,s.people[0].end,s.people[0].maxHours],[null,null,null,null]);
  assert.throws(()=>editorStore(store,{roster:[...data().roster,data().roster[0]]}),EditorInputError);
});
test('actual strict planner gets no fabricated hours or assignments when no source exists',()=>{
  const p=editorProps(args());assert.equal(p.ok,true);const planner=createPlanner(p.stores,p);assert.equal(planner.record(0,day),null);const row=planner.rows(0,'2026-11').find(r=>r.day===day);assert.equal(row.state,'unknown');assert.equal(row.minimumCoverage,null);assert.equal(row.weeklyHours.a,null);
});
test('explicit resolver seam preserves provenance, is detached, and never overrides manager choices',()=>{
  const record={on:[],off:['a'],absences:{a:{kind:'off',source:{kind:'legacy planned off',snapshotRevision:'fictional-r1'}}}};
  const p=editorProps({...args(),explicitAssignmentForDay:(date,index)=>date===day&&index===0?{storeId:store.id,day:date,record}:null});const planner=createPlanner(p.stores,p);
  const r=planner.record(0,day);assert.deepEqual(r.absences,record.absences);r.absences.a.source.kind='changed';assert.equal(record.absences.a.source.kind,'legacy planned off');assert.equal(r.shifts,undefined);
  planner.setAssignment(0,day,{on:[],off:[],unknownNotes:{a:{source:{kind:'manager choice'}}}});assert.deepEqual(planner.record(0,day).off,[]);assert.equal(planner.record(0,day).unknownNotes.a.source.kind,'manager choice');assert.equal(planner.record(0,'2026-11-03'),null);
});
test('cross-store or date resolver answers fail closed, missing and blocked stay null',()=>{
  for(const bad of [{storeId:'other',day,record:{}},{storeId:store.id,day:'2026-11-03',record:{}},{storeId:store.id,day,record:[]}]) {const p=editorProps({...args(),explicitAssignmentForDay:()=>bad});assert.throws(()=>createPlanner(p.stores,p).record(0,day),EditorInputError);}
  const p=editorProps(args());assert.equal(p.explicitAssignmentForDay(day,1),null);assert.equal(p.explicitAssignmentForDay('bad'),null);
});
test('source display does not materialize base records into exported overrides or claim persistence',()=>{
  const p=editorProps({...args(),explicitAssignmentForDay:date=>date===day?{storeId:store.id,day,record:{on:[],off:['a']}}:null}),planner=createPlanner(p.stores,p);
  assert.deepEqual(planner.record(0,day).off,['a']);const exported=planner.exportMonth(0,'2026-11');assert.deepEqual(exported.projection.overrides,{});assert.equal(planner.draftStatus(0).atomic,false);
});

test('reviewed legacy factory composes through actual host seam without hours or loss of provenance',()=>{
  const d=data();d.daysOff={a:[day]};d.forcedOff={a:[day]};d.daysOffAt={a:'2026-11-01T12:00:00Z'};
  d.scheduleSource={'2026-10':{file:'fictional.csv',at:'2026-11-01T12:00:00Z',off:{a:[day]}}};
  const s=editorStore(store,d,'America/New_York');
  const seed=createLegacyScheduleResolver({stores:[s],snapshots:[{storeId:store.id,revision:'synthetic-r1',data:d}],startDate:'2026-11-01',endDate:'2026-11-30'});
  const built=editorProps({...args(),data:d,explicitAssignmentForDay:seed.explicitAssignmentForDay}),p=createPlanner(built.stores,built),r=p.record(0,day);
  assert.deepEqual(r.on,[]);assert.deepEqual(r.off,['a']);assert.equal(r.shifts,undefined);assert.ok(r.unknownNotes.b);
  assert.equal(r.absences.a.source.managerForced,true);assert.equal(r.absences.a.source.originalAbsenceTypeKnown,false);assert.equal(r.absences.a.source.uploadReferences[0].sourceMonth,'2026-10');
  d.daysOff.a=[];r.absences.a.source.uploadReferences[0].file='changed';assert.equal(p.record(0,day).absences.a.source.uploadReferences[0].file,'fictional.csv');
  p.setAssignment(0,day,{on:[],off:[],unknownNotes:{a:{source:{kind:'manager override'}}}});assert.deepEqual(p.record(0,day).off,[]);
  assert.equal(seed.report().applyReady,false);assert.equal(seed.report().completeProvenance,false);
});
test('inconsistent legacy source blocks day and sparse input cannot become work',()=>{
  const d=data();d.daysOff={};d.forcedOff={a:[day]};const s=editorStore(store,d,'America/New_York');
  const seed=createLegacyScheduleResolver({stores:[s],snapshots:[{storeId:store.id,revision:'synthetic-r2',data:d}],startDate:'2026-11-01',endDate:'2026-11-30'});
  const built=editorProps({...args(),explicitAssignmentForDay:seed.explicitAssignmentForDay});assert.equal(createPlanner(built.stores,built).record(0,day),null);assert.ok(seed.report().stores[0].blockedDates.includes(day));
  const sparse=[];sparse.length=1;assert.throws(()=>createLegacyScheduleResolver({stores:sparse,snapshots:[],startDate:day,endDate:day}));
});
test('inclusive daily employment bounds survive adapter and block direct work outside employment',()=>{
  const d={__storeId:store.id,roster:[{id:'a',name:'Alex',roleId:'sales',hiredAt:'2026-11-03'}],departed:[{id:'a',at:'2026-11-05'}]};
  const s=editorStore(store,d,'America/New_York');Object.assign(s.people[0],{off:[],start:9,end:17,maxHours:60});s.rules=[{effective:'2014-01-01',open:9,close:17,minimum:1,closedDays:[],holidays:{}}];
  for(const [date,allowed] of [['2026-11-02',false],['2026-11-03',true],['2026-11-05',true],['2026-11-06',false]]){
    const p=createPlanner([s],{strictHours:true,explicitAssignmentForDay:day=>({storeId:s.id,day,record:{on:[],off:day===date?[]:['a']}})});
    const command={index:0,day:date,personId:'a',startMinute:540,endMinute:720};if(allowed)assert.equal(p.reviewDirectShift(command).mode,'add');else{assert.throws(()=>p.reviewDirectShift(command),/employment/);p.setAssignment(0,date,{on:['a'],off:[]});assert.ok(p.rows(0,'2026-11').find(r=>r.day===date).conflicts.a.some(reason=>/employment/.test(reason)));}
  }
});
test('hydration cannot strip authoritative employment bounds from the scoped roster',()=>{
  const built=editorProps(args()),p=createPlanner(built.stores,built),out=p.exportMonth(0,'2026-11');out.projection.store.people.find(p=>p.id==='b').hiredAt=null;
  const q=createPlanner(built.stores,built);assert.deepEqual(q.hydrateMonth(0,out.projection,x=>x),{ok:false,reason:'employment-scope'});assert.equal(q.drafts.size,0);
});
test('malformed supplied employment bounds fail closed while absent unknown bounds stay compatible',()=>{
  for(const hiredAt of [false,0,NaN,'bad']){const d=data();d.roster[0].hiredAt=hiredAt;assert.equal(editorProps({...args(),data:d}).reason,'employment');}
  const built=editorProps(args()),p=createPlanner(built.stores,built),out=p.exportMonth(0,'2026-11');for(const person of out.projection.store.people)if(person.hiredAt===null){delete person.hiredAt;delete person.departedAt;}
  assert.equal(createPlanner(built.stores,built).hydrateMonth(0,out.projection,x=>x).ok,true);
});
test('employment bounds support longstanding staff before the planner range and genuine Gregorian dates',()=>{
  const d=data();d.roster[0].hiredAt='2008-05-15';const built=editorProps({...args(),data:d});assert.equal(built.ok,true);assert.equal(employmentProblem(built.stores[0].people[0],day),null);
  assert.equal(employmentProblem({hiredAt:'2000-02-29'},day),null);assert.match(employmentProblem({hiredAt:'1900-02-29'},day),/review/);assert.equal(employmentProblem({departedAt:'2010-05-01'},day),'After employment end date.');
});
test('a future hire does not make an employed person’s confirmed daily coverage unknown',()=>{
  const s={id:'fictional',timezone:'America/New_York',history:[],teams:[],memberships:[],people:[{id:'a',name:'Alex',start:9,end:17,maxHours:60,off:[]},{id:'b',name:'Blair',start:9,end:17,maxHours:60,off:[],hiredAt:'2026-11-03'}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,closedDays:[],holidays:{}}]};
  const p=createPlanner([s],{strictHours:true,explicitAssignmentForDay:date=>({storeId:s.id,day:date,record:date===day?{on:['a'],off:[],shifts:[{storeId:s.id,personId:'a',date,endDate:date,startMinute:540,endMinute:1020,timezone:s.timezone}]}:{on:[],off:['a','b']}})});
  assert.equal(p.rows(0,'2026-11').find(r=>r.day===day).minimumCoverage,1);
});
