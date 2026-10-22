import {validateDraft} from '../scripts/scheduler-performance/persistence/validate.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function addManualShift(draft,{day,personId,start,end,role,replaceAbsence=false}){
 const minute=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):NaN;
 const a=minute(start),b=minute(end);
 if(!Number.isInteger(a)||!Number.isInteger(b)||b<=a)fail('Choose increasing same-day start and end times.');
 const next=structuredClone(draft),record=next.overrides[day]||{on:[],off:[]};
 if(Array.isArray(record))fail('This legacy day needs review before editing.');
 if((record.off||[]).includes(personId)&&!replaceAbsence)fail('Confirm replacing the recorded absence first.');
 if(replaceAbsence){record.off=(record.off||[]).filter(id=>id!==personId);if(record.absences)delete record.absences[personId];}
 record.shifts=[...(record.shifts||[]),{storeId:next.storeId,personId,date:day,endDate:day,startMinute:a,endMinute:b,timezone:next.store.timezone,...(role?{role}:{})}];
 record.on=[...new Set([...(record.on||[]),personId])];
 if(record.unknownNotes)delete record.unknownNotes[personId];
 next.overrides[day]=record;
 if(!validateDraft(next,{storeId:next.storeId,month:next.month}).ok)fail('This shift does not match the saved month.');
 return next;
}
export function removeManualShift(draft,day,index){
 const next=structuredClone(draft),record=next.overrides[day];
 if(!record?.shifts?.[index])fail('Shift is unavailable.');
 const id=record.shifts[index].personId;record.shifts.splice(index,1);
 if(!record.shifts.some(s=>s.personId===id))record.on=(record.on||[]).filter(x=>x!==id);
 return next;
}
export function markManualOff(draft,day,id){
 const next=structuredClone(draft),record=next.overrides[day]||{on:[],off:[]};
 if(Array.isArray(record)||(record.shifts||[]).some(s=>s.personId===id))fail('Remove this person’s shifts explicitly before marking off.');
 record.on=(record.on||[]).filter(x=>x!==id);record.off=[...new Set([...(record.off||[]),id])];
 record.absences={...record.absences,[id]:record.absences?.[id]||{kind:'off'}};
 next.overrides[day]=record;
 if(!validateDraft(next,{storeId:next.storeId,month:next.month}).ok)fail('This day does not match the saved month.');
 return next;
}
