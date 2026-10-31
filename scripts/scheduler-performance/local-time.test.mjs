import test from 'node:test';
import assert from 'node:assert/strict';
import {localInterval,shiftProblem} from './shift-intervals.mjs';
import {weeklyHoursAudit} from './weekly-hours.mjs';
const zone='America/New_York';
test('November 1 and spring transition ordinary daytime are exact 480 elapsed minutes',()=>{
 for(const day of ['2026-11-01','2026-03-08','2026-11-02'])assert.deepEqual(localInterval(day,540,1020,zone),{ok:true,reason:null,elapsedMinutes:480});
});
test('fall fold endpoints are ambiguous, including a wall interval with two possible occurrences',()=>{
 for(const [a,b] of [[60,90],[90,180],[0,90]]){const r=localInterval('2026-11-01',a,b,zone);assert.equal(r.ok,false);assert.match(r.reason,/Ambiguous/);assert.equal(r.elapsedMinutes,null);}
});
test('spring gap endpoints do not exist',()=>{
 for(const [a,b] of [[120,150],[90,150],[150,240]]){const r=localInterval('2026-03-08',a,b,zone);assert.equal(r.ok,false);assert.match(r.reason,/Nonexistent/);assert.equal(r.elapsedMinutes,null);}
});
test('unique endpoints crossing a transition report exact elapsed duration but require review',()=>{
 const fall=localInterval('2026-11-01',0,180,zone),spring=localInterval('2026-03-08',60,240,zone);
 assert.equal(fall.elapsedMinutes,240);assert.equal(spring.elapsedMinutes,120);
 for(const r of [fall,spring]){assert.equal(r.ok,false);assert.match(r.reason,/crossing/);}
});
test('minute boundaries around gaps and folds, invalid zones and overnight remain fail closed',()=>{
 assert.equal(localInterval('2026-11-01',120,180,zone).elapsedMinutes,60);
 assert.equal(localInterval('2026-03-08',180,181,zone).elapsedMinutes,1);
 assert.equal(localInterval('2026-03-08',119,180,zone).ok,false);
 assert.equal(localInterval('2026-11-01',59,120,zone).ok,false);
 assert.equal(localInterval('2026-11-01',540,1020,'Europe/London').ok,false);
 assert.equal(localInterval('2026-11-31',540,1020,zone).ok,false);
 assert.equal(localInterval('2026-11-01',540,1440,zone).ok,false);
 const shift={storeId:'fictional',date:'2026-11-01',endDate:'2026-11-02',startMinute:1380,endMinute:60,timezone:zone};
 assert.match(shiftProblem(shift,{id:'fictional',timezone:zone},shift.date),/Overnight/);
});
test('weekly interval audit counts daytime exactly and refuses implicit crossing hours',()=>{
 const day='2026-11-01';
 const store={id:'fictional',timezone:zone,people:[{id:'a',maxHours:40}],rules:[{effective:'2026-01-01',open:9,close:17}]};
 const record={on:['a'],off:[],breaksKnown:true};
 const resolve=date=>({store,record:date===day?record:{on:[],off:['a']}});
 assert.equal(weeklyHoursAudit(day,'a',resolve).knownMinutes,480);
 store.rules[0].open=0;store.rules[0].close=3;
 const crossing=weeklyHoursAudit(day,'a',resolve);assert.equal(crossing.knownMinutes,0);assert.equal(crossing.complete,false);
});
