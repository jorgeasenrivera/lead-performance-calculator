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
  const on = [...new Set(record?.on || [])].filter(id => valid.has(id));
  const off = [...new Set(record?.off || [])].filter(id => valid.has(id) && !on.includes(id));
  const unknown = [...valid].filter(id => !on.includes(id) && !off.includes(id));
  const teamRows = teams.map(t => ({ ...t, state: t.ids.length && t.ids.every(id => on.includes(id)) ? 'On' : t.ids.length && t.ids.every(id => off.includes(id)) ? 'Off' : t.ids.some(id => on.includes(id)) ? 'Partly on' : 'Unknown' }));
  const members = new Set(teams.flatMap(t => t.ids));
  const additional = { on: on.filter(id => !members.has(id)).length, off: off.filter(id => !members.has(id)).length, unknown: unknown.filter(id => !members.has(id)).length };
  const covering = on.filter(id => { const p = people.find(p => p.id === id); return row.rule && p.start <= row.rule.open && p.end >= row.rule.close; }).length;
  const status = row.state === 'closed' ? 'Closed' : row.state !== 'open' ? 'Hours unknown' : !record ? 'Needs schedule' : covering < row.rule.minimum ? 'Low staff' : 'Scheduled';
  return { on, off, unknown, teams: teamRows, additional, covering, status };
}
