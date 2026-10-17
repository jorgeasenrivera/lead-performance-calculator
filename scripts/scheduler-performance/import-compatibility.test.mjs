import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {legacyOffDays,teamGrid} from './import-compatibility.mjs';
import {reviewImport,applyImport,importSnapshot} from './schedule-import.mjs';
import {createPlanner} from './month-model.mjs';
import {teamBalance} from './team-balance.mjs';
import {dayEditRecord} from './day-edit-state.mjs';
const scope={storeId:'synthetic',month:'2026-11'};
const setup=()=>createPlanner([{id:'synthetic',name:'Synthetic',timezone:'America/New_York',people:['Alex One','Blair Two','Casey Three'].map((name,i)=>({id:['a','b','c'][i],name,start:0,end:24,off:[],maxHours:50,teamIds:['a-team']})),teams:[{id:'a-team',name:'Team A'},{id:'b-team',name:'Team B'}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[],holidays:{}}],history:[]}]);
const legacy=(data)=>legacyOffDays(JSON.stringify(data),'saved.json',scope);
const fixture=readFileSync(new URL('./fixtures/team-grid.csv',import.meta.url),'utf8');
const grid=()=>teamGrid(fixture,'grid.csv',scope);
test('saved snapshot preserves off with unknown reason, provenance and historical membership',()=>{
 const p=setup(),rows=legacy({off:{a:['2026-11-02']},file:'Original.csv',at:'2026-10-01',kind:'OFF/VAC'}),before=importSnapshot(p,0);
 const r=reviewImport(p,0,rows);assert.equal(r.blocked,false);assert.equal(importSnapshot(p,0),before);applyImport(p,r);
 const record=p.context(0,'2026-11-02').record;assert.deepEqual(record.on,[]);assert.deepEqual(record.off,['a']);assert.deepEqual(record.shifts,[]);assert.equal(record.absences.a.kind,'legacy-off');assert.equal(record.absences.a.source.originalFile,'Original.csv');assert.equal(record.absences.a.source.importedAt,'2026-10-01');assert.equal(record.teamSnapshot.a.unknown,true);assert.deepEqual(record.teamSnapshot.a.teamIds,[]);
 assert.equal(p.context(0,'2026-11-03').record,null);
 const edited=dayEditRecord(record,{a:'Off'},{},[],['a']);assert.equal(edited.absences.a.kind,'legacy-off');
});
test('daysOff-only source does not manufacture missing original metadata',()=>{
 const r=reviewImport(setup(),0,legacy({daysOff:{a:['2026-11-02']}}));assert.equal(r.blocked,false);assert.equal(r.items[0].source.originalFile,null);assert.equal(r.items[0].source.importedAt,null);
});
test('unresolved IDs and dateless unmatched names block entire batch until explicit skip',()=>{
 const p=setup(),rows=legacyOffDays(readFileSync(new URL('./fixtures/legacy-off-days.json',import.meta.url),'utf8'),'saved.json',scope),before=importSnapshot(p,0);
 const blocked=reviewImport(p,0,rows);assert.equal(blocked.blocked,true);assert.throws(()=>applyImport(p,blocked));assert.equal(importSnapshot(p,0),before);
 const r=reviewImport(p,0,rows,{1:{skip:true},2:{skip:true}});assert.equal(r.blocked,false);applyImport(p,r);assert.deepEqual(p.context(0,'2026-11-02').record.off,['a']);
});
test('store/month mismatches and malformed data are rejected without filtering',()=>{
 for(const data of [{storeId:'other',off:{a:['2026-11-02']}},{month:'2026-12',off:{a:['2026-11-02']}},{off:{a:'2026-11-02'}},{off:{},unmatched:{a:1}},{off:{}}])assert.throws(()=>legacy(data));
 for(const date of ['2026-12-01','2026-11-31','11/02'])assert.equal(reviewImport(setup(),0,legacy({off:{a:[date]}})).blocked,true);
 const rows=legacy({off:{a:['2026-11-02']}});rows[0].scope.storeId='other';assert.equal(reviewImport(setup(),0,rows).blocked,true);
});
test('representative grid expands only explicit legends and times, blanks remain unknown',()=>{
 const rows=grid();assert.equal(rows.length,9);assert.deepEqual(rows.slice(0,3).map(r=>r.raw.name),['Alex One','Blair Two','Casey Three']);assert.equal(rows[0].raw.start,'09:15');assert.equal(rows[0].raw.end,'16:45');assert.equal(rows[3].raw.status,'unknown');assert.equal(rows[5].raw.status,'vacation');assert.equal(rows[0].source.column,4);assert.equal(rows[1].source.legendLine,3);assert.ok(rows.every(r=>r.raw.name!=='Example note'));
 const p=setup(),before=importSnapshot(p,0);assert.equal(reviewImport(p,0,rows).blocked,true);assert.equal(importSnapshot(p,0),before);
 const choices=Object.fromEntries(rows.map(r=>[r.index,{teamDecision:'confirm'}]));const r=reviewImport(p,0,rows,choices);assert.equal(r.blocked,false,JSON.stringify(r.items));applyImport(p,r);
 const day=p.context(0,'2026-11-03').record;assert.deepEqual(day.on,[]);assert.equal(day.shifts.length,0);assert.ok(day.unknownNotes.a);assert.equal(day.absences.c.kind,'vacation');assert.deepEqual(day.teamSnapshot.c.teamIds,['b-team']);
});
test('grid keep decision preserves unknown historical teams instead of using current teams',()=>{
 const p=setup(),rows=grid(),choices=Object.fromEntries(rows.map(r=>[r.index,{teamDecision:'keep'}]));const r=reviewImport(p,0,rows,choices);assert.equal(r.blocked,false);applyImport(p,r);assert.equal(p.context(0,'2026-11-02').record.teamSnapshot.a.unknown,true);
});
test('ambiguous grid cells, dates and legends fail closed',()=>{
 for(const text of [fixture.replace('9:15am-4:45pm','9-5'),fixture.replace('11/02/2026','11/02'),fixture.replace('11/02/2026','12/02/2026'),fixture.replace('Alex One','Unknown Person')])assert.equal(reviewImport(setup(),0,teamGrid(text,'grid.csv',scope)).blocked,true);
 assert.throws(()=>teamGrid(fixture.replace(',,Blair Two',',Blair Two,Other Person'),'grid.csv',scope));
 assert.throws(()=>teamGrid(fixture.replace('Team B Casey Three','Team A Casey Three'),'grid.csv',scope));
});
test('later files are additive, duplicates retain original provenance, contradictions reject atomically',()=>{
 const p=setup();applyImport(p,reviewImport(p,0,legacy({off:{a:['2026-11-02']},file:'first.csv'})));
 let r=reviewImport(p,0,legacy({off:{a:['2026-11-02','2026-11-03']},file:'second.csv'}));assert.deepEqual(r.items.map(i=>i.state),['duplicate','ready']);applyImport(p,r);assert.equal(p.context(0,'2026-11-02').record.absences.a.source.originalFile,'first.csv');assert.equal(p.context(0,'2026-11-03').record.absences.a.source.originalFile,'second.csv');
 const rows=grid(),before=importSnapshot(p,0);r=reviewImport(p,0,rows,Object.fromEntries(rows.map(r=>[r.index,{teamDecision:'keep'}])));assert.equal(r.blocked,true);assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);
});
test('stale review and row expansion bounds are enforced',()=>{
 const p=setup(),r=reviewImport(p,0,legacy({off:{a:['2026-11-02']}}));p.setAssignment(0,'2026-11-03',{on:[],off:['b']});assert.throws(()=>applyImport(p,r),/draft changed/);
 assert.throws(()=>legacy({off:{a:Array(501).fill('2026-11-02')}}),/500/);assert.throws(()=>legacyOffDays(' '.repeat(100001),'saved.json',scope),/100 KB/);
});
test('grid matching is exact after canonical normalization, with ambiguous and contradictory identities blocked',()=>{
 const rows=grid();rows[0].raw.name='  ＡＬＥＸ   ＯＮＥ ';assert.equal(reviewImport(setup(),0,rows,{0:{teamDecision:'keep'}}).items[0].personId,'a');
 const p=setup();p.context(0,'2026-11-02').store.people.push({id:'duplicate',name:'Alex One'});assert.equal(reviewImport(p,0,grid()).items[0].personId,undefined);
 const contradictory=grid();contradictory.push({...structuredClone(contradictory[0]),index:9,raw:{...contradictory[0].raw,team:'Team B'}});const review=reviewImport(setup(),0,contradictory,Object.fromEntries(contradictory.map(r=>[r.index,{teamDecision:'confirm'}])));assert.equal(review.blocked,true);assert.match(review.items.at(-1).messages.join(' '),/contradictory/);
 assert.throws(()=>teamGrid(fixture.replace('11/02/2026,Monday',',Monday'),'grid.csv',scope),/missing its date/);
});

