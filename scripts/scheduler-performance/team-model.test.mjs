import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanner,monthDays} from './month-model.mjs';
import {teamsFor} from './assignment-view.mjs';
import {membershipAt,teamsOnDay,membershipMismatches,teamSnapshot,dayAbsence,absenceKind} from './team-model.mjs';
import {parseSchedule,reviewImport,applyImport,importSnapshot} from './schedule-import.mjs';
import {teamBalance} from './team-balance.mjs';
import {balanceMarkup,peopleTeamsMarkup,teamDayMarkup} from './team-ui.mjs';
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
 for(const day of monthDays('2026-11'))p.setAssignment(0,day,{on:['p0'],off:['p1','p2']});
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
test('team creation shares CSV canonical identity and reserves import syntax',()=>{
 const p=setup();const before=importSnapshot(p,0);
 for(const name of [' OAK   TEAM ', 'Ｏａｋ　ｔｅａｍ', 'oAk\tteam','none','ＮＯＮＥ','one|two','one｜two','  '])assert.throws(()=>p.addTeam(0,name));
 assert.equal(importSnapshot(p,0),before);
 p.addTeam(0,'Café team');assert.throws(()=>p.addTeam(0,'Cafe\u0301  TEAM'));
 const review=reviewImport(p,0,csv('Alex,2026-11-04,09:00,12:00,work,ＯＡＫ　ＴＥＡＭ'));assert.equal(review.blocked,false);applyImport(p,review);assert.deepEqual(p.record(0,'2026-11-04').teamSnapshot.p0.teamIds,['oak']);
});
test('ambiguous and reserved existing team names reject even explicit keep or confirm',()=>{
 for(const team of [{id:'other',name:'Ｏａｋ　 team'},{id:'reserved',name:'none'}])for(const decision of ['keep','confirm']){
  const s=store();s.teams.push(team);const p=createPlanner([s]);const before=importSnapshot(p,0);
  const rows=csv(`Alex,2026-11-04,09:00,12:00,work,${team.id==='other'?'Oak team':'none'}\nBlair,2026-11-04,09:00,12:00,work,Pine team`);
  const r=reviewImport(p,0,rows,{0:{teamDecision:decision}});assert.equal(r.blocked,true);assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);
  applyImport(p,reviewImport(p,0,rows,{0:{skip:true}}));assert.deepEqual(p.record(0,'2026-11-04').on,['p1']);
 }
});
test('CSV team syntax rejects empty tokens and mixed none, with atomic skip recovery',()=>{
 for(const value of ['none|Oak team','none|none','|Oak team','Oak team|','Oak team||Pine team','Oak team｜none']){
  const p=setup(),before=importSnapshot(p,0),rows=csv(`Alex,2026-11-04,09:00,12:00,work,${value}`);
  const r=reviewImport(p,0,rows,{0:{teamDecision:'keep'}});assert.equal(r.blocked,true,value);assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);
  assert.equal(applyImport(p,reviewImport(p,0,rows,{0:{skip:true}})).changed,0);
 }
});
test('contradictory declarations block even duplicate intervals and keep-current choices',()=>{
 for(const decision of ['keep','confirm']){
  const p=setup(),before=importSnapshot(p,0),rows=csv('Alex,2026-11-04,09:00,12:00,work,Oak team\nAlex,2026-11-04,09:00,12:00,work,Pine team');
  const r=reviewImport(p,0,rows,{1:{teamDecision:decision}});assert.equal(r.blocked,true);assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);
  applyImport(p,reviewImport(p,0,rows,{1:{skip:true}}));assert.equal(p.record(0,'2026-11-04').shifts.length,1);assert.deepEqual(p.record(0,'2026-11-04').teamSnapshot.p0.teamIds,['oak']);
 }
});
test('balance retains imported time and day conflicts after closure without opportunity',()=>{
 const p=setup();applyImport(p,reviewImport(p,0,csv('Alex,2026-11-04,09:15,16:45,work,Oak team')));
 p.get(0,'2026-11').store.rules[0].holidays['2026-11-04']='closed';
 const row=p.rows(0,'2026-11').find(r=>r.day==='2026-11-04'),b=teamBalance(p,0,'2026-11');
 assert.equal(b.totals.entered,450);assert.equal(b.totals.scheduled,0);assert.equal(b.totals.excludedMinutes,450);assert.equal(b.totals.conflictDays,1);assert.equal(b.people[0].available,29*480);assert.equal(b.people[0].opening,0);assert.equal(b.people[0].closing,0);assert.equal(b.people[0].busy,0);assert.equal(b.people[0].unknownDurationDays,0);
 assert.deepEqual(b.excludedAssignments[0].reasons,row.conflicts.p0);assert.equal(b.excludedAssignments[0].knownMinutes,450);assert.equal(b.teams.find(t=>t.id==='oak').entered,450);
});
test('unknown store hours retain known imported minutes while full-day duration stays unknown',()=>{
 const p=setup();applyImport(p,reviewImport(p,0,csv('Alex,2026-11-04,09:15,16:45,work,Oak team')));p.setAssignment(0,'2026-11-04',{...p.record(0,'2026-11-04'),on:['p0','p1','missing']});
 p.get(0,'2026-11').store.rules=[];
 const row=p.rows(0,'2026-11').find(r=>r.day==='2026-11-04'),b=teamBalance(p,0,'2026-11');
 assert.equal(b.unknownStoreDays,30);assert.equal(b.unknownAssignments,1);assert.equal(b.totals.entered,450);assert.equal(b.totals.excludedMinutes,450);assert.equal(b.totals.available,0);assert.equal(b.totals.scheduled,0);assert.equal(b.totals.unknownDurationDays,2);assert.equal(b.totals.conflictDays,3);
 for(const a of b.excludedAssignments)assert.deepEqual(a.reasons,row.conflicts[a.id]);assert.equal(b.people[1].unknownDurationDays,1);assert.equal(b.excludedAssignments.find(a=>a.id==='p1').unknownDuration,true);
});
test('closed-date unknown identities and duplicate assignments reconcile once',()=>{
 const p=setup();p.get(0,'2026-11').store.rules[0].holidays['2026-11-04']='closed';p.setAssignment(0,'2026-11-04',{on:['missing','missing'],off:[]});
 const b=teamBalance(p,0,'2026-11');assert.equal(b.unknownAssignments,1);assert.equal(b.excludedAssignments.length,1);assert.equal(b.totals.entered,480);assert.equal(b.totals.conflictDays,1);assert.equal(b.totals.excludedMinutes,480);assert.equal(b.totals.scheduled,0);
});
test('legacy pipe names cannot be mistaken for a list of other known teams',()=>{
 const s=store();s.teams.push({id:'combined',name:'Oak team|Pine team'});const p=createPlanner([s]),before=importSnapshot(p,0);
 for(const value of ['Oak team|Pine team','Oak team | Pine team','Ｐｉｎｅ　ｔｅａｍ｜Oak team'])for(const teamDecision of ['keep','confirm']){const r=reviewImport(p,0,csv(`Alex,2026-11-04,09:00,12:00,work,${value}`),{0:{teamDecision}});assert.equal(r.blocked,true);assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);}
});
test('contradictory included declarations are checked even when the first interval already exists',()=>{
 const p=setup();applyImport(p,reviewImport(p,0,csv('Alex,2026-11-04,09:00,12:00,work,Oak team')));const before=importSnapshot(p,0);
 const r=reviewImport(p,0,csv('Alex,2026-11-04,09:00,12:00,work,Oak team\nAlex,2026-11-04,13:00,17:00,work,Pine team'),{1:{teamDecision:'keep'}});assert.equal(r.blocked,true);assert.throws(()=>applyImport(p,r));assert.equal(importSnapshot(p,0),before);
});
test('non-finite full-day boundaries never fabricate a known duration',()=>{
 const p=setup();p.setAssignment(0,'2026-11-04',{on:['p0'],off:[]});p.get(0,'2026-11').store.rules[0].open=null;
 const b=teamBalance(p,0,'2026-11');assert.equal(b.people[0].unknownDurationDays,1);assert.equal(b.people[0].entered,0);
});

