import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {originalC113 as c113} from '../../api/_scheduler-c113.mjs';
import {storeKey} from '../../api/_store-keys.mjs';
import {createPlanner} from '../scheduler-performance/month-model.mjs';
import {personIntervals,employmentProblem} from '../scheduler-performance/shift-intervals.mjs';
import {generationInput,generateProposal,applyProposal} from '../scheduler-performance/generation.mjs';
import {parseSchedule,reviewImport,applyImport} from '../scheduler-performance/schedule-import.mjs';
import {monthPeople} from '../../src/scheduler-editor-adapter.mjs';
import * as review from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review-provenance.mjs';
import {assembleSource,createSourceCapture} from '../scheduler-source-capture/adapter.mjs';
import {assembleManualSource} from './contract.mjs';
import {preparePublication,validatePublicationPlan} from '../scheduler-delivery-relational/context.mjs';

// These constructors reproduce the complete synthetic cases recorded from
// accepted 76a25c9, not real data or a grant to activate publication.
const zone='America/New_York', copy=structuredClone;
const hash=text=>createHash('sha256').update(text).digest('hex');
const person=(id,extra={})=>({id,name:'Synthetic '+id,start:9,end:17,off:[],maxHours:40,maxHoursSource:'manager-confirmed',...extra});
const store=(id,people,openDays)=>({id,name:'Synthetic semantic fixture',timezone:zone,people,teams:[],memberships:people.map(p=>({storeId:id,personId:p.id,teamIds:[],unknown:false,from:'2014-01-01',to:'2100-12-31',source:{kind:'explicit synthetic no-team membership'}})),rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[0,1,2,3,4,5,6],holidays:Object.fromEntries(openDays.map(d=>[d,'open']))}],history:[]});
const shift=(id,personId,date,startMinute=540,endMinute=1020,source={kind:'explicit synthetic external schedule'})=>({storeId:id,personId,date,endDate:date,startMinute,endMinute,timezone:zone,source});
function reviewInput(baseStore,projections,month,base={}){
  const span=review.reviewSpan(month);
  return {definition:review.REVIEW_DEFINITION,scope:{storeId:baseStore.id,month},baseStore:copy(baseStore),teamState:{teams:copy(baseStore.teams),memberships:copy(baseStore.memberships)},months:Object.fromEntries(projections.map(p=>[p.month,{store:{...copy(p.store),id:p.storeId,history:copy(baseStore.history)},overrides:copy(p.overrides)}])),base:Object.fromEntries(span.days.map(day=>[day,copy(base[day]??null)]))};
}
function roundTrip(projection){
  const encoded=c113.serializeDraft({...projection,rev:1,draft:projection});
  assert.equal(encoded.ok,true,JSON.stringify(encoded.problems));
  const decoded=c113.deserializeVersion(encoded.text,{storeId:projection.storeId,month:projection.month,kind:'draft',rev:1});
  assert.equal(decoded.ok,true);assert.deepEqual(decoded.draft,projection);return encoded.text;
}
function generatedCase(){
  const day='2026-12-07',s=store('semantic-generated',[person('a',{hiredAt:'2010-02-01'}),person('b',{hiredAt:day}),person('c',{departedAt:day}),person('future',{hiredAt:'2026-12-08'}),person('departed',{departedAt:'2026-12-06'})],[day]);
  s.rules[0].minimum=2;
  s.history=['2026-11-09','2026-11-16','2026-11-23','2026-11-30'].map((day,i)=>({day,state:'known',units:8+i*4,source:'explicit synthetic daily history'}));
  const planner=createPlanner([s],{assignmentForDay:()=>null});
  planner.setAssignment(0,day,{on:[],off:['c'],shifts:[],generationLocks:['c'],absences:{c:{kind:'vacation',source:{kind:'explicit synthetic manager choice'}}}});
  const policy={confirmed:true,regenerate:true,mode:'individual',shifts:[{id:'explicit-09-to-17',startMinute:540,endMinute:1020}],requiredRoles:{sales:1,lead:1},people:Object.fromEntries(s.people.map(p=>[p.id,{eligible:true,roles:p.id==='a'?['sales','lead']:['sales']}])),useMarket:false,market:null};
  const proposal=generateProposal(generationInput(planner,0,'2026-12',policy),{now:()=>0});
  assert.equal(proposal.status,'covered');assert.equal(applyProposal(planner,proposal),31);
  return {s,planner,projection:planner.exportMonth(0,'2026-12').projection,day};
}
function importedCase(){
  const day='2026-11-02',s=store('semantic-imported',[person('a',{hiredAt:'2010-02-01'}),person('b',{departedAt:day}),person('c',{hiredAt:day}),person('d',{off:null,start:null,end:null,maxHours:null}),person('e')],[day]);
  const csv='Person ID,Date,Start,End,Status,Team,Timezone\n'+[`a,${day},09:15,16:45,work,none,${zone}`,`b,${day},,,vacation,none,${zone}`,`c,${day},,,unavailable,none,${zone}`,`d,${day},,,unknown,none,${zone}`,`e,${day},,,off,none,${zone}`].join('\n');
  const planner=createPlanner([s],{assignmentForDay:()=>null});
  const proposal=reviewImport(planner,0,parseSchedule(csv,'synthetic-semantic.csv'));
  assert.equal(proposal.blocked,false);assert.equal(applyImport(planner,proposal).changed,1);
  return {s,planner,projection:planner.exportMonth(0,'2026-11').projection,day};
}
function boundaryCase(){
  const days=['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03'];
  const s=store('semantic-boundary',[person('a',{hiredAt:'2001-05-12'}),person('b')],days);
  const external=Object.fromEntries(days.map(day=>[day,{on:[],off:['a','b'],shifts:[],absences:{a:{kind:'off'},b:{kind:'off'}}}]));
  for(const [day,start,end]of[['2026-12-28',540,1020],['2026-12-29',555,1005]])external[day]={on:['a'],off:['b'],shifts:[shift(s.id,'a',day,start,end)],breaksKnown:false,absences:{b:{kind:'off'}}};
  external['2026-12-31'].absences.b={kind:'vacation',source:{kind:'explicit synthetic external absence'}};
  external['2027-01-03']={on:[],off:['b'],shifts:[],unknownNotes:{a:{source:{kind:'explicit unknown boundary assignment'}}},absences:{b:{kind:'off'}}};
  const planner=createPlanner([s],{strictHours:true,requireMaterializedSources:true,explicitAssignmentForDay:(day,index)=>index===0&&external[day]?{storeId:s.id,day,record:copy(external[day])}:null});
  planner.get(0,'2026-12');planner.get(0,'2027-01').store.people.find(p=>p.id==='a').maxHours=8;
  planner.setAssignment(0,'2027-01-01',{on:['a'],off:['b'],shifts:[shift(s.id,'a','2027-01-01',540,1020,{kind:'explicit synthetic neighbor draft'})],breaksKnown:false,absences:{b:{kind:'off'}}});
  for(const month of ['2026-12','2027-01'])planner.applyMaterialization(planner.reviewMaterialization(0,month));
  return {s,planner,external,projections:['2026-12','2027-01'].map(m=>planner.exportMonth(0,m).projection)};
}

