import test from 'node:test';import assert from 'node:assert/strict';
import {dayDemand,monthDemand} from './demand-context.mjs';import {monthDays} from './month-model.mjs';
const row=(day,units)=>({day,state:'known',units});
test('daily context uses only prior known same weekdays, retaining true zero',()=>{
 const h=[row('2026-09-02',0),row('2026-09-09',4),row('2026-09-16',8),row('2026-09-23',6),row('2026-10-14',999),row('2026-10-15',999),row('2026-09-24',100),{day:'2026-09-30',state:'unknown'}, {day:'2026-10-07',state:'closed'}];
 const d=dayDemand(h,'2026-10-14');assert.equal(d.count,4);assert.equal(d.estimate.low,0);assert.equal(d.estimate.high,8);assert.equal(d.first,'2026-09-02');assert.equal(d.last,'2026-09-23');assert.equal(d.daysSinceComparable,21);
});
test('insufficient or invalid daily samples do not imply zero demand',()=>{
 const d=dayDemand([row('2026-09-02',3),row('2026-09-09',-1),row('2026-09-16',NaN)],'2026-10-14');assert.equal(d.estimate,null);assert.equal(d.count,1);assert.equal(dayDemand([],'2026-10-14').last,null);
});
test('daily provenance is stable when input history is unsorted',()=>{
 const h=Array.from({length:8},(_,i)=>row(`2026-0${i+1}-01`,i));assert.deepEqual(dayDemand(h,'2026-10-14'),dayDemand(h.toReversed(),'2026-10-14'));
});
test('monthly comparison uses last three same calendar months, not future or partial totals as a range',()=>{
 const h=['2022-10','2023-10','2024-10','2025-10'].flatMap((m,i)=>monthDays(m).map(d=>row(d,i)));
 h.push(row('2026-10-01',999),row('2025-11-01',999));h.find(r=>r.day==='2024-10-02').state='unknown';
 const d=monthDemand(h,'2026-10');assert.deepEqual(d.comparable.map(r=>r.month),['2023-10','2024-10','2025-10']);assert.equal(d.comparable[1].unknown,1);assert.deepEqual(d.range,{low:31,high:93,months:2});
});
test('missing comparable months remain unavailable; complete known zero is valid',()=>{
 assert.equal(monthDemand([],'2026-10').range,null);
 const h=['2024-10','2025-10'].flatMap(m=>monthDays(m).map(d=>row(d,0)));assert.deepEqual(monthDemand(h,'2026-10').range,{low:0,high:0,months:2});h.pop();assert.equal(monthDemand(h,'2026-10').range,null);
});
