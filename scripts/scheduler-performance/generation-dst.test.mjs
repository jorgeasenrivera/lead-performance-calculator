import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanner} from './month-model.mjs';
import {generationInput,generateProposal,applyProposal} from './generation.mjs';

function setup(day){
 const month=day.slice(0,7),store={id:'fictional-dst',name:'Fictional',timezone:'America/New_York',history:[],people:['a','b','c'].map(id=>({id,name:id,off:[],start:9,end:17,maxHours:40})),teams:[],memberships:[],rules:[{effective:'2026-01-01',open:9,close:17,minimum:1,useCapacity:false,closedDays:[0,1,2,3,4,5,6],holidays:{[day]:'open'}}]};
 const planner=createPlanner([store]);
 const policy={confirmed:true,regenerate:true,mode:'individual',shifts:[{id:'day',fullDay:true}],requiredRoles:{sales:1},people:Object.fromEntries(store.people.map(p=>[p.id,{eligible:true,roles:['sales']}])),useMarket:false};
 return {day,month,planner,policy};
}
const generate=x=>generateProposal(generationInput(x.planner,0,x.month,x.policy));

for(const day of ['2026-03-08','2026-11-01'])test(`refused ${day} emits no generated work, Off, absence or ownership`,()=>{
 const x=setup(day);x.planner.get(0,x.month).store.rules[0].open=0;x.planner.get(0,x.month).store.rules[0].close=4;const before=structuredClone(x.planner.record(0,day)),proposal=generate(x),record=proposal.records[day];
 assert.equal(proposal.status,'incomplete');
 assert.deepEqual(record.on,[]);assert.deepEqual(record.off,[]);assert.deepEqual(record.shifts,[]);
 assert.equal(record.absences,undefined);assert.equal(record.generation,undefined);assert.equal(record.teamSnapshot,undefined);
 const detail=proposal.days.find(r=>r.day===day);assert.ok(detail.notes.some(n=>n.startsWith('DST-')));assert.equal(detail.changed,false);
 applyProposal(x.planner,proposal);assert.deepEqual(x.planner.record(0,day),before);
});

test('regeneration preserves manual work, Off, unknown and old generated choices on a refused date',()=>{
 const x=setup('2026-11-01');x.policy.shifts=[{id:'fold',startMinute:60,endMinute:180}];const r={on:['a'],off:['b'],shifts:[{storeId:'fictional-dst',personId:'a',date:x.day,endDate:x.day,startMinute:540,endMinute:1020,timezone:'America/New_York',role:'sales',source:{kind:'manual'}}],absences:{b:{kind:'off',source:{kind:'generated preview'}}},unknownNotes:{c:{source:{kind:'manual unknown'}}},generationLocks:['c']};
 r.generation={unlocked:['b'],signatures:{b:JSON.stringify({on:false,off:true,shifts:[],absence:r.absences.b})}};
 x.planner.setAssignment(0,x.day,r);const before=structuredClone(x.planner.record(0,x.day));
 for(const regenerate of [true,false]){
  x.policy.regenerate=regenerate;const p=generate(x);assert.equal(p.status,'incomplete');assert.deepEqual(p.records[x.day],before);
  applyProposal(x.planner,p);assert.deepEqual(x.planner.record(0,x.day),before);
 }
});

test('Apply cannot install refused-date Off from an older generator proposal and reports actual write count',()=>{
 const x=setup('2026-11-01'),p=generate(x),before=structuredClone(x.planner.record(0,x.day));
 delete p.temporalPolicy;
 p.records[x.day]={on:[],off:['a'],shifts:[],absences:{a:{kind:'off',source:{kind:'generated preview'}}}};
 const written=[],set=x.planner.setAssignment;x.planner.setAssignment=(...args)=>{written.push(args[1]);return set(...args);};
 assert.equal(applyProposal(x.planner,p),29);assert.equal(written.length,29);assert.ok(!written.includes(x.day));
 assert.deepEqual(x.planner.record(0,x.day),before);
});

test('supported dates still generate and apply ordinary nonselection Off',()=>{
 const x=setup('2026-11-02'),p=generate(x);assert.equal(p.status,'covered');
 assert.equal(p.records[x.day].on.length,1);assert.equal(p.records[x.day].off.length,2);
 assert.equal(applyProposal(x.planner,p),29);assert.deepEqual(x.planner.record(0,x.day).off,p.records[x.day].off);
});

test('a refused closed date does not clear an earlier assignment on regenerate or Apply',()=>{
 const x=setup('2026-11-01');x.planner.get(0,x.month).store.rules[0].holidays={};
 x.planner.setAssignment(0,x.day,{on:[],off:['a'],absences:{a:{kind:'vacation'}}});
 const before=structuredClone(x.planner.record(0,x.day)),p=generate(x);
 assert.deepEqual(p.records[x.day],{shifts:[],...before});applyProposal(x.planner,p);assert.deepEqual(x.planner.record(0,x.day),before);
});

for(const day of ['2026-11-01','2026-03-08'])test(`ordinary daytime generation and Apply accepted on ${day}`,()=>{
 const x=setup(day),p=generate(x);assert.equal(p.status,'covered');assert.equal(p.records[day].shifts.length,1);
 assert.equal(p.records[day].shifts[0].startMinute,540);assert.equal(p.records[day].shifts[0].endMinute,1020);
 applyProposal(x.planner,p);assert.deepEqual(x.planner.record(0,day).shifts,p.records[day].shifts);
});

for(const [day,startMinute,endMinute] of [['2026-11-01',60,180],['2026-03-08',120,240]])test(`unsafe template on ${day} emits no work or Off despite daytime hours`,()=>{
 const x=setup(day);x.policy.shifts=[{id:'unsafe',startMinute,endMinute}];const p=generate(x);
 assert.deepEqual(p.records[day].on,[]);assert.deepEqual(p.records[day].off,[]);assert.equal(p.records[day].generation,undefined);
 const before=structuredClone(x.planner.record(0,day));applyProposal(x.planner,p);assert.deepEqual(x.planner.record(0,day),before);
});
