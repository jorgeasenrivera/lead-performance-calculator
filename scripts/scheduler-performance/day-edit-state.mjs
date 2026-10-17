// Presentation choices never expand an imported interval into a full-day shift.
export function intendedStatus(record,id) {
  const on=(record?.on||[]).includes(id)||(record?.shifts||[]).some(s=>s.personId===id),off=(record?.off||[]).includes(id);
  return on&&off?'':on?'On':off?'Off':'Unknown';
}
export function dayEditRecord(record,statuses,reasons,confirmedRemoval,knownIds) {
  const known=new Set(knownIds),on=(record?.on||[]).filter(id=>!known.has(id)),off=(record?.off||[]).filter(id=>!known.has(id));
  for(const id of known){const status=statuses[id];if(!['On','Off','Unknown'].includes(status))throw Error('Resolve the intended status before applying.');if(status==='On')on.push(id);if(status==='Off')off.push(id);}
  for(const shift of record?.shifts||[])if(known.has(shift.personId)&&!on.includes(shift.personId)&&!confirmedRemoval.includes(shift.personId))throw Error('Confirm removal of imported times before applying.');
  const absences=Object.fromEntries(off.map(id=>{const kind=reasons[id]||record?.absences?.[id]?.kind||'off';return[id,record?.absences?.[id]?.kind===kind?record.absences[id]:{kind,source:{kind:'manager day edit'}}];}));
  return {on,off,absences,generationLocks:[...known],teamSnapshot:record?.teamSnapshot,unknownNotes:Object.fromEntries(Object.entries(record?.unknownNotes||{}).filter(([id])=>!on.includes(id)&&!off.includes(id))),...(record?.shifts?{shifts:record.shifts.filter(s=>!known.has(s.personId)||on.includes(s.personId))}:{})};
}
