import {rosterHours} from './roster-hours.mjs';
// Explicit entries only; conflicts and unknown context are visible rather than implied as confirmed.
export function shiftAgendaEntries(rows,store){
 return rows.flatMap(row=>[...new Set((row.record?.shifts||[]).map(s=>s.personId))].map(id=>{
  const person=store.people.find(p=>p.id===id),conflicts=row.conflicts?.[id]||[];
  const issues=[!person?'Unknown person':null,row.state==='closed'?'Store closed':row.state!=='open'?'Store hours unknown':null,!(row.record?.on||[]).includes(id)?'On status not confirmed':null,Object.hasOwn(row.record?.unknownNotes||{},id)?'Assignment unknown':null,Object.hasOwn(row.record?.absences||{},id)?'Absence recorded':null,...conflicts];
  return {day:row.day,id,name:person?.name||id,hours:rosterHours(row.record,id,'On',store,row.day,{strictHours:row.strictHours===true}).replace(/^On · /,''),issues:[...new Set(issues.filter(Boolean))]};
 }));
}
