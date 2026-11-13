import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountMonthApp} from '../scripts/scheduler-performance/month-app-core.mjs';
const root={nodeType:1};
const store={id:'fictional',people:[],rules:[],teams:[],memberships:[]};
test('refuses missing explicit team and membership arrays rather than inventing preview teams',()=>{
 for(const invalid of [{...store,teams:undefined},{...store,memberships:undefined},{...store,teams:null},{...store,memberships:null}])assert.throws(()=>mountMonthApp({root,stores:[invalid],assignmentForDay:()=>null}),/explicit teams and memberships/);
});
test('refuses an absent assignment resolver before any DOM access',()=>{
 assert.throws(()=>mountMonthApp({root,stores:[store]}),/assignmentForDay/);
 assert.throws(()=>mountMonthApp({root,stores:[store],assignmentForDay:null}),/assignmentForDay/);
});
test('refuses absent root and stores before constructing a planner',()=>{
 assert.throws(()=>mountMonthApp({root:null,stores:[store],assignmentForDay:()=>null}),/root element/);
 assert.throws(()=>mountMonthApp({root,stores:[],assignmentForDay:()=>null}),/at least one store/);
});

test('injected historical team snapshots survive changed current membership', async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');
 const {membershipMismatches}=await import('../scripts/scheduler-performance/team-model.mjs');
 const day='2026-11-03',s={id:'fictional',timezone:'America/New_York',people:[{id:'a',name:'A',start:9,end:17,off:[],maxHours:40}],teams:[{id:'old',name:'Old'},{id:'new',name:'New'}],memberships:[{storeId:'fictional',personId:'a',teamIds:['new'],from:'2014-01-01',to:'2100-12-31'}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,closedDays:[],holidays:{}}],history:[]};
 const source={on:['a'],off:[],teamSnapshot:{a:{storeId:'fictional',personId:'a',teamIds:['old'],from:day,to:day}}},before=JSON.stringify(source);
 const p=createPlanner([s],{assignmentForDay:d=>d===day?source:null}),r=p.record(0,day);
 assert.deepEqual(r.teamSnapshot.a.teamIds,['old']);assert.equal(JSON.stringify(source),before);assert.ok(membershipMismatches(s,r,day).some(m=>m.id==='a'));
});

test('explicit store-scoped facts survive closed and unknown-hours days without invoking preview defaults', async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-01';let defaults=0;const base={id:'fictional',people:[],teams:[],memberships:[],history:[],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,closedDays:[0],holidays:{}}]};
 for(const rules of [base.rules,[]]){const p=createPlanner([{...base,rules}],{assignmentForDay:()=>{defaults++;return {on:['fixture']};},explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record:{on:[],off:['a']}}:null});assert.deepEqual(p.record(0,day).off,['a']);}
 assert.equal(defaults,0);
});
test('explicit facts from another store or date fail closed',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const s={id:'fictional',people:[],teams:[],memberships:[],rules:[],history:[]};
 for(const bad of [{storeId:'other',day:'2026-11-01',record:{off:['a']}},{storeId:'fictional',day:'2026-11-02',record:{off:['a']}},{storeId:'fictional',day:'2026-11-01',record:{storeId:'other',off:['a']}},{storeId:'fictional',day:'2026-11-01',record:{date:'2026-11-02',off:['a']}},{storeId:'fictional',day:'2026-11-01',record:{month:'2026-12',off:['a']}}]){const p=createPlanner([s],{explicitAssignmentForDay:()=>bad});assert.throws(()=>p.record(0,'2026-11-01'),/scope mismatch/);}
});

test('direct add and adjustment refuse even falsy existing off or unknown evidence without mutation',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-03',s={id:'fictional',timezone:'America/New_York',people:[{id:'a',name:'A',start:0,end:24,off:[],maxHours:40}],teams:[],memberships:[],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,closedDays:[],holidays:{}}],history:[]};
 for(const field of ['absences','unknownNotes'])for(const adjust of [false,true]){const shift={storeId:'fictional',personId:'a',date:day,endDate:day,timezone:'America/New_York',startMinute:540,endMinute:720},record={on:adjust?['a']:[],off:[],shifts:adjust?[shift]:[],[field]:{a:null}},before=JSON.stringify(record),p=createPlanner([s],{explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record}:null});const cmd={index:0,day,personId:'a',startMinute:540,endMinute:720,...(adjust?{original:shift}:{})};assert.throws(()=>p.reviewDirectShift(cmd),/off or unknown|existing conflicts/i);assert.equal(JSON.stringify(record),before);assert.equal(p.revision,0);}
});