test('actual generated export keeps generation metadata, inclusive employment, vacation and historical provenance',()=>{
  const {s,projection,day}=generatedCase();roundTrip(projection);
  const input=reviewInput(s,[projection],'2026-12'),validated=review.validateReviewInput(input);
  assert.deepEqual(validated,input);
  const result=review.reviewMonth(input,{sha256:hash}),record=result.rows.find(r=>r.day===day).record;
  assert.deepEqual(record.on,['a','b']);assert.equal(record.absences.c.kind,'vacation');
  assert.deepEqual(record.generation,projection.overrides[day].generation);
  for(const id of ['a','b'])assert.deepEqual(personIntervals(record,id,s.rules[0],{strictHours:true}),[[540,1020]]);
  assert.equal(record.on.includes('future'),false);assert.equal(record.on.includes('departed'),false);
  assert.equal(employmentProblem(s.people[1],day),null);assert.equal(employmentProblem(s.people[2],day),null);
  assert.ok(result.openIssues>0,'missing authoritative neighbor assignments and break facts cannot publish');
  assert.ok(result.completenessIssues.some(x=>x.reason==='Break information unavailable'));
  const changed=copy(input);changed.baseStore.history[0].source='different explicit source';
  assert.notEqual(review.reviewMonth(changed,{sha256:hash}).inputDigest,result.inputDigest);
  assert.notEqual(review.reviewMonth(changed,{sha256:hash}).digest,result.digest);
  const fromLive=review.exportReviewInput({planner:review.hydrateReviewPlanner(validated),stores:[s],month:'2026-12',storeId:s.id,assignmentForDay:()=>null});
  assert.deepEqual(fromLive,input);
});

