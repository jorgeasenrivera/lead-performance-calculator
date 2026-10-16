// Preview-only full-day assignments, independent of the unvalidated r2 package.
export function fixtureAssignments(day) {
  if (!day.startsWith('2026-10-') || Number(day.slice(-2)) > 20) return null;
  const n = Number(day.slice(-2));
  if (n % 5 === 0) return null;
  return n % 3 === 0
    ? { on: ['p0'], off: ['p2', 'p3'] }
    : { on: ['p0', 'p1', 'p4'], off: ['p2', 'p3'] };
}
export function teamsFor(people, mode) {
  if (mode === 'individual') return [];
  const ids = people.map(p => p.id);
  return mode === 'team'
    ? [{ name: 'Oak team', ids: ids.slice(0, 3) }, { name: 'Pine team', ids: ids.slice(3) }]
    : [{ name: 'Oak team', ids: ids.slice(0, 2) }, { name: 'Pine team', ids: ids.slice(2, 4) }];
}
export function assignmentSummary(people, teams, record, row) {
  const valid = new Set(people.map(p => p.id));
  const assigned = [...new Set(record?.on || [])].filter(id => valid.has(id));
  const on = assigned.filter(id => (row.eligibleIds || []).includes(id));
  const conflicting = assigned.filter(id => !on.includes(id));
  const off = [...new Set(record?.off || [])].filter(id => valid.has(id) && !assigned.includes(id));
  const unknown = [...valid].filter(id => !assigned.includes(id) && !off.includes(id));
  const teamRows = teams.map(t => ({ ...t, state: t.ids.some(id => conflicting.includes(id)) ? 'Conflict' : t.ids.length && t.ids.every(id => on.includes(id)) ? 'On' : t.ids.length && t.ids.every(id => off.includes(id)) ? 'Off' : t.ids.some(id => on.includes(id)) ? 'Partly on' : 'Unknown' }));
  const members = new Set(teams.flatMap(t => t.ids));
  const additional = { on: on.filter(id => !members.has(id)).length, off: off.filter(id => !members.has(id)).length, unknown: unknown.filter(id => !members.has(id)).length, conflicts: conflicting.filter(id => !members.has(id)).length };
  const additionalPeople = [...new Map(people.map(p => [p.id, p])).values()].filter(p => !members.has(p.id)).map(p => ({id:p.id, name:p.name || p.id, state:conflicting.includes(p.id) ? 'Conflict' : on.includes(p.id) ? 'On' : off.includes(p.id) ? 'Off' : 'Unknown'}));
  const covering = row.minimumCoverage ?? on.length;
  const status = row.state === 'closed' ? (row.issues?.length ? 'Schedule conflict' : 'Closed') : row.state !== 'open' ? 'Hours unknown' : !record ? 'Needs schedule' : covering < row.rule.minimum ? 'Low staff' : row.issues?.length || conflicting.length ? 'Schedule conflict' : 'Scheduled';
  return { on, assigned, conflicting, off, unknown, teams: teamRows, additional, additionalPeople, covering, status };
}
