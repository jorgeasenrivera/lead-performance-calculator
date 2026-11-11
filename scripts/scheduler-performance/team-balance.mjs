import { enteredMonth, monthDays } from './month-model.mjs';
import { personIntervals, unionMinutes } from './shift-intervals.mjs';
import { dayDemand } from './demand-context.mjs';
import { assignedMembership, membershipAt, membershipMismatches, absenceKind, dayAbsence } from './team-model.mjs';
const overlap=(intervals,start,end)=>unionMinutes(intervals.map(([a,b])=>[Math.max(a,start),Math.min(b,end)]));
const empty=()=>({entered:0,excludedMinutes:0,excludedAssignmentDays:0,unknownDurationDays:0,scheduled:0,available:0,opening:0,openingAvailable:0,closing:0,closingAvailable:0,busy:0,busyAvailable:0,offDays:0,vacationDays:0,unavailableDays:0,unknownDays:0,unknownAvailabilityDays:0,unknownCapDays:0,unknownMembershipDays:0,mismatchDays:0,conflictDays:0,sharedMinutes:0,sharedAvailableMinutes:0,sharedMemberDays:0,memberDays:0});
const accumulate=(target,values)=>{for(const key of Object.keys(empty()))target[key]+=values[key]||0;};
export function teamBalance(planner,index,month) {
  const dates=monthDays(month),rows=enteredMonth(month,day=>planner.context(index,day)).map(row=>({...row,store:planner.context(index,row.day).store}));
  const store=planner.context(index,dates[0]).store;
  const demand=new Map(rows.filter(r=>r.state==='open').map(r=>[r.day,dayDemand(r.store.history,r.day)]));
  const scores=[...demand.values()].filter(d=>d.estimate).map(d=>(d.estimate.low+d.estimate.high)/2).sort((a,b)=>a-b);
  const median=scores.length? (scores[Math.floor((scores.length-1)/2)]+scores[Math.floor(scores.length/2)])/2:null;
  const highDays=new Set([...demand].filter(([,d])=>d.estimate&&(d.estimate.low+d.estimate.high)/2>median).map(([day])=>day));
  const groups=new Map([...store.teams.map(t=>[t.id,{id:t.id,name:t.name,...empty(),people:new Set()}]),['__none',{id:'__none',name:'No team',...empty(),people:new Set()}]]);
  const people=new Map(store.people.map(p=>[p.id,{id:p.id,name:p.name,...empty(),teamNames:new Set(),weeklyCap:p.maxHours}]));
  const totals=empty(),excludedAssignments=[],comparisonIssues={unknownAssignments:0,unknownAvailability:0,unknownCaps:0,membershipMismatches:0,unknownMembership:0,conflicts:0};let unknownStoreDays=0,unknownAssignments=0;
  const durationFor=(row,id)=>{
    const explicit=(row.record?.shifts||[]).some(s=>s.personId===id);
    const validHours=Number.isFinite(row.rule?.open)&&Number.isFinite(row.rule?.close)&&row.rule.close>row.rule.open;
    const intervals=explicit||validHours?personIntervals(row.record,id,row.rule):[];
    const known=intervals.filter(([a,b])=>Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b<=1440&&b>a);
    return {knownMinutes:unionMinutes(known),unknownDuration:!intervals.length||known.length!==intervals.length};
  };
  for(const row of rows){
    const open=row.state==='open';if(row.state==='unknown')unknownStoreDays++;
    const mismatches=new Set(membershipMismatches(row.store,row.record,row.day).map(m=>m.id));
    unknownAssignments+=row.ids.filter(id=>!row.store.people.some(p=>p.id===id)).length;
    for(const id of row.ids){
      const person=row.store.people.find(p=>p.id===id),membership=person?assignedMembership(row.store,row.record,row.day,id):null,current=person?membershipAt(row.store,id,row.day):null;
      const reasons=[...(row.conflicts[id]||[]),...(mismatches.has(id)?['Assignment team membership differs from current membership']:[]),...(person&&(membership.unknown||current.unknown)?['Team membership unknown']:[])];
      if(reasons.length){
        const duration=durationFor(row,id);excludedAssignments.push({day:row.day,id,name:person?.name||id,state:row.state,...duration,reasons});
        if(!person){totals.entered+=duration.knownMinutes;totals.excludedMinutes+=duration.knownMinutes;totals.excludedAssignmentDays++;totals.unknownDurationDays+=Number(duration.unknownDuration);totals.conflictDays++;}
      }
    }
    for(const p of new Map(row.store.people.map(p=>[p.id,p])).values()){
      if(!open&&!row.ids.includes(p.id)&&!(row.record?.off||[]).includes(p.id)&&!row.record?.unknownNotes?.[p.id])continue;
      const metric=empty(),intervals=personIntervals(row.record,p.id,row.rule),eligible=row.eligibleIds.includes(p.id),kind=absenceKind(row.record,p.id),weekday=new Date(row.day+'T12:00:00Z').getUTCDay();
      const known=kind!=='legacy-off'&&Array.isArray(p.off)&&Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start;
      const unavailable=!known||p.off.includes(weekday)||kind==='vacation'||kind==='unavailable';
      const available=!open||unavailable?[]:[[Math.max(row.rule.open,p.start)*60,Math.min(row.rule.close,p.end)*60]];
      const assigned=row.ids.includes(p.id),duration=assigned?durationFor(row,p.id):{knownMinutes:0,unknownDuration:false};
      const excluded=excludedAssignments.some(a=>a.day===row.day&&a.id===p.id);
      metric.entered=duration.knownMinutes;metric.unknownDurationDays=Number(duration.unknownDuration);metric.excludedMinutes=excluded?metric.entered:0;metric.excludedAssignmentDays=Number(excluded);metric.scheduled=eligible?metric.entered:0;metric.available=unionMinutes(available);
      metric.opening=eligible?overlap(intervals,row.rule.open*60,Math.min(row.rule.close,row.rule.open+1)*60):0;
      metric.openingAvailable=!open?0:overlap(available,row.rule.open*60,Math.min(row.rule.close,row.rule.open+1)*60);
      metric.closing=eligible?overlap(intervals,Math.max(row.rule.open,row.rule.close-1)*60,row.rule.close*60):0;
      metric.closingAvailable=!open?0:overlap(available,Math.max(row.rule.open,row.rule.close-1)*60,row.rule.close*60);
      metric.busy=highDays.has(row.day)?metric.scheduled:0;metric.busyAvailable=highDays.has(row.day)?metric.available:0;
      metric.offDays=['off','legacy-off'].includes(kind)?1:0;metric.vacationDays=kind==='vacation'?1:0;
      metric.unavailableDays=kind!=='vacation'&&(kind==='unavailable'||known&&p.off.includes(weekday))?1:0;
      metric.unknownDays=dayAbsence(row.store,row.record,row.day,p.id)==='unknown'?1:0;metric.unknownAvailabilityDays=known?0:1;metric.unknownCapDays=Number(!Number.isFinite(p.maxHours)||p.maxHours<0);
      metric.conflictDays=row.conflicts[p.id]?1:0;metric.mismatchDays=mismatches.has(p.id)?1:0;metric.memberDays=Number(open);
      const membership=assignedMembership(row.store,row.record,row.day,p.id),current=membershipAt(row.store,p.id,row.day);
      metric.unknownMembershipDays=membership.unknown||current.unknown?1:0;
      const ids=membership.teamIds.length?[...new Set(membership.teamIds)]:['__none'];metric.sharedMinutes=ids.length>1?metric.scheduled:0;metric.sharedAvailableMinutes=ids.length>1?metric.available:0;metric.sharedMemberDays=ids.length>1&&open?1:0;
      if(open&&(membership.teamIds.length||current.teamIds.length||membership.unknown||current.unknown)){
        comparisonIssues.unknownAssignments+=metric.unknownDays;comparisonIssues.unknownAvailability+=metric.unknownAvailabilityDays;comparisonIssues.unknownCaps+=metric.unknownCapDays;comparisonIssues.membershipMismatches+=metric.mismatchDays;comparisonIssues.unknownMembership+=metric.unknownMembershipDays;comparisonIssues.conflicts+=metric.conflictDays;
      }
      if(!open&&(membership.teamIds.length||current.teamIds.length||membership.unknown||current.unknown)){comparisonIssues.conflicts+=metric.conflictDays;comparisonIssues.membershipMismatches+=metric.mismatchDays;comparisonIssues.unknownMembership+=metric.unknownMembershipDays;}
      const person=people.get(p.id);if(!person)continue;
      for(const id of ids)person.teamNames.add(membership.unknown?'Unknown team':groups.get(id)?.name||'Unknown team');
      accumulate(person,metric);accumulate(totals,metric);
      // Do not mix an old assignment membership with a new availability denominator.
      if(metric.mismatchDays||membership.unknown||current.unknown)continue;
      for(const id of ids){const group=groups.get(id);if(group){group.people.add(p.id);accumulate(group,metric);}}
    }
  }
  const teams=[...groups.values()].filter(g=>g.people.size).map(g=>({...g,people:[...g.people],uniquePeople:g.people.size}));
  const comparisonTeams=teams.filter(t=>t.id!=='__none'&&t.available>0);
  const complete=unknownStoreDays===0&&unknownAssignments===0&&!Object.values(comparisonIssues).some(Boolean);
  const comparisonStatus=!complete?'incomplete':comparisonTeams.length<2?'insufficient-teams':'ready';
  const historyComplete=scores.length===rows.filter(r=>r.state==='open').length&&scores.length>0;
  const differences=[];
  if(comparisonStatus==='ready')for(const [metric,denominator,label] of [['scheduled','available','Scheduled hours'],['opening','openingAvailable','Opening band'],['closing','closingAvailable','Closing band'],['busy','busyAvailable','Higher-history days']]){
    if(metric==='busy'&&!historyComplete)continue;
    const eligible=comparisonTeams.filter(t=>t[denominator]>0).map(t=>({name:t.name,rate:t[metric]/t[denominator]})).sort((a,b)=>a.rate-b.rate);
    if(eligible.length<2)continue;
    const percentagePoints=(eligible.at(-1).rate-eligible[0].rate)*100;
    if(percentagePoints+1e-10>=20)differences.push({label,low:eligible[0].name,high:eligible.at(-1).name,percentagePoints});
  }
  return {comparisonStatus,comparisonIssues,historyComplete,comparisonTeams:comparisonTeams.map(t=>t.id),excludedAssignments,month,start:dates[0],end:dates.at(-1),teams,people:[...people.values()].map(p=>({...p,teamNames:[...p.teamNames]})),totals,differences,unknownStoreDays,unknownAssignments,comparableDays:scores.length,highDays:highDays.size,median,historyThrough:[...demand.values()].map(d=>d.historyThrough).filter(Boolean).sort().at(-1)||null,strengthAvailable:false};
}
