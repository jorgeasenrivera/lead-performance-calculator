import {displayTime,shiftProblem} from './shift-intervals.mjs';
// Show only explicit intervals verified for this store, date and timezone.
export function rosterHours(record,id,state,store,day,{strictHours=false}={}){
  const shifts=(record?.shifts||[]).filter(s=>s.personId===id);
  const valid=shifts.filter(s=>store&&day&&!shiftProblem(s,store,day,{strictHours})).sort((a,b)=>a.startMinute-b.startMinute);
  if(state!=='On'&&state!=='Conflict')return state;
  const times=valid.map(s=>`${displayTime(s.startMinute)}–${displayTime(s.endMinute)}`).join(', ');
  return [state,times||(shifts.length?'hours unverified':'hours not specified'),valid.length&&valid.length<shifts.length?'some hours unverified':''].filter(Boolean).join(' · ');
}
