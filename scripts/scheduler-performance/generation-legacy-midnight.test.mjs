import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanner} from './month-model.mjs';
import {generationInput,generateProposal,applyProposal,generationDateSafe} from './generation.mjs';

// Fictional store that closes at hour 24 (legacy midnight close). Legacy `on` records
// count to 24:00 as scheduled wall time; an explicit 24:00 shift is still never generated.
const ZONE='America/New_York',STORE='fictional-midnight';
function setup(day,{open=17,maxHours=40,people=['a'],shifts=[{id:'evening',startMinute:1020,endMinute:1320}]}={}){
 const month=day.slice(0,7),store={id:STORE,name:'Fictional',timezone:ZONE,history:[],people:people.map(id=>({id,name:id,off:[],start:0,end:24,maxHours})),teams:[],memberships:[],rules:[{effective:'2026-01-01',open,close:24,minimum:1,useCapacity:false,closedDays:[0,1,2,3,4,5,6],holidays:{[day]:'open'}}]};
 const planner=createPlanner([store]);
 const policy={confirmed:true,regenerate:true,mode:'individual',shifts,requiredRoles:{sales:1},people:Object.fromEntries(store.people.map(p=>[p.id,{eligible:true,roles:['sales']}])),useMarket:false};
 return {day,month,store,planner,policy};
}
const generate=x=>generateProposal(generationInput(x.planner,0,x.month,x.policy));

test('ordinary midnight close: the date is generated, with an explicit evening shift that stops before 24:00',()=>{
 const x=setup('2026-11-04'),p=generate(x),d=p.days.find(r=>r.day===x.day);
 assert.equal(generationDateSafe(x.day,x.planner.get(0,x.month).store,x.policy,x.planner.record(0,x.day)),true);
 assert.ok(!d.notes.some(n=>n.startsWith('DST-')));
 const shifts=p.records[x.day].shifts;assert.equal(shifts.length,1);
 assert.equal(shifts[0].startMinute,1020);assert.equal(shifts[0].endMinute,1320);
 assert.ok(shifts.every(s=>s.endMinute<1440));
 // The last hour is honestly reported as open: no explicit 24:00 shift is invented to close it.
 assert.deepEqual([...new Set(d.gaps.map(g=>g.start+'-'+g.end))],['1320-1440']);// headcount and role gap, same window
 assert.equal(p.status,'incomplete');
 assert.equal(applyProposal(x.planner,p),29);// 2026-11-01 is closed and a transition date, never written
 assert.deepEqual(x.planner.record(0,x.day).shifts,shifts);
});

test('a full-store template on a midnight-close store stays refused: no explicit 24:00 shift, no generated Off',()=>{
 const x=setup('2026-11-04',{shifts:[{id:'open-hours',fullDay:true}],people:['a','b']}),before=structuredClone(x.planner.record(0,x.day)),p=generate(x),r=p.records[x.day];
 assert.deepEqual(r.shifts,[]);assert.deepEqual(r.on,[]);assert.deepEqual(r.off,[]);assert.equal(r.absences,undefined);assert.equal(r.generation,undefined);
 assert.equal(p.days.find(d=>d.day===x.day).changed,false);assert.equal(p.status,'incomplete');
 applyProposal(x.planner,p);assert.deepEqual(x.planner.record(0,x.day),before);
});

for(const day of ['2026-11-01','2026-03-08'])test(`midnight close on transition date ${day} stays unsafe: no work, Off, absence or ownership`,()=>{
 const x=setup(day,{people:['a','b']}),before=structuredClone(x.planner.record(0,day));
 assert.equal(generationDateSafe(day,x.planner.get(0,x.month).store,x.policy,x.planner.record(0,day)),false);
 const p=generate(x),r=p.records[day];
 assert.deepEqual(r.on,[]);assert.deepEqual(r.off,[]);assert.deepEqual(r.shifts,[]);assert.equal(r.absences,undefined);assert.equal(r.generation,undefined);
 assert.ok(p.days.find(d=>d.day===day).notes.some(n=>n.startsWith('DST-')));assert.equal(p.status,'incomplete');
 applyProposal(x.planner,p);assert.deepEqual(x.planner.record(0,day),before);
});

test('a retained explicit shift ending at 24:00 still makes its date unsafe and is preserved untouched',()=>{
 const x=setup('2026-11-04',{people:['a','b']}),shift={storeId:STORE,personId:'a',date:x.day,endDate:x.day,startMinute:1020,endMinute:1440,timezone:ZONE,role:'sales',source:{kind:'manual'}};
 x.planner.setAssignment(0,x.day,{on:['a'],off:[],shifts:[shift]});const before=structuredClone(x.planner.record(0,x.day)),p=generate(x);
 assert.equal(generationDateSafe(x.day,x.planner.get(0,x.month).store,x.policy,x.planner.record(0,x.day)),false);
 assert.deepEqual(p.records[x.day],before);assert.deepEqual(p.records[x.day].off,[]);
});

test('retained legacy weekly seeding counts 7 hours to midnight against the cap, not zero and not unknown',()=>{
 // 2026-11-02 is a Monday. Person a already has a legacy full-store `on` (17:00 to 24:00 = 420 min).
 for(const [maxHours,expectOtherDay] of [[14,true],[8,false]]){
  const x=setup('2026-11-03',{maxHours});
  const store=x.planner.get(0,x.month).store;store.rules[0].holidays={'2026-11-02':'open','2026-11-03':'open'};
  x.planner.setAssignment(0,'2026-11-02',{on:['a'],off:[],breaksKnown:true});
  const p=generate(x),mon=p.records['2026-11-02'],tue=p.records['2026-11-03'];
  assert.deepEqual(mon.on,['a']);assert.deepEqual(mon.shifts,[]);// the legacy record is preserved as entered
  assert.equal(tue.shifts.length,expectOtherDay?1:0,`maxHours ${maxHours}`);
  if(!expectOtherDay)assert.deepEqual(tue.off,['a']);// a known cap, not unknown availability: ordinary generated Off
 }
});
