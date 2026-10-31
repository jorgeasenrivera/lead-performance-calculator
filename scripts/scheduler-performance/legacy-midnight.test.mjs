import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyHoursAudit} from './weekly-hours.mjs';
import {createPlanner} from './month-model.mjs';
import {localInterval,shiftProblem} from './shift-intervals.mjs';
const store=()=>({id:'fictional',timezone:'America/New_York',people:[{id:'a',name:'Fictional A',start:0,end:24,off:[],maxHours:168}],rules:[{effective:'2014-01-01',open:17,close:24,minimum:1,closedDays:[],holidays:{}}],history:[]});
function inspect(day,record,s=store()) {
 const before=structuredClone(record),p=createPlanner([s]);p.setAssignment(0,day,record);
 const audit=weeklyHoursAudit(day,'a',d=>({store:s,record:d===day?record:{on:[],off:['a'],breaksKnown:true}}));
 const row=p.rows(0,day.slice(0,7)).find(r=>r.day===day);
 assert.deepEqual(record,before);return {audit,row};
}
test('legacy midnight closing retains seven known hours in both consumers; missing breaks remain unknown',()=>{
 for(const breaksKnown of [true,false]){const {audit,row}=inspect('2026-11-04',{on:['a'],off:[],breaksKnown});assert.equal(audit.knownMinutes,420);assert.equal(audit.complete,breaksKnown);assert.equal(row.weeklyHours.a,7);assert.ok(!row.conflicts.a?.some(x=>x.includes('weekly hours unknown')));}
});
test('explicit midnight endpoint stays refused even with legacy on marker',()=>{
 const date='2026-11-04',shift={storeId:'fictional',personId:'a',date,endDate:date,timezone:'America/New_York',startMinute:1020,endMinute:1440};
 const {audit,row}=inspect(date,{on:['a'],off:[],shifts:[shift],breaksKnown:true});assert.equal(audit.knownMinutes,0);assert.equal(audit.complete,false);assert.equal(row.weeklyHours.a,null);assert.ok(shiftProblem(shift,store(),date));assert.equal(localInterval(date,1020,1440,'America/New_York').ok,false);
});
test('legacy midnight on transition dates remains manual-review unknown, with no invented totals',()=>{
 for(const date of ['2026-11-01','2026-03-08']){const s=store();s.rules[0].open=0;const {audit,row}=inspect(date,{on:['a'],off:[],breaksKnown:true},s);assert.equal(audit.knownMinutes,0);assert.equal(audit.complete,false);assert.equal(row.weeklyHours.a,null);}
});
test('unknown legacy store hours stay unknown',()=>{
 const s=store();s.rules[0].open=null;const {audit,row}=inspect('2026-11-04',{on:['a'],off:[]},s);assert.equal(audit.knownMinutes,0);assert.equal(row.weeklyHours.a,null);
});
