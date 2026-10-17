import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanner} from './month-model.mjs';
import {parseSchedule,reviewImport,applyImport,importSnapshot,csvRows} from './schedule-import.mjs';
import {validDate,coverageSegments,unionMinutes} from './shift-intervals.mjs';
const makeStore=(id='s1')=>({id,name:id,timezone:'America/New_York',people:[{id:'a',name:'Alex One',start:0,end:24,off:[],maxHours:40},{id:'b',name:'Blair Two',start:0,end:24,off:[],maxHours:40}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[],holidays:{}}],history:[]});
const setup=()=>createPlanner([makeStore(),makeStore('s2')]);
const csv=(lines)=>parseSchedule('Name,Date,Start,End,Status\n'+lines,'synthetic.csv');
const run=(p,lines,index=0)=>reviewImport(p,index,csv(lines));
test('minute shifts create exact gap boundaries and durations without rounding',()=>{
 const p=setup(),r=run(p,'Alex One,2026-11-02,09:15,16:45,work');assert.equal(r.blocked,false);applyImport(p,r);
 const row=p.rows(0,'2026-11')[1];assert.equal(row.weeklyHours.a,7.5);assert.equal(row.minimumCoverage,0);
 assert.deepEqual(row.coverage,[{start:540,end:555,count:0},{start:555,end:1005,count:1},{start:1005,end:1020,count:0}]);
 assert.equal(row.record.shifts[0].source.line,2);assert.equal(row.record.shifts[0].storeId,'s1');
});
test('split people provide continuous coverage without requiring either to work all day',()=>{
 const p=setup(),r=run(p,'Alex One,2026-11-02,09:00,12:17,work\nBlair Two,2026-11-02,12:17,17:00,work');applyImport(p,r);const row=p.rows(0,'2026-11')[1];assert.equal(row.minimumCoverage,1);assert.equal(row.weeklyHours.a,197/60);assert.equal(row.weeklyHours.b,283/60);
});
test('overlapping teams/person entries cannot double-count coverage',()=>{
 const record={on:['a','a'],shifts:[{personId:'a',startMinute:540,endMinute:720},{personId:'a',startMinute:600,endMinute:1020}]};
 assert.equal(unionMinutes([[540,720],[600,1020]]),480);assert.ok(coverageSegments({open:9,close:17},record,['a','a']).every(s=>s.count===1));
});
test('legacy assignments retain full store hours',()=>{const p=setup();p.setAssignment(0,'2026-11-02',{on:['a'],off:[]});const row=p.rows(0,'2026-11')[1];assert.equal(row.weeklyHours.a,8);assert.equal(row.minimumCoverage,1);});
test('existing manual assignments and confirmed off cannot be overwritten',()=>{
 const p=setup();p.setAssignment(0,'2026-11-02',{on:['a'],off:['b']});const before=importSnapshot(p,0);
 for(const line of ['Alex One,2026-11-02,09:15,16:45,work','Blair Two,2026-11-02,09:15,16:45,work','Alex One,2026-11-02,,,off']){const r=run(p,line);assert.equal(r.blocked,true);assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);}
});
test('review and cancel are pure, and failed batch applies nothing',()=>{const p=setup(),before=importSnapshot(p,0);const r=run(p,'Alex One,2026-11-02,09:15,16:45,work\nMissing,2026-11-03,09:00,17:00,work');assert.equal(importSnapshot(p,0),before);assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);});
test('strict dates reject normalization, missing years, impossible days and ambiguous formats',()=>{
 for(const date of ['2026-02-30','2026-01-99','2025-02-29','11/02','11/02/2026','2026-1-02','2026-11-00']){assert.equal(validDate(date),false);assert.equal(run(setup(),`Alex One,${date},09:00,17:00,work`).blocked,true);}
 assert.equal(validDate('2024-02-29'),true);
});
test('DST change dates, overnight, mismatched zones and invalid times fail closed',()=>{
 for(const line of ['Alex One,2026-03-08,09:00,17:00,work','Alex One,2026-11-01,09:00,17:00,work','Alex One,2026-11-02,22:00,06:00,work','Alex One,2026-11-02,09:00,24:00,work','Alex One,2026-11-02,,17:00,work','Alex One,2026-11-02,09:61,17:00,work'])assert.equal(run(setup(),line).blocked,true);
 for(const extra of ['2026-11-03,America/New_York','2026-11-02,UTC']){const r=reviewImport(setup(),0,parseSchedule('Name,Date,Start,End,End Date,Timezone\nAlex One,2026-11-02,09:00,17:00,'+extra));assert.equal(r.blocked,true);}
});
test('unknown formats, break columns and malformed CSV are explicit errors',()=>{
 for(const source of ['Name,Date,Start,End,Break\nAlex,2026-11-02,09:00,17:00,30','Name,Date,Start,Start\na,b,c,d','Name,Date,Start,End\n"unfinished'])assert.throws(()=>parseSchedule(source));
 assert.equal(reviewImport(setup(),0,parseSchedule('Name,Date,Start,End\nAlex One,2026-11-02,09:00')).blocked,true);
 assert.throws(()=>parseSchedule('x'.repeat(100001)));assert.throws(()=>csv('Alex One,2026-11-02,09:00,17:00,work\n'.repeat(501)));
});
test('quoted CSV retains physical provenance and does not execute cell text',()=>{const rows=csvRows('Name,Date\r\n"A, B\nC",2026-11-02\r\n"D""E",2026-11-03');assert.equal(rows[1].cells[0],'A, B\nC');assert.equal(rows[2].line,4);assert.equal(rows[2].cells[0],'D"E');});
test('ambiguous exact names and first names require explicit identity review',()=>{
 const stores=[makeStore()];stores[0].people.push({...stores[0].people[0],id:'c'});const p=createPlanner(stores),rows=csv('Alex One,2026-11-02,09:00,17:00,work');assert.equal(reviewImport(p,0,rows).blocked,true);
 const reviewed=reviewImport(p,0,rows,{0:{personId:'c'}});assert.equal(reviewed.blocked,false);applyImport(p,reviewed);assert.deepEqual(p.record(0,'2026-11-02').on,['c']);assert.equal(run(setup(),'Alex,2026-11-02,09:00,17:00,work').blocked,true);
});
test('explicit skip resolves unsupported rows without silently dropping them',()=>{const p=setup(),rows=csv('Alex One,2026-11-02,09:00,17:00,work\nUnknown,11/03,10,6,work'),r=reviewImport(p,0,rows,{1:{skip:true}});assert.equal(r.items[1].state,'skipped');assert.equal(r.blocked,false);assert.equal(applyImport(p,r).changed,1);});
test('same CSV twice and double Apply are no-ops',()=>{const p=setup(),line='Alex One,2026-11-02,09:15,16:45,work',r=run(p,line);assert.equal(applyImport(p,r).changed,1);const before=importSnapshot(p,0);assert.equal(applyImport(p,r).changed,0);const again=run(p,line);assert.equal(again.items[0].state,'duplicate');assert.equal(applyImport(p,again).changed,0);assert.equal(importSnapshot(p,0),before);});
test('stale assignment, settings and reset invalidate review',()=>{
 for(const mutate of [p=>p.setAssignment(0,'2026-11-03',{on:['b'],off:[]}),p=>p.get(0,'2026-11').store.people[0].maxHours=2,p=>p.reset(0,'2026-11')]){const p=setup();p.get(0,'2026-11');p.setAssignment(0,'2026-11-04',{on:['b'],off:[]});const r=run(p,'Alex One,2026-11-02,09:15,16:45,work');mutate(p);assert.throws(()=>applyImport(p,r),/draft changed/);assert.equal(p.record(0,'2026-11-02'),null);}
});
test('composite identity isolates equal person IDs across stores',()=>{const p=setup();applyImport(p,run(p,'Alex One,2026-11-02,09:15,16:45,work',1));assert.equal(p.record(0,'2026-11-02'),null);assert.equal(p.record(1,'2026-11-02').shifts[0].storeId,'s2');});
test('overlap and work/off conflicts within one file block both input orders',()=>{
 for(const lines of ['Alex One,2026-11-02,09:00,12:00,work\nAlex One,2026-11-02,11:59,17:00,work','Alex One,2026-11-02,,,off\nAlex One,2026-11-02,09:00,17:00,work','Alex One,2026-11-02,09:00,17:00,work\nAlex One,2026-11-02,,,off'])assert.equal(run(setup(),lines).blocked,true);
 const p=setup();applyImport(p,run(p,'Alex One,2026-11-02,09:00,12:00,work'));assert.equal(run(p,'Alex One,2026-11-02,11:59,17:00,work').blocked,true);assert.equal(run(p,'Alex One,2026-11-02,12:00,17:00,work').blocked,false);
});
test('weekly caps include adjacent months, exact partial minutes and legacy assignments',()=>{
 const p=setup();p.get(0,'2026-10').store.people[0].maxHours=40;p.get(0,'2026-11').store.people[0].maxHours=40;
 for(const d of ['26','27','28','29','30'])p.setAssignment(0,'2026-10-'+d,{on:['a'],off:[]});
 // Nov 1 is rejected as a DST day as well, so use a non-DST boundary week in February/March.
 const q=setup();for(const d of ['23','24','25','26','27'])q.setAssignment(0,'2026-02-'+d,{on:['a'],off:[]});
 const r=run(q,'Alex One,2026-03-01,09:00,09:01,work');assert.ok(r.items[0].messages.some(m=>m.includes('weekly hours exceeded')));assert.equal(r.blocked,true);
 q.setAssignment(0,'2026-02-27',{on:[],off:[]});const ok=run(q,'Alex One,2026-03-01,09:00,09:01,work');applyImport(q,ok);assert.equal(q.rows(0,'2026-03')[0].weeklyHours.a,32+1/60);
});
test('closed dates, unknown store hours and availability are not valid imported work',()=>{
 for(const mutate of [s=>s.rules[0].holidays['2026-11-02']='closed',s=>s.rules=[],s=>s.people[0].start=10,s=>s.people[0].off=[1]]){const store=makeStore();mutate(store);assert.equal(run(createPlanner([store]),'Alex One,2026-11-02,09:15,16:45,work').blocked,true);}
});
test('integer minute accounting does not accumulate fractional-hour cap errors',()=>{
 const s=makeStore();s.people[0].maxHours=1;const p=createPlanner([s]);
 const lines=Array.from({length:60},(_,m)=>`Alex One,2026-11-02,09:${String(m).padStart(2,'0')},${m===59?'10:00':'09:'+String(m+1).padStart(2,'0')},work`).join('\n');
 const r=run(p,lines);assert.equal(r.blocked,false);applyImport(p,r);assert.equal(p.rows(0,'2026-11')[1].weeklyHours.a,1);assert.equal(run(p,'Alex One,2026-11-02,10:00,10:01,work').blocked,true);
});
test('changing a draft and restoring its values still invalidates an old review',()=>{
 const p=setup();p.setAssignment(0,'2026-11-03',{on:[],off:[]});const r=run(p,'Alex One,2026-11-02,09:15,16:45,work');p.setAssignment(0,'2026-11-03',{on:['b'],off:[]});p.setAssignment(0,'2026-11-03',{on:[],off:[]});assert.throws(()=>applyImport(p,r),/draft changed/);
});
test('earlier-month imports include following-month assignments and year boundaries',()=>{
 const p=setup();p.get(0,'2025-12').store.people[0].maxHours=8;p.setAssignment(0,'2026-01-01',{on:['a'],off:[]});
 const r=run(p,'Alex One,2025-12-31,09:00,09:01,work');assert.equal(r.blocked,true);assert.ok(r.items[0].messages.some(m=>m.includes('weekly hours exceeded')));
});
test('a repeated source row within a batch is preserved as a visible no-op',()=>{const p=setup(),line='Alex One,2026-11-02,09:15,16:45,work',r=run(p,line+'\n'+line);assert.deepEqual(r.items.map(i=>i.state),['ready','duplicate']);applyImport(p,r);assert.equal(p.record(0,'2026-11-02').shifts.length,1);});
test('import validates existing assignments under both monthly caps, atomically, with skip recovery',()=>{
 for(const [existingDay,importDay,existingCap,importCap] of [
  ['2026-12-31','2027-01-01',8,40],
  ['2027-01-01','2026-12-31',8,40],
  ['2026-12-31','2027-01-01',40,8],
  ['2027-01-01','2026-12-31',40,8],
 ]){
  const p=setup();p.get(0,existingDay.slice(0,7)).store.people[0].maxHours=existingCap;
  p.get(0,importDay.slice(0,7)).store.people[0].maxHours=importCap;
  p.setAssignment(0,existingDay,{on:['a'],off:[]});const existingRecord=structuredClone(p.record(0,existingDay));
  const rows=csv(`Alex One,${importDay},09:00,09:01,work\nBlair Two,${importDay},09:00,09:01,work`),before=importSnapshot(p,0),r=reviewImport(p,0,rows);
  assert.equal(r.blocked,true);assert.ok(r.items[0].messages.some(m=>m.includes('weekly hours exceeded')));
  if(existingCap===8)assert.ok(r.items[0].messages.some(m=>m.includes(`Existing assignment on ${existingDay}`)));
  assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);
  const skipped=reviewImport(p,0,rows,{0:{skip:true}});assert.equal(skipped.blocked,false);assert.equal(applyImport(p,skipped).changed,1);
  assert.deepEqual(p.record(0,existingDay),existingRecord);assert.deepEqual(p.record(0,importDay).on,['b']);
 }
});
test('an unrelated pre-existing conflict does not block a different person import',()=>{
 const p=setup();p.get(0,'2026-12').store.people[0].maxHours=7;p.setAssignment(0,'2026-12-31',{on:['a'],off:[]});
 const r=run(p,'Blair Two,2027-01-01,09:00,09:01,work');assert.equal(r.blocked,false);applyImport(p,r);
});
test('Cedar December 31 cap eight blocks January 1 minute despite January cap forty',async()=>{
 const {fixtures}=await import('../scheduler-proposal/model.mjs');const p=createPlanner([fixtures()[0]]);
 p.get(0,'2026-12').store.people[0].maxHours=8;p.get(0,'2027-01').store.people[0].maxHours=40;
 p.setAssignment(0,'2026-12-31',{on:['p0'],off:[]});const before=importSnapshot(p,0);
 const r=run(p,'Alex 1,2027-01-01,09:00,09:01,work');assert.equal(r.blocked,true);
 assert.ok(r.items[0].messages.some(m=>m.includes('Existing assignment on 2026-12-31')));
 assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);
});
