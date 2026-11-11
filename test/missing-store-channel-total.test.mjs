import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapDeliverySummaryGrid, parseDeliverySummaryRows, parseReport, norm } from '../api/_report-parsers.mjs';
import { admitsEveryone, holdPerson } from '../api/_people-status.mjs';
const line = str => ({ parts: [{ str }] });
const head = name => line(`${name} Total Leads Total Ups Showroom Unsold In Showroom Be Backs Total Delivered/ F&I Closing %`);
const row = (name, value) => line(`${name} 10 0 0 0 ${value} 0%`);
const grid = storeRows => mapDeliverySummaryGrid([head('Fictional Store'), ...storeRows,
  ...['Alex Fixture', 'Blair Fixture', 'Casey Fixture'].flatMap(name => [head(name), row('Internet', .5)])]);

test('stock-only store block does not fabricate a zero delivery total', () => {
  const result = grid([row('New', 35), row('Used', 30)]);
  assert.equal(result.stated.total, null);
  assert.deepEqual(result.stated.units, { internet: null, phone: null, showroom: null, campaign: null });
  assert.deepEqual(result.stated.vehicles, { new: 35, used: 30, other: null });
  assert.equal(parseDeliverySummaryRows(result.rows)['alex fixture'].internetUnits, .5);
});
test('all missing channel delivery cells remain unknown', () => {
  assert.equal(grid(['Internet', 'Phone', 'Showroom', 'Campaign'].map(k => row(k, '-'))).stated.total, null);
});
test('explicit channel zeros are preserved, including existing sparse-report behavior', () => {
  assert.equal(grid(['Internet', 'Phone', 'Showroom', 'Campaign'].map(k => row(k, 0))).stated.total, 0);
  assert.equal(grid([row('Internet', 0)]).stated.total, 0);
});
test('nonempty channel sums and fractional credit parsing are unchanged', () => {
  assert.equal(grid([row('Internet', 35), row('Showroom', 30)]).stated.total, 65);
  assert.equal(grid([row('Internet', .5)]).stated.total, .5);
});
test('missing stock side remains null at parser boundary; explicit stock zero stays zero', () => {
  assert.deepEqual(grid([row('New', 35)]).stated.vehicles, { new: 35, used: null, other: null });
  assert.deepEqual(grid([row('New', 0), row('Used', 0)]).stated.vehicles, { new: 0, used: 0, other: null });
});

// Execute unchanged production merge, fixed date, without backend access.
const ingest = readFileSync(new URL('../api/ingest.mjs', import.meta.url), 'utf8');
const body = ingest.slice(ingest.indexOf('function applyToStore('), ingest.indexOf('/* ---------- routing helpers'));
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-22T15:00:00Z'])); } }
const apply = new Function('ymET', 'todayET', 'norm', 'uid', 'parseReport', 'parseDeliverySummaryRows', 'admitsEveryone', 'holdPerson', 'Date', body + '\nreturn applyToStore;')(
  () => '2026-10', () => '2026-10-22', norm, () => 'fixture-id', parseReport, parseDeliverySummaryRows, admitsEveryone, holdPerson, FixedDate);
const entry = storeRows => ({ ...grid(storeRows), type: 'delivery-summary', fileName: 'synthetic.pdf' });
test('unknown channel total does not create a zero stated headline on an empty month', () => {
  const d = apply({}, [entry([row('New', 35), row('Used', 30)])], 'synthetic').next;
  assert.equal(d.months['2026-10'].stated, undefined);
  assert.equal(d.months['2026-10'].stats['alex fixture'].internetUnits, .5);
});
test('unknown total does not overwrite an existing total or its metadata', () => {
  for (const source of ['summary-grid', 'roll-up']) {
    const stated = { deliveries: 53, source, day: '2026-10-20', file: 'earlier-report', at: '2026-10-20T15:00:00Z' };
    const d = apply({ months: { '2026-10': { stated } } }, [entry([row('New', 35), row('Used', 30)])], 'synthetic').next;
    assert.deepEqual(d.months['2026-10'].stated, { ...stated, vehicles: { new: 35, used: 30, other: null } });
  }
});
test('a complete explicit zero still enters the existing summary-grid path', () => {
  const d = apply({}, [entry(['Internet', 'Phone', 'Showroom', 'Campaign'].map(k => row(k, 0)))], 'synthetic').next;
  assert.equal(d.months['2026-10'].stated.deliveries, 0);
});
