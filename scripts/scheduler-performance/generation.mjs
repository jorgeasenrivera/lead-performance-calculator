import {monthDays,enteredMonth} from './month-model.mjs';
import {addDays,weekday,ruleFor} from '../scheduler-proposal/model.mjs';
import {personIntervals,unionMinutes,shiftProblem,stableLocalDate,storeTimezone,validDate} from './shift-intervals.mjs';
import {membershipAt,teamSnapshot} from './team-model.mjs';
import {importSnapshot} from './schedule-import.mjs';
import {dayDemand} from './demand-context.mjs';
const copy=x=>structuredClone(x), unique=x=>[...new Set(x)], week=day=>addDays(day,-((weekday(day)+6)%7));
const signature=(r,id)=>JSON.stringify({on:r?.on?.includes(id)||false,off:r?.off?.includes(id)||false,shifts:(r?.shifts||[]).filter(s=>s.personId===id),absence:r?.absences?.[id],unknown:r?.unknownNotes?.[id],team:r?.teamSnapshot?.[id]});
export function fictionalMarketSample(){
 const observations=[];let n=0;for(const date of monthDays('2026-09')){if(weekday(date)===0)continue;for(const comparable of ['sample-a','sample-b','sample-c'])observations.push({comparable,date,state:n<2?'unknown':'known',units:n<2?null:[5,6].includes(weekday(date))?24:8});n++;}
 return {source:'Fictional comparable-store sample A',period:'2026-09-01 to 2026-09-30',completeness:'72 of 78 daily observations; 3 synthetic same-market stores with similar opening hours',authorized:true,comparable:true,fixture:true,observations};
}
export function marketSignal(sample,before='2101-01-01'){
 if(!sample?.fixture||sample.authorized!==true||sample.comparable!==true||!sample.source||!sample.period||!Array.isArray(sample.observations)||sample.observations.length>1000)return null;
 if(new Set(sample.observations.map(r=>r.comparable+':'+r.date)).size!==sample.observations.length)return null;
 const known=sample.observations.filter(r=>r.state==='known'&&Number.isInteger(r.units)&&r.units>=0&&validDate(r.date)&&r.date<before);
 if(known.length<12||new Set(known.map(r=>r.comparable)).size<2)return null;
 const average=known.reduce((n,r)=>n+r.units,0)/known.length;
 const busyWeekdays=Array.from({length:7},(_,i)=>i).filter(w=>{const rows=known.filter(r=>weekday(r.date)===w);return rows.length>=4&&rows.reduce((n,r)=>n+r.units,0)/rows.length>average;});
 return {...copy(sample),busyWeekdays,completeness:`${known.length} of ${sample.observations.length} daily observations; ${new Set(known.map(r=>r.comparable)).size} fictional comparable stores`};
}
// Deliberately fictional, separate from any production eligibility or market feed.
export function fixtureGenerationPolicy(store) {
 return {confirmed:false,regenerate:true,mode:'mixed',shifts:[{id:'open-hours',fullDay:true}],requiredRoles:{sales:1},people:Object.fromEntries(store.people.map(p=>[p.id,{eligible:true,roles:['sales']}])),market:fictionalMarketSample(),useMarket:true};
}
export function generationInput(planner,index,month,policy) {
 const dates=monthDays(month);planner.get(index,month);const start=week(dates[0]),end=addDays(week(dates.at(-1)),6),stores={},records={};
 for(let day=start;day<=end;day=addDays(day,1)){const c=planner.context(index,day),key=day.slice(0,7);if(!stores[key]){stores[key]=copy(c.store);stores[key].history=[];}records[day]=copy(c.record);}
 const store=planner.get(index,month).store;
 stores[month].planningPolicy={people:copy(policy.people),requiredRoles:copy(policy.requiredRoles)};
 return {index,month,storeId:store.id,stores,records,history:copy(store.history),policy:copy(policy),snapshot:importSnapshot(planner,index)};
}
function validate(input){
 const {month,stores,policy:p}=input,store=stores[month];monthDays(month);
 if(!store||store.id!==input.storeId||!p?.confirmed)throw Error('Confirm the planning inputs before generating.');
 if(store.people.length>100||!store.people.length||new Set(store.people.map(x=>x.id)).size!==store.people.length)throw Error('Use 1 to 100 unique people in this preview.');
 if(!['individual','team','mixed'].includes(p.mode))throw Error('Choose teams, individuals or mixed.');
 if(!Array.isArray(p.shifts)||!p.shifts.length||p.shifts.length>4||p.shifts.some(s=>!s.fullDay&&(!Number.isInteger(s.startMinute)||!Number.isInteger(s.endMinute)||s.startMinute<0||s.endMinute>=1440||s.endMinute<=s.startMinute)))throw Error('Use up to four exact same-day shifts.');
 if(!p.requiredRoles||Object.keys(p.requiredRoles).length>3||Object.entries(p.requiredRoles).some(([r,n])=>!r||!Number.isInteger(n)||n<0||n>100))throw Error('Use up to three role minimums from 0 to 100.');
 if(input.history.length>10000)throw Error('History exceeds this preview envelope.');
 for(const s of Object.values(stores)){if(s.id!==input.storeId)throw Error('Store identity changed.');if(s.people.length>100||(s.teams||[]).length>100||(s.memberships||[]).length>1000)throw Error('Planning inputs exceed this preview envelope.');}
 if(Object.values(input.records).reduce((n,r)=>n+(r?.shifts?.length||0),0)>5000)throw Error('Retained shifts exceed this preview envelope.');
}
function cleanRecord(record,regenerate){
 const r=copy(record||{on:[],off:[]});r.on||=[];r.off||=[];r.shifts||=[];
 if(regenerate)for(const id of r.generation?.unlocked||[]){if(r.generationLocks?.includes(id)||signature(r,id)!==r.generation.signatures?.[id])continue;r.on=r.on.filter(x=>x!==id);r.off=r.off.filter(x=>x!==id);r.shifts=r.shifts.filter(s=>s.personId!==id);for(const key of ['absences','unknownNotes','teamSnapshot'])if(r[key])delete r[key][id];}
 delete r.generation;return r;
}
// Greedy adds fix a multi-role person's role before later deficits are known, so a day that
// can be covered may end with a role gap. This re-chooses roles for the shifts marked
// `choices` (generated this run, person holds two or more roles) and leaves every other shift
// as it is. It minimises missing role person-minutes, keeps the current assignment unless a
// strictly better one is found, and searches in a fixed order under a node cap, so the same
// input always gives the same answer. Role names compare by code unit, never by locale.
// Limits, stated plainly: this only re-chooses roles among people already on the day; it does
// not choose who works, so a role gap left after it is a limit of the greedy add step, not proof
// the day is infeasible. `maxNodes` applies to one call only (generateProposal may make up to
// three per day, each with a fresh budget), a capped call can report maxNodes + 1 nodes, and the
// search does not poll maxMs or count against maxChecks. It is not a global budget.
export function matchRoles(shifts,required,open,close,maxNodes=20000){
 const roles=Object.entries(required||{}).filter(([,n])=>n>0).sort(([x],[y])=>x<y?-1:x>y?1:0),index=new Map(roles.map(([role],i)=>[role,i]));
 const current=shifts.map(s=>s.role),mutable=shifts.map((s,i)=>s.choices?.length>1?i:-1).filter(i=>i>=0).sort((x,y)=>{const a=shifts[x],b=shifts[y];return a.key<b.key?-1:a.key>b.key?1:a.a-b.a||x-y;});
 if(!roles.length||!mutable.length)return {roles:current,changed:false,capped:false,nodes:0};
 const points=[...new Set([open,close,...shifts.flatMap(s=>[Math.max(open,s.a),Math.min(close,s.b)])])].filter(x=>x>=open&&x<=close).sort((a,b)=>a-b);
 const segments=points.slice(0,-1).map((start,i)=>({start,length:points[i+1]-start,count:roles.map(()=>0)}));
 const covers=shifts.map(s=>segments.map((g,i)=>s.a<=g.start&&s.b>=g.start+g.length?i:-1).filter(i=>i>=0));
 let missing=segments.reduce((n,g)=>n+g.length*roles.reduce((m,[,need])=>m+need,0),0);
 const place=(i,role,step)=>{const r=index.get(role);if(r===undefined)return;for(const s of covers[i]){const g=segments[s],before=Math.max(0,roles[r][1]-g.count[r]);g.count[r]+=step;missing+=(Math.max(0,roles[r][1]-g.count[r])-before)*g.length;}};
 shifts.forEach((s,i)=>{if(!s.choices||s.choices.length<2)place(i,s.role,1);});
 for(const i of mutable)place(i,shifts[i].role,1);
 let best=missing,bestRoles=current,nodes=0,capped=false,done=false;
 if(best===0)return {roles:current,changed:false,capped:false,nodes:0};
 for(const i of mutable)place(i,shifts[i].role,-1);
 // Equal shifts are interchangeable, so only non-decreasing choices are tried among them.
 const sameAs=mutable.map((i,k)=>{for(let j=k-1;j>=0;j--){const o=shifts[mutable[j]],s=shifts[i];if(o.a===s.a&&o.b===s.b&&JSON.stringify(o.choices)===JSON.stringify(s.choices))return j;}return -1;});
 const picked=[],walk=k=>{
  if(done||capped)return;
  if(++nodes>maxNodes){capped=true;return;}
  if(k===mutable.length){if(missing<best){best=missing;bestRoles=current.slice();mutable.forEach((i,j)=>{bestRoles[i]=shifts[i].choices[picked[j]];});if(best===0)done=true;}return;}
  const i=mutable[k],from=sameAs[k]>=0?picked[sameAs[k]]:0;
  for(let c=from;c<shifts[i].choices.length;c++){picked[k]=c;place(i,shifts[i].choices[c],1);walk(k+1);place(i,shifts[i].choices[c],-1);if(done||capped)return;}
 };
 walk(0);
 return {roles:bestRoles,changed:bestRoles!==current,capped:capped&&!done,nodes};
}
export function generateProposal(input,{maxChecks=50000,now=()=>performance.now(),maxMs=20000,maxRoleNodes=20000}={}) {
 validate(input);const began=now(),{month,policy,storeId}=input,dates=monthDays(month),store=input.stores[month],records=copy(input.records),changed={},days=[],weekly=new Map(),caps=new Map(),unknownWeeks=new Set(),used=new Map(),opportunity=new Map(),bands=new Map();let checks=0,limited=false,roleLimited=false;
 const context=day=>({store:input.stores[day.slice(0,7)],record:records[day]});
 const rule=day=>ruleFor(context(day).store.rules,day);
 for(const day of dates)records[day]=cleanRecord(records[day],policy.regenerate);
 // Seed full-week budgets from retained records, including both adjacent months.
 for(const [day,r] of Object.entries(records))for(const id of unique([...(r?.on||[]),...(r?.shifts||[]).map(s=>s.personId)])){
  const c=context(day),p=c.store.people.find(p=>p.id===id),rr=rule(day),key=week(day)+':'+id,intervals=personIntervals(r,id,rr),minutes=unionMinutes(intervals);
  weekly.set(key,(weekly.get(key)||0)+minutes);used.set(id,(used.get(id)||0)+(day.startsWith(month)?minutes:0));
  if(!p||!Number.isFinite(p.maxHours)||p.maxHours<0||!intervals.length||!rr||!Number.isFinite(rr.open)||!Number.isFinite(rr.close)||(r?.shifts||[]).filter(s=>s.personId===id).some(s=>shiftProblem(s,c.store,day)))unknownWeeks.add(key);
  else caps.set(key,Math.min(caps.get(key)??Infinity,p.maxHours*60));
 }
 const baseRows=enteredMonth(month,context),base=new Map(baseRows.map(r=>[r.day,r]));
 const demand=new Map(dates.map(day=>[day,dayDemand(input.history,day)]));
 const market=policy.useMarket?marketSignal(policy.market,dates[0]):null;
 const known=p=>Array.isArray(p.off)&&Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start&&p.start>=0&&p.end<=24&&Number.isFinite(p.maxHours)&&p.maxHours>=0&&p.maxHours<=168&&p.off.every(d=>Number.isInteger(d)&&d>=0&&d<=6);
 for(const day of dates){const r=base.get(day);if(r.state!=='open')continue;for(const p of store.people)if(known(p)&&!p.off.includes(weekday(day))&&!records[day]?.off.includes(p.id)&&!records[day]?.unknownNotes?.[p.id]&&policy.people[p.id]?.eligible===true)opportunity.set(p.id,(opportunity.get(p.id)||0)+Math.max(0,Math.min(p.end,r.rule.close)-Math.max(p.start,r.rule.open))*60);}
 const priority=day=>(demand.get(day).estimate?.high||0)+(market?.busyWeekdays?.includes(weekday(day))?1:0);
 const ordered=[...dates].sort((a,b)=>priority(b)-priority(a)||a.localeCompare(b));
 for(const day of ordered){
  const row=base.get(day),r=records[day],rr=row.rule,generated=new Set(),notes=[],lockedConflicts=[],made=new Set();let roleCapped=false;
  const retainedOwnership=policy.regenerate?[]:(input.records[day]?.generation?.unlocked||[]).filter(id=>!r.generationLocks?.includes(id)&&signature(r,id)===input.records[day].generation.signatures?.[id]);
  const members=new Map(store.people.map(p=>[p.id,p]));
  const retainedIds=unique([...r.on,...r.shifts.map(s=>s.personId)]);
  const validIds=retainedIds.filter(id=>{const role=policy.people[id],reasons=[...(row.conflicts[id]||[])];if(role?.eligible!==true)reasons.push('Store eligibility unknown or excluded');if(reasons.length)lockedConflicts.push({id,reasons});return !reasons.length;});
  const entries=()=>unique([...r.on,...r.shifts.map(s=>s.personId)]).filter(id=>validIds.includes(id)||generated.has(id)).flatMap(id=>personIntervals(r,id,rr).map(([a,b])=>{const shift=r.shifts.find(s=>s.personId===id&&s.startMinute===a&&s.endMinute===b);return {id,a,b,shift,role:shift?.role||(policy.people[id]?.roles?.length===1?policy.people[id].roles[0]:null)};}));
  // Only shifts this run created may change role; manual, imported and retained shifts never do.
  const rematch=()=>{
   const all=entries(),items=all.map(e=>({key:e.id,a:e.a,b:e.b,role:e.role,choices:e.shift&&made.has(e.shift)?[...new Set(policy.people[e.id]?.roles||[])].sort():null}));
   // maxRoleNodes is per call, and up to three calls per day; it is separate from maxChecks and maxMs.
   const result=matchRoles(items,policy.requiredRoles,rr.open*60,rr.close*60,maxRoleNodes);
   if(result.capped)roleCapped=true;
   if(!result.changed)return false;
   all.forEach((e,i)=>{if(items[i].choices&&result.roles[i]!==e.role)e.shift.role=result.roles[i];});
   return true;
  };
  const segments=()=>{if(row.state!=='open')return [];const all=entries(),points=unique([rr.open*60,rr.close*60,...all.flatMap(e=>[Math.max(rr.open*60,e.a),Math.min(rr.close*60,e.b)])]).filter(x=>x>=rr.open*60&&x<=rr.close*60).sort((a,b)=>a-b);return points.slice(0,-1).map((a,i)=>{const b=points[i+1],active=all.filter(e=>e.a<=a&&e.b>=b);return {start:a,end:b,count:unique(active.map(e=>e.id)).length,roles:Object.fromEntries(Object.keys(policy.requiredRoles).map(role=>[role,unique(active.filter(e=>e.role===role).map(e=>e.id)).length]))};});};
  const gaps=()=>segments().flatMap(s=>[...(s.count<rr.minimum?[{start:s.start,end:s.end,role:null,missing:rr.minimum-s.count}]:[]),...Object.entries(policy.requiredRoles).filter(([role,n])=>(s.roles[role]||0)<n).map(([role,n])=>({start:s.start,end:s.end,role,missing:n-(s.roles[role]||0)}))]);
  if(row.state==='open'&&stableLocalDate(day,storeTimezone(store))){
   const available=(id,a,b)=>{const p=members.get(id),e=policy.people[id],key=week(day)+':'+id,intervals=personIntervals(r,id,rr);return p&&known(p)&&!retainedIds.includes(id)&&e?.eligible===true&&Array.isArray(e.roles)&&!p.off.includes(weekday(day))&&!r.off.includes(id)&&!r.unknownNotes?.[id]&&!r.generationLocks?.includes(id)&&a>=p.start*60&&b<=p.end*60&&a>=rr.open*60&&b<=rr.close*60&&!unknownWeeks.has(key)&&!intervals.some(([x,y])=>a<y&&b>x)&&(weekly.get(key)||0)+b-a<=Math.min(caps.get(key)??Infinity,p.maxHours*60);};
   const memberships=new Map(store.people.map(p=>[p.id,membershipAt(store,p.id,day)]));
   const units=policy.mode==='individual'?[]:(store.teams||[]).map(t=>store.people.filter(p=>memberships.get(p.id).teamIds.includes(t.id)).map(p=>p.id)).filter(ids=>ids.length&&ids.every(id=>!memberships.get(id).unknown));
   if(policy.mode!=='team')units.push(...store.people.map(p=>[p.id]));
   const fill=()=>{let deficits=gaps();
   while(deficits.length&&!limited){
    let best=null;
    candidates: for(const ids of units)for(const template of policy.shifts){
     if(checks>=maxChecks||now()-began>maxMs){limited=true;break candidates;}
     checks++;
     const a=template.fullDay?rr.open*60:template.startMinute,b=template.fullDay?rr.close*60:template.endMinute;
     if(!Number.isInteger(a)||!Number.isInteger(b)||b>=1440||!ids.every(id=>available(id,a,b)))continue;
     const additions=ids.map(id=>{const roles=policy.people[id].roles;const role=[...roles].sort((x,y)=>deficits.filter(d=>d.role===y&&d.start<b&&d.end>a).reduce((n,d)=>n+(Math.min(b,d.end)-Math.max(a,d.start))*d.missing,0)-deficits.filter(d=>d.role===x&&d.start<b&&d.end>a).reduce((n,d)=>n+(Math.min(b,d.end)-Math.max(a,d.start))*d.missing,0)||x.localeCompare(y))[0];return {id,role};});
     const gain=deficits.reduce((n,d)=>n+Math.max(0,Math.min(b,d.end)-Math.max(a,d.start))*Math.min(d.missing,additions.filter(x=>!d.role||x.role===d.role).length),0);
     if(!gain)continue;
     const balance=ids.reduce((n,id)=>n+(used.get(id)||0)/Math.max(1,opportunity.get(id)||0)+(bands.get(id)||0)/1000,0)/ids.length;
     const candidate={ids,a,b,additions,gain,score:gain/(ids.length*(b-a)),balance,key:ids.join('|')+':'+template.id};
     if(!best||candidate.score>best.score||candidate.score===best.score&&(balance<best.balance||balance===best.balance&&candidate.key<best.key))best=candidate;
    }
    if(limited||!best)break;
    for(const {id,role} of best.additions){const key=week(day)+':'+id,p=members.get(id);r.on=unique([...r.on,id]);const shift={storeId,personId:id,date:day,endDate:day,startMinute:best.a,endMinute:best.b,timezone:storeTimezone(store),role,source:{kind:'generated preview',file:'Generated local proposal'}};r.shifts.push(shift);made.add(shift);generated.add(id);weekly.set(key,(weekly.get(key)||0)+best.b-best.a);caps.set(key,Math.min(caps.get(key)??Infinity,p.maxHours*60));used.set(id,(used.get(id)||0)+best.b-best.a);bands.set(id,(bands.get(id)||0)+Number(best.a===rr.open*60)+Number(best.b===rr.close*60));}
    deficits=gaps();
   }};
   fill();
   // A role gap may only mean an earlier multi-role choice was the wrong one; re-choose, then top up.
   for(let pass=0;pass<3&&!limited&&gaps().some(d=>d.role)&&rematch();pass++)fill();
  } else if(row.state==='open')notes.push('DST-change date unsupported; enter and review separately.');
  if(row.state==='unknown')notes.push('Store hours or holiday status unknown.');
  // A capped role search only counts as a stop when a role gap is still open; it never halts later days.
  const roleStopped=roleCapped&&gaps().some(d=>d.role);if(roleStopped)roleLimited=true;
  if(limited||roleStopped)notes.push('Bounded search stopped; incomplete proposal.');
  // An unselected known eligible person is a generated off choice, never a substitute for unknown availability.
  if(row.state==='open'&&!limited)for(const p of store.people)if(!r.on.includes(p.id)&&!r.off.includes(p.id)&&!r.unknownNotes?.[p.id]&&!r.generationLocks?.includes(p.id)&&known(p)&&policy.people[p.id]?.eligible===true){r.off.push(p.id);r.absences={...r.absences,[p.id]:{kind:p.off.includes(weekday(day))?'unavailable':'off',source:{kind:'generated preview'}}};generated.add(p.id);}
  r.teamSnapshot={...r.teamSnapshot,...teamSnapshot(store,day,[...generated])};
  const owned=unique([...retainedOwnership,...generated]);
  r.generation={unlocked:owned,signatures:Object.fromEntries(owned.map(id=>[id,signature(r,id)]))};
  const actualGaps=gaps();
  const extraTarget=rr?.useCapacity&&rr.capacity>0&&demand.get(day).estimate?Math.max(rr.minimum,Math.ceil(demand.get(day).estimate.high/rr.capacity)):null;
  if(market?.busyWeekdays?.includes(weekday(day)))notes.push('Fictional comparable-store sample suggests higher day-level coverage; no hourly peak inferred.');
  if(extraTarget!==null&&extraTarget>rr.minimum)notes.push(`Entered capacity calibration suggests ${extraTarget} people for the day; generation meets hard minimums first. Review this soft suggestion.`);
  else if(market?.busyWeekdays?.includes(weekday(day)))notes.push('No capacity calibration enabled: no numeric extra headcount recommended.');
  notes.push('Greedy minimum coverage first, then lower scheduled/available time and opening/closing opportunities; not an optimal or fairness guarantee.');
  const unknown=(row.state==='open'?store.people:[]).filter(p=>!known(p)||policy.people[p.id]?.eligible===undefined||!Array.isArray(policy.people[p.id]?.roles)||r.unknownNotes?.[p.id]||r.generationLocks?.includes(p.id)&&!r.on.includes(p.id)&&!r.off.includes(p.id)).map(p=>p.id);
  days.push({day,state:row.state,segments:segments(),gaps:actualGaps,conflicts:lockedConflicts,unknown,notes,added:[...generated].filter(id=>r.on.includes(id)),preserved:retainedIds,removed:(input.records[day]?.on||[]).filter(id=>!r.on.includes(id)),changed:JSON.stringify(r)!==JSON.stringify(input.records[day])});
  changed[day]=r;
 }
 const finalRows=enteredMonth(month,context);for(const row of finalRows){const d=days.find(d=>d.day===row.day);for(const [id,reasons] of Object.entries(row.conflicts))if(!d.conflicts.some(c=>c.id===id))d.conflicts.push({id,reasons});}
 const incomplete=limited||roleLimited||days.some(d=>d.gaps.length||d.conflicts.length||d.unknown.length||d.state==='unknown'||d.notes.some(n=>n.startsWith('DST-')));
 return {month,index:input.index,storeId,snapshot:input.snapshot,policy:copy(policy),records:changed,days:days.sort((a,b)=>a.day.localeCompare(b.day)),status:incomplete?'incomplete':'covered',limited:limited||roleLimited,checks,computeMs:now()-began,market,applied:false};
}
export function applyProposal(planner,proposal){
 if(proposal.applied)throw Error('This proposal was already applied.');
 if(importSnapshot(planner,proposal.index)!==proposal.snapshot)throw Error('The draft changed. Generate and review a new proposal.');
 // Only generator-owned proposal objects are passed by the UI. Preflight every record before mutation.
 const days=monthDays(proposal.month);if(days.some(d=>!proposal.records[d])||planner.get(proposal.index,proposal.month).store.id!==proposal.storeId)throw Error('Incomplete proposal payload.');
 const batch=copy(proposal.records);for(const day of days){const r=batch[day];if(!Array.isArray(r.on)||!Array.isArray(r.off)||!Array.isArray(r.shifts))throw Error('Invalid proposal record.');}
 for(const day of days)planner.setAssignment(proposal.index,day,batch[day]);
 planner.get(proposal.index,proposal.month).store.planningPolicy={people:copy(proposal.policy.people),requiredRoles:copy(proposal.policy.requiredRoles)};
 planner.get(proposal.index,proposal.month).generationPolicy=copy(proposal.policy);proposal.applied=true;return days.length;
}
