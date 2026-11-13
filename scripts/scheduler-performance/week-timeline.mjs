import {shiftProblem} from './shift-intervals.mjs';
import {shiftAgendaEntries} from './shift-agenda.mjs';
import {assignedMembership} from './team-model.mjs';
export function describeTimelineTeam(store,record,day,id){
 const membership=assignedMembership(store,record,day,id),ids=Array.isArray(membership?.teamIds)?[...new Set(membership.teamIds)].sort():null,teams=store.teams||[];
 if(!ids||membership.unknown||ids.some(id=>!teams.some(t=>t.id===id)))return {teamLabel:'Team unconfirmed',teamTone:'neutral'};
 if(!ids.length)return {teamLabel:'No team',teamTone:'neutral'};
 const labels=ids.map(id=>teams.find(t=>t.id===id).name||id);if(ids.length>1)return {teamLabel:labels.join(' / '),teamTone:'neutral'};
 const order=teams.map(t=>t.id).sort(),slot=order.indexOf(ids[0])%5;return {teamLabel:labels[0],teamTone:String(slot)};
}
// Disjoint connected clusters share a lane count; touching endpoints do not overlap.
export function placeIntervals(intervals){
 const ordered=intervals.map((v,i)=>({...v,_order:i})).sort((a,b)=>a.start-b.start||a.end-b.end||a._order-b._order);let cluster=[],end=-1;
 const finish=()=>{if(!cluster.length)return;const lanes=[];for(const v of cluster){let n=lanes.findIndex(x=>x<=v.start);if(n<0)n=lanes.length;lanes[n]=v.end;v.lane=n;}for(const v of cluster)v.lanes=lanes.length;cluster=[];end=-1;};
 for(const v of ordered){if(v.start>=end)finish();cluster.push(v);end=Math.max(end,v.end);}finish();return ordered;
}
export function projectWeekTimeline(weekRows){
 return weekRows.map(({day,row,store})=>{
  if(!row||!store)return {day,state:'outside',events:[],unverified:[],off:[],unknown:[]};
  const entries=shiftAgendaEntries([row],store).map(e=>({...e,...describeTimelineTeam(store,row.record,day,e.id)})),events=[],unverified=[];
  for(const e of entries){const shifts=(row.record?.shifts||[]).filter(x=>x.personId===e.id);let invalid=false;for(const shift of shifts){const problem=shiftProblem(shift,store,day,{strictHours:row.strictHours===true});if(problem){invalid=true;continue;}events.push({day,id:e.id,name:e.name,start:shift.startMinute,end:shift.endMinute,issues:e.issues,teamLabel:e.teamLabel,teamTone:e.teamTone,intervalCount:shifts.length});}if(invalid)unverified.push(e);}
  const name=id=>store.people.find(p=>p.id===id)?.name||id;
  const off=(row.record?.off||[]).map(name),unknown=Object.keys(row.record?.unknownNotes||{}).map(name);
  return {day,state:row.state,events:placeIntervals(events),unverified,off,unknown,noRecord:!row.record};
 });
}

// Compact month marks represent verified intervals, including each split part.
// Assignments with missing or invalid times remain separate from those marks.
export function projectMonthSchedule(row,store){
 const projected=projectWeekTimeline([{day:row.day,row,store}])[0];
 const record=row.record,validIds=new Set(projected.events.map(e=>e.id));
 const untimed=[...new Set((record?.on||[]).filter(id=>!validIds.has(id)))];
 const unverified=[...new Set([...projected.unverified.map(e=>e.id),...untimed])];
 return {events:projected.events,unverified,recorded:Boolean(record),state:row.state};
}
