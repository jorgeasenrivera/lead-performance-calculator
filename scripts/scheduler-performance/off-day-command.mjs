import {validDate,stableLocalDate,storeTimezone} from './shift-intervals.mjs';
import {absenceKind,membershipAt} from './team-model.mjs';
const copy=value=>structuredClone(value);
const working=(record,id)=>(record?.on||[]).includes(id)||(record?.shifts||[]).some(s=>s.personId===id);
export function planOffDay({index,personId,from,to,mode},context) {
 if(!['move','copy'].includes(mode))throw Error('Choose Move or Copy.');
 if(!validDate(from)||!validDate(to)||from===to)throw Error('Choose two different valid dates.');
 const source=context(index,from),destination=context(index,to);
 const person=source.store.people.find(p=>p.id===personId),target=destination.store.people.find(p=>p.id===personId);
 if(!person||!target||source.store.id!==destination.store.id)throw Error('Choose the same person in this store on both dates.');
 if([source,destination].some(c=>storeTimezone(c.store)!=='America/New_York')||!stableLocalDate(from,storeTimezone(source.store))||!stableLocalDate(to,storeTimezone(destination.store)))throw Error('This preview does not support these timezone or DST-change dates.');
 const kind=absenceKind(source.record,personId);
 if(!['off','legacy-off'].includes(kind)||working(source.record,personId))throw Error('Choose an explicit off-day without a conflicting work assignment. Vacation and recurring unavailability cannot be moved or copied here.');
 const recurring=(p,day)=>!Array.isArray(p.off)||p.off.includes(new Date(day+'T12:00:00Z').getUTCDay());
 if(recurring(person,from)||recurring(target,to))throw Error('Recurring availability is unknown or unavailable on one of these dates. Review People first.');
 const r=destination.record;
 if(working(r,personId)||r?.off?.includes(personId)||r?.generationLocks?.includes(personId))throw Error('The destination has work, an absence or a protected manual choice. Review that day first.');
 const absence=copy(source.record.absences?.[personId]||{kind:'off',source:{kind:'entered off-day'}});
 const provenance={...copy(absence.source||{}),kind:`manager off-day ${mode}`,transfer:{mode,from,to,personId,original:copy(absence.source||{}),priorUnknown:copy(r?.unknownNotes?.[personId]||null)}};
 const next=copy(r||{on:[],off:[]});next.off=[...(next.off||[]),personId];next.absences={...next.absences,[personId]:{...absence,kind,source:provenance}};
 next.generationLocks=[...new Set([...(next.generationLocks||[]),personId])];if(next.unknownNotes)delete next.unknownNotes[personId];
 let membership=membershipAt(destination.store,personId,to);
 if(source.record.teamSnapshot?.[personId]?.unknown)membership={storeId:destination.store.id,personId,teamIds:[],unknown:true,from:to,to,source:{kind:'Unknown historical membership retained'}};
 next.teamSnapshot={...next.teamSnapshot,[personId]:{...membership,date:to}};
 const changes={[to]:next};
 if(mode==='move'){
  const cleared=copy(source.record);cleared.off=cleared.off.filter(id=>id!==personId);if(cleared.absences)delete cleared.absences[personId];
  cleared.unknownNotes={...cleared.unknownNotes,[personId]:{source:{kind:'manager moved off-day',from,to,original:absence}}};
  cleared.generationLocks=[...new Set([...(cleared.generationLocks||[]),personId])];changes[from]=cleared;
 }
 return {changes,summary:{index,personId,personName:person.name,from,to,mode,kind,unknownMembership:Boolean(membership.unknown),teamIds:membership.teamIds,sourceAfter:mode==='move'?'Unknown':'Off'}};
}
