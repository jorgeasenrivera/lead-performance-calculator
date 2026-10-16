import { dayAbsence } from "./team-model.mjs";
// Preview-only full-day assignments, independent of the unvalidated r2 package.
export function fixtureAssignments(day) {
  if (!day.startsWith('2026-10-') || Number(day.slice(-2)) > 20) return null;
  const n = Number(day.slice(-2));
  if (n % 5 === 0) return null;
  return n % 3 === 0
    ? { on: ['p0'], off: ['p2', 'p3'] }
    : { on: ['p0', 'p1', 'p4'], off: ['p2', 'p3'] };
}
// Display mode never creates or changes membership. Callers provide explicit team IDs.
export function teamsFor(people, mode, definitions=[{id:'oak',name:'Oak team'},{id:'pine',name:'Pine team'}]) {
  if (mode === 'individual') return [];
  return definitions.map(t=>({...t,ids:[...new Set(people.filter(p=>(p.teamIds||[]).includes(t.id)).map(p=>p.id))]})).filter(t=>t.ids.length);
}
export function assignmentSummary(people, teams, record, row) {
  const valid = new Set(people.map(p => p.id));
  const assigned = [...new Set(record?.on || [])].filter(id => valid.has(id));
  const on = assigned.filter(id => (row.eligibleIds || []).includes(id));
  const conflicting = assigned.filter(id => !on.includes(id));
  const off = [...new Set(record?.off || [])].filter(id => valid.has(id) && !assigned.includes(id));
  const absenceStates=Object.fromEntries([...valid].map(id=>[id,dayAbsence(row.store||{people},record,row.day,id)]));
  const unavailable=[...valid].filter(id=>!assigned.includes(id)&&absenceStates[id]==='unavailable');
  const vacation=off.filter(id=>absenceStates[id]==='vacation');
  const unknown = [...valid].filter(id => !assigned.includes(id) && !off.includes(id) && !unavailable.includes(id));
  const teamRows = teams.map(t => ({ ...t, state: t.ids.some(id => conflicting.includes(id)) ? 'Conflict' : t.ids.length && t.ids.every(id => on.includes(id)) ? 'On' : t.ids.length && t.ids.every(id => off.includes(id)) ? 'Off' : t.ids.some(id => on.includes(id)) ? 'Partly on' : 'Unknown' }));
  const members = new Set(teams.flatMap(t => t.ids));
  const additional = { on: on.filter(id => !members.has(id)).length, off: off.filter(id => !members.has(id)&&absenceStates[id]==='off').length, unknown: unknown.filter(id => !members.has(id)).length, conflicts: conflicting.filter(id => !members.has(id)).length };
  if(vacation.some(id=>!members.has(id)))additional.vacation=vacation.filter(id=>!members.has(id)).length;
  if(unavailable.some(id=>!members.has(id)))additional.unavailable=unavailable.filter(id=>!members.has(id)).length;
  const additionalPeople = [...new Map(people.map(p => [p.id, p])).values()].filter(p => !members.has(p.id)).map(p => ({id:p.id, name:p.name || p.id, state:conflicting.includes(p.id) ? 'Conflict' : on.includes(p.id) ? 'On' : vacation.includes(p.id)?'Vacation':unavailable.includes(p.id)?'Unavailable':off.includes(p.id) ? 'Off' : 'Unknown'}));
  const covering = row.minimumCoverage ?? on.length;
  const status = row.state === 'closed' ? (row.issues?.length ? 'Schedule conflict' : 'Closed') : row.state !== 'open' ? 'Hours unknown' : !record ? 'Needs schedule' : covering < row.rule.minimum ? 'Low staff' : row.issues?.length || conflicting.length ? 'Schedule conflict' : 'Scheduled';
  return { on, assigned, conflicting, off, unknown, unavailable, vacation, absenceStates, teams: teamRows, additional, additionalPeople, covering, status };
}
