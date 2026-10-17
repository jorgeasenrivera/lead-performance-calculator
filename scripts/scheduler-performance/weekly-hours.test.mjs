import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyHoursAudit, weeklyHoursText } from './weekly-hours.mjs';
import { createPlanner } from './month-model.mjs';
import { parseSchedule, reviewImport, applyImport } from './schedule-import.mjs';
import { teamBalance } from './team-balance.mjs';
import { addDays } from '../scheduler-proposal/model.mjs';
const start='2026-12-28';
const store=()=>({id:'s',timezone:'America/New_York',people:[{id:'a',name:'Alex',maxHours:168,start:0,end:24,off:[]}],rules:[{effective:'2014-01-01',open:0,close:23,closedDays:[],holidays:{},minimum:1}],history:[]});
function fixture(total,{missing,breaksKnown=true}={}) {
 const s=store(),records=new Map();
 for(let i=0;i<7;i++){
  const day=addDays(start,i),minutes=Math.min(total,600);total-=minutes;
  records.set(day,{on:minutes?['a']:[],off:minutes?[]:['a'],breaksKnown,shifts:minutes?[{personId:'a',storeId:'s',date:day,endDate:day,timezone:'America/New_York',startMinute:0,endMinute:minutes}]:[]});
 }
 if(missing)records.delete(missing);
 return {s,records,resolve:day=>({store:s,record:records.get(day)})};
}
for(const [minutes,warn] of [[2399,false],[2400,false],[3000,false],[3001,true]])test(`exact boundary ${minutes} minutes`,()=>{
 const f=fixture(minutes),a=weeklyHoursAudit('2027-01-01','a',f.resolve);
 assert.equal(a.knownMinutes,minutes);assert.equal(a.warning,warn);assert.equal(a.complete,true);
 assert.equal(a.excessMinutes,Math.max(0,minutes-3000));assert.equal(a.start,start);assert.equal(a.end,'2027-01-03');
 assert.match(weeklyHoursText(a),warn?/50:01.*0:01 above/:/no above-50 warning/);
});
test('deduplicates shared-team, repeated and overlapping intervals, preserves split shifts',()=>{
 const f=fixture(60),r=f.records.get(start),first=r.shifts[0];
 r.on=['a','a'];r.shifts=[first,{...first,teamIds:['one','two']},{...first,startMinute:30,endMinute:90},{...first,startMinute:120,endMinute:180}];
 assert.equal(weeklyHoursAudit(start,'a',f.resolve).knownMinutes,150);
});
test('missing adjacent dates stay incomplete both below and above threshold',()=>{
 for(const minutes of [2400,3001]){
  const f=fixture(minutes,{missing:'2027-01-03'}),a=weeklyHoursAudit('2027-01-01','a',f.resolve);
  assert.equal(a.complete,false);assert.equal(a.warning,minutes>3000);assert.match(weeklyHoursText(a),/^At least/);
  assert.doesNotMatch(weeklyHoursText(a),/no above-50/);
 }
});
test('unknown durations and breaks are explicit; closure does not erase known intervals',()=>{
 const f=fixture(3001,{breaksKnown:false});f.s.rules[0].holidays[start]='closed';
 let a=weeklyHoursAudit(start,'a',f.resolve);assert.equal(a.knownMinutes,3001);assert.equal(a.complete,false);assert.equal(a.warning,true);
 f.records.get(start).shifts[0].endMinute=null;a=weeklyHoursAudit(start,'a',f.resolve);
 assert.equal(a.knownMinutes,2401);assert.equal(a.complete,false);assert.ok(a.days[0].reasons.includes('Shift duration or identity unknown'));
});
test('confirmed 45-hour cap remains separate at 48 hours; fixture default is not policy',()=>{
 const f=fixture(2880);f.s.people[0].maxHours=45;f.s.people[0].maxHoursSource='manager-confirmed';
 let a=weeklyHoursAudit(start,'a',f.resolve);assert.equal(a.warning,false);assert.equal(a.confirmedCapConflicts.length,7);
 delete f.s.people[0].maxHoursSource;a=weeklyHoursAudit(start,'a',f.resolve);assert.equal(a.confirmedCapConflicts.length,0);assert.equal(a.caps[0].confirmed,false);
});
test('audit is pure; warning does not alter cap enforcement, eligibility, balance or atomic stale import',()=>{
 const p=createPlanner([store()]);
 const lines=Array.from({length:6},(_,i)=>`a,${addDays(start,i)},00:00,${i===5?'00:01':'10:00'}`).join('\n');
 const parsed=parseSchedule('Person ID,Date,Start,End\n'+lines,'fixture.csv');
 const review=reviewImport(p,0,parsed);assert.equal(review.blocked,false);assert.equal(review.weeklyAudits[0].warning,true);
 assert.equal(p.record(0,start),null);applyImport(p,review);
 const before=JSON.stringify([...p.drafts]),rows=p.rows(0,'2026-12'),balance=teamBalance(p,0,'2026-12');
 const a=weeklyHoursAudit(start,'a',d=>p.context(0,d));assert.equal(a.knownMinutes,3001);
 assert.equal(JSON.stringify([...p.drafts]),before);assert.deepEqual(p.rows(0,'2026-12'),rows);assert.deepEqual(teamBalance(p,0,'2026-12'),balance);
 assert.deepEqual(rows.find(r=>r.day===start).eligibleIds,['a']);
 const stale=reviewImport(p,0,parsed);p.setAssignment(0,'2027-01-03',{on:[],off:['a']});
 assert.throws(()=>applyImport(p,stale),/draft changed/);
 p.get(0,'2026-12').store.people[0].maxHours=45;
 assert.match(p.rows(0,'2026-12').find(r=>r.day===start).conflicts.a.join(' '),/weekly hours exceeded/);
});
