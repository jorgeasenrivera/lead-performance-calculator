import {validDate,shiftProblem,employmentProblem} from './shift-intervals.mjs';
import {membershipAt,sameTeams} from './team-model.mjs';
const clone=x=>structuredClone(x);
// A reviewed transfer covers every explicit interval for one person on a date.
export function planShiftTransfer({index,personId,from,to,mode,switchOff,sourceStatus,recurrenceChoice},context){
 if(!['move','copy'].includes(mode))throw Error('Choose Move or Copy.');
 if(!validDate(from)||!validDate(to)||from===to)throw Error('Choose two different valid dates.');
 if(mode==='move'){
  if(typeof switchOff!=='boolean')throw Error('Choose whether to switch days off.');
  if(switchOff && typeof recurrenceChoice!=='boolean')throw Error('Choose whether the new day off recurs.');
  if(switchOff && recurrenceChoice)throw Error('Recurring days off are not available yet. No changes have been applied.');
  if(!switchOff && !['off','unknown'].includes(sourceStatus))throw Error('Choose the original day status.');
 }
 const source=context(index,from),dest=context(index,to),p=source.store.people.find(x=>x.id===personId),q=dest.store.people.find(x=>x.id===personId);
 if(!p||!q||source.store.id!==dest.store.id)throw Error('Choose the same person and store.');
 for(const [person,date] of [[p,from],[q,to]]){const problem=employmentProblem(person,date);if(problem)throw Error(problem);}
 if((source.strictHours&&!source.store.timezone)||(dest.strictHours&&!dest.store.timezone))throw Error('Store timezone is unknown.');
 const original=source.record,shifts=(original?.shifts||[]).filter(x=>x.personId===personId);
 if(!original?.on?.includes(personId)||!shifts.length||original.off?.includes(personId)||Object.hasOwn(original.absences||{},personId)||Object.hasOwn(original.unknownNotes||{},personId))throw Error('Choose an explicit scheduled shift without conflicting source details.');
 const validGeneration=g=>g==null||(typeof g==='object'&&!Array.isArray(g)&&Array.isArray(g.unlocked)&&g.unlocked.every(id=>typeof id==='string'&&id.length>0)&&new Set(g.unlocked).size===g.unlocked.length&&g.signatures&&typeof g.signatures==='object'&&!Array.isArray(g.signatures)&&Object.entries(g.signatures).every(([id,value])=>id.length>0&&typeof value==='string')&&g.unlocked.every(id=>Object.hasOwn(g.signatures,id)));
 if(!validGeneration(original.generation))throw Error('Source generation metadata needs review.');
 if(shifts.some(s=>shiftProblem(s,source.store,from,{strictHours:source.strictHours===true})))throw Error('Source shift dates, timezone or times need review.');
 const target=dest.record;
 if(!validGeneration(target?.generation))throw Error('Destination generation metadata needs review.');
 const swapping=mode==='move'&&switchOff===true, targetOff=target?.off?.includes(personId), targetAbsence=target?.absences?.[personId];
 if(swapping&&(!targetOff || (Object.hasOwn(target.absences||{},personId) && (!targetAbsence || typeof targetAbsence!=='object' || Array.isArray(targetAbsence) || !['off','legacy-off'].includes(targetAbsence.kind)))))throw Error('Choose a destination with an explicit scheduled off day.');
 if(target?.on?.includes(personId)||(!swapping&&targetOff)||target?.shifts?.some(s=>s.personId===personId)||(!swapping&&target?.generationLocks?.includes(personId))||Object.hasOwn(target?.unknownNotes||{},personId)||(!swapping&&Object.hasOwn(target?.absences||{},personId))||(!swapping&&Object.hasOwn(target?.teamSnapshot||{},personId))||target?.generation?.unlocked?.includes(personId))throw Error('Destination already has a person-specific choice. Review it first.');
 const sourceCurrent=membershipAt(source.store,personId,from),sourceTeam=original.teamSnapshot?.[personId]||sourceCurrent,targetTeam=membershipAt(dest.store,personId,to);
 if(sourceTeam.unknown||sourceCurrent.unknown||targetTeam.unknown||!sameTeams(sourceTeam.teamIds,sourceCurrent.teamIds)||!sameTeams(sourceTeam.teamIds,targetTeam.teamIds))throw Error('Team membership differs or is unknown; review it first.');
 if(swapping && Object.hasOwn(target.teamSnapshot||{},personId) && (!target.teamSnapshot[personId] || !Array.isArray(target.teamSnapshot[personId].teamIds) || target.teamSnapshot[personId].unknown || !sameTeams(target.teamSnapshot[personId].teamIds,targetTeam.teamIds)))throw Error('Destination team membership needs review.');
 const moved=shifts.map(s=>({...clone(s),date:to,endDate:to,source:{...(clone(s.source)||{}),transfer:{mode,from,to,original:clone(s.source)||null}}}));
 if(moved.some(s=>shiftProblem(s,dest.store,to,{strictHours:dest.strictHours===true})))throw Error('Destination date, timezone or times need review.');
 const next=clone(target||{on:[],off:[]});if(swapping){next.off=next.off.filter(id=>id!==personId);if(next.absences)delete next.absences[personId];}next.on=[...new Set([...(next.on||[]),personId])];next.shifts=[...(next.shifts||[]),...moved];next.generationLocks=[...new Set([...(next.generationLocks||[]),personId])];next.teamSnapshot={...next.teamSnapshot,[personId]:{...clone(targetTeam),date:to}};
 const changes={[to]:next};
 if(mode==='move'){const cleared=clone(original);cleared.on=(cleared.on||[]).filter(id=>id!==personId);cleared.shifts=(cleared.shifts||[]).filter(s=>s.personId!==personId);cleared.generationLocks=[...new Set([...(cleared.generationLocks||[]),personId])];if(swapping||sourceStatus==='off'){cleared.off=[...new Set([...(cleared.off||[]),personId])];cleared.absences={...cleared.absences,[personId]:{kind:'off',source:{kind:'manager moved shift',from,to,original:clone(shifts),previousOff:swapping?clone(targetAbsence||{kind:'legacy-off'}):null,previousTeamSnapshot:swapping?clone(target.teamSnapshot?.[personId]||null):null}}};}else cleared.unknownNotes={...cleared.unknownNotes,[personId]:{source:{kind:'manager moved shift',from,to,original:clone(shifts)}}};changes[from]=cleared;}
 return {changes,summary:{index,personId,personName:p.name||personId,from,to,mode,intervals:shifts.map(s=>({startMinute:s.startMinute,endMinute:s.endMinute})),timezone:shifts[0].timezone,sourceAfter:mode==='move'?(swapping||sourceStatus==='off'?'Off':'Unknown'):'On',...(mode==='move'?{switchOff,recurrenceChoice:swapping?false:null}:{})}};
}