test('incomplete Pine data is unknown rather than a 100 versus 33 percent team gap',()=>{
 const p=setup();for(const [i,day] of monthDays('2026-11').entries())p.setAssignment(0,day,{on:i<10?['p0','p1']:['p0'],off:['p2']});
 const before=importSnapshot(p,0),b=teamBalance(p,0,'2026-11');assert.equal(b.comparisonStatus,'incomplete');assert.equal(b.comparisonIssues.unknownAssignments,20);assert.deepEqual(b.differences,[]);assert.equal(b.people[1].offDays,0);assert.equal(b.people[1].unknownDays,20);assert.equal(importSnapshot(p,0),before);
 for(const day of monthDays('2026-11').slice(10))p.setAssignment(0,day,{on:['p0'],off:['p1','p2']});const completed=teamBalance(p,0,'2026-11');assert.equal(completed.comparisonStatus,'ready');assert.ok(completed.differences.length);assert.equal(completed.people[1].offDays,20);
});
test('No team remains context and never becomes a named-team competitor',()=>{
 const p=setup();for(const day of monthDays('2026-11'))p.setAssignment(0,day,{on:['p0','p1'],off:['p2']});const b=teamBalance(p,0,'2026-11');assert.ok(b.teams.some(t=>t.id==='__none'));assert.deepEqual(b.comparisonTeams,['oak','pine']);assert.deepEqual(b.differences,[]);
 const s=store();s.memberships=s.memberships.map(m=>({...m,teamIds:m.personId==='p0'?['oak']:[]}));const one=createPlanner([s]);for(const day of monthDays('2026-11'))one.setAssignment(0,day,{on:['p0'],off:['p1','p2']});assert.equal(teamBalance(one,0,'2026-11').comparisonStatus,'insufficient-teams');
});
test('exact twenty percentage points is included despite floating point subtraction',()=>{
 const p=setup();for(const [i,day] of monthDays('2026-11').entries())p.setAssignment(0,day,{on:[...(i<21?['p0']:[]),...(i<15?['p1']:[])],off:[...(i>=21?['p0']:[]),...(i>=15?['p1']:[]),'p2']});const b=teamBalance(p,0,'2026-11');assert.equal(b.comparisonStatus,'ready');assert.equal(Math.round(b.differences.find(d=>d.label==='Scheduled hours').percentagePoints),20);
});
test('unscheduled shared members disclose shared denominators, with no invented shared work',()=>{
 const p=setup();p.setMembership(0,{storeId:'s1',personId:'p2',teamIds:['oak','pine'],from:'2026-11-01',to:'2026-11-30',source:{kind:'manager'}});for(const day of monthDays('2026-11'))p.setAssignment(0,day,{on:['p0','p1'],off:['p2']});const b=teamBalance(p,0,'2026-11');for(const t of b.teams){assert.equal(t.sharedMemberDays,30);assert.equal(t.sharedAvailableMinutes,30*480);assert.equal(t.sharedMinutes,0);}assert.equal(b.comparisonStatus,'ready');
});
test('missing weekly caps or uncertain membership suppress prompts without changing staffing',()=>{
 const p=setup();for(const day of monthDays('2026-11'))p.setAssignment(0,day,{on:['p0'],off:['p1','p2']});p.get(0,'2026-11').store.people[1].maxHours=null;let b=teamBalance(p,0,'2026-11');assert.equal(b.people[1].unknownCapDays,30);assert.equal(b.comparisonStatus,'incomplete');assert.deepEqual(b.differences,[]);
 p.get(0,'2026-11').store.people[1].maxHours=168;change(p,['pine']);b=teamBalance(p,0,'2026-11');assert.equal(b.comparisonIssues.membershipMismatches,1);assert.equal(b.comparisonStatus,'incomplete');assert.deepEqual(p.record(0,'2026-11-04').on,['p0']);
});

