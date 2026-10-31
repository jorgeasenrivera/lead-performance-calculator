import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanner} from './month-model.mjs';
import {generationInput,generateProposal,applyProposal} from './generation.mjs';
import {localInterval} from './shift-intervals.mjs';

/* Ordinary store hours on the two clock-change dates. generation-dst.test.mjs
   pins the refusal rules and one 09:00 to 17:00 store; this file adds what it
   does not reach: stores whose hours differ from each other and run into the
   evening, and the guarantee that a refused date in one store never touches
   another. It states no scheduling rule. Every number below is read back from
   the store's own configured hours. Fictional stores only.
   Exact elapsed minutes for ordinary daytime on these dates are already pinned
   in local-time.test.mjs, so this file only checks acceptance and that each
   store's configured hours are what comes out. */

const zone='America/New_York';
// Hours differ on purpose. None of them is 9 to 17, and none closes at midnight.
const HOURS=[{id:'fictional-early',open:8,close:18},{id:'fictional-long',open:8,close:21},{id:'fictional-late',open:10,close:21},{id:'fictional-mid',open:9,close:20}];
const person=(id,s)=>({id,name:id,off:[],start:s.open,end:s.close,maxHours:168});
const makeStore=s=>({id:s.id,name:s.id,timezone:zone,history:[],people:['a','b','c'].map(id=>person(id,s)),teams:[],memberships:[],rules:[{effective:'2026-01-01',open:s.open,close:s.close,minimum:1,useCapacity:false,closedDays:[],holidays:{}}]});
const policyFor=store=>({confirmed:true,regenerate:true,mode:'individual',shifts:[{id:'day',fullDay:true}],requiredRoles:{sales:1},people:Object.fromEntries(store.people.map(p=>[p.id,{eligible:true,roles:['sales']}])),useMarket:false});
const generate=(planner,index,month,policy)=>generateProposal(generationInput(planner,index,month,policy));
const refusalNote=(proposal,day)=>proposal.days.find(r=>r.day===day).notes.some(n=>n.startsWith('DST-'));

for(const day of ['2026-11-01','2026-03-08','2026-11-02'])test(`each store's own daytime hours are accepted and preserved on ${day}`,()=>{
 const month=day.slice(0,7),stores=HOURS.map(makeStore),planner=createPlanner(stores);
 stores.forEach((store,index)=>{
  const {open,close}=HOURS[index],proposal=generate(planner,index,month,policyFor(store)),record=proposal.records[day];
  assert.equal(proposal.status,'covered',store.id);
  assert.equal(refusalNote(proposal,day),false,store.id);
  assert.equal(record.shifts.length,1,store.id);
  const shift=record.shifts[0];
  assert.equal(shift.startMinute,open*60,store.id);assert.equal(shift.endMinute,close*60,store.id);
  assert.equal(shift.storeId,store.id);assert.equal(shift.date,day);assert.equal(shift.endDate,day);assert.equal(shift.timezone,zone);
  // Acceptance only. Exact elapsed time for daytime on these dates is local-time.test.mjs's job.
  assert.equal(localInterval(day,shift.startMinute,shift.endMinute,zone).ok,true,store.id);
  assert.equal(record.on.length+record.off.length,store.people.length,'every known person is either working or generated Off');
 });
});

test('split daytime and evening templates inside one store are accepted on both clock-change dates and cover the whole day',()=>{
 for(const day of ['2026-11-01','2026-03-08']){
  const month=day.slice(0,7),store=makeStore({id:'fictional-long',open:8,close:21}),planner=createPlanner([store]);
  const policy=policyFor(store);policy.shifts=[{id:'morning',startMinute:480,endMinute:780},{id:'evening',startMinute:780,endMinute:1260}];
  const proposal=generate(planner,0,month,policy),record=proposal.records[day];
  assert.equal(proposal.status,'covered',day);
  const spans=record.shifts.map(s=>[s.startMinute,s.endMinute]).sort((x,y)=>x[0]-y[0]);
  assert.deepEqual(spans,[[480,780],[780,1260]],day);
  for(const [a,b] of spans)assert.equal(localInterval(day,a,b,zone).ok,true,`${day} ${a}-${b}`);
  // Who takes which template is the generator's greedy choice, and it only refuses overlapping
  // shifts for one person (adjacent ones are allowed), so no person-count is asserted. What the
  // current rule does guarantee is that no person is given two overlapping shifts.
  for(const id of new Set(record.shifts.map(s=>s.personId))){
   const mine=record.shifts.filter(s=>s.personId===id).sort((x,y)=>x.startMinute-y.startMinute);
   mine.slice(1).forEach((s,i)=>assert.ok(s.startMinute>=mine[i].endMinute,`${day} ${id} has no overlapping shifts`));
  }
 }
});

