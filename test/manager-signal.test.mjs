import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownManagerSignalSurface, recapDue, recapPresented } from '../src/manager-signal.mjs';

test('presentation survives navigation without Close, including denied storage', () => {
  const seen = new Set();
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.equal(recapDue('store-a-day-1', seen, denied), true);
  recapPresented('store-a-day-1', seen, denied);
  assert.equal(recapDue('store-a-day-1', seen, denied), false);
  assert.equal(recapDue('store-b-day-1', seen, denied), true);
  assert.equal(recapDue('store-a-day-2', seen, denied), true);
});

test('successful recap presentation persists across a fresh session', () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  recapPresented('today', new Set(), storage);
  assert.equal(recapDue('today', new Set(), storage), false);
});

test('only mounted manager shells own the material and navigation observer', () => {
  const classes = new Set();
  let phase = false, observe, disconnected = 0, observers = 0, writes = 0;
  const root = {
    classList: { contains: name => classes.has(name), add: (...names) => { writes++; names.forEach(name => classes.add(name)); }, remove: (...names) => names.forEach(name => classes.delete(name)) },
    matches: () => phase,
  };
  const env = { document: { documentElement: root }, MutationObserver: class {
    constructor(callback) { observe = callback; observers++; }
    observe() {}
    disconnect() { disconnected++; }
  } };
  assert.equal(classes.size, 0);
  const first = ownManagerSignalSurface(env), second = ownManagerSignalSurface(env);
  assert.equal(observers, 1);
  assert.equal(classes.has('manager-signal'), true);
  assert.equal(classes.has('manager-signal-switch'), false);
  phase = true; observe();
  assert.equal(classes.has('manager-signal-switch'), true);
  const afterPhase = writes;
  observe(); observe();
  assert.equal(writes, afterPhase, 'the observer cannot notify itself in a loop');
  first(); first();
  assert.equal(disconnected, 0);
  second();
  assert.equal(disconnected, 1);
  assert.equal(classes.size, 0);
});

test('shipped source has no study switch, credentials, recorder or digest writer', () => {
  const source = readFileSync(new URL('../src/Manager.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/manager-signal.css', import.meta.url), 'utf8');
  for (const forbidden of ['__SAGE_POLISH', '__SAGE_FINAL_TOTALS', 'data-study-record-card', 'data-signal-record-card', 'data-signal-card-close', 'demo@sageonline.app', 'installProposal', 'managerDirection', 'ruWritten', 'function buildDigest']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(css.includes('data-manager-direction'), false);
  assert.ok(source.includes('const digests = digestIntegrity.history;'));
  assert.ok(source.includes('useLayoutEffect(() => ownManagerSignalSurface(), []);'));
  assert.ok(source.includes('<style>{managerSignalCSS}</style>'));
  assert.ok(source.includes('recapPresented(seenKey, signalRecapSeen, localStorage)'));
});
