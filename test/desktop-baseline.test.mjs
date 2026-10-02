import test from 'node:test';
import assert from 'node:assert/strict';
import { installDesktopProbe, summarizeSample } from '../scripts/desktop-baseline-metrics.mjs';
import { denseFixture, denseDay } from '../scripts/desktop-baseline.mjs';
import { isolatedMockSource } from '../scripts/desktop-baseline-mock.mjs';
import fs from 'node:fs';

const sample = overrides => ({ label: 'test', status: 'complete', start: 100, end: 200,
  frames: [], tasks: [], longFrames: [], contentMs: 10, settledMs: 20,
  longTaskSupported: true, longFrameSupported: true, hidden: false, droppedEntries: 0,
  viewport: [1440, 900], ...overrides });
test('empty frame evidence stays unknown, not zero FPS', () => {
  const s = summarizeSample(sample());
  assert.equal(s.frameMedianMs, null); assert.equal(s.frameP95Ms, null); assert.equal(s.frameMaxMs, null);
});
test('nearest-rank percentiles do not average away the worst frame', () => {
  const s = summarizeSample(sample({ frames: [16, 17, 100, 16, NaN, -1, 0] }));
  assert.equal(s.frameCount, 4); assert.equal(s.frameMedianMs, 16);
  assert.equal(s.frameP95Ms, 100); assert.equal(s.gapsOver34Ms, 1);
});
test('long task duration is clipped to the sample and boundary-only tasks are excluded', () => {
  const s = summarizeSample(sample({ tasks: [{ startTime: 70, duration: 50 }, { startTime: 180, duration: 90 }, { startTime: 200, duration: 70 }] }));
  assert.equal(s.longTasks, 2); assert.equal(s.longTaskOverlapMs, 40);
});
test('unsupported browser APIs stay null instead of claiming no stalls', () => {
  const s = summarizeSample(sample({ longTaskSupported: false, longFrameSupported: false }));
  assert.equal(s.longTasks, null); assert.equal(s.longTaskOverlapMs, null); assert.equal(s.longFrames, null);
});
test('hidden and interrupted recordings cannot be baseline evidence', () => {
  assert.equal(summarizeSample(sample({ hidden: true })).usable, false);
  assert.equal(summarizeSample(sample({ status: 'interrupted' })).usable, false);
});
test('incomplete lifecycle, missing frames and capped entries cannot look like a usable baseline', () => {
  assert.equal(summarizeSample(sample({ frames: [16, 16] })).usable, true);
  for (const override of [{ contentMs: null }, { settledMs: null }, { droppedEntries: 1 }, { frames: [] }]) {
    assert.equal(summarizeSample(sample({ frames: [16, 16], ...override })).usable, false);
  }
});

