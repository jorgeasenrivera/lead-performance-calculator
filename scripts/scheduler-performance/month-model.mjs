import {planShiftTransfer} from './shift-transfer.mjs';
import {planOffDay} from './off-day-command.mjs';
import { nameKey, reservedTeamName } from './name-key.mjs';
import { seedTeams, teamSnapshot, validateMembership } from "./team-model.mjs";
import { personIntervals, unionMinutes, coverageSegments, shiftProblem, stableLocalDate, storeTimezone, validDate, employmentProblem } from "./shift-intervals.mjs";
import {
  addDays,
  weekday,
  ruleFor,
  forecast,
} from "../scheduler-proposal/model.mjs";
export function validMonth(month) {
  return (
    typeof month === "string" &&
    /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month) &&
    month >= "2014-01" &&
    month <= "2100-12"
  );
}
export function monthDays(month) {
  if (!validMonth(month))
    throw Error("Choose a month from January 2014 to December 2100.");
  const [year, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}
export function shiftMonth(month, delta) {
  monthDays(month);
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  const result = date.toISOString().slice(0, 7);
  if (!validMonth(result)) throw Error("Month outside prototype range.");
  return result;
}
// A draft owns its settings and overrides. Viewing another month never mutates it.
export function createPlanner(stores, { assignmentForDay = () => null, explicitAssignmentForDay = () => null, strictHours = false, requireMaterializedSources = false } = {}) {
  if (typeof assignmentForDay !== "function" || typeof explicitAssignmentForDay !== "function") throw Error("Assignment resolvers must be functions.");
  if (strictHours && stores.some(s => !s || !Array.isArray(s.teams) || !Array.isArray(s.memberships))) throw Error("Strict planner requires explicit teams and memberships.");
  if (strictHours && (stores.some(s=>typeof s.id!=="string" || !s.id.trim() || s.id!==s.id.trim()) || new Set(stores.map(s=>s.id)).size!==stores.length)) throw Error("Strict planner requires unique nonempty store identifiers.");
  const drafts = new Map();
  const teamState = stores.map(seedTeams), initialTeams = structuredClone(teamState);
  let revision = 0;
  const key = (index, month) => `${index}:${month}`;
  // The draft bridge keeps, per month, what is saved (or pristine) so "unsaved" means "differs from that", never "was ever edited".
  const baselines = new Map(), acked = new Map(), seen = new Map(), groups = [], listeners = new Set();
  const issued = new WeakMap();
  let seq = 0, changeToken = 0;
  const get = (index, month) => {
    monthDays(month);
    if (!stores[index]) throw Error("Unknown store");
    const k = key(index, month);
    if (!drafts.has(k)) {
      drafts.set(k, {
        store: {
          ...stores[index],
          ...teamState[index],
          timezone: strictHours ? stores[index].timezone : storeTimezone(stores[index]),
          people: structuredClone(stores[index].people),
          rules: structuredClone(stores[index].rules),
        },
        overrides: {},
        accepted: false,
        reviewFingerprint: null,
      });
      if (!baselines.has(k)) { baselines.set(k, canonOf(k)); seen.set(k, baselines.get(k)); }
    }
    return drafts.get(k);
  };
  const resolve = (index, day) => drafts.get(key(index, day.slice(0, 7))) || { store: {...stores[index],...teamState[index]}, overrides: {} };
  const assertRecordScope = (value, index, day) => {
    if (!strictHours) return;
    if (!value || typeof value !== "object" || Array.isArray(value) || (Object.hasOwn(value,"storeId") && value.storeId !== stores[index].id) || (Object.hasOwn(value,"date") && value.date !== day) || (Object.hasOwn(value,"month") && value.month !== day.slice(0,7))) throw Error("Assignment record scope mismatch.");
    for (const key of ["on","off"]) if (Object.hasOwn(value,key) && (!Array.isArray(value[key]) || value[key].some(id=>typeof id!=="string" || !id) || new Set(value[key]).size!==value[key].length)) throw Error("Assignment record shape invalid.");
    if (Object.hasOwn(value,"shifts") && (!Array.isArray(value.shifts) || value.shifts.some(shift=>!shift || typeof shift!=="object" || Array.isArray(shift) || typeof shift.personId!=="string" || !shift.personId))) throw Error("Assignment record shape invalid.");
    if ((value.shifts||[]).some(shift=>(Object.hasOwn(shift,"storeId") && shift.storeId!==stores[index].id) || (Object.hasOwn(shift,"date") && shift.date!==day) || (Object.hasOwn(shift,"month") && shift.month!==day.slice(0,7)))) throw Error("Assignment shift scope mismatch.");
    for (const key of ["unknownNotes","absences"]) if (Object.hasOwn(value,key) && (!value[key] || typeof value[key]!=="object" || Array.isArray(value[key]))) throw Error("Assignment record shape invalid.");
    if (Object.hasOwn(value,"teamSnapshot")) {
      const snapshot=value.teamSnapshot;
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw Error("Assignment team scope mismatch.");
      for (const [id,team] of Object.entries(snapshot)) if (!team || typeof team !== "object" || Array.isArray(team) || (Object.hasOwn(team,"storeId") && team.storeId !== stores[index].id) || (Object.hasOwn(team,"personId") && team.personId !== id) || (Object.hasOwn(team,"date") && team.date !== day) || (Object.hasOwn(team,"from") && (!validDate(team.from) || team.from > day)) || (Object.hasOwn(team,"to") && (!validDate(team.to) || team.to < day))) throw Error("Assignment team scope mismatch.");
    }
  };
  // Explicit sources alone can be materialized. Never turn implicit preview
  // defaults or a missing source into persisted assignment facts.
  const explicitRecord = (index,day) => {
    const bound=explicitAssignmentForDay(day,index);
    if(bound==null)return null;
    if(typeof bound!=='object'||Array.isArray(bound)||bound.storeId!==stores[index].id||bound.day!==day||!bound.record||typeof bound.record!=='object'||Array.isArray(bound.record)||(Object.hasOwn(bound.record,'storeId')&&bound.record.storeId!==bound.storeId)||(Object.hasOwn(bound.record,'date')&&bound.record.date!==day)||(Object.hasOwn(bound.record,'month')&&bound.record.month!==day.slice(0,7)))throw Error('Explicit assignment scope mismatch.');
    assertRecordScope(bound.record,index,day);
    const copy=structuredClone(bound.record);
    if(!Object.hasOwn(copy,'teamSnapshot'))copy.teamSnapshot=teamSnapshot({...stores[index],...initialTeams[index]},day,[...(copy.on||[]),...(copy.off||[])]);
    return copy;
  };
  const record = (index, day) => {
    const d = resolve(index, day);
    if (Object.hasOwn(d.overrides, day)) {
      const value = d.overrides[day];
      assertRecordScope(value, index, day);
      return Array.isArray(value) ? { on: value, off: [] } : value;
    }
    const rule = ruleFor(d.store.rules, day);
    const state = rule && (rule.holidays[day] || (rule.closedDays.includes(weekday(day)) ? "closed" : "open"));
    // Explicit, store/date-bound facts may exist even on closed or unknown-hours days.
    // Preview-generated defaults remain restricted to open days.
    const explicit=explicitRecord(index,day);if(explicit!==null)return explicit;
    const value = !strictHours && state === "open" ? assignmentForDay(day, index) : null;
    if (!value) return null;
    assertRecordScope(value, index, day);
    const copy = structuredClone(value);
    // Existing assignment snapshots are historical facts, not current team membership.
    if (!Object.hasOwn(copy, "teamSnapshot")) copy.teamSnapshot = teamSnapshot({...stores[index],...initialTeams[index]},day,[...(value.on||[]),...(value.off||[])]);
    return copy;
  };
  const rows = (index, month) => {
    get(index, month);
    return enteredMonth(month, day => ({ ...resolve(index, day), record: record(index, day), strictHours }));
  };
  const setAssignment = (index, day, value) => {
    assertRecordScope(value, index, day);
    const d = get(index, day.slice(0, 7));
    const prior=record(index,day);
    const copy=structuredClone(value);
    if(!Array.isArray(copy)) {
      if(prior?.unknownNotes&&!copy.unknownNotes)copy.unknownNotes=Object.fromEntries(Object.entries(prior.unknownNotes).filter(([id])=>!(copy.on||[]).includes(id)&&!(copy.off||[]).includes(id)));
      if(prior?.absences||copy.absences)copy.absences=Object.fromEntries((copy.off||[]).map(id=>[id,copy.absences?.[id]||prior?.absences?.[id]||{kind:'off',source:{kind:'manager day edit'}}]));
      const ids=[...new Set([...(copy.on||[]),...(copy.off||[]),...Object.keys(copy.unknownNotes||{})])];
      copy.teamSnapshot=Object.fromEntries(ids.map(id=>[id,copy.teamSnapshot?.[id]||prior?.teamSnapshot?.[id]||teamSnapshot(d.store,day,[id])[id]]));
    }
    d.overrides[day] = copy;
    revision++;
    d.accepted = false;
    d.reviewFingerprint = null;
  };
  const reset = (index, month) => {
    drafts.delete(key(index, month));
    revision++;
    return get(index, month);
  };
  const setMembership = (index,entry) => {
    const store={...stores[index],...teamState[index]};
    const next=validateMembership(store,entry);teamState[index].memberships.push(next);revision++;
    for(const [k,d] of drafts)if(k.startsWith(index+':')){d.accepted=false;d.reviewFingerprint=null;}
  };
  const addTeam = (index,name) => {
    name=String(name).trim();if(!nameKey(name)||name.length>60||reservedTeamName(name)||teamState[index].teams.some(t=>nameKey(t.name)===nameKey(name)))throw Error('Use a unique team name, up to 60 characters, without the reserved name none or |.');
    let n=teamState[index].teams.length+1;while(teamState[index].teams.some(t=>t.id==='team-'+n))n++;const id='team-'+n;teamState[index].teams.push({id,name});revision++;return id;
  };
  const context=(index,day)=>({...resolve(index,day),record:record(index,day),strictHours});
  const settingsChanged=(index,month)=>{const d=get(index,month);revision++;d.accepted=false;d.reviewFingerprint=null;};
  const reviews=new WeakMap(),undos=new WeakMap();
  const stamp=(command)=>JSON.stringify({revision,days:[command.from,command.to].map(day=>{const c=context(command.index,day);return {record:c.record,override:Object.hasOwn(c.overrides,day),people:c.store.people,rules:c.store.rules,policy:c.store.planningPolicy,teams:c.store.teams,memberships:c.store.memberships,timezone:strictHours?c.store.timezone:storeTimezone(c.store)};})});
  const reviewOffDay=command=>{
    const planned=planOffDay(command,context);
    const stateFor=day=>{const r=ruleFor(resolve(command.index,day).store.rules,day);if(!r||!Number.isFinite(r.open)||!Number.isFinite(r.close)||r.open<0||r.close>24||r.close<=r.open||!Number.isInteger(r.minimum)||r.minimum<1)return 'Hours unknown';const state=r.holidays[day]||(r.closedDays.includes(weekday(day))?'closed':'open');return state==='closed'?'Closed':state==='open'?'Open':'Hours unknown';};
    const token=Object.freeze(structuredClone({...planned.summary,sourceState:stateFor(command.from),destinationState:stateFor(command.to)}));
    reviews.set(token,{command:structuredClone(command),changes:planned.changes,stamp:stamp(command)});return token;
  };
  const applyOffDay=token=>{
    const review=reviews.get(token);if(!review||review.stamp!==stamp(review.command))throw Error('The draft changed. Review this off-day operation again.');
    const {index}=review.command,before={},batch=structuredClone(review.changes);
    for(const day of Object.keys(batch)){const d=resolve(index,day);before[day]={present:Object.hasOwn(d.overrides,day),value:structuredClone(d.overrides[day])};}
    // Preflight every date and clone before the synchronous commit. No partial callback writes.
    const prepared=new Map();for(const day of Object.keys(batch)){const month=day.slice(0,7),k=key(index,month);if(!prepared.has(k)){const existing=drafts.get(k);prepared.set(k,existing?{...existing,overrides:{...existing.overrides},accepted:false,reviewFingerprint:null}:{store:{...stores[index],...teamState[index],timezone:strictHours?stores[index].timezone:storeTimezone(stores[index]),people:structuredClone(stores[index].people),rules:structuredClone(stores[index].rules)},overrides:{},accepted:false,reviewFingerprint:null});}}
    for(const [day,value] of Object.entries(batch))prepared.get(key(index,day.slice(0,7))).overrides[day]=value;
    for(const [k,d] of prepared)drafts.set(k,d);
    revision++;reviews.delete(token);const undo=Object.freeze({...token});undos.set(undo,{command:review.command,before,stamp:stamp(review.command)});return undo;
  };
  // The transfer review depends on both complete weeks, including neighboring drafts.
  const shiftStamp=command=>{const days=new Set();for(const anchor of [command.from,command.to]){const monday=addDays(anchor,-((weekday(anchor)+6)%7));for(let i=0;i<7;i++)days.add(addDays(monday,i));}return JSON.stringify({revision,days:[...days].sort().map(day=>{const c=context(command.index,day);return {day,storeId:c.store.id,record:c.record,override:Object.hasOwn(c.overrides,day),people:c.store.people,rules:c.store.rules,policy:c.store.planningPolicy,teams:c.store.teams,memberships:c.store.memberships,timezone:strictHours?c.store.timezone:storeTimezone(c.store)};})});};
  const shiftReviews=new WeakMap();
  const reviewShiftTransfer=command=>{
    const planned=planShiftTransfer(command,context);
    // Validate the source with the reviewed destination filled in. Otherwise an
    // intentionally unassigned destination makes the source week unknown.
    const sourcePreview=day=>{const c=context(command.index,day);return {...c,record:day===command.to?planned.changes[day]:c.record};};
    const sourceRow=enteredMonth(command.from.slice(0,7),sourcePreview,{conflictDay:command.from}).find(r=>r.day===command.from);
    // For a same-week move the source preview temporarily contains the source
    // and destination intervals. Defer only its weekly-cap conflict to the
    // final-state checks below; all other source conflicts remain blocking.
    const sameWeekMove=command.mode==='move' && addDays(command.from,-((weekday(command.from)+6)%7))===addDays(command.to,-((weekday(command.to)+6)%7));
    const sourceConflicts=(sourceRow?.conflicts?.[command.personId]||[]).filter(reason=>!(sameWeekMove && reason.startsWith('weekly hours exceeded (')));
    if(sourceConflicts.length)throw Error('Source conflicts: '+sourceConflicts.join('; '));
    const simulated=day=>{const c=context(command.index,day);return {...c,record:Object.hasOwn(planned.changes,day)?planned.changes[day]:c.record};};
    for(const day of [command.from,command.to]){const result=enteredMonth(day.slice(0,7),simulated,{conflictDay:day}).find(r=>r.day===day);if(day===command.to&&result?.conflicts?.[command.personId]?.length)throw Error('Destination conflicts: '+result.conflicts[command.personId].join('; '));}
    // Honor the strictest applicable limit across the entire destination week,
    // including adjacent months with their own draft settings.
    const monday=addDays(command.to,-((weekday(command.to)+6)%7));let total=0,cap=Infinity;
    for(let i=0;i<7;i++){const day=addDays(monday,i),c=simulated(day),person=c.store.people.find(p=>p.id===command.personId),rule=ruleFor(c.store.rules,day);if(!person||!Number.isFinite(person.maxHours))throw Error('Weekly limit is unknown.');cap=Math.min(cap,person.maxHours*60);const assigned=(c.record?.on||[]).includes(command.personId)||(c.record?.shifts||[]).some(s=>s.personId===command.personId);if(assigned){if(!rule||!Number.isFinite(rule.open)||!Number.isFinite(rule.close)||(strictHours && (!c.store.timezone || !(c.record?.shifts||[]).some(s=>s.personId===command.personId)))||(c.record?.shifts||[]).filter(s=>s.personId===command.personId).some(s=>shiftProblem(s,c.store,day,{strictHours})))throw Error('Weekly hours are unknown.');total+=unionMinutes(personIntervals(c.record,command.personId,rule,{strictHours}));}}
    if(total>cap)throw Error('Destination conflicts: weekly hours exceed the strictest applicable limit.');
    const token=Object.freeze(structuredClone(planned.summary));shiftReviews.set(token,{command:structuredClone(command),changes:planned.changes,stamp:shiftStamp(command)});return token;
  };
  const applyShiftTransfer=token=>{
    const review=shiftReviews.get(token);if(!review||review.stamp!==shiftStamp(review.command))throw Error('The draft changed. Review this shift again.');
    const prepared=new Map();for(const [day,value] of Object.entries(structuredClone(review.changes))){const k=key(review.command.index,day.slice(0,7));if(!prepared.has(k)){const d=drafts.get(k),store=resolve(review.command.index,day).store;prepared.set(k,d?{...d,overrides:{...d.overrides},accepted:false,reviewFingerprint:null}:{store:structuredClone(store),overrides:{},accepted:false,reviewFingerprint:null});}prepared.get(k).overrides[day]=value;}
    for(const [k,d] of prepared)drafts.set(k,d);revision++;shiftReviews.delete(token);return structuredClone(token);
  };
  // Direct edits are reviewed against an immutable draft revision before any write.
  const directReviews=new WeakMap();
  const reviewDirectShift=command=>{
    const {index,day,personId,startMinute,endMinute,original}=command;
    const c=context(index,day),person=c.store.people.find(p=>p.id===personId),prior=c.record;
    if(!person)throw Error('Choose a person in this store.');
    const employment=employmentProblem(person,day);if(employment)throw Error(employment);
    if(strictHours && !c.store.timezone)throw Error('Store timezone is unknown.');
    const row=enteredMonth(day.slice(0,7),d=>context(index,d)).find(r=>r.day===day);
    if(!row||row.state!=='open')throw Error('Choose an open day with confirmed store hours.');
    if(row.conflicts?.[personId]?.length)throw Error('Resolve this person’s existing conflicts first.');
    const record=structuredClone(prior||{on:[],off:[]}),shifts=record.shifts||[];
    if ((record.off||[]).includes(personId) || Object.hasOwn(record.absences||{},personId) || Object.hasOwn(record.unknownNotes||{},personId)) throw Error('Review the existing off or unknown choice first.');
    if(original){
      if(!(record.on||[]).includes(personId))throw Error('Confirm this person is on before adjusting.');
      const matches=shifts.map((shift,i)=>({shift,i})).filter(x=>x.shift.personId===personId&&x.shift.startMinute===original.startMinute&&x.shift.endMinute===original.endMinute);
      if(matches.length!==1)throw Error('This interval is ambiguous or changed. Review it again.');
      const {shift,i}=matches[0];if(shiftProblem(shift,c.store,day,{strictHours}))throw Error('Review the existing shift times first.');
      shifts[i]={...shift,startMinute,endMinute,source:{...structuredClone(shift.source||{}),adjustment:{kind:'manager preview',originalStart:shift.startMinute,originalEnd:shift.endMinute,...(shift.source?.adjustment?{previous:structuredClone(shift.source.adjustment)}:{})}}};
    }else{
      if((record.on||[]).includes(personId)||shifts.some(shift=>shift.personId===personId)||(record.generationLocks||[]).includes(personId)||(record.generation?.unlocked||[]).includes(personId)||Object.hasOwn(record.teamSnapshot||{},personId))throw Error('This person already has a choice. Review it first.');
      shifts.push({storeId:c.store.id,personId,date:day,endDate:day,timezone:strictHours?c.store.timezone:storeTimezone(c.store),startMinute,endMinute,source:{kind:'manager preview'}});
      record.on=[...new Set([...(record.on||[]),personId])];
    }
    record.shifts=shifts;record.generationLocks=[...new Set([...(record.generationLocks||[]),personId])];
    const changed=shifts.filter(shift=>shift.personId===personId);if(changed.some(shift=>shiftProblem(shift,c.store,day,{strictHours})))throw Error('Enter valid same-day start and end times.');
    const ordered=changed.map(shift=>[shift.startMinute,shift.endMinute]).sort((a,b)=>a[0]-b[0]);if(ordered.some((v,i)=>i&&v[0]<ordered[i-1][1]))throw Error('This overlaps another shift for the same person.');
    const simulated=d=>{const item=context(index,d);return {...item,record:d===day?record:item.record};};
    const result=enteredMonth(day.slice(0,7),simulated,{conflictDay:day}).find(r=>r.day===day);
    if(result?.conflicts?.[personId]?.length)throw Error('Shift conflicts: '+result.conflicts[personId].join('; '));
    const monday=addDays(day,-((weekday(day)+6)%7));let total=0,cap=Infinity;
    for(let i=0;i<7;i++){const date=addDays(monday,i),item=simulated(date),p=item.store.people.find(x=>x.id===personId),rule=ruleFor(item.store.rules,date);if(!p||!Number.isFinite(p.maxHours))throw Error('Weekly limit is unknown.');cap=Math.min(cap,p.maxHours*60);const assigned=(item.record?.on||[]).includes(personId)||(item.record?.shifts||[]).some(shift=>shift.personId===personId);if(assigned){if(!rule||!Number.isFinite(rule.open)||!Number.isFinite(rule.close)||(strictHours && (!item.store.timezone || !(item.record?.shifts||[]).some(shift=>shift.personId===personId)))||(item.record?.shifts||[]).filter(shift=>shift.personId===personId).some(shift=>shiftProblem(shift,item.store,date,{strictHours})))throw Error('Weekly hours are unknown.');total+=unionMinutes(personIntervals(item.record,personId,rule,{strictHours}));}}
    if(total>cap)throw Error('Weekly hours exceed the strictest applicable limit.');
    const token=Object.freeze({day,personId,personName:person.name||personId,startMinute,endMinute,mode:original?'adjust':'add'});directReviews.set(token,{index,day,record,revision,stamp:shiftStamp({index,from:day,to:day})});return token;
  };
  const applyDirectShift=token=>{const item=directReviews.get(token);if(!item||item.revision!==revision||item.stamp!==shiftStamp({index:item.index,from:item.day,to:item.day}))throw Error('The draft changed. Review this shift again.');setAssignment(item.index,item.day,item.record);directReviews.delete(token);return {...token};};

  const undoOffDay=token=>{
    const entry=undos.get(token);if(!entry||entry.stamp!==stamp(entry.command))throw Error('Undo is unavailable after another edit. Review the affected days.');
    const before=structuredClone(entry.before),prepared=new Map();
    for(const [day,state] of Object.entries(before)){const k=key(entry.command.index,day.slice(0,7));if(!prepared.has(k)){const existing=drafts.get(k);prepared.set(k,{...existing,overrides:{...existing.overrides},accepted:false,reviewFingerprint:null});}const d=prepared.get(k);if(state.present)d.overrides[day]=state.value;else delete d.overrides[day];}
    for(const [k,d] of prepared)drafts.set(k,d);
    revision++;undos.delete(token);return {...token};
  };
  /* ---- the draft bridge -------------------------------------------------------------------------------------
     What a month would save is exactly {storeId, month, store:{people, rules, teams, memberships, timezone}, overrides}.
     Acceptance, review fingerprints, history and anything on screen are not part of it and never leave here as saved
     state. Every value handed out is a copy, and every value taken in is checked first and copied before anything is
     changed. Nothing here sends anything anywhere, or knows how a draft is written down: the caller's own verified
     codec says whether a projection is acceptable. */
  const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((p) => [p, x[p]])) : x));
  const monthOf = (k) => k.slice(k.indexOf(":") + 1);
  const indexOf = (k) => Number(k.slice(0, k.indexOf(":")));
  const projectionFor = (k) => {
    const index = indexOf(k), d = drafts.get(k);
    return {
      storeId: stores[index].id,
      month: monthOf(k),
      store: {
        people: structuredClone(d.store.people),
        rules: structuredClone(d.store.rules),
        teams: structuredClone(teamState[index].teams),
        memberships: structuredClone(teamState[index].memberships),
        timezone: d.store.timezone,
      },
      overrides: structuredClone(d.overrides),
    };
  };
  const canonOf = (k) => stable(projectionFor(k));
  // A month made by a tool that writes the draft map itself (an off-day move) has no recorded start. It began as it is
  // now without the days that tool wrote, so that is what it is measured against; read right after the change, before
  // anything else can alter its teams or people.
  const baselineOf = (k) => { if (!baselines.has(k)) baselines.set(k, stable({ ...projectionFor(k), overrides: {} })); return baselines.get(k); };
  // A change that reached several months is open for as long as any of those months still differs from what was saved.
  const groupOpen = (g) => g.keys.size > 1 && [...g.keys].some((x) => canonOf(x) !== baselineOf(x));
  const unresolved = () => groups.filter(groupOpen);
  const touch = (kind) => {
    const changed = [];
    for (const k of drafts.keys()) {
      baselineOf(k);
      const c = canonOf(k);
      if (seen.get(k) !== c) { seen.set(k, c); changed.push(k); }
    }
    // A change that reached a month that began unchanged is a change of that month, whatever else it reached.
    for (let i = groups.length - 1; i >= 0; i--) if (!groupOpen(groups[i])) groups.splice(i, 1);
    if (!changed.length) return;
    // A change that reached more than one month is one change: no month's success can stand for the others.
    if (changed.length > 1) groups.push({ keys: new Set(changed), reason: kind === "teams" ? "shared-teams" : kind === "off-day" ? "cross-month-move" : "multi-month", revision });
    const event = Object.freeze({ token: ++changeToken, kind, months: Object.freeze(changed.map((k) => Object.freeze({ index: indexOf(k), month: monthOf(k) }))) });
    for (const fn of [...listeners]) { try { fn(event); } catch { /* a listener's failure is its own */ } }
  };
  const mutating = (fn, kind) => (...args) => { try { return fn(...args); } finally { touch(kind); } };
  const refuse = (reason) => Object.freeze({ ok: false, reason });
  const sourceVector=(index,month,overrides)=>monthDays(month).filter(day=>!Object.hasOwn(overrides,day)).map(day=>[day,explicitRecord(index,day)]);
  const missingSources=(vector,overrides)=>vector.filter(([day,value])=>value!==null&&!Object.hasOwn(overrides,day));
  const materializations=new WeakMap();
  const reviewMaterialization=(index,month)=>{
    const d=get(index,month),k=key(index,month),startRevision=revision,canonical=canonOf(k),vector=sourceVector(index,month,d.overrides),encoded=stable(vector);
    if(startRevision!==revision||canonical!==canonOf(k))throw Error('The draft changed while reading source schedules.');
    const missing=missingSources(vector,d.overrides);
    const token=Object.freeze({storeId:stores[index].id,index,month,dates:Object.freeze(missing.map(([day])=>day)),records:structuredClone(Object.fromEntries(missing)),unavailableDates:Object.freeze(vector.filter(([,value])=>value===null).map(([day])=>day))});
    materializations.set(token,{revision:startRevision,canonical,encoded,records:Object.fromEntries(missing)});return token;
  };
  const applyMaterialization=token=>{
    const review=materializations.get(token);if(!review)throw Error('Unknown source review.');
    const {index,month}=token,k=key(index,month),encoded=stable(sourceVector(index,month,get(index,month).overrides)),d=get(index,month);
    if(review.revision!==revision||review.canonical!==canonOf(k)||review.encoded!==encoded)throw Error('The draft or source changed. Review source schedules again.');
    const prepared={...d,overrides:{...structuredClone(d.overrides),...structuredClone(review.records)},accepted:false,reviewFingerprint:null};
    // Prove the full candidate serializes before the one local draft commit.
    stable({store:prepared.store,overrides:prepared.overrides,teams:teamState[index]});
    if(token.dates.length){Map.prototype.set.call(drafts,k,prepared);revision++;}
    materializations.delete(token);return {changed:token.dates.length,month,storeId:token.storeId};
  };
  const issueExport = (index, month) => {
    get(index, month);
    const k = key(index, month), canonical = canonOf(k);
    const linked = [...new Set(unresolved().filter((g) => g.keys.has(k)).flatMap((g) => [...g.keys]).filter((x) => x !== k).map(monthOf))].sort();
    const token = Object.freeze({ storeIndex: index, month, storeId: stores[index].id, seq: ++seq, linked: Object.freeze(linked) });
    issued.set(token, { key: k, canonical, seq: token.seq, revision });
    return { projection: projectionFor(k), token };
  };
  const exportMonth=(index,month)=>{
    const d=get(index,month);
    if(requireMaterializedSources&&missingSources(sourceVector(index,month,d.overrides),d.overrides).length){const error=Error('Review and include source schedules before export.');error.code='source-not-materialized';throw error;}
    return issueExport(index,month);
  };
  // The baseline moves to exactly what was submitted, and only forward: anything changed since stays unsaved, and an
  // acknowledgment that is unknown, for another month, or older than one already taken changes nothing.
  const acknowledgeMonth = (index, month, token) => {
    const meta = token && typeof token === "object" ? issued.get(token) : null;
    if (!meta) return refuse("unknown-submission");
    const k = key(index, month);
    if (meta.key !== k || token.storeIndex !== index || token.month !== month) return refuse("wrong-scope");
    if (!drafts.has(k)) return refuse("no-such-month");
    if (meta.seq < (acked.get(k)?.seq ?? 0)) return refuse("stale");
    acked.set(k, { seq: meta.seq, revision: meta.revision });
    baselines.set(k, meta.canonical);
    touch("ack");
    const open = unresolved().filter((g) => g.keys.has(k));
    return Object.freeze({ ok: true, clean: canonOf(k) === meta.canonical && canonOf(k) === baselines.get(k), stillLinked: Object.freeze([...new Set(open.flatMap((g) => [...g.keys]).filter((x) => x !== k).map(monthOf))].sort()) });
  };
  const dirtyKeys = () => [...drafts.keys()].filter((k) => canonOf(k) !== baselineOf(k));
  const draftStatus = (index) => {
    const mine = (k) => indexOf(k) === index;
    const open = unresolved().filter((g) => [...g.keys].some(mine));
    return Object.freeze({
      dirtyMonths: Object.freeze(dirtyKeys().filter(mine).map(monthOf).sort()),
      // Changes that reached several months. Each month must be submitted and acknowledged on its own; none of them is
      // saved together, and this says so until each one has been.
      unresolved: Object.freeze(open.map((g) => Object.freeze({ reason: g.reason, months: Object.freeze([...g.keys].filter(mine).map(monthOf).sort()), complete: false }))),
      atomic: false,
    });
  };
  const SHAPE_TOP = ["month", "overrides", "storeId", "store"].sort(), SHAPE_STORE = ["memberships", "people", "rules", "teams", "timezone"];
  const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const sameKeys = (o, want) => plain(o) && Object.keys(o).sort().join() === want.join();
  const shapeProblem = (c, index) => {
    if (!sameKeys(c, SHAPE_TOP)) return "shape";
    if (c.storeId !== stores[index].id) return "scope";
    if (!validMonth(c.month)) return "shape";
    if (!sameKeys(c.store, SHAPE_STORE)) return "shape";
    const { people, rules, teams, memberships, timezone } = c.store;
    if (![people, rules, teams, memberships].every(Array.isArray) || people.length > 500 || rules.length > 400 || teams.length > 200 || memberships.length > 5000) return "shape";
    const ids = new Set();
    for (const p of people) { if (!plain(p) || typeof p.id !== "string" || !p.id || ids.has(p.id)) return "shape"; ids.add(p.id);const original=stores[index].people.find(x=>x.id===p.id);if(original&&['hiredAt','departedAt'].some(field=>Object.hasOwn(original,field)&&(p[field]??null)!==(original[field]??null)))return 'employment-scope'; }
    // The planner reads inside these on its next draw, so what is inside is checked here, not left to the caller's codec.
    if (!rules.every((r) => plain(r) && typeof r.effective === "string")) return "shape";
    const teamIds = new Set();
    for (const t of teams) { if (!plain(t) || typeof t.id !== "string" || !t.id || typeof t.name !== "string" || teamIds.has(t.id)) return "shape"; teamIds.add(t.id); }
    if (!memberships.every((m) => plain(m) && m.storeId === c.storeId && typeof m.personId === "string" && m.personId && Array.isArray(m.teamIds) && m.teamIds.every((id) => teamIds.has(id)) && typeof m.from === "string" && typeof m.to === "string")) return "shape";
    if (typeof timezone !== "string" || !timezone) return "shape";
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { return "shape"; }
    if (!plain(c.overrides)) return "shape";
    const days = new Set(monthDays(c.month));
    for (const [day, value] of Object.entries(c.overrides)) {
      if (!days.has(day) || value === null || typeof value !== "object") return "shape";
      try { assertRecordScope(value, index, day); } catch { return "scope"; }
    }
    return null;
  };
  // Takes a saved month in. It never writes the month's draft by way of the map's own set, which the editor wraps to
  // seed a roster into each NEW draft: that is for months nobody has saved, and would replace the people saved here.
  const hydrateMonth = (index, input, verify, expectedScope) => {
    if (!stores[index]) return refuse("scope");
    if (typeof verify !== "function") return refuse("codec-missing");
    let candidate;
    try { candidate = structuredClone(input); } catch { return refuse("shape"); }
    // Caller scope is captured before invoking a codec. A valid projection for
    // another month must never mutate that month while loading the requested one.
    const scope = expectedScope === undefined
      ? {storeId: candidate?.storeId, month: candidate?.month}
      : {storeId: expectedScope?.storeId, month: expectedScope?.month};
    if (expectedScope === undefined && !validMonth(scope.month)) return refuse("shape");
    if (scope.storeId !== stores[index].id || !validMonth(scope.month)
        || candidate?.storeId !== scope.storeId || candidate?.month !== scope.month) return refuse("scope");
    let verified;
    try { verified = verify(structuredClone(candidate)); } catch { return refuse("codec-refused"); }
    if (verified === false || verified === null || verified === undefined) return refuse("codec-refused");
    if (verified !== true) { try { candidate = structuredClone(verified); } catch { return refuse("codec-refused"); } }
    const bad = shapeProblem(candidate, index);
    if (bad) return refuse(bad);
    if (candidate.storeId !== scope.storeId || candidate.month !== scope.month) return refuse("scope");
    if(requireMaterializedSources){try{if(missingSources(sourceVector(index,candidate.month,candidate.overrides),candidate.overrides).length)return refuse('source-not-materialized');}catch{return refuse('source-unavailable');}}
    try { stable(candidate); } catch { return refuse('shape'); }
    const k = key(index, candidate.month);
    if (drafts.has(k) && canonOf(k) !== baselineOf(k)) return refuse("unsaved-changes");
    const others = [...drafts.keys()].filter((x) => x !== k && indexOf(x) === index);
    const sameTeams = stable({ teams: candidate.store.teams, memberships: candidate.store.memberships }) === stable({ teams: teamState[index].teams, memberships: teamState[index].memberships });
    // Teams and memberships belong to the store, not the month: another month that is unsaved, or has been saved or
    // loaded, depends on the ones in place now, so different ones are refused rather than rewritten under it.
    const dependent = others.filter((x) => canonOf(x) !== baselineOf(x) || acked.has(x));
    if (!sameTeams && dependent.length) return refuse("shared-teams");
    // Everything is checked; from here on nothing can fail.
    if (!sameTeams) {
      teamState[index].teams.splice(0, teamState[index].teams.length, ...structuredClone(candidate.store.teams));
      teamState[index].memberships.splice(0, teamState[index].memberships.length, ...structuredClone(candidate.store.memberships));
    }
    const draft = {
      store: { ...stores[index], ...teamState[index], timezone: candidate.store.timezone, people: candidate.store.people, rules: candidate.store.rules },
      overrides: candidate.overrides,
      accepted: false,
      reviewFingerprint: null,
    };
    Map.prototype.set.call(drafts, k, draft);
    seen.set(k, canonOf(k)); baselines.set(k, seen.get(k));
    // Months that were only ever pristine are still pristine under the teams just taken in.
    if (!sameTeams) for (const x of others) { seen.set(x, canonOf(x)); baselines.set(x, seen.get(x)); }
    acked.set(k, { seq: ++seq, revision });
    touch("hydrate");
    return Object.freeze({ ok: true, ...issueExport(index, candidate.month) });
  };
  const subscribe = (fn) => { if (typeof fn !== "function") return () => {}; listeners.add(fn); return () => listeners.delete(fn); };
  return {
    get, rows, record, drafts, teamState, reviewOffDay, reviewShiftTransfer, reviewDirectShift, context,
    setAssignment: mutating(setAssignment, "edit"), reset: mutating(reset, "edit"), settingsChanged: mutating(settingsChanged, "edit"),
    setMembership: mutating(setMembership, "teams"), addTeam: mutating(addTeam, "teams"),
    applyOffDay: mutating(applyOffDay, "off-day"), undoOffDay: mutating(undoOffDay, "off-day"),
    applyShiftTransfer: mutating(applyShiftTransfer, "shift-transfer"), applyDirectShift: mutating(applyDirectShift, "shift-edit"),
    exportMonth, acknowledgeMonth, hydrateMonth, draftStatus, subscribe,reviewMaterialization,
    applyMaterialization:mutating(applyMaterialization,'source-materialization'),
    observe: () => touch("observe"), get unsaved() { return dirtyKeys().length > 0; }, get revision() { return revision; },
  };
}
// Evaluate legacy full-day and explicit minute shifts across complete Monday–Sunday weeks.
// Suggestions never contribute hours and never become assignments implicitly.
export function enteredMonth(month, resolveDay, { conflictDay = null } = {}) {
  const dates = monthDays(month);
  const start = addDays(dates[0], -((weekday(dates[0]) + 6) % 7));
  const end = addDays(dates.at(-1), 6 - ((weekday(dates.at(-1)) + 6) % 7));
  const all = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const { store, record, overrides, strictHours = false } = resolveDay(day), rule = ruleFor(store.rules, day);
    const state = !rule ? "unknown" : rule.holidays[day] || (rule.closedDays.includes(weekday(day)) ? "closed" : "open");
    const ids = [...new Set([...(record?.on || []), ...(record?.shifts || []).map(s=>s.personId)])];
    const validRule = rule && Number.isFinite(rule.open) && Number.isFinite(rule.close) && rule.open >= 0 && rule.close <= 24 && rule.close > rule.open && Number.isInteger(rule.minimum) && rule.minimum >= 1;
    all.push({ day, store, rule, record, ids, strictHours, state: validRule ? state : "unknown", hours: validRule ? rule.close - rule.open : 0, week: addDays(day, -((weekday(day) + 6) % 7)), override: Object.hasOwn(overrides || {}, day) });
  }
  const totals = new Map(), unknownWeeks = new Set();
  for (const r of all) {
    r.unknownPeople = [];
    if (!r.strictHours) continue;
    for (const person of r.store.people) {
      const employment=employmentProblem(person,r.day);
      if(employment==='Before employment start date.'||employment==='After employment end date.')continue;
      const id = person.id, record = r.record;
      const shifted = (record?.shifts || []).some(s => s.personId === id);
      const statusKnown = Boolean(record && ((record.on || []).includes(id) || (record.off || []).includes(id) || shifted));
      const unknownNote = Object.hasOwn(record?.unknownNotes || {}, id);
      const absence = record?.absences;
      const invalidAbsence = Object.hasOwn(absence || {}, id) && !['off','legacy-off','vacation','unavailable'].includes(absence[id]?.kind);
      if (!r.store.timezone || !statusKnown || unknownNote || invalidAbsence) {
        r.unknownPeople.push(id);
        unknownWeeks.add(r.week + ':' + id);
      }
    }
  }
  for (const r of all) for (const id of r.ids) {
    const key = r.week + ':' + id;
    totals.set(key, (totals.get(key) || 0) + unionMinutes(personIntervals(r.record,id,r.rule,{strictHours:r.strictHours})));
    if (!r.hours || (r.strictHours && (!r.store.timezone || !(r.record?.shifts || []).some(s=>s.personId===id))) || (r.record?.shifts || []).filter(s=>s.personId===id).some(s=>shiftProblem(s,r.store,r.day,{strictHours:r.strictHours}))) unknownWeeks.add(key);
  }
  return all.filter(r => r.day.startsWith(month + '-') && (!conflictDay || r.day === conflictDay)).map(r => {
    const issues = [], conflicts = {}, eligibleIds = [];
    for (const id of r.ids) {
      const p = r.store.people.find(p => p.id === id), reasons = [];
      if (!p) reasons.push("Unknown person");
      else {
        const employment=employmentProblem(p,r.day);if(employment)reasons.push(employment);
        if (!Array.isArray(p.off) || !Number.isFinite(p.start) || !Number.isFinite(p.end) || !Number.isFinite(p.maxHours)) reasons.push("Availability or weekly limit unknown");
        else {
          if (p.off.includes(weekday(r.day))) reasons.push("day off");
          const intervals = personIntervals(r.record,id,r.rule,{strictHours:r.strictHours});
          if (intervals.some(([a,b])=>a<p.start*60 || b>p.end*60)) reasons.push("outside availability");
          const shifts = (r.record?.shifts || []).filter(s=>s.personId===id);
          for(const shift of shifts) { const problem=shiftProblem(shift,r.store,r.day,{strictHours:r.strictHours}); if(problem)reasons.push(problem); }
          if (unionMinutes(intervals) < intervals.reduce((sum,[a,b])=>sum+b-a,0)) reasons.push("overlapping shifts");
          if (shifts.length && intervals.some(([a,b])=>a<r.rule?.open*60 || b>r.rule?.close*60)) reasons.push("outside store hours");
          if (unknownWeeks.has(r.week + ":" + id)) reasons.push("weekly hours unknown because another entered shift has unknown hours");
          const total = totals.get(r.week + ':' + id) || 0;
          if (total > p.maxHours*60) reasons.push(`weekly hours exceeded (${total/60}/${p.maxHours})`);
        }
        if ((r.record?.off || []).includes(id)) reasons.push("also marked off");
        if(r.store.planningPolicy && r.store.planningPolicy.people?.[id]?.eligible!==true)reasons.push("Store eligibility unknown or excluded");
        if(r.store.planningPolicy&&(r.record?.shifts||[]).some(s=>s.personId===id&&s.role&&!r.store.planningPolicy.people?.[id]?.roles?.includes(s.role)))reasons.push("Assigned role not qualified");
      }
      if (r.state !== 'open') reasons.push(r.state === 'closed' ? "assigned on a closed date" : "store hours unknown");
      if (reasons.length) { conflicts[id] = reasons; issues.push(`${p?.name || id}: ${reasons.join('; ')}.`); }
      else eligibleIds.push(id);
    }
    if (conflictDay) return { day:r.day, conflicts };
    if (r.state === 'unknown') issues.push('Store hours or holiday status unknown. Manager input needed.');
    if (r.state === 'open' && !r.record) issues.push('Needs schedule: no entered assignments.');
    const hoursUnknown = r.strictHours && (r.unknownPeople.length > 0 || !r.store.timezone || r.ids.some(id => unknownWeeks.has(r.week + ':' + id) || Object.hasOwn(conflicts, id)));
    if (hoursUnknown) issues.push('Assignment or shift hours unknown.');
    const coverage = r.state === 'open' && !hoursUnknown ? coverageSegments(r.rule,r.record,eligibleIds,{strictHours:r.strictHours}) : [];
    const minimumCoverage = hoursUnknown ? null : coverage.length ? Math.min(...coverage.map(s=>s.count)) : 0;
    if (r.state === 'open' && r.record && minimumCoverage !== null && minimumCoverage < r.rule.minimum) issues.push(`${r.rule.minimum - minimumCoverage} more eligible people needed for entered minimum coverage.`);
    if(r.state==='open'&&r.store.planningPolicy){
      const policy=r.store.planningPolicy;
      if(r.strictHours && !r.store.timezone) issues.push('Store timezone unknown.');
      else if(!stableLocalDate(r.day,storeTimezone(r.store)))issues.push('Generated planning does not support this DST-change date.');
      if(r.store.people.some(p=>!Array.isArray(p.off)||!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.end<=p.start||!Number.isFinite(p.maxHours)||policy.people?.[p.id]?.eligible===undefined||!Array.isArray(policy.people?.[p.id]?.roles)||r.record?.unknownNotes?.[p.id]||r.record?.generationLocks?.includes(p.id)&&!r.ids.includes(p.id)&&!(r.record?.off||[]).includes(p.id)))issues.push('Planning inputs incomplete: review availability, eligibility and roles.');
      for(const [role,minimum] of Object.entries(policy.requiredRoles||{}))if(coverage.some(segment=>new Set(eligibleIds.filter(id=>personIntervals(r.record,id,r.rule,{strictHours:r.strictHours}).some(([a,b])=>a<=segment.start&&b>=segment.end&&((r.record?.shifts||[]).find(s=>s.personId===id&&s.startMinute===a&&s.endMinute===b)?.role||(policy.people[id]?.roles?.length===1?policy.people[id].roles[0]:null))===role))).size<minimum))issues.push(`Required ${role} coverage is incomplete.`);
    }
    const estimate = r.state === 'open' ? forecast(r.store.history, r.day) : null;
    const target = r.state === 'open' ? Math.max(r.rule.minimum, r.rule.useCapacity && estimate && r.rule.capacity > 0 ? Math.ceil(estimate.high / r.rule.capacity) : 0) : null;
    const suggestions = r.state !== 'open' ? [] : r.store.people.filter(p => !employmentProblem(p,r.day) && !(r.record?.shifts || []).some(s=>s.personId===p.id) && !unknownWeeks.has(r.week + ':' + p.id) && !(r.record?.off || []).includes(p.id) && Array.isArray(p.off) && !p.off.includes(weekday(r.day)) && p.start <= r.rule.open && p.end >= r.rule.close && Number.isFinite(p.maxHours) && (totals.get(r.week + ':' + p.id) || 0) - (r.ids.includes(p.id) ? unionMinutes(personIntervals(r.record,p.id,r.rule,{strictHours:r.strictHours})) : 0) + r.hours*60 <= p.maxHours*60).slice(0, target).map(p => p.id);
    return { coverage, minimumCoverage, strictHours:r.strictHours, day:r.day, state:r.state, rule:r.rule, record:r.record, ids:r.ids, eligibleIds, conflicts, issues, required:r.state === 'open' ? r.rule.minimum : null, recommendationTarget:target, suggestions, estimate, hours:r.hours, override:r.override, weeklyHours:Object.fromEntries(r.store.people.map(p => [p.id, r.strictHours && unknownWeeks.has(r.week + ':' + p.id) ? null : (totals.get(r.week + ':' + p.id) || 0)/60])) };
  });
}