test('actual imported export retains 450 minutes and vacation, unavailable, unknown and Off without inferred breaks',()=>{
  const {s,projection,day}=importedCase();roundTrip(projection);
  const result=review.reviewMonth(reviewInput(s,[projection],'2026-11'),{sha256:hash});
  const record=result.rows.find(r=>r.day===day).record;
  assert.deepEqual(personIntervals(record,'a',s.rules[0],{strictHours:true}),[[555,1005]]);
  assert.equal(result.weeklyAudits.find(a=>a.personId==='a'&&a.start===day).knownMinutes,450);
  assert.equal(record.absences.b.kind,'vacation');assert.equal(record.absences.c.kind,'unavailable');assert.equal(record.absences.e.kind,'off');
  assert.ok(Object.hasOwn(record.unknownNotes,'d'));assert.equal(Object.hasOwn(record,'breaksKnown'),false);
  assert.deepEqual(record.shifts[0].source,{file:'synthetic-semantic.csv',line:2});
  assert.ok(result.openIssues>0);assert.equal(result.weeklyAudits.find(a=>a.personId==='a'&&a.start===day).complete,false);
});

test('actual boundary exports preserve 1410 known minutes, incomplete status, neighbor override and January cap conflicts',()=>{
  const {s,projections}=boundaryCase();projections.forEach(roundTrip);
  const result=review.reviewMonth(reviewInput(s,projections,'2026-12'),{sha256:hash});
  const audit=result.weeklyAudits.find(a=>a.personId==='a'&&a.start==='2026-12-28');
  assert.equal(audit.knownMinutes,1410);assert.equal(audit.complete,false);
  assert.deepEqual(audit.confirmedCapConflicts.map(c=>c.date),['2027-01-01','2027-01-02','2027-01-03']);
  assert.deepEqual(audit.days.find(d=>d.date==='2027-01-01').reasons,['Break information unavailable']);
  assert.ok(audit.days.find(d=>d.date==='2027-01-03').reasons.includes('Assignment status unknown'));
  assert.ok(result.completenessIssues.some(x=>x.date==='2027-01-01'&&x.reason==='Weekly hours exceed confirmed cap'));
  assert.equal(result.rows.find(r=>r.day==='2026-12-31').record.absences.b.kind,'vacation');
  assert.ok(result.openIssues>0);
  const january=review.reviewMonth(reviewInput(s,projections,'2027-01'),{sha256:hash});
  assert.ok(january.rows.find(r=>r.day==='2027-01-01').conflicts.a.some(reason=>reason==='weekly hours exceeded (23.5/8)'));
  assert.equal(january.weeklyAudits.find(a=>a.personId==='a'&&a.start==='2026-12-28').knownMinutes,1410);
  const input=reviewInput(s,projections,'2026-12'),before=result.inputDigest;
  input.months['2027-01'].overrides['2027-01-01'].shifts[0].source.kind='different neighbor source';
  assert.notEqual(review.reviewMonth(input,{sha256:hash}).inputDigest,before);
});