function harness() {
  let now = 0, frame, deadline, hidden = false, busy = false, exists = true, reads = 0;
  const listeners = new Map();
  const doc = { get hidden() { return hidden; }, createElement: () => ({}), body: { appendChild() {} },
    documentElement: { matches: () => busy },
    querySelector: selector => selector === '.acard' ? null : exists ? { getClientRects: () => { reads++; return [1]; } } : null,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const env = { document: doc, performance: { now: () => now }, innerWidth: 1440, innerHeight: 900,
    getComputedStyle: () => ({ visibility: 'visible' }),
    requestAnimationFrame: cb => { frame = cb; return 1; }, cancelAnimationFrame: () => { frame = null; },
    setTimeout: cb => { deadline = cb; return 1; }, clearTimeout: () => { deadline = null; } };
  installDesktopProbe(env);
  return { api: env.__desktopProbe, listeners, tick(t) { now = t; const cb = frame; frame = null; cb(t); },
    hide() { hidden = true; listeners.get('visibilitychange')(); },
    busy(v) { busy = v; }, exists(v) { exists = v; }, reads: () => reads, timeout() { now = 4200; deadline(); } };
}
test('two ready frames are distinct from content arrival and navigation settling', () => {
  const h = harness(); h.api.start('nav', '.target', { windowMs: 100 });
  h.busy(true); h.tick(16); h.busy(false); h.tick(32); h.tick(48); h.tick(110);
  assert.equal(h.api.samples[0].contentMs, 16); assert.equal(h.api.samples[0].settledMs, 48);
  assert.equal(h.api.samples[0].status, 'complete');
});
test('another interaction closes the previous recording, not mixing results', () => {
  const h = harness(); h.api.start('first'); h.tick(16); h.api.start('second');
  assert.equal(h.api.samples[0].status, 'interrupted'); assert.equal(h.api.samples[0].label, 'first');
  h.api.finish('complete'); assert.equal(h.api.samples[1].label, 'second');
});
test('visibility changes invalidate the whole sample even if it returns', () => {
  const h = harness(); h.api.start('nav'); h.hide(); h.tick(16); h.tick(32); h.tick(2300);
  assert.equal(h.api.samples[0].hidden, true);
});
test('watchdog bounds a suspended frame loop and dispose removes listeners', () => {
  const h = harness(); h.api.start('nav'); h.timeout();
  assert.equal(h.api.samples[0].status, 'watchdog'); h.api.dispose(); assert.equal(h.listeners.size, 0);
});
test('card close waits for actual removal', () => {
  const h = harness(); h.api.start('close', '.target', { absent: true, windowMs: 100 });
  h.tick(16); h.exists(false); h.tick(32); h.tick(48); h.tick(110);
  assert.equal(h.api.samples[0].contentMs, 32); assert.equal(h.api.samples[0].settledMs, 48);
});
test('armed capture starts on the in-page event, not automation preparation', () => {
  const h = harness(); h.api.arm('nav', '.target');
  assert.equal(h.api.samples.length, 0);
  h.listeners.get('click')({ target: { closest: () => ({}) } });
  h.tick(16); h.api.finish('complete'); assert.equal(h.api.samples[0].contentMs, 16);
  assert.equal(h.listeners.has('click'), false);
});
test('settled samples collect frame timestamps without repeatedly forcing layout', () => {
  const h = harness(); h.api.start('nav', '.target', { windowMs: 100 });
  h.tick(16); h.tick(32); h.tick(48); h.tick(64); h.tick(110);
  assert.equal(h.reads(), 2); assert.equal(h.api.samples[0].frames.length, 4);
});
test('stress roster preserves the original fixture and maps monthly/daily stats by name', () => {
  const source = { roster: [{ id: 'a', name: 'Source Person', roleId: 'sales' }, { id: 'm', roleId: 'manager' }],
    months: { '2026-10': { stats: { 'source person': { unitsDelivered: 9 } }, stated: { deliveries: 9 } } },
    activity: { '2026-10-01': { 'source person': { calls: 10 } } } };
  const before = structuredClone(source), result = denseFixture(source);
  assert.equal(result.roster.length, 61); assert.equal(new Set(result.roster.map(p => p.id)).size, 61);
  assert.equal(result.months['2026-10'].stats['fictional associate 60'].unitsDelivered, 9);
  assert.equal(result.activity['2026-10-01']['fictional associate 60'].calls, 10);
  assert.deepEqual(source, before); assert.deepEqual(result.months['2026-10'].stated, before.months['2026-10'].stated);
  assert.deepEqual(result.roster[0], before.roster[0]);
  assert.equal(result.months['2026-10'].stats['source person'].unitsDelivered, 9);
  assert.equal(result.roster.at(-1).label, result.roster.at(-1).name);
});
test('each context can launch an isolated seed without changing the shared mock source', () => {
  const source = fs.readFileSync(new URL('../scripts/mock-supabase.mjs', import.meta.url), 'utf8');
  const transformed = isolatedMockSource(source, 'file:///fictional/demo-seed.mjs');
  assert.ok(transformed.includes('.listen(5434,')); assert.ok(source.includes('.listen(5433,'));
  assert.ok(transformed.includes('"file:///fictional/demo-seed.mjs"'));
  assert.throws(() => isolatedMockSource('unexpected', 'file:///fixture.mjs'), /shape changed/);
});

test('authoritative split activity keeps stress identities and the newer daily figures', () => {
  const roster = [{ id: 'a', name: 'Source Person', roleId: 'sales' }, { id: 'm', roleId: 'manager' }];
  const embedded = denseFixture({ roster, activity: { '2026-10-01': { 'source person': { calls: 10 } } } });
  const separate = { 'source person': { calls: 22, units: 3 }, 'original manager': { calls: 1 } };
  const before = structuredClone(separate);
  // This is loadStore's exact overlay order, which previously erased the clones.
  const loaded = { ...embedded.activity, '2026-10-01': denseDay(separate, roster) };
  assert.equal(Object.keys(loaded['2026-10-01']).length, 61);
  assert.deepEqual(loaded['2026-10-01']['fictional associate 60'], { calls: 22, units: 3 });
  assert.deepEqual(loaded['2026-10-01']['source person'], before['source person']);
  assert.deepEqual(loaded['2026-10-01']['original manager'], before['original manager']);
  loaded['2026-10-01']['fictional associate 60'].calls = 99;
  assert.deepEqual(separate, before);
  assert.equal(loaded['2026-10-01']['source person'].calls, 22);
});
