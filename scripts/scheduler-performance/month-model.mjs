import {planOffDay} from './off-day-command.mjs';
import { nameKey, reservedTeamName } from './name-key.mjs';
import { seedTeams, teamSnapshot, validateMembership } from "./team-model.mjs";
import { personIntervals, unionMinutes, coverageSegments, shiftProblem, stableLocalDate, storeTimezone } from "./shift-intervals.mjs";
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
export function createPlanner(stores, { assignmentForDay = () => null } = {}) {
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
          timezone: storeTimezone(stores[index]),
          people: structuredClone(stores[index].people),
          rules: structuredClone(stores[index].rules),
        },
        overrides: {},
        accepted: false,
        reviewFingerprint: null,
      });
      // The first thing a month is, before anyone has changed it, is what it is measured against.
      if (!baselines.has(k)) { baselines.set(k, canonOf(k)); seen.set(k, baselines.get(k)); }
    }
    return drafts.get(k);
  };
  const resolve = (index, day) => drafts.get(key(index, day.slice(0, 7))) || { store: {...stores[index],...teamState[index]}, overrides: {} };
  const record = (index, day) => {
    const d = resolve(index, day);
    if (Object.hasOwn(d.overrides, day)) {
      const value = d.overrides[day];
      return Array.isArray(value) ? { on: value, off: [] } : value;
    }
    const rule = ruleFor(d.store.rules, day);
    const state = rule && (rule.holidays[day] || (rule.closedDays.includes(weekday(day)) ? "closed" : "open"));
    const value=state === "open" ? assignmentForDay(day, index) : null;
    return value ? {...structuredClone(value),teamSnapshot:teamSnapshot({...stores[index],...initialTeams[index]},day,[...(value.on||[]),...(value.off||[])])} : null;
  };
  const rows = (index, month) => {
    get(index, month);
    return enteredMonth(month, day => ({ ...resolve(index, day), record: record(index, day) }));
  };
  const setAssignment = (index, day, value) => {
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
  const context=(index,day)=>({...resolve(index,day),record:record(index,day)});
  const settingsChanged=(index,month)=>{const d=get(index,month);revision++;d.accepted=false;d.reviewFingerprint=null;};
  const reviews=new WeakMap(),undos=new WeakMap();
  const stamp=(command)=>JSON.stringify({revision,days:[command.from,command.to].map(day=>{const c=context(command.index,day);return {record:c.record,override:Object.hasOwn(c.overrides,day),people:c.store.people,rules:c.store.rules,policy:c.store.planningPolicy,teams:c.store.teams,memberships:c.store.memberships,timezone:storeTimezone(c.store)};})});
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
    const prepared=new Map();for(const day of Object.keys(batch)){const month=day.slice(0,7),k=key(index,month);if(!prepared.has(k)){const existing=drafts.get(k);prepared.set(k,existing?{...existing,overrides:{...existing.overrides},accepted:false,reviewFingerprint:null}:{store:{...stores[index],...teamState[index],timezone:storeTimezone(stores[index]),people:structuredClone(stores[index].people),rules:structuredClone(stores[index].rules)},overrides:{},accepted:false,reviewFingerprint:null});}}
    for(const [day,value] of Object.entries(batch))prepared.get(key(index,day.slice(0,7))).overrides[day]=value;
    for(const [k,d] of prepared)drafts.set(k,d);
    revision++;reviews.delete(token);const undo=Object.freeze({...token});undos.set(undo,{command:review.command,before,stamp:stamp(review.command)});return undo;
  };
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
  const exportMonth = (index, month) => {
    get(index, month);
    const k = key(index, month), canonical = canonOf(k);
    const linked = [...new Set(unresolved().filter((g) => g.keys.has(k)).flatMap((g) => [...g.keys]).filter((x) => x !== k).map(monthOf))].sort();
    const token = Object.freeze({ storeIndex: index, month, storeId: stores[index].id, seq: ++seq, linked: Object.freeze(linked) });
    issued.set(token, { key: k, canonical, seq: token.seq, revision });
    return { projection: projectionFor(k), token };
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
    for (const p of people) { if (!plain(p) || typeof p.id !== "string" || !p.id || ids.has(p.id)) return "shape"; ids.add(p.id); }
    // The planner reads inside these on its next draw, so what is inside is checked here, not left to the caller's codec.
    if (!rules.every((r) => plain(r) && typeof r.effective === "string")) return "shape";
    const teamIds = new Set();
    for (const t of teams) { if (!plain(t) || typeof t.id !== "string" || !t.id || typeof t.name !== "string" || teamIds.has(t.id)) return "shape"; teamIds.add(t.id); }
    if (!memberships.every((m) => plain(m) && m.storeId === c.storeId && typeof m.personId === "string" && m.personId && Array.isArray(m.teamIds) && m.teamIds.every((id) => teamIds.has(id)) && typeof m.from === "string" && typeof m.to === "string")) return "shape";
    if (typeof timezone !== "string" || !timezone) return "shape";
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { return "shape"; }
    if (!plain(c.overrides)) return "shape";
    const days = new Set(monthDays(c.month));
    for (const [day, value] of Object.entries(c.overrides)) if (!days.has(day) || value === null || typeof value !== "object") return "shape";
    return null;
  };
  // Takes a saved month in. It never writes the month's draft by way of the map's own set, which the editor wraps to
  // seed a roster into each NEW draft: that is for months nobody has saved, and would replace the people saved here.
  const hydrateMonth = (index, input, verify) => {
    if (!stores[index]) return refuse("scope");
    if (typeof verify !== "function") return refuse("codec-missing");
    let candidate;
    try { candidate = structuredClone(input); } catch { return refuse("shape"); }
    let verified;
    try { verified = verify(structuredClone(candidate)); } catch { return refuse("codec-refused"); }
    if (verified === false || verified === null || verified === undefined) return refuse("codec-refused");
    if (verified !== true) { try { candidate = structuredClone(verified); } catch { return refuse("codec-refused"); } }
    const bad = shapeProblem(candidate, index);
    if (bad) return refuse(bad);
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
    return Object.freeze({ ok: true, ...exportMonth(index, candidate.month) });
  };
  const subscribe = (fn) => { if (typeof fn !== "function") return () => {}; listeners.add(fn); return () => listeners.delete(fn); };
  return {
    get, rows, record, drafts, teamState, reviewOffDay, context,
    setAssignment: mutating(setAssignment, "edit"), reset: mutating(reset, "edit"), settingsChanged: mutating(settingsChanged, "edit"),
    setMembership: mutating(setMembership, "teams"), addTeam: mutating(addTeam, "teams"),
    applyOffDay: mutating(applyOffDay, "off-day"), undoOffDay: mutating(undoOffDay, "off-day"),
    exportMonth, acknowledgeMonth, hydrateMonth, draftStatus, subscribe,
    // Notices the changes made by code that edits a draft directly and tells the planner afterwards, or not at all.
    observe: () => touch("observe"),
    get unsaved() { return dirtyKeys().length > 0; },
    get revision() { return revision; },
  };
}
// Evaluate legacy full-day and explicit minute shifts across complete Monday–Sunday weeks.
// Suggestions never contribute hours and never become assignments implicitly.
export function enteredMonth(month, resolveDay) {
  const dates = monthDays(month);
  const start = addDays(dates[0], -((weekday(dates[0]) + 6) % 7));
  const end = addDays(dates.at(-1), 6 - ((weekday(dates.at(-1)) + 6) % 7));
  const all = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const { store, record, overrides } = resolveDay(day), rule = ruleFor(store.rules, day);
    const state = !rule ? "unknown" : rule.holidays[day] || (rule.closedDays.includes(weekday(day)) ? "closed" : "open");
    const ids = [...new Set([...(record?.on || []), ...(record?.shifts || []).map(s=>s.personId)])];
    const validRule = rule && Number.isFinite(rule.open) && Number.isFinite(rule.close) && rule.open >= 0 && rule.close <= 24 && rule.close > rule.open && Number.isInteger(rule.minimum) && rule.minimum >= 1;
    all.push({ day, store, rule, record, ids, state: validRule ? state : "unknown", hours: validRule ? rule.close - rule.open : 0, week: addDays(day, -((weekday(day) + 6) % 7)), override: Object.hasOwn(overrides || {}, day) });
  }
  const totals = new Map(), unknownWeeks = new Set();
  for (const r of all) for (const id of r.ids) {
    const key = r.week + ':' + id;
    totals.set(key, (totals.get(key) || 0) + unionMinutes(personIntervals(r.record,id,r.rule)));
    if (!r.hours || (r.record?.shifts || []).filter(s=>s.personId===id).some(s=>shiftProblem(s,r.store,r.day))) unknownWeeks.add(key);
  }
  return all.filter(r => r.day.startsWith(month + '-')).map(r => {
    const issues = [], conflicts = {}, eligibleIds = [];
    for (const id of r.ids) {
      const p = r.store.people.find(p => p.id === id), reasons = [];
      if (!p) reasons.push("Unknown person");
      else {
        if (!Array.isArray(p.off) || !Number.isFinite(p.start) || !Number.isFinite(p.end) || !Number.isFinite(p.maxHours)) reasons.push("Availability or weekly limit unknown");
        else {
          if (p.off.includes(weekday(r.day))) reasons.push("day off");
          const intervals = personIntervals(r.record,id,r.rule);
          if (intervals.some(([a,b])=>a<p.start*60 || b>p.end*60)) reasons.push("outside availability");
          const shifts = (r.record?.shifts || []).filter(s=>s.personId===id);
          for(const shift of shifts) { const problem=shiftProblem(shift,r.store,r.day); if(problem)reasons.push(problem); }
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
    if (r.state === 'unknown') issues.push('Store hours or holiday status unknown. Manager input needed.');
    if (r.state === 'open' && !r.record) issues.push('Needs schedule: no entered assignments.');
    const coverage = r.state === 'open' ? coverageSegments(r.rule,r.record,eligibleIds) : [];
    const minimumCoverage = coverage.length ? Math.min(...coverage.map(s=>s.count)) : 0;
    if (r.state === 'open' && r.record && minimumCoverage < r.rule.minimum) issues.push(`${r.rule.minimum - minimumCoverage} more eligible people needed for entered minimum coverage.`);
    if(r.state==='open'&&r.store.planningPolicy){
      const policy=r.store.planningPolicy;
      if(!stableLocalDate(r.day,storeTimezone(r.store)))issues.push('Generated planning does not support this DST-change date.');
      if(r.store.people.some(p=>!Array.isArray(p.off)||!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.end<=p.start||!Number.isFinite(p.maxHours)||policy.people?.[p.id]?.eligible===undefined||!Array.isArray(policy.people?.[p.id]?.roles)||r.record?.unknownNotes?.[p.id]||r.record?.generationLocks?.includes(p.id)&&!r.ids.includes(p.id)&&!(r.record?.off||[]).includes(p.id)))issues.push('Planning inputs incomplete: review availability, eligibility and roles.');
      for(const [role,minimum] of Object.entries(policy.requiredRoles||{}))if(coverage.some(segment=>new Set(eligibleIds.filter(id=>personIntervals(r.record,id,r.rule).some(([a,b])=>a<=segment.start&&b>=segment.end&&((r.record?.shifts||[]).find(s=>s.personId===id&&s.startMinute===a&&s.endMinute===b)?.role||(policy.people[id]?.roles?.length===1?policy.people[id].roles[0]:null))===role))).size<minimum))issues.push(`Required ${role} coverage is incomplete.`);
    }
    const estimate = r.state === 'open' ? forecast(r.store.history, r.day) : null;
    const target = r.state === 'open' ? Math.max(r.rule.minimum, r.rule.useCapacity && estimate && r.rule.capacity > 0 ? Math.ceil(estimate.high / r.rule.capacity) : 0) : null;
    const suggestions = r.state !== 'open' ? [] : r.store.people.filter(p => !(r.record?.shifts || []).some(s=>s.personId===p.id) && !unknownWeeks.has(r.week + ':' + p.id) && !(r.record?.off || []).includes(p.id) && Array.isArray(p.off) && !p.off.includes(weekday(r.day)) && p.start <= r.rule.open && p.end >= r.rule.close && Number.isFinite(p.maxHours) && (totals.get(r.week + ':' + p.id) || 0) - (r.ids.includes(p.id) ? unionMinutes(personIntervals(r.record,p.id,r.rule)) : 0) + r.hours*60 <= p.maxHours*60).slice(0, target).map(p => p.id);
    return { coverage, minimumCoverage, day:r.day, state:r.state, rule:r.rule, record:r.record, ids:r.ids, eligibleIds, conflicts, issues, required:r.state === 'open' ? r.rule.minimum : null, recommendationTarget:target, suggestions, estimate, hours:r.hours, override:r.override, weeklyHours:Object.fromEntries(r.store.people.map(p => [p.id, (totals.get(r.week + ':' + p.id) || 0)/60])) };
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
