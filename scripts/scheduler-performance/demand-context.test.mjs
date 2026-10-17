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

test('calendar shading reuses daily evidence without target-day or future leakage',async()=>{
 const {historicalCalendar}=await import('./demand-context.mjs');const h=[row('2026-09-02',0),row('2026-09-09',4),row('2026-09-16',8),row('2026-09-23',6),row('2026-10-14',999),row('2026-10-15',999)];const before=structuredClone(h),calendar=historicalCalendar(h,'2026-10'),d=calendar.days.find(d=>d.day==='2026-10-14');assert.deepEqual(d.estimate,dayDemand(h,d.day).estimate);assert.equal(d.count,4);assert.equal(d.average,4.5);assert.deepEqual(h,before);assert.equal(calendar.days.find(d=>d.day==='2026-10-01').level,null);
});
test('calendar keeps zero supported and missing or closed-only history neutral',async()=>{
 const {historicalCalendar}=await import('./demand-context.mjs');for(const state of ['unknown','closed'])assert.ok(historicalCalendar(Array.from({length:4},(_,i)=>({day:`2026-09-${String(2+i*7).padStart(2,'0')}`,state})),'2026-10').days.every(d=>d.level===null));const zero=historicalCalendar([2,9,16,23].map(n=>row(`2026-09-${String(n).padStart(2,'0')}`,0)),'2026-10');const d=zero.days.find(d=>d.day==='2026-10-14');assert.equal(d.level,0);assert.equal(d.average,0);assert.equal(d.estimate.low,0);assert.equal(d.estimate.high,0);
});
test('calendar bins are zero-anchored and do not stretch small range differences',async()=>{
 const {historicalCalendar}=await import('./demand-context.mjs');const history=[];for(const month of ['2026-07','2026-08','2026-09'])for(const day of monthDays(month))history.push(row(day,Number(day.slice(-2))%2?10:11));const c=historicalCalendar(history,'2026-10');assert.equal(c.ceiling,11);assert.ok(c.days.every(d=>d.level===3));assert.deepEqual(c.month,monthDemand(history,'2026-10'));
});

test('month shading and its shared scale are invariant to records at or after the month cutoff',async()=>{
 const {historicalCalendar}=await import('./demand-context.mjs');
 const prior=[row('2026-09-02',0),row('2026-09-09',4),row('2026-09-16',8),row('2026-09-23',6)];
 const baseline=historicalCalendar(prior,'2026-10');
 const later=[row('2026-10-01',999),row('2026-10-14',999),row('2026-10-15',999),row('2026-11-01',999)];
 const augmented=historicalCalendar([...prior,...later],'2026-10');
 assert.equal(augmented.ceiling,baseline.ceiling);
 assert.deepEqual(augmented.days,baseline.days);
 assert.equal(augmented.days.find(d=>d.day==='2026-10-14').level,2);
 assert.equal(augmented.cutoff,'2026-10-01');
 assert.ok(augmented.days.every(d=>!d.last||d.last<augmented.cutoff));
});