// Recorded deliveries never borrow from a planning range, including future dates.
export function recordedDay(store, day, today) {
  if (day > today) return { state: "future", units: null };
  const row = store.history.find((r) => r.day === day);
  return row?.state === "known"
    ? { state: "known", units: row.units }
    : row?.state === "closed"
      ? { state: "closed", units: null }
      : { state: "unknown", units: null };
}
export function monthSales(store, month, today) {
  const days = monthDays(month).map((day) => ({
    day,
    ...recordedDay(store, day, today),
  }));
  const known = days.filter((r) => r.state === "known");
  const maximum = known.length ? Math.max(...known.map(r => r.units)) : null;
  return {
    bestDays: known.filter(r => r.units === maximum),
    days,
    total: known.length ? known.reduce((n, r) => n + r.units, 0) : null,
    known: known.length,
    unknown: days.filter((r) => r.state === "unknown").length,
    closed: days.filter((r) => r.state === "closed").length,
    future: days.filter((r) => r.state === "future").length,
    best:
      known.toSorted(
        (a, b) => b.units - a.units || a.day.localeCompare(b.day),
      )[0] || null,
  };
}

export const STORE_TIME_ZONE = "America/New_York";
export function storeToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function calendarCells(month) {
  const days = monthDays(month),
    leading = (weekday(days[0]) + 6) % 7;
  const cells = [...Array(leading).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return cells;
}

// A visual scale of observed sales only. Planning estimates never enter this path.
export function salesHeat(store, month, today) {
  const summary = monthSales(store, month, today);
  const maximum = summary.best?.units ?? null;
  const tied = summary.bestDays.length > 1;
  return summary.days.map(row => ({
    ...row,
    level: row.state === "known" ? (maximum > 0 ? Math.round(row.units / maximum * 4) : 0) : null,
    best: row.state === "known" && row.units === maximum,
    bestLabel: row.state === "known" && row.units === maximum ? (tied ? "Best recorded · tied" : "Best recorded") : "",
  }));
}