test('a refused date in one store leaves another store and the neighbouring dates generating normally',()=>{
 const refused=makeStore({id:'fictional-refused',open:8,close:18}),normal=makeStore({id:'fictional-normal',open:8,close:21});
 // Opening at 01:00 puts the store's own opening hour inside the November fold. The other store is ordinary.
 refused.rules[0].open=1;refused.rules[0].close=9;refused.people.forEach(p=>{p.start=1;p.end=9;});
 const planner=createPlanner([refused,normal]),month='2026-11',day='2026-11-01';
 const a=generate(planner,0,month,policyFor(refused)),b=generate(planner,1,month,policyFor(normal));
 assert.equal(a.status,'incomplete');assert.equal(b.status,'covered');
 const ra=a.records[day];
 assert.deepEqual([ra.on,ra.off,ra.shifts],[[],[],[]]);assert.equal(ra.absences,undefined);assert.equal(ra.generation,undefined);assert.equal(refusalNote(a,day),true);
 assert.equal(refusalNote(b,day),false);assert.equal(b.records[day].shifts[0].endMinute,21*60);
 // The refusal is for that date only, not for the store or the month.
 for(const other of ['2026-11-02','2026-11-03'])assert.equal(a.records[other].shifts.length,1,`refused store still generates ${other}`);
 // Apply leaves the refused date exactly as it was. A proposal is tied to the draft it came from,
 // so the other store is generated again after the first Apply rather than reusing the stale one.
 const before=structuredClone(planner.record(0,day));
 applyProposal(planner,a);assert.deepEqual(planner.record(0,day),before);
 // Current behavior, not a product decision: the draft guard is one planner-wide revision, so a
 // proposal for the other store goes stale after any Apply. Pinned so a change to it is deliberate.
 assert.throws(()=>applyProposal(planner,b),/draft changed/);
 const fresh=generate(planner,1,month,policyFor(normal));
 applyProposal(planner,fresh);assert.equal(planner.record(1,day).shifts.length,1);assert.equal(planner.record(1,day).shifts[0].endMinute,21*60);
});

test('retained manual work on a supported clock-change date survives generate and Apply, and a second run is stable',()=>{
 for(const day of ['2026-11-01','2026-03-08']){
  const month=day.slice(0,7),store=makeStore({id:'fictional-long',open:8,close:21}),planner=createPlanner([store]),policy=policyFor(store);
  const manual={storeId:store.id,personId:'a',date:day,endDate:day,startMinute:540,endMinute:1020,timezone:zone,role:'sales',source:{kind:'manual'}};
  planner.setAssignment(0,day,{on:['a'],off:[],shifts:[manual]});
  const before=structuredClone(planner.record(0,day)),first=generate(planner,0,month,policy),record=first.records[day];
  assert.deepEqual(planner.record(0,day),before,'generating changes nothing until Apply');
  assert.deepEqual(record.shifts.find(s=>s.personId==='a'),manual,'manual shift is carried over untouched');
  // The manual 09:00 to 17:00 shift leaves 08:00 to 09:00 and 17:00 to 21:00 for generation to cover.
  assert.equal(first.status,'covered',day);
  assert.ok(record.shifts.filter(s=>s.personId!=='a').every(s=>s.source.kind==='generated preview'&&s.startMinute===480&&s.endMinute===1260));
  applyProposal(planner,first);
  const applied=structuredClone(planner.record(0,day));
  assert.deepEqual(applied.shifts.find(s=>s.personId==='a'),manual);
  const second=generate(planner,0,month,policy);
  assert.deepEqual(second.records[day],applied,`${day}: generating again after Apply does not add, drop or reorder anything`);
 }
});