test('legacy off remains a known off-day in audit without vacation or scheduled minutes',()=>{
 const p=setup();applyImport(p,reviewImport(p,0,legacy({off:{a:['2026-11-02']}})));const a=teamBalance(p,0,'2026-11').people.find(p=>p.id==='a');assert.equal(a.offDays,1);assert.equal(a.vacationDays,0);assert.equal(a.scheduled,0);assert.ok(a.unknownMembershipDays>=1);assert.ok(a.unknownAvailabilityDays>=1);
 assert.throws(()=>legacy({off:{a:['2026-11-02']},daysOff:{a:['2026-11-03']}}),/cannot be combined/);
});
test('valid off-days apply with unknown store hours and incomplete weekly totals',()=>{
 const p=setup();const d=p.get(0,'2026-11');d.store.rules[0].open=null;d.store.rules[0].close=null;
 const r=reviewImport(p,0,legacy({daysOff:{a:['2026-11-02']}}));assert.equal(r.blocked,false);assert.equal(r.weeklyAudits.find(a=>a.personId==='a').complete,false);applyImport(p,r);assert.deepEqual(p.context(0,'2026-11-02').record.off,['a']);assert.deepEqual(p.context(0,'2026-11-02').record.shifts,[]);
});

test('reordered and resaved identical off-days are idempotent',()=>{
 const p=setup();applyImport(p,reviewImport(p,0,legacy({off:{a:['2026-11-02','2026-11-03']},file:'first.csv'})));const before=importSnapshot(p,0);const r=reviewImport(p,0,legacy({off:{a:['2026-11-03','2026-11-02']},file:'resaved.csv'}));assert.deepEqual(r.items.map(i=>i.state),['duplicate','duplicate']);assert.equal(applyImport(p,r).changed,0);assert.equal(importSnapshot(p,0),before);
});
test('manual clearing cannot be silently resurrected by re-upload',()=>{
 const p=setup(),rows=legacy({off:{a:['2026-11-02']}});applyImport(p,reviewImport(p,0,rows));const prior=p.context(0,'2026-11-02').record;p.setAssignment(0,'2026-11-02',dayEditRecord(prior,{a:'Unknown'},{},[],['a']));const before=importSnapshot(p,0),r=reviewImport(p,0,rows);assert.equal(r.blocked,true);assert.match(r.items[0].messages.join(' '),/will not be restored automatically/);assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);assert.equal(applyImport(p,reviewImport(p,0,rows,{0:{skip:true}})).changed,0);
});
test('blank grid cells are exact no-ops over existing off or work',()=>{
 for(const kind of ['off','work']){const p=setup();if(kind==='off')applyImport(p,reviewImport(p,0,legacy({off:{a:['2026-11-03']}})));else p.setAssignment(0,'2026-11-03',{on:['a'],off:[],shifts:[{personId:'a',storeId:'synthetic',date:'2026-11-03',endDate:'2026-11-03',timezone:'America/New_York',startMinute:540,endMinute:1020}]});
 const before=importSnapshot(p,0),rows=grid().filter(r=>r.raw.name==='Alex One'&&r.raw.date==='2026-11-03'),r=reviewImport(p,0,rows);assert.equal(r.blocked,false);assert.equal(r.items[0].state,'unchanged');assert.equal(applyImport(p,r).changed,0);assert.equal(importSnapshot(p,0),before);}
});
test('disjoint files commute and repeated apply is idempotent',()=>{
 const p=setup(),q=setup(),a=legacy({off:{a:['2026-11-02']}}),b=legacy({off:{b:['2026-11-03']}});for(const rows of [a,b])applyImport(p,reviewImport(p,0,rows));for(const rows of [b,a])applyImport(q,reviewImport(q,0,rows));for(const day of ['2026-11-02','2026-11-03'])assert.deepEqual(p.context(0,day).record,q.context(0,day).record);const r=reviewImport(p,0,legacy({off:{c:['2026-11-04']}}));applyImport(p,r);const before=importSnapshot(p,0);assert.equal(applyImport(p,r).changed,0);assert.equal(importSnapshot(p,0),before);
});
test('date-only year boundaries and leap dates survive host timezone changes',()=>{
 const prior=process.env.TZ;try{for(const zone of ['UTC','America/Los_Angeles','Pacific/Kiritimati']){process.env.TZ=zone;for(const date of ['2026-12-31','2027-01-01','2024-02-29']){const p=setup(),rows=legacyOffDays(JSON.stringify({off:{a:[date]}}),'dates.json',{...scope,month:date.slice(0,7)}),r=reviewImport(p,0,rows);assert.equal(r.blocked,false);applyImport(p,r);assert.deepEqual(p.context(0,date).record.off,['a']);assert.equal(rows[0].raw.date,date);}}}finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
test('a conflicting edit after preview is retained when stale apply rejects',()=>{
 const p=setup(),r=reviewImport(p,0,legacy({off:{a:['2026-11-02']}}));p.setAssignment(0,'2026-11-02',{on:['a'],off:[]});const current=importSnapshot(p,0);assert.throws(()=>applyImport(p,r),/draft changed/);assert.equal(importSnapshot(p,0),current);
});
test('mixed review accounting distinguishes duplicate, ready, blocked, skipped and blank unchanged entries',()=>{
 const p=setup();applyImport(p,reviewImport(p,0,legacy({off:{a:['2026-11-02']}})));
 const blank=grid().find(r=>r.raw.name==='Alex One'&&r.raw.date==='2026-11-03');blank.raw.date='2026-11-02';
 const rows=[...legacy({off:{a:['2026-11-02'],b:['2026-11-03'],'unresolved-id':['2026-11-04']}}),blank].map((r,index)=>({...r,index}));
 const r=reviewImport(p,0,rows);assert.deepEqual(r.items.map(i=>i.state),['duplicate','ready','blocked','unchanged']);assert.throws(()=>applyImport(p,r));
 const reviewed=reviewImport(p,0,rows,{2:{skip:true}});assert.deepEqual(reviewed.items.map(i=>i.state),['duplicate','ready','skipped','unchanged']);const result=applyImport(p,reviewed);assert.equal(result.changed,1);assert.equal(result.skipped,1);
});

test('notes that resemble a team legend never become people or membership',()=>{
 const rows=teamGrid(fixture.replace('Example note','Team A All staff'),'grid.csv',scope);assert.equal(rows.length,9);assert.deepEqual([...new Set(rows.map(r=>r.raw.name))],['Alex One','Blair Two','Casey Three']);assert.equal(rows[0].source.note,'Team A All staff');assert.ok(rows[0].warnings.some(w=>w.includes('Unapplied source note')));
});