function completedCapture(){
  const month='2026-12',day='2026-12-07',id='publication-complete';
  const data={__storeId:id,roster:[{id:'a',name:'Synthetic a',roleId:'sales',hiredAt:'2010-02-01'},{id:'b',name:'Synthetic b',roleId:'sales',hiredAt:day}],departed:[{id:'b',at:day}],daysOff:{},forcedOff:{}};
  const s=store(id,[person('a',{hiredAt:'2010-02-01'}),person('b',{hiredAt:day,departedAt:day})],[day]);
  s.planningPolicy=null;
  s.history=[{day:'2026-11-30',state:'known',units:8,source:'explicit synthetic daily history'}];
  const span=review.reviewSpan(month),peopleFor=monthPeople(data),drafts=[],heads={},versions=[];
  for(const m of span.months){
    const people=peopleFor(m).map(p=>({...person(p.id),...p,start:9,end:17,off:[],maxHours:40}));
    const dstore={people,rules:copy(s.rules),teams:[],memberships:s.memberships.filter(m=>people.some(p=>p.id===m.personId)),timezone:zone};
    const overrides=Object.fromEntries(span.days.filter(d=>d.startsWith(m+'-')).map(d=>[d,{on:[],off:people.map(p=>p.id),shifts:[],absences:Object.fromEntries(people.map(p=>[p.id,{kind:'off',source:{kind:'explicit synthetic manager choice'}}]))}]));
    if(m===month)overrides[day]={on:['a','b'],off:[],shifts:[shift(id,'a',day),shift(id,'b',day)],breaksKnown:true};
    const draft={storeId:id,month:m,store:dstore,overrides},text=roundTrip(draft);
    heads[m]={draft_rev:1,published_rev:0,last_audit_hash:null,audit_revision:0};
    versions.push({store_id:id,month:m,kind:'draft',rev:1,version_text:text});drafts.push(draft);
  }
  return {version:'scheduler-source-snapshot/1',scope:{storeId:id,month},epoch:1,rows:{[storeKey(id)]:data},heads,versions,
    supplement:{version:'scheduler-source-inputs/1',baseStore:s,teamState:{teams:[],memberships:s.memberships},months:Object.fromEntries(span.months.map(m=>[m,{history:copy(s.history),planningPolicy:null}]))}};
}
function reseal(raw,month,change){
  const row=raw.versions.find(v=>v.month===month),decoded=c113.deserializeVersion(row.version_text);
  change(decoded.draft);row.version_text=roundTrip(decoded.draft);
}
async function prepare(assembled){
  const snapshot=copy(assembled.snapshot);let registrations=0;
  snapshot.contextTransaction={id:'synthetic-context',capabilities:{'scheduler-context-cas-and-provenance-v1':true},register:async({bindingDigest})=>{registrations++;return {registered:true,transactionId:'synthetic-context',bindingDigest};}};
  const result=await preparePublication({request:{op:'publish',...snapshot.scope,requestId:'synthetic-publish',input:{draftRev:1,review:assembled.review}},actor:{id:'synthetic-manager'},now:'2026-11-12T12:00:00.000Z',snapshot,sourceEpoch:assembled.raw.epoch});
  assert.equal(registrations,1);return result;
}

test('complete captured explicit schedule assembles and projects exact person/date intervals without losing history',async()=>{
  const raw=completedCapture(),before=copy(raw),assembled=assembleManualSource(raw);
  assert.deepEqual(raw,before);assert.deepEqual(assembled.raw,before);
  assert.deepEqual(assembled.snapshot.reviewInput.baseStore.history,raw.supplement.baseStore.history);
  assert.equal(review.reviewMonth(assembled.snapshot.reviewInput,{sha256:hash}).openIssues,0);
  const result=await prepare(assembled);assert.equal(validatePublicationPlan(result.context.plan,result.context),true);
  for(const id of ['a','b']){
    const own=result.context.projection.find(p=>p.personId===id).days;
    assert.deepEqual(own.find(d=>d.date==='2026-12-07'),{date:'2026-12-07',status:'working',intervals:[[540,1020]],timezone:zone});
    assert.equal(own.length,31);
  }
  assert.ok(Object.isFrozen(result));
});