test('audit labels distinguish incomplete data, absent history, absent cap and an actual no-gap result',()=>{
 const p=setup();let html=balanceMarkup(p,0,'2026-11');assert.match(html,/Comparison unavailable: complete/);assert.match(html,/Unavailable: no comparable history/);assert.doesNotMatch(html,/No supported named-team rate gap/);
 p.get(0,'2026-11').store.people[0].maxHours=null;html=balanceMarkup(p,0,'2026-11');assert.match(html,/Weekly cap: Unavailable: weekly limit unknown/);assert.doesNotMatch(html,/nullh|undefinedh/);
 p.get(0,'2026-11').store.people[0].maxHours=168;for(const day of monthDays('2026-11'))p.setAssignment(0,day,{on:['p0','p1'],off:['p2']});html=balanceMarkup(p,0,'2026-11');assert.match(html,/No supported named-team rate gap reaches 20/);assert.match(html,/Unavailable: no comparable history/);
});
test('People and day details visibly disclose dated attribution mismatches',()=>{
 const p=setup();p.setAssignment(0,'2026-11-04',{on:['p0'],off:[]});change(p,['pine']);const s=current(p),r=p.record(0,'2026-11-04');const people=peopleTeamsMarkup(s,'2026-11-04',r),day=teamDayMarkup(s,r,'2026-11-04',false);
 assert.match(people,/retained assignment memberships differ/);assert.match(people,/assignment uses Oak team; current teams are Pine team/);assert.match(day,/Review assignment teams: 1 membership mismatches/);assert.ok(day.indexOf('Review assignment teams')<day.indexOf('<details'));
});
test('partial historical support withholds the historical comparison, not the known hours audit',()=>{
 const s=store();for(let i=0;i<8;i++)s.history.push({day:new Date(Date.parse('2026-09-02T12:00:00Z')+i*7*86400000).toISOString().slice(0,10),state:'known',units:i});const p=createPlanner([s]);for(const day of monthDays('2026-11'))p.setAssignment(0,day,{on:['p0'],off:['p1','p2']});const b=teamBalance(p,0,'2026-11');assert.equal(b.comparisonStatus,'ready');assert.ok(b.comparableDays>0);assert.equal(b.historyComplete,false);assert.ok(b.differences.some(d=>d.label==='Scheduled hours'));assert.ok(b.differences.every(d=>d.label!=='Higher-history days'));assert.match(balanceMarkup(p,0,'2026-11'),/comparable history is missing for some open dates/);
});
test('a scheduled-hours gap just below twenty points stays below the prompt threshold',()=>{
 const p=setup();for(const [i,day] of monthDays('2026-11').entries())p.setAssignment(0,day,{on:[...(i<21?['p0']:[]),...(i<15?['p1']:[])],off:[...(i>=21?['p0']:[]),...(i>=15?['p1']:[]),'p2']});const day='2026-11-16',record=p.record(0,day);p.setAssignment(0,day,{...record,on:[...record.on,'p1'],off:record.off.filter(id=>id!=='p1'),shifts:[{storeId:'s1',personId:'p1',date:day,endDate:day,timezone:'America/New_York',startMinute:540,endMinute:541}]});const b=teamBalance(p,0,'2026-11');assert.equal(b.comparisonStatus,'ready');assert.ok(b.differences.every(d=>d.label!=='Scheduled hours'));
});

test('the existing full-day midnight closing policy remains known in the audit',()=>{const p=setup(),s=p.get(0,'2026-11').store;s.rules[0].open=17;s.rules[0].close=24;s.people[0].start=17;s.people[0].end=24;p.setAssignment(0,'2026-11-04',{on:['p0'],off:[]});const b=teamBalance(p,0,'2026-11');assert.equal(b.totals.entered,420);assert.equal(b.people[0].unknownDurationDays,0);assert.equal(b.people[0].scheduled,420);});
