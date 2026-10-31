// Actual manual handler and real report parsers; persistence is captured, not qualified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReport, parseDeliverySummaryRows, norm } from '../api/_report-parsers.mjs';
import { applySummaryStated } from '../api/_summary-stated.mjs';
const source = readFileSync(new URL('../src/LeadPerformanceCalculator.jsx', import.meta.url), 'utf8');
const anchor = '  const applyEntries = async (entries) => {';
assert.equal(source.split(anchor).length, 2);
const start = source.indexOf(anchor), end = source.indexOf('\n  };', start);
assert.ok(end > start);
const body = source.slice(start, end + 5);
const month = '2026-10', day = '2026-10-28', key = 'alex rowan';
const baseline = () => ({ __storeId: 'synthetic', aliases: { 'a rowan': key, 'alex r': key }, roster: [{ id: 'person', name: 'Alex Rowan', roleId: 'sales' }], months: { [month]: { stats: { [key]: { internetUnits: 2, phoneUnits: 9, customNote: 'keep' } }, names: {}, imports: {} } }, activity: {} });
const header = ['Name', 'internetUnits', 'internetLeads', 'internetPct', 'phoneUnits', 'phoneLeads', 'phonePct', 'showroomUnits', 'showroomLeads', 'showroomPct', 'campaignUnits', 'newUnits', 'usedUnits', 'otherUnits'];
const row = (name, units, pct = 20) => [name, units, 10, pct, 0, 0, 0, 0, 0, 0, 0, units, 0, 0];
const pdf = (rows = [row('Alex Rowan', 1.5), row('A Rowan', .5)], columns = header) => ({ rows: [[], columns, ...rows], type: 'delivery-summary', fileName: 'synthetic.pdf' });
async function apply(entries, data = baseline(), { accepted = true, scope = 'day' } = {}) {
  const original = structuredClone(data), calls = [];
  const proof = {};
  const ctx = { activityScope: scope, activityDay: day, today: () => day, console: { log() {} }, absenceProof: () => proof,
    storeData: data, view: 'synthetic', session: { id: 'synthetic-user', name: 'Synthetic' }, takeRestorePoint: async () => 'synthetic-point',
    channelTotals: () => ({}), applySummaryStated, parseReport, parseDeliverySummaryRows, departedNames: () => [], norm,
    admitsEveryone: () => false, uid: () => 'synthetic-id', setImportLog() {}, analyzeImport: () => [], setImportFlags() {}, config: {},
    workingDaysInMonth: () => 26, monthLabel: () => 'October', REPORTS: {}, LEADERBOARD_REPORTS: {},
    holdPerson() { assert.fail('known aliases must not be held as strangers'); },
    persistStore: async (store, next, audit, before, fields, gotProof) => {
      assert.equal(store, 'synthetic'); assert.equal(gotProof, proof); assert.deepEqual(before, original);
      calls.push({ next: structuredClone(next), fields }); return accepted;
    },
  };
  await new Function('ctx', `with(ctx){${body}; return applyEntries;}`)(ctx)(entries);
  assert.deepEqual(data, original, 'the loaded copy is never mutated');
  assert.equal(calls.length, 1);
  return calls[0];
}
const stat = result => result.next.months[month].stats[key];
test('actual PDF handler preserves 1.5 + 0.5 on identical reimport, in either row order', async () => {
  for (const rows of [[row('Alex Rowan', 1.5), row('A Rowan', .5)], [row('A Rowan', .5), row('Alex Rowan', 1.5)]]) {
    const first = await apply([pdf(rows)]); assert.equal(stat(first).internetUnits, 2);
    const retry = await apply([pdf(rows)], first.next); assert.equal(stat(retry).internetUnits, 2);
    assert.equal(stat(retry).newUnits, 2); assert.equal(stat(retry).customNote, 'keep');
    assert.deepEqual(Object.keys(retry.next.months[month].stats), [key]);
    assert.deepEqual(retry.next.months[month].names.delivery, [key]);
    assert.ok(retry.fields.some(p => p.join('.') === `${month}.stats.${key}.internetUnits`));
  }
});
test('refused-save retry uses the same incoming snapshot, never accumulates it onto stored totals', async () => {
  const data = baseline(), entry = pdf();
  const refused = await apply([entry], data, { accepted: false });
  const retried = await apply([entry], data);
  assert.equal(stat(refused).internetUnits, 2); assert.equal(stat(retried).internetUnits, 2);
  const changed = await apply([pdf([row('Alex Rowan', .5), row('A Rowan', .5)])], retried.next);
  assert.equal(stat(changed).internetUnits, 1, 'a later report replaces, rather than adds to, the snapshot');
});
test('multiple aliases, absent canonical row, and reversed order retain the canonical display name and fractional sum', async () => {
  const rows = [row('A Rowan', .5), row('Alex R', 1.5)];
  for (const ordered of [rows, [...rows].reverse()]) {
    const result = await apply([pdf(ordered)]);
    assert.equal(stat(result).internetUnits, 2); assert.equal(stat(result).displayName, 'Alex Rowan');
  }
});
test('each report is aggregated separately; repeated entries do not double count; explicit zero replaces prior units', async () => {
  assert.equal(stat(await apply([pdf(), pdf()])).internetUnits, 2);
  assert.equal(stat(await apply([pdf([row('Alex Rowan', 0), row('A Rowan', 0)])])).internetUnits, 0);
});
test('unknown additive values stay unknown in either order; zero plus a fractional value stays known', async () => {
  for (const value of [null, undefined]) for (const reverse of [false, true]) {
    const rows = [row('Alex Rowan', 0), row('A Rowan', value)]; if (reverse) rows.reverse();
    const result = await apply([pdf(rows)]);
    assert.equal(stat(result).internetUnits, null);
    assert.ok(result.fields.some(p => p.join('.') === `${month}.stats.${key}.internetUnits`));
  }
  assert.equal(stat(await apply([pdf([row('Alex Rowan', 0), row('A Rowan', .5)])])).internetUnits, .5);
});
test('percentages are never added or arbitrarily selected from a conflicting alias', async () => {
  for (const reverse of [false, true]) {
    const rows = [row('Alex Rowan', 1.5, 15), row('A Rowan', .5, 5)]; if (reverse) rows.reverse();
    assert.equal(stat(await apply([pdf(rows)])).internetPct, null);
  }
  assert.equal(stat(await apply([pdf()])).internetPct, 20, 'matching reported percentages are retained');
  assert.equal(stat(await apply([pdf([row('Alex Rowan', 0, null), row('A Rowan', .5, 20)])])).internetPct, null);
});
test('real CSV channel parser aggregates counts while preserving other report fields', async () => {
  const entry = { type: 'delivery-phone', fileName: 'synthetic.csv', rows: [[], ['Name', 'Units Delivered', 'Delivered %', 'Opportunities'], ['Alex Rowan', '1.5', '15', '10'], ['A Rowan', '0.5', '5', '10']] };
  const result = await apply([entry]);
  assert.equal(stat(result).phoneUnits, 2); assert.equal(stat(result).phoneLeads, 20); assert.equal(stat(result).phonePct, null);
  assert.equal(stat(result).internetUnits, 2, 'other channel snapshot stays intact');
});
test('actual daily and monthly activity branches use aggregated counts, not the final alias', async () => {
  const entry = { type: 'activity', fileName: 'synthetic.csv', rows: [[], ['Name', 'Calls', 'Units Delivered', 'Open Tasks'], ['Alex Rowan', '12', '1.5', '0'], ['A Rowan', '7', '0.5', '0']] };
  const daily = await apply([entry]);
  assert.equal(daily.next.activity[day][key].calls, 19); assert.equal(daily.next.activity[day][key].units, 2); assert.equal(daily.next.activity[day][key].tasksPosted, 0);
  const monthly = await apply([entry], baseline(), { scope: 'month' });
  assert.equal(stat(monthly).activityMTD.calls, 19); assert.deepEqual(monthly.next.activity, {});
});
test('unaliased imports and excluded alias handling retain existing behavior', async () => {
  const result = await apply([pdf([row('Alex Rowan', .5, 5)])]);
  assert.equal(stat(result).internetUnits, .5); assert.equal(stat(result).internetPct, 5);
  const data = baseline(); data.excluded = ['A Rowan'];
  assert.equal(stat(await apply([pdf()], data)).internetUnits, 1.5);
});
