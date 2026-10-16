import { nameKey, reservedTeamName } from './name-key.mjs';
import { seedTeams, teamSnapshot, validateMembership } from "./team-model.mjs";
import { personIntervals, unionMinutes, coverageSegments, shiftProblem, storeTimezone } from "./shift-intervals.mjs";
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
  const get = (index, month) => {
    monthDays(month);
    if (!stores[index]) throw Error("Unknown store");
    const k = key(index, month);
    if (!drafts.has(k))
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
  return { get, rows, record, setAssignment, reset, drafts, setMembership, addTeam, teamState, get revision() { return revision; }, context: (index,day) => ({...resolve(index,day),record:record(index,day)}) };
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