test('live mounting fails closed until strict source and time contracts are verified',()=>{
 for(const preview of [false,undefined]) assert.throws(()=>mountMonthApp({root,stores:[store],assignmentForDay:()=>null,preview}),/Live scheduler is not configured/);
});

test('a local draft requires an explicit strict source contract and a currently valid host lease',()=>{
  const options={root,stores:[store],assignmentForDay:()=>null,localDraft:true,strictHours:true,requireMaterializedSources:true,isCurrent:()=>true,today:()=> '2026-11-03'};
  for(const change of [{localDraft:false},{strictHours:false},{requireMaterializedSources:false},{isCurrent:null},{isCurrent:()=>false}]){
    assert.throws(()=>mountMonthApp({...options,...change}),/Live scheduler is not configured/);
  }
});
test('strict synthetic mount requires an explicit store-local clock',()=>{
 assert.throws(()=>mountMonthApp({root,stores:[store],assignmentForDay:()=>null,preview:true,strictHours:true}),/explicit store-local today/);
});
test('strict planner rejects absent, ambiguous and duplicate store identifiers',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');
 for(const id of [undefined,null,'','  ',' fictional '])assert.throws(()=>createPlanner([{...store,id}],{strictHours:true}),/store identifiers/);
 assert.throws(()=>createPlanner([store,{...store}],{strictHours:true}),/store identifiers/);
});
test('strict resolver and draft writes reject contradictory nested shift scope',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-03';
 for(const shift of [{personId:'a',storeId:'other'},{personId:'a',date:'2026-11-04'},{personId:'a',month:'2026-12'}]){const record={on:['a'],off:[],shifts:[shift]},p=createPlanner([store],{strictHours:true,explicitAssignmentForDay:()=>({storeId:store.id,day,record})});assert.throws(()=>p.record(0,day),/shift scope mismatch/);assert.throws(()=>p.setAssignment(0,day,record),/shift scope mismatch/);}
});

test('explicit work on a closed day remains visible as a conflict',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-08',s={id:'fictional',timezone:'America/New_York',people:[{id:'a',name:'A',start:9,end:17,off:[],maxHours:40}],teams:[],memberships:[],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,closedDays:[0],holidays:{}}],history:[]};const record={on:['a'],off:[],shifts:[{storeId:'fictional',personId:'a',date:day,endDate:day,timezone:'America/New_York',startMinute:540,endMinute:720}]};
 const p=createPlanner([s],{explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record}:null}),row=p.rows(0,'2026-11').find(r=>r.day===day);assert.equal(row.state,'closed');assert.deepEqual(row.record.on,['a']);assert.match(row.conflicts.a.join(' '),/closed/);
});

