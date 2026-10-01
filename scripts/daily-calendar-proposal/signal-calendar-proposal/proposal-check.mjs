import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMonthReader, visibleMonth } from './month-reader.mjs';
import { createControlledTransport } from '../synthetic-fixtures/controlled-transport.mjs';
import { malformedCases, httpErrors } from '../synthetic-fixtures/fixture-catalog.mjs';
import { verifySource, sourceRoot } from './build.mjs';
import { transformManager } from './transform-manager.mjs';
import path from 'node:path';
const payload = async (name) => JSON.parse(await readFile(new URL(`../synthetic-fixtures/payloads/${name}.json`, import.meta.url), 'utf8'));
const alpha = await payload('alpha-september'), beta = await payload('beta-september');
const corrected = await payload('alpha-september-corrected'), october = await payload('alpha-october');
const scope = { storeId: 'fictional-a', month: '2026-09', revision: 0 };
const readCount = (reader) => reader.state.days.find((day) => day.date === '2026-09-18')?.count;
const make = (options = {}) => {
  const transport = createControlledTransport({ abortMode: 'ignore' }), states = [];
  const reader = createMonthReader({ fetch: transport.fetch, onChange: (state) => states.push(state), ...options });
  return { transport, reader, states };
};

test('pinned owner source verifies and fixture transforms are bounded', async () => {
  const contract = await verifySource(), source = await readFile(path.join(sourceRoot, 'src/Manager.jsx'), 'utf8');
  assert.equal(contract.sourceCommit, '0f165a2e5d7c7c55fe569619553b800893b97122');
  const result = transformManager(source);
  assert.equal(result.operations.length, 9);
  assert.throws(() => transformManager(source + '\n'), /source changed/);
  const { phoneStart, desktopEnd } = result.boundaries;
  assert.ok(result.code.includes(source.slice(0, phoneStart)), 'source before phone is unchanged');
  assert.ok(result.code.endsWith(source.slice(desktopEnd)), 'source after desktop is unchanged, including actual SignalSchedule handlers');
  assert.equal((result.code.match(/const dayUnits = useMemo/g) || []).length, (source.match(/const dayUnits = useMemo/g) || []).length);
  const originalDerivations = [...source.matchAll(/const dayUnits = useMemo\(\(\) => \{[\s\S]*?\}, \[digests\]\);/g)].map((m) => m[0]);
  for (const derivation of originalDerivations) assert.ok(result.code.includes(derivation), 'held digest path is not fed report counts');
  assert.ok(result.code.includes('data-daily-unavailable="phone-best-day"'));
  assert.ok(result.code.includes('data-daily-unavailable="recap"'));
});
test('actual Signal shell ownership, style injection and cleanup are used', async () => {
  const entry = await readFile(new URL('./entry.jsx', import.meta.url), 'utf8');
  assert.match(entry, /import \{ ownManagerSignalSurface \} from '@sage\/manager-signal.mjs'/);
  assert.match(entry, /useLayoutEffect\(\(\) => ownManagerSignalSurface\(\), \[\]\)/);
  assert.match(entry, /<style data-fixture-signal-style>\{signalCSS\}<\/style>/);
});
test('successful response exposes exact printed count and known zero', async () => {
  const { reader, transport } = make();
  const done = reader.select(scope); assert.equal(reader.state.phase, 'loading');
  transport.settle(1, { body: alpha }); await done;
  assert.equal(reader.state.phase, 'ready'); assert.equal(readCount(reader), 7);
  assert.equal(reader.state.days[18].count, 0); assert.equal(reader.state.days[16].count, null);
});
test('selection identity is checked synchronously before the effect runs', async () => {
  const { reader, transport } = make(); const done = reader.select(scope); transport.settle(1, { body: alpha }); await done;
  for (const change of [{ storeId: 'fictional-b' }, { month: '2026-10' }, { revision: 1 }]) {
    const result = visibleMonth(reader.state, { ...scope, ...change });
    assert.equal(result.phase, 'loading'); assert.deepEqual(result.days, []);
  }
  assert.equal(visibleMonth(reader.state, { ...scope, active: false }).phase, 'idle');
});
test('old Alpha resolving after Beta cannot repaint', async () => {
  const { reader, transport } = make(); const first = reader.select(scope);
  const second = reader.select({ ...scope, storeId: 'fictional-b' });
  transport.settle(2, { body: beta }); await second;
  transport.settle(1, { body: alpha }); await first;
  assert.equal(reader.state.storeId, 'fictional-b'); assert.equal(readCount(reader), 11);
});
test('old September resolving after October cannot repaint', async () => {
  const { reader, transport } = make(); const first = reader.select(scope);
  const second = reader.select({ ...scope, month: '2026-10' });
  transport.settle(2, { body: october }); await second;
  transport.settle(1, { body: alpha }); await first;
  assert.equal(reader.state.month, '2026-10'); assert.equal(reader.state.days.length, 31);
  assert.ok(reader.state.days.every((day) => day.count === null));
});
test('same-identity reopen is guarded by generation, not only store/month', async () => {
  const { reader, transport } = make(); const first = reader.select(scope); reader.cancel();
  const second = reader.select(scope); transport.settle(2, { body: corrected }); await second;
  transport.settle(1, { body: alpha }); await first;
  assert.equal(readCount(reader), 6);
});
test('Alpha-Beta-Alpha rapid selection rejects the first Alpha generation', async () => {
  const { reader, transport } = make(); const first = reader.select(scope);
  const second = reader.select({ ...scope, storeId: 'fictional-b' }); const third = reader.select(scope);
  transport.settle(3, { body: corrected }); await third;
  transport.settle(2, { body: beta }); await second; transport.settle(1, { body: alpha }); await first;
  assert.equal(reader.state.storeId, 'fictional-a'); assert.equal(readCount(reader), 6);
});
test('timeout then retry cannot be overwritten by the obsolete request', async () => {
  const timers = []; const { reader, transport } = make({ setTimer: (fn) => { timers.push(fn); return fn; }, clearTimer: () => {} });
  const first = reader.select(scope); timers[0](); assert.equal(reader.state.phase, 'error');
  const second = reader.select(scope); transport.settle(2, { body: corrected }); await second;
  transport.settle(1, { body: alpha }); await first; assert.equal(readCount(reader), 6);
});
test('unmount cancellation is silent and late completions cannot emit', async () => {
  const { reader, transport, states } = make(); const done = reader.select(scope);
  reader.cancel({ silent: true }); const size = states.length;
  transport.settle(1, { body: alpha }); await done;
  assert.equal(states.length, size); assert.equal(reader.state.phase, 'idle');
});
for (const [name, envelope] of Object.entries(httpErrors)) {
  test(`${name} is a transport failure, not a missing-data success`, async () => {
    const { reader, transport } = make(); const done = reader.select(scope); transport.settle(1, envelope); await done;
    assert.equal(reader.state.phase, envelope.status === 503 ? 'error' : 'denied'); assert.deepEqual(reader.state.days, []);
  });
}
test('all malformed successes fail closed before any day is published', async () => {
  for (const [name, response] of Object.entries(malformedCases(alpha))) {
    const { reader, transport } = make(); const done = reader.select(scope); transport.settle(1, response); await done;
    assert.equal(reader.state.phase, 'error', name); assert.deepEqual(reader.state.days, [], name);
  }
});
test('network errors clear old values and retry recovers', async () => {
  const { reader, transport } = make(); const first = reader.select(scope); transport.fail(1); await first;
  assert.equal(reader.state.phase, 'error');
  const second = reader.select(scope); transport.settle(2, { body: alpha }); await second;
  assert.equal(reader.state.phase, 'ready'); assert.equal(readCount(reader), 7);
});
test('a later hold removes every earlier known count', async () => {
  const { reader, transport } = make(); const first = reader.select(scope); transport.settle(1, { body: alpha }); await first;
  const second = reader.select(scope); transport.settle(2, { body: await payload('alpha-september-all-held') }); await second;
  assert.equal(reader.state.phase, 'ready'); assert.ok(reader.state.days.every((day) => day.count === null && day.status === 'incomplete'));
});
test('no source generation or held helper is normalized to make a check pass', async () => {
  const source = await readFile(path.join(sourceRoot, 'src/Manager.jsx'), 'utf8');
  const { code } = transformManager(source);
  const fragments = [
    source.slice(source.indexOf('function SignalSchedule('), source.indexOf('\nfunction SignalPenaltyRank(')),
    source.slice(source.indexOf('    if (pop.k === "stock")', source.indexOf('function BoardRoomPhone(')), source.indexOf('    if (pop.k === "onoff")', source.indexOf('function BoardRoomPhone('))),
  ];
  for (const fragment of fragments) { assert.ok(fragment.length > 200); assert.ok(code.includes(fragment)); }
});