test('generated or imported provenance alone does not prohibit a complete explicit captured schedule',async()=>{
  for(const kind of ['generated','CSV reviewed import']){
    const raw=completedCapture();reseal(raw,'2026-12',d=>{const r=d.overrides['2026-12-07'];r.shifts[0].source={kind,file:'synthetic.csv',line:2};r.generation={unlocked:[],signatures:{a:'synthetic explicit assignment'}};});
    const result=await prepare(assembleManualSource(raw));
    assert.deepEqual(result.context.projection[0].days.find(d=>d.date==='2026-12-07').intervals,[[540,1020]]);
  }
});

test('bare On, unknown breaks, invalid employment and missing boundary drafts refuse publication',()=>{
  const bare=completedCapture();reseal(bare,'2026-12',d=>{delete d.overrides['2026-12-07'].shifts;});
  assert.throws(()=>assembleManualSource(bare),{code:'MANUAL_EXPLICIT_TIMES_REQUIRED'});
  const breaks=completedCapture();reseal(breaks,'2026-12',d=>{d.overrides['2026-12-07'].breaksKnown=false;});
  assert.throws(()=>assembleManualSource(breaks),{code:'SOURCE_REVIEW_ISSUES'});
  const employment=completedCapture();reseal(employment,'2026-12',d=>{d.store.people[0].hiredAt='2026-12-08';});
  assert.throws(()=>assembleManualSource(employment),{code:'MANUAL_EXPLICIT_TIMES_REQUIRED'});
  const missing=completedCapture();missing.versions=missing.versions.filter(v=>v.month!=='2027-01');
  assert.throws(()=>assembleManualSource(missing),{code:'MANUAL_BOUNDARY_DRAFT_REQUIRED'});
});

test('employment metadata, break types and record schema are validated without weakening exclusions',()=>{
  const {s,projection}=generatedCase(),base=reviewInput(s,[projection],'2026-12');
  for(const date of ['2010-02-29','1900-02-29','0000-01-01','2026-12-07T00:00:00Z']){
    const changed=copy(base);changed.months['2026-12'].store.people[0].hiredAt=date;
    assert.throws(()=>review.validateReviewInput(changed),{code:'employment'});
  }
  const reversed=copy(base);reversed.months['2026-12'].store.people[0].departedAt='2009-12-31';assert.throws(()=>review.validateReviewInput(reversed),{code:'employment'});
  const breaks=copy(base);breaks.months['2026-12'].overrides['2026-12-07'].breaksKnown='yes';assert.throws(()=>review.validateReviewInput(breaks),{code:'shape'});
  const extra=copy(base);extra.months['2026-12'].overrides['2026-12-07'].unapproved=true;assert.throws(()=>review.validateReviewInput(extra),{code:'unknown key'});
  const metadata=copy(base);metadata.months['2026-12'].overrides['2026-12-07'].generation.unqualified=true;assert.throws(()=>review.validateReviewInput(metadata),{code:'unknown key'});
});

test('source capture compares authoritative employment bounds and requires deliberate legacy seed materialization',()=>{
  const wrong=completedCapture();wrong.supplement.baseStore.people[0].hiredAt='2011-01-01';
  assert.throws(()=>assembleSource(wrong,{explicitManual:true}),{code:'SOURCE_ROSTER_MISMATCH'});
  const source=completedCapture();source.rows[storeKey(source.scope.storeId)].daysOff.a=['2026-12-08'];
  reseal(source,'2026-12',d=>{delete d.overrides['2026-12-08'];});
  assert.throws(()=>assembleSource(source),{code:'SOURCE_MATERIALIZATION_REQUIRED'});
  const forced=completedCapture();forced.rows[storeKey(forced.scope.storeId)].forcedOff.a=['2026-12-08'];
  assert.throws(()=>assembleSource(forced),{code:'SOURCE_INPUTS_INVALID'});
});