const strictStore=()=>({id:'fictional',timezone:'America/New_York',people:[{id:'a',name:'A',start:0,end:24,off:[],maxHours:40}],teams:[],memberships:[],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,closedDays:[],holidays:{}}],history:[]});
test('strict injected mode never calls a fixture fallback when explicit facts are absent',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');let called=0;const p=createPlanner([strictStore()],{strictHours:true,assignmentForDay:()=>{called++;return {on:['fake']};},explicitAssignmentForDay:()=>null});assert.equal(p.record(0,'2026-11-03'),null);assert.equal(called,0);
});
test('strict injected on-without-times has unknown coverage and weekly hours, not a full-day shift or zero',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const {weeklyHoursAudit}=await import('../scripts/scheduler-performance/weekly-hours.mjs');const day='2026-11-03',record={on:['a'],off:[]};const p=createPlanner([strictStore()],{strictHours:true,explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record}:null});const row=p.rows(0,'2026-11').find(x=>x.day===day);assert.equal(row.minimumCoverage,null);assert.equal(row.weeklyHours.a,null);assert.deepEqual(row.coverage,[]);assert.match(row.conflicts.a.join(' '),/hours unknown/i);const audit=weeklyHoursAudit(day,'a',d=>p.context(0,d));assert.equal(audit.knownMinutes,0);assert.equal(audit.complete,false);assert.ok(audit.days.find(d=>d.date===day).reasons.includes('Shift duration unknown'));
});
test('strict injected split hours use real intervals and do not invent their gap',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-03',shift=(startMinute,endMinute)=>({storeId:'fictional',personId:'a',date:day,endDate:day,timezone:'America/New_York',startMinute,endMinute});const p=createPlanner([strictStore()],{strictHours:true,explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record:{on:['a'],off:[],shifts:[shift(540,720),shift(780,1020)]}}:d>='2026-11-02'&&d<='2026-11-08'?{storeId:'fictional',day:d,record:{on:[],off:['a']}}:null});const row=p.rows(0,'2026-11').find(x=>x.day===day);assert.equal(row.weeklyHours.a,7);assert.equal(row.minimumCoverage,0);assert.ok(row.coverage.some(x=>x.start===720&&x.end===780&&x.count===0));
});
test('strict mode with missing store timezone leaves even apparently matching shift times unverified',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const {weeklyHoursAudit}=await import('../scripts/scheduler-performance/weekly-hours.mjs');const day='2026-11-03',s=strictStore();delete s.timezone;const shift={storeId:'fictional',personId:'a',date:day,endDate:day,timezone:'America/New_York',startMinute:540,endMinute:1020};const p=createPlanner([s],{strictHours:true,explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record:{on:['a'],off:[],shifts:[shift]}}:null});const row=p.rows(0,'2026-11').find(x=>x.day===day);assert.equal(row.minimumCoverage,null);assert.equal(row.weeklyHours.a,null);assert.match(row.conflicts.a.join(' '),/timezone unknown/i);const audit=weeklyHoursAudit(day,'a',d=>p.context(0,d));assert.equal(audit.complete,false);assert.equal(audit.timezone,null);
});
test('strict month projection and labels do not verify a shift with unknown store timezone',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const {projectMonthSchedule}=await import('../scripts/scheduler-performance/week-timeline.mjs');const {shiftAgendaEntries}=await import('../scripts/scheduler-performance/shift-agenda.mjs');const day='2026-11-03',s=strictStore();delete s.timezone;const shift={storeId:'fictional',personId:'a',date:day,endDate:day,timezone:'America/New_York',startMinute:540,endMinute:1020};const p=createPlanner([s],{strictHours:true,explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record:{on:['a'],off:[],shifts:[shift]}}:null});const row=p.rows(0,'2026-11').find(x=>x.day===day),store=p.context(0,day).store;assert.deepEqual(projectMonthSchedule(row,store).events,[]);assert.deepEqual(projectMonthSchedule(row,store).unverified,['a']);assert.match(shiftAgendaEntries([row],store)[0].hours,/unverified/);
});
test('strict direct shift cannot invent a missing store timezone',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const s=strictStore();delete s.timezone;const p=createPlanner([s],{strictHours:true});assert.throws(()=>p.reviewDirectShift({index:0,day:'2026-11-03',personId:'a',startMinute:540,endMinute:720}),/timezone.*unknown/i);assert.equal(p.revision,0);
});
test('strict weekly audit keeps falsy unknown evidence unresolved on off days',async()=>{
 const {weeklyHoursAudit}=await import('../scripts/scheduler-performance/weekly-hours.mjs');const s=strictStore(),row={on:[],off:['a'],unknownNotes:{a:null}};const audit=weeklyHoursAudit('2026-11-03','a',()=>({store:s,record:row,strictHours:true}));assert.equal(audit.complete,false);assert.ok(audit.days.every(d=>d.reasons.includes('Assignment status unknown')));
});
test('strict empty, missing and explicitly unknown records never claim zero coverage or a complete weekly total',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-03';for(const record of [null,{on:[],off:[]},{on:[],off:[],unknownNotes:{a:null}}]){const p=createPlanner([strictStore()],{strictHours:true,explicitAssignmentForDay:d=>d===day&&record?{storeId:'fictional',day,record}:null});const row=p.rows(0,'2026-11').find(x=>x.day===day);assert.equal(row.minimumCoverage,null);assert.equal(row.weeklyHours.a,null);assert.deepEqual(row.coverage,[]);assert.ok(row.issues.some(x=>/unknown/i.test(x)));assert.ok(!row.issues.some(x=>/more eligible people needed/i.test(x)));}
});
test('strict confirmed off can establish zero coverage for that date without declaring the week complete',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-03',p=createPlanner([strictStore()],{strictHours:true,explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record:{on:[],off:['a']}}:null}),row=p.rows(0,'2026-11').find(x=>x.day===day);assert.equal(row.minimumCoverage,0);assert.equal(row.weeklyHours.a,null);
});
test('unverified strict-source generation, import and off-day transfer fail closed',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const {generationInput}=await import('../scripts/scheduler-performance/generation.mjs');const {reviewImport}=await import('../scripts/scheduler-performance/schedule-import.mjs');const {planOffDay}=await import('../scripts/scheduler-performance/off-day-command.mjs');const p=createPlanner([strictStore()],{strictHours:true});
 assert.throws(()=>generationInput(p,0,'2026-11',{}),/unavailable.*strict/i);assert.throws(()=>reviewImport(p,0,[]),/unavailable.*strict/i);assert.throws(()=>planOffDay({index:0,personId:'a',from:'2026-11-03',to:'2026-11-04',mode:'copy'},(i,d)=>p.context(i,d)),/unavailable.*strict/i);assert.equal(p.revision,0);
});
test('strict explicit team snapshots reject nested cross-store, person and date mismatches',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-03';for(const bad of [{storeId:'other'},{personId:'other'},{date:'2026-11-04'},{from:'2026-11-04'},{to:'2026-11-02'}]){const record={on:['a'],off:[],teamSnapshot:{a:{teamIds:[],...bad}}},p=createPlanner([strictStore()],{strictHours:true,explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record}:null});assert.throws(()=>p.record(0,day),/team scope mismatch/);}
});
test('strict coverage with an unknown scheduled person is unverified rather than confirmed zero',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-03',s=strictStore(),shift={storeId:'fictional',personId:'x',date:day,endDate:day,timezone:'America/New_York',startMinute:540,endMinute:1020};const p=createPlanner([s],{strictHours:true,explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record:{on:['x'],off:['a'],shifts:[shift]}}:null});const row=p.rows(0,'2026-11').find(x=>x.day===day);assert.equal(row.minimumCoverage,null);assert.deepEqual(row.coverage,[]);assert.match(row.conflicts.x.join(' '),/Unknown person/);assert.ok(!row.issues.some(x=>/more eligible people needed/i.test(x)));
});
test('strict overrides reject nested cross-store snapshots before changing state',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const p=createPlanner([strictStore()],{strictHours:true}),bad={on:['a'],off:[],teamSnapshot:{a:{storeId:'other',personId:'a',teamIds:[]}}};assert.throws(()=>p.setAssignment(0,'2026-11-03',bad),/team scope mismatch/);assert.equal(p.revision,0);assert.equal(p.record(0,'2026-11-03'),null);
});
test('strict hydration rejects nested cross-store snapshots without applying changes',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const p=createPlanner([strictStore()],{strictHours:true}),projection=p.exportMonth(0,'2026-11').projection;projection.overrides['2026-11-03']={on:['a'],off:[],teamSnapshot:{a:{storeId:'other',personId:'a',teamIds:[]}}};const before=JSON.stringify(p.exportMonth(0,'2026-11').projection),result=p.hydrateMonth(0,projection,()=>true);assert.equal(result.ok,false);assert.equal(result.reason,'scope');assert.equal(JSON.stringify(p.exportMonth(0,'2026-11').projection),before);
});
test('strict explicit, override and hydration inputs reject malformed assignment collections',async()=>{
 const {createPlanner}=await import('../scripts/scheduler-performance/month-model.mjs');const day='2026-11-03';for(const bad of [{on:'a',off:[]},{on:['a','a'],off:[]},{on:[],off:{a:true}},{on:[],off:[],shifts:[null]},{on:[],off:[],unknownNotes:[]}]){const source=createPlanner([strictStore()],{strictHours:true,explicitAssignmentForDay:d=>d===day?{storeId:'fictional',day,record:bad}:null});assert.throws(()=>source.record(0,day),/shape invalid/);const target=createPlanner([strictStore()],{strictHours:true});assert.throws(()=>target.setAssignment(0,day,bad),/shape invalid/);assert.equal(target.revision,0);const candidate=target.exportMonth(0,'2026-11').projection;candidate.overrides[day]=bad;const before=JSON.stringify(target.exportMonth(0,'2026-11').projection);assert.equal(target.hydrateMonth(0,candidate,()=>true).ok,false);assert.equal(JSON.stringify(target.exportMonth(0,'2026-11').projection),before);}
});
