import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanner,monthDays} from './month-model.mjs';
import {teamsFor} from './assignment-view.mjs';
import {membershipAt,teamsOnDay,membershipMismatches,teamSnapshot,dayAbsence,absenceKind} from './team-model.mjs';
import {parseSchedule,reviewImport,applyImport,importSnapshot} from './schedule-import.mjs';
import {teamBalance} from './team-balance.mjs';
const store=(id='s1')=>({id,name:'Fictional',people:[{id:'p0',name:'Alex',start:9,end:17,off:[],maxHours:168},{id:'p1',name:'Blair',start:9,end:17,off:[],maxHours:168},{id:'p2',name:'Casey',start:9,end:17,off:[],maxHours:168}],teams:[{id:'oak',name:'Oak team'},{id:'pine',name:'Pine team'}],memberships:[{storeId:id,personId:'p0',teamIds:['oak'],from:'2014-01-01',to:'2100-12-31',source:{kind:'explicit fixture'}},{storeId:id,personId:'p1',teamIds:['pine'],from:'2014-01-01',to:'2100-12-31',source:{kind:'explicit fixture'}},{storeId:id,personId:'p2',teamIds:[],from:'2014-01-01',to:'2100-12-31',source:{kind:'explicit fixture'}}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[],holidays:{}}],history:[]});
const setup=()=>createPlanner([store(),store('s2')]);
const csv=text=>parseSchedule('Name,Date,Start,End,Status,Team\n'+text,'fictional-teams.csv');
const current=(p,index=0,day='2026-11-04')=>p.context(index,day).store;
const change=(p,ids,from='2026-11-04',to=from,index=0)=>p.setMembership(index,{storeId:current(p,index).id,personId:'p0',teamIds:ids,from,to,source:{kind:'manager dated edit'}});
test('dated membership spans months, remains store scoped and changes no assignments',()=>{
 const p=setup();p.setAssignment(0,'2026-11-04',{on:['p0'],off:[]});const prior=structuredClone(p.record(0,'2026-11-04'));
 change(p,['pine'],'2026-11-04','2026-12-02');
 assert.deepEqual(membershipAt(current(p),'p0','2026-11-03').teamIds,['oak']);assert.deepEqual(membershipAt(current(p),'p0','2026-12-02').teamIds,['pine']);assert.deepEqual(membershipAt(current(p),'p0','2026-12-03').teamIds,['oak']);assert.deepEqual(membershipAt(current(p,1),'p0','2026-11-04').teamIds,['oak']);assert.deepEqual(p.record(0,'2026-11-04'),prior);assert.equal(membershipMismatches(current(p),prior,'2026-11-04').length,1);
});
test('display modes cannot assign teams, and membership ignores roster order',()=>{
 const p=setup(),s=current(p),before=importSnapshot(p,0);
 assert.deepEqual(teamsOnDay(s,null,'2026-11-04','mixed'),teamsOnDay(s,null,'2026-11-04','team'));assert.deepEqual(teamsOnDay(s,null,'2026-11-04','individual'),[]);
 assert.deepEqual(teamsOnDay({...s,people:[...s.people].reverse()},null,'2026-11-04').map(t=>t.ids),teamsOnDay(s,null,'2026-11-04').map(t=>t.ids));assert.equal(importSnapshot(p,0),before);
 const people=[{id:'x',teamIds:['oak']},{id:'y',teamIds:['pine']}];assert.deepEqual(teamsFor(people,'team'),teamsFor(people,'mixed'));assert.deepEqual(teamsFor([{id:'p0'}],'mixed'),[]);
});
test('CSV membership mismatch requires an explicit choice without changing review state',()=>{
 const p=setup(),rows=csv('Alex,2026-11-04,09:15,16:45,work,Pine team'),before=importSnapshot(p,0);
 const blocked=reviewImport(p,0,rows);assert.equal(blocked.blocked,true);assert.throws(()=>applyImport(p,blocked));assert.equal(importSnapshot(p,0),before);
 const kept=reviewImport(p,0,rows,{0:{teamDecision:'keep'}});applyImport(p,kept);const record=p.record(0,'2026-11-04');assert.deepEqual(record.teamSnapshot.p0.teamIds,['oak']);assert.equal(record.teamSnapshot.p0.source.declaredTeam,'Pine team');assert.deepEqual(membershipAt(current(p),'p0','2026-11-04').teamIds,['oak']);
});
test('confirmed CSV team changes are dated, retain source and duplicate imports are no-ops',()=>{
 const p=setup(),rows=csv('Alex,2026-11-04,09:15,16:45,work,Pine team');applyImport(p,reviewImport(p,0,rows,{0:{teamDecision:'confirm'}}));
 assert.deepEqual(membershipAt(current(p),'p0','2026-11-04').teamIds,['pine']);assert.deepEqual(membershipAt(current(p),'p0','2026-11-05').teamIds,['oak']);assert.equal(p.record(0,'2026-11-04').shifts[0].teamSource.line,2);
 const before=importSnapshot(p,0);assert.equal(applyImport(p,reviewImport(p,0,rows)).changed,0);assert.equal(importSnapshot(p,0),before);
});
test('unknown team names and conflicting rows cannot silently create or move teams',()=>{
 const p=setup(),rows=csv('Alex,2026-11-04,09:00,12:00,work,Unknown team');assert.equal(reviewImport(p,0,rows,{0:{teamDecision:'confirm'}}).blocked,true);assert.equal(current(p).teams.length,2);
 const id=p.addTeam(0,'Unknown team');applyImport(p,reviewImport(p,0,rows,{0:{teamDecision:'confirm'}}));assert.deepEqual(p.record(0,'2026-11-04').teamSnapshot.p0.teamIds,[id]);
 const conflict=reviewImport(p,0,csv('Alex,2026-11-04,13:00,17:00,work,Oak team'),{0:{teamDecision:'confirm'}});assert.equal(conflict.blocked,true);assert.ok(conflict.items[0].messages.some(m=>m.includes('snapshot')));
});
test('a dated team edit invalidates a pending import review',()=>{const p=setup(),review=reviewImport(p,0,csv('Alex,2026-11-04,09:15,16:45,work,Oak team'));change(p,['pine']);assert.throws(()=>applyImport(p,review),/draft changed/);});
test('vacation, unavailable, scheduled off and unknown retain separate provenance through edits',()=>{
 for(const kind of ['vacation','unavailable','off','unknown']){
  const p=setup();applyImport(p,reviewImport(p,0,csv(`Alex,2026-11-04,,,${kind},Oak team`)));
  const first=p.record(0,'2026-11-04');assert.equal(dayAbsence(current(p),first,'2026-11-04','p0'),kind);
  p.setAssignment(0,'2026-11-04',{on:['p1'],off:first.off});const edited=p.record(0,'2026-11-04');assert.deepEqual(edited.teamSnapshot.p0,first.teamSnapshot.p0);
  if(kind==='unknown')assert.deepEqual(edited.unknownNotes.p0,first.unknownNotes.p0);else assert.deepEqual(edited.absences.p0,first.absences.p0);
  if(kind!=='unknown')assert.equal(reviewImport(p,0,csv('Alex,2026-11-04,09:00,17:00,work,Oak team')).blocked,true);
 }
});
test('balance uses exact union minutes, unique people, overlapping teams and availability bands',()=>{
 const p=setup();change(p,['oak','pine']);applyImport(p,reviewImport(p,0,csv('Alex,2026-11-04,09:15,16:45,work,Oak team|Pine team')));
 const b=teamBalance(p,0,'2026-11'),oak=b.teams.find(t=>t.id==='oak'),pine=b.teams.find(t=>t.id==='pine');assert.equal(b.totals.entered,450);assert.equal(oak.scheduled,450);assert.equal(pine.scheduled,450);assert.equal(oak.opening,45);assert.equal(oak.closing,45);assert.equal(oak.sharedMinutes,450);assert.equal(oak.uniquePeople,1);assert.equal(pine.uniquePeople,2);assert.equal(b.people.find(p=>p.id==='p0').scheduled,450);
});
test('scheduled off retains potential availability; vacation and unavailable reduce it',()=>{
 const p=setup();applyImport(p,reviewImport(p,0,csv('Alex,2026-11-04,,,off,Oak team\nBlair,2026-11-04,,,vacation,Pine team\nCasey,2026-11-04,,,unavailable,none')));
 const b=teamBalance(p,0,'2026-11');assert.equal(b.people[0].available,30*480);assert.equal(b.people[1].available,29*480);assert.equal(b.people[2].available,29*480);assert.equal(b.people[0].offDays,1);assert.equal(b.people[1].vacationDays,1);assert.equal(b.people[2].unavailableDays,1);
});
test('team differences account for team size and are review prompts, not ratings',()=>{
 const p=setup();p.setMembership(0,{storeId:'s1',personId:'p2',teamIds:['oak'],from:'2026-11-01',to:'2026-11-30',source:{kind:'manager'}});
 for(const day of monthDays('2026-11'))p.setAssignment(0,day,{on:['p0'],off:['p1']});
 const b=teamBalance(p,0,'2026-11'),oak=b.teams.find(t=>t.id==='oak');assert.equal(oak.uniquePeople,2);assert.equal(oak.scheduled/oak.available,.5);assert.equal(b.differences.find(d=>d.label==='Scheduled hours').percentagePoints,50);assert.equal(b.strengthAvailable,false);
});
test('membership mismatches are excluded from team comparisons until explicitly reviewed',()=>{
 const p=setup();p.setAssignment(0,'2026-11-04',{on:['p0'],off:[]});change(p,['pine']);let b=teamBalance(p,0,'2026-11');assert.equal(b.totals.entered,480);assert.equal(b.totals.mismatchDays,1);assert.equal(b.teams.reduce((s,t)=>s+t.scheduled,0),0);
 const record=p.record(0,'2026-11-04');p.setAssignment(0,'2026-11-04',{...record,teamSnapshot:{...record.teamSnapshot,...teamSnapshot(current(p),'2026-11-04',['p0'])}});b=teamBalance(p,0,'2026-11');assert.equal(b.totals.mismatchDays,0);assert.equal(b.teams.find(t=>t.id==='pine').scheduled,480);
});
test('unknown membership and unknown availability do not become known zero/off',()=>{
 const s=store();s.memberships=s.memberships.filter(m=>m.personId!=='p0');s.people[0].start=null;const p=createPlanner([s]),b=teamBalance(p,0,'2026-11');assert.equal(membershipAt(current(p),'p0','2026-11-04').unknown,true);assert.equal(b.people[0].unknownAvailabilityDays,30);assert.equal(b.people[0].available,0);assert.equal(b.people[0].offDays,0);
});
test('no history means unavailable opportunity; daily history never becomes individual ability',()=>{
 const s=store();const start=new Date('2026-08-01T12:00:00Z');for(let n=0;n<92;n++){const d=new Date(start.getTime()+n*86400000);s.history.push({day:d.toISOString().slice(0,10),state:'known',units:d.getUTCDay()===3?10:0});}
 const p=createPlanner([s]),b=teamBalance(p,0,'2026-11');assert.equal(b.comparableDays,30);assert.equal(b.highDays,4);assert.equal(b.strengthAvailable,false);
 s.history.push({day:'2027-01-01',state:'known',units:99999});assert.equal(teamBalance(createPlanner([s]),0,'2026-11').highDays,4);assert.equal(teamBalance(setup(),0,'2026-11').comparableDays,0);
});
test('duplicate roster identities never inflate balance totals',()=>{const s=store();s.people.push({...s.people[0]});const p=createPlanner([s]);p.setAssignment(0,'2026-11-04',{on:['p0','p0'],off:[]});assert.equal(teamBalance(p,0,'2026-11').totals.entered,480);});