test('a contradictory or malformed source store stamp refuses both capture paths without relabeling it',()=>{
  for(const stamp of ['contradictory-foreign-store',null,123,''])for(const manual of [true,false]){
    const raw=completedCapture();raw.rows[storeKey(raw.scope.storeId)].__storeId=stamp;
    const before=copy(raw);
    assert.throws(()=>manual?assembleManualSource(raw):assembleSource(raw),{code:'SOURCE_INPUTS_INVALID'});
    assert.deepEqual(raw,before);
  }
  const unstamped=completedCapture();delete unstamped.rows[storeKey(unstamped.scope.storeId)].__storeId;
  assert.equal(assembleManualSource(unstamped).snapshot.scope.storeId,unstamped.scope.storeId);
});

test('a departed boundary person absent from January roster is excluded only by consistent captured bounds',()=>{
  const raw=completedCapture();raw.scope.month='2027-01';
  reseal(raw,'2027-01',d=>{for(const day of review.reviewSpan('2027-01').days.filter(day=>day.startsWith('2027-01-')))d.overrides[day]={on:[],off:['a'],shifts:[],absences:{a:{kind:'off'}}};});
  raw.supplement.baseStore.people=raw.supplement.baseStore.people.filter(p=>p.id==='a');
  raw.supplement.baseStore.memberships=raw.supplement.baseStore.memberships.filter(p=>p.personId==='a');
  raw.supplement.teamState.memberships=raw.supplement.teamState.memberships.filter(p=>p.personId==='a');
  const assembled=assembleManualSource(raw),input=assembled.snapshot.reviewInput;
  const reviewed=review.reviewMonth(input,{sha256:hash});
  assert.equal(reviewed.openIssues,0);
  const b=reviewed.weeklyAudits.find(a=>a.personId==='b');
  assert.equal(b.complete,false,'raw missing-assignment audit is retained');
  assert.ok(b.days.some(d=>d.date==='2027-01-01'&&d.reasons.includes('Assignment data missing')));
  assert.equal(reviewed.completenessIssues.some(i=>i.personId==='b'),false);
  const conflicting=copy(input);conflicting.months['2026-12'].store.people.find(p=>p.id==='b').departedAt=null;
  assert.ok(review.reviewMonth(conflicting,{sha256:hash}).completenessIssues.some(i=>i.personId==='b'));
  const disagreeing=copy(input);disagreeing.baseStore.people.push({...copy(input.months['2026-12'].store.people.find(p=>p.id==='b')),departedAt:'2026-12-08'});
  assert.ok(review.reviewMonth(disagreeing,{sha256:hash}).completenessIssues.some(i=>i.personId==='b'),'conflicting known bounds cannot be selected opportunistically');
  const assigned=copy(input);assigned.months['2027-01'].overrides['2027-01-01'].on=['b'];
  assert.ok(review.reviewMonth(assigned,{sha256:hash}).openIssues>0,'assignment never disappears behind an employment exclusion');
});

test('old history-free manual policy is unavailable rather than manufactured into empty history',()=>{
  const raw=completedCapture();raw.supplement={version:'scheduler-manual-policy/1',months:Object.fromEntries(review.reviewSpan(raw.scope.month).months.map(m=>[m,null]))};
  assert.throws(()=>assembleManualSource(raw),{code:'MANUAL_HISTORY_UNAVAILABLE'});
});

test('changed source, history or review digest cannot register a stale publication context',async()=>{
  const raw=completedCapture(),assembled=assembleManualSource(raw);
  const changed=copy(assembled);changed.snapshot.reviewInput.baseStore.history[0].source='new provenance';
  await assert.rejects(()=>prepare(changed));
  const wrong=copy(assembled);wrong.review.digest='0'.repeat(64);await assert.rejects(()=>prepare(wrong));
  let registers=0;
  const capture=createSourceCapture({enabled:true,assemble:assembleManualSource,port:{snapshot:async()=>{const latest=copy(raw);if(registers++>0)latest.epoch=2;return latest;},register:async()=>assert.fail('stale snapshot reached registration')}});
  await assert.rejects(()=>capture.capture({scope:raw.scope,actor:{id:'synthetic-manager'},now:'2026-11-12T12:00:00.000Z',requestId:'capture-only'}),{code:'SOURCE_CONFLICT'});
});
