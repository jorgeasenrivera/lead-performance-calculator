// Executes the production gates and row construction. No runtime qualification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeliverySummaryRows } from '../api/_report-parsers.mjs';
const source = process.env.LAUNCH_GAP_SOURCE;
const core = readFileSync(source ? `${source}/src/LeadPerformanceCalculator.jsx` : new URL('../src/LeadPerformanceCalculator.jsx', import.meta.url), 'utf8');
const manager = readFileSync(source ? `${source}/src/Manager.jsx` : new URL('../src/Manager.jsx', import.meta.url), 'utf8');
const ordinary = core.match(/if \((!session \|\| holdMount[^\n]*?)\) return wrap\(<Shell><Style \/><\/Shell>\);/)[1];
const recovery = core.match(/if \((rec.status !== "idle")\) return wrap\(<Shell><Style \/><\/Shell>\);/)?.[1] || 'false';
const gate = `(${recovery}) || (${ordinary})`;
const held = new Function('session', 'holdMount', 'rec', `return ${gate}`);
test('recovery holds the dashboard through pending, ready, failure and interruption, then releases it', () => {
  for (const status of ['pending', 'ready', 'failed', 'interrupted']) assert.equal(held({ id: 'manager' }, false, { status }), true, status);
  assert.equal(held({ id: 'manager' }, false, { status: 'idle' }), false);
  assert.equal(held(null, false, { status: 'idle' }), true);
  assert.equal(held({ id: 'manager' }, true, { status: 'idle' }), true);
});
const completeness = manager.match(/complete: ([^\n]+),\n/);
const complete = new Function('rows', `return ${completeness?.[1] || 'true'}`);
test('unknown, missing and nonnumeric figures cannot certify a complete match', () => {
  for (const row of [{ fu: null, hu: 0 }, { fu: 0, hu: null }, { fu: null, hu: null }, { fu: NaN, hu: 0 }, { fu: Infinity, hu: 0 }]) {
    assert.equal(complete([{ onBoard: true, comparable: true, ...row }]), false);
    assert.equal(complete([{ onBoard: true, comparable: true, fu: 0, hu: 0 }, { onBoard: true, comparable: true, ...row }]), false);
  }
  assert.equal(complete([]), false);
  assert.equal(complete([{ onBoard: false, comparable: true, fu: 0, hu: 0 }]), false);
});
test('explicit zero and fractional values remain comparable', () => {
  assert.equal(complete([{ onBoard: true, comparable: true, fu: 0, hu: 0 }]), true);
  assert.equal(complete([{ onBoard: true, comparable: true, fu: .5, hu: .5 }]), true);
});
test('the match claim is conditional on complete coverage', () => {
  assert.match(manager.slice(manager.indexOf('function CrossCheck('), manager.indexOf('function XcList(')), /res\.complete \? "Every name and every figure matches\." : "Some names or figures could not be compared\."/);
});

// Execute the real row construction, including unitsOf's missing-to-zero behavior.
const crossStart = manager.indexOf('function CrossCheck(');
const rowStart = manager.indexOf('      const rows = [];', crossStart);
const rowEnd = manager.indexOf('      rows.sort(', rowStart);
assert.ok(rowStart > crossStart && rowEnd > rowStart);
const unitsCode = manager.slice(manager.indexOf('const unitsOf = (s) =>'), manager.indexOf(';', manager.indexOf('const unitsOf = (s) =>')) + 1);
const buildRows = new Function('file2', 'held', 'onRoster', `${unitsCode}\n${manager.slice(rowStart, rowEnd)}\nreturn rows;`);
const channels = ['internetUnits', 'phoneUnits', 'showroomUnits', 'campaignUnits'];
const zero = () => Object.fromEntries(channels.map(k => [k, 0]));
const construct = (f, h) => buildRows({ person: f }, { person: h }, new Set(['person']));
test('actual CSV versus held row construction cannot certify absent or null channels as zero', () => {
  for (const channel of channels) for (const absent of [true, false]) {
    const h = zero(); if (absent) delete h[channel]; else h[channel] = null;
    const rows = construct({ flatUnits: 0 }, h);
    assert.equal(rows[0].hu, 0, 'the existing numerical total is preserved');
    assert.equal(complete(rows), false, `${channel}: ${absent ? 'missing' : 'null'}`);
  }
  assert.equal(complete(construct({ flatUnits: 0 }, {})), false);
  assert.equal(complete(construct({ flatUnits: 0 }, zero())), true);
});
test('actual PDF row construction requires every channel, including a missing header or null parsed cell', () => {
  for (const channel of channels) for (const absent of [true, false]) {
    const header = channels.filter(k => !absent || k !== channel);
    const values = header.map(k => k === channel ? null : 0);
    const file = parseDeliverySummaryRows([[], ['Name', ...header], ['person', ...values]]);
    const rows = buildRows(file, { person: zero() }, new Set(['person']));
    assert.equal(rows[0].fu, 0, 'global unitsOf still totals absent channels as before');
    assert.equal(complete(rows), false, `${channel}: ${absent ? 'missing header' : 'null cell'}`);
  }
  assert.equal(complete(construct({}, zero())), false);
  assert.equal(complete(construct(zero(), zero())), true);
});
test('constructed mixed coverage stays incomplete; explicit fractional channels remain comparable', () => {
  const known = { ...zero(), internetUnits: .5 };
  assert.equal(complete(construct(known, known)), true);
  const rows = buildRows({ a: { flatUnits: 0 }, b: { flatUnits: 0 } }, { a: zero(), b: {} }, new Set(['a', 'b']));
  assert.equal(complete(rows), false);
  assert.equal(rows.reduce((n, r) => n + r.hu, 0), 0);
});
