import {dayAbsence} from './team-model.mjs';

// Preserve explicit contradictions and unknowns rather than inferring a shift.
export function selectedScheduleRows(row,store){
 const record=row.record;if(!record)return [];
 const people=store.people||[], referenced=[...(record.on||[]),...(record.off||[]),...(record.shifts||[]).map(s=>s.personId),...Object.keys(record.unknownNotes||{}),...Object.keys(record.absences||{})];
 const ids=[...new Set([...people.map(p=>p.id),...referenced])];
 return ids.map(id=>{
  const on=(record.on||[]).includes(id),shift=(record.shifts||[]).some(s=>s.personId===id),off=(record.off||[]).includes(id),unknown=Object.hasOwn(record.unknownNotes||{},id),hasAbsence=Object.hasOwn(record.absences||{},id),absence=dayAbsence(store,record,row.day,id),issues=row.conflicts?.[id]||[];
  const malformedAbsence=hasAbsence&&!['off','legacy-off','vacation','unavailable'].includes(record.absences[id]?.kind);
  const contradiction=malformedAbsence||(hasAbsence&&!off)||(on||shift)&&(off||unknown||hasAbsence||(absence&&absence!=='unknown')||row.state==='closed');
  const state=contradiction||issues.length?'Conflict':on?'On':shift?'Unconfirmed':absence==='vacation'?'Vacation':absence==='unavailable'?'Unavailable':absence==='legacy-off'?'Off, reason unknown':off||absence==='off'?'Off':'Unknown';
  return {id,name:people.find(p=>p.id===id)?.name||`Unknown person (${id})`,state,hasShift:shift,issues};
 });
}

// The existing entered minimum is the only warning threshold. Incomplete rosters
// cannot prove low staffing, so unknown/conflicting people stay Unconfirmed.
export function verifiedLow(row,summary){return row.state==='open'&&Boolean(row.record)&&!summary.unknown.length&&!summary.conflicting.length&&!Object.keys(row.conflicts||{}).length&&row.minimumCoverage<row.required;}
export function quickRosterGroups(people,summary,record){
 const names=new Map(people.map(p=>[p.id,p.name]));
 const unknownIds=[...new Set([...(record?.on||[]),...(record?.shifts||[]).map(s=>s.personId)])].filter(id=>!names.has(id));for(const id of unknownIds)names.set(id,`Unknown person (${id})`);
 const states=[['On',summary.on],['Off',[...summary.off,...summary.unavailable]],['Unconfirmed',[...summary.conflicting,...summary.unknown,...unknownIds]]];
 return states.map(([label,ids])=>{const wanted=new Set(ids),seen=new Set(),items=[];
  const add=(id,team)=>{if(!wanted.has(id)||seen.has(id)||!names.has(id))return;seen.add(id);items.push({id,name:names.get(id),team,note:label==='Unconfirmed'?(summary.conflicting.includes(id)?'conflict':'unknown'):summary.vacation?.includes(id)?'Vacation':summary.unavailable?.includes(id)?'Unavailable':''});};
  for(const t of summary.teams)for(const id of t.ids)add(id,t.name);
  for(const id of wanted)add(id,null);
  return {label,items};
 });
}

// A low-coverage count with unknown people is not confirmed low staffing.
export function calendarWarning(row,summary){
 if(summary.status==='Schedule conflict'||summary.conflicting.length||Object.keys(row.conflicts||{}).length)return {kind:'needs',label:'Schedule conflict'};
 if(summary.status==='Needs schedule')return {kind:'needs',label:'Needs schedule'};
 if(summary.status==='Low staff')return verifiedLow(row,summary)?{kind:'low',label:'Low staff'}:{kind:'needs',label:'Coverage unconfirmed'};
 return null;
}
