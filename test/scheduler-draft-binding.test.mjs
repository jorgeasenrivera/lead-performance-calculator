// Integration fixtures use the exact published planner, not a replacement model.
// The handle wrapper, codec, auth and fetch below are explicitly synthetic doubles.
// No C113 serialization, SQL, live endpoint or browser wiring is exercised.
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, posix} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSchedulerDraftBinding} from '../src/scheduler-draft-binding.mjs';
import {createSchedulerDraftTransport} from '../src/scheduler-draft-transport.mjs';
const REF = 'b6cd4798d6daa0ab950f6e8e142f6df6479521f4';
const root = mkdtempSync(join(tmpdir(), 'sage-binding-bridge-'));
after(() => rmSync(root, {recursive: true, force: true}));
const copied = new Set();
function materialize(path) {
  if (copied.has(path)) return;
  const source = execFileSync('git', ['show', `${REF}:${path}`], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  copied.add(path);
  mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), source);
  for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+\.mjs)['"]/g)) {
    if (match[1].startsWith('.')) materialize(posix.normalize(posix.join(posix.dirname(path), match[1])));
  }
}
let createPlanner, missingBridge;
try { execFileSync('git', ['cat-file', '-e', `${REF}^{commit}`], {stdio: 'ignore'}); }
catch { missingBridge = `Exact bridge fixture ${REF} unavailable; fetch this published commit to run integration checks`; }
if (!missingBridge) {
  // Only a missing pinned commit is a skip. Fixture/import failures must fail.
  materialize('scripts/scheduler-performance/month-model.mjs');
  ({createPlanner} = await import(pathToFileURL(join(root, 'scripts/scheduler-performance/month-model.mjs'))));
}
const bridgeTest = (name, fn) => test(name, {skip: missingBridge || false}, fn);
const MONTH = '2026-11', NEXT = '2026-12';
const store = () => ({id: 'fictional', name: 'Fictional', timezone: 'America/New_York', history: [],
  people: ['a', 'b'].map(id => ({id, name: id, off: [], start: 9, end: 17, maxHours: 40})),
  rules: [{effective: '2014-01-01', open: 9, close: 17, minimum: 1, closedDays: [], holidays: {}}],
  teams: [{id: 'one', name: 'One'}], memberships: []});
const deferred = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise, resolve, reject};};
async function until(predicate) {for (let i=0;i<40;i++) {if (predicate()) return; await Promise.resolve();} assert.fail('operation did not reach expected checkpoint');}
function setup({verify = () => true, codecExtra = {}, assignmentForDay = () => null} = {}) {
  const planner = createPlanner([store()], {assignmentForDay}), calls = [], acks = [], exports = [], listeners = new Set();
  let pending = false, epoch = 1, token = 'synthetic', id = 0, binding;
  const auth = {getSnapshot: () => ({principalEpoch: epoch, disposed: false}),
    getAccessToken: async () => token,
    subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);}};
  const handle = {
    exportMonth(month, index) {const value = {ok: true, ...planner.exportMonth(index, month)}; exports.push(value); return value;},
    acknowledgeMonth(month, token, index) {acks.push({month, token}); return planner.acknowledgeMonth(index, month, token);},
    hydrateMonth(projection, index) {return planner.hydrateMonth(index, projection, verify);},
    draftStatus(index) {return {ok: true, ...planner.draftStatus(index), pending};},
    hasDraft() {return planner.unsaved || pending;},
  };
  let activeHandle = handle;
  const codec = {validateScope: s => s.storeId === 'fictional' && /^2026-(11|12)$/.test(s.month),
    encode: v => v, decode: v => v, ...codecExtra};
  const transport = createSchedulerDraftTransport({auth, codec, requestId: () => `save-${++id}`, fetchImpl: (_url, options) => {
    const d = deferred(); calls.push({...d, options, body: JSON.parse(options.body)}); return d.promise;
  }});
  binding = createSchedulerDraftBinding({auth, transport, getEditor: () => activeHandle, storeId: 'fictional', index: 0, lifetime: 'mount-1'});
  planner.subscribe(event => binding.onDraftChange(event));
  const reply = (call, payload, status = 200) => call.resolve({status, json: async () => payload});
  const load = async (month = MONTH, projection = null, rev = projection ? 3 : 0) => {
    const offset = calls.length, promise = binding.load(month); await until(() => calls.length > offset);
    reply(calls.at(-1), {result: {kind: 'draft', revision: rev, schedule: projection}}); await promise;
  };
  const edit = (month = MONTH, day = '10') => planner.setAssignment(0, `${month}-${day}`, {on: ['a'], off: ['b'],
    unknownNotes: {unlisted: {source: 'unknown source'}}, generationLocks: ['a']});
  const complete = async (promise, rev = 1) => {
    await until(() => calls.at(-1)?.body.op === 'save');
    reply(calls.at(-1), {result: {head: {draftRev: rev, publishedRev: 0}}, replayed: false}); await promise;
  };
  return {binding, planner, handle, calls, acks, exports, load, edit, complete, reply,
    month: (month = MONTH) => binding.getSnapshot().months.find(m => m.month === month),
    setPending(v) {pending=v;}, setToken(v) {token=v;},
    changeAuth() {epoch++; for (const fn of [...listeners]) fn();},
    replaceHandle() {activeHandle = {...handle};}, ids: () => id};
}
bridgeTest('read absence and 503 remain distinct; load and save do not coalesce', async () => {
  const s = setup(), p = s.binding.load(MONTH);
  assert.equal(s.binding.load(MONTH), p);
  assert.throws(() => s.binding.save(MONTH), {code: 'operation-in-progress'});
  await until(() => s.calls.length === 1); s.reply(s.calls[0], {error: 'storage-not-configured'}, 503); await p;
  assert.equal(s.month().loadAccepted, false); assert.equal(s.month().controller.draftRev, null);
  assert.throws(() => s.binding.save(MONTH), {code: 'load-not-accepted'});
  await s.load(); assert.equal(s.month().loadAccepted, true); assert.equal(s.month().controller.draftRev, 0);
  s.binding.dispose();
});
bridgeTest('save coalesces, retains exact token and frozen projection despite mutation attempts', async () => {
  const s = setup(); await s.load(); s.edit();
  const p = s.binding.save(MONTH), submitted = s.exports.at(-1);
  assert.equal(s.binding.save(MONTH), p);
  submitted.projection.overrides[`${MONTH}-10`].on.push('mutated');
  assert.throws(() => s.month().controller.draft.overrides[`${MONTH}-10`].on.push('subscriber'), TypeError);
  await until(() => s.calls.length === 2);
  assert.deepEqual(s.calls[1].body.input.draft.overrides[`${MONTH}-10`].on, ['a']);
  assert.equal(Object.hasOwn(s.calls[1].body.input, 'token'), false);
  await s.complete(p);
  assert.equal(s.acks[0].token, submitted.token); assert.equal(s.planner.unsaved, false);
  assert.equal(s.binding.getSnapshot().editor.atomic, false); s.binding.dispose();
});
bridgeTest('same-turn and in-flight edits never change submission bytes or become acknowledged', async () => {
  const s = setup(); await s.load(); s.edit();
  const p = s.binding.save(MONTH), submitted = s.exports.at(-1);
  s.edit(MONTH, '11');
  await until(() => s.calls.length === 2);
  assert.equal(s.calls[1].body.input.draft.overrides[`${MONTH}-11`], undefined);
  await s.complete(p);
  assert.equal(s.acks[0].token, submitted.token);
  assert.deepEqual(s.binding.getSnapshot().editor.dirtyMonths, [MONTH]);
  assert.equal(s.month().controller.dirty, true); s.binding.dispose();
});
bridgeTest('uncertain retries retain command and token through auth denial and later edits', async () => {
  const s = setup(); await s.load(); s.edit();
  let p = s.binding.save(MONTH); const submitted = s.exports.at(-1);
  await until(() => s.calls.length === 2); s.calls[1].reject(Error('network')); await p;
  assert.equal(s.month().controller.status, 'uncertain');
  assert.throws(() => s.binding.save(MONTH), {code: 'retry-required'});
  s.setToken(null); await s.binding.retry(MONTH);
  assert.equal(s.month().controller.status, 'uncertain'); assert.equal(s.acks.length, 0);
  s.edit(MONTH, '12'); s.setToken('rotated'); p = s.binding.retry(MONTH);
  assert.equal(s.binding.retry(MONTH), p);
  await until(() => s.calls.length === 3);
  assert.equal(s.calls[1].options.body, s.calls[2].options.body); assert.equal(s.ids(), 1);
  s.reply(s.calls[2], {result: {head: {draftRev: 1, publishedRev: 0}}, replayed: true}); await p;
  assert.equal(s.acks[0].token, submitted.token); assert.equal(s.planner.unsaved, true); s.binding.dispose();
});
bridgeTest('raw C113-style verification result is refused; boolean normalization hydrates', async () => {
  for (const [verify, accepted] of [[() => ({ok: true}), false], [() => ({ok: true})?.ok === true, true]]) {
    const s = setup({verify}); const projection = s.handle.exportMonth(MONTH, 0).projection;
    await s.load(MONTH, projection); assert.equal(s.month().loadAccepted, accepted);
    if (!accepted) {assert.equal(s.month().error, 'shape'); assert.throws(() => s.binding.save(MONTH), {code: 'load-not-accepted'});}
    s.binding.dispose();
  }
});
bridgeTest('edits during read prevent hydration and preserve editor data', async () => {
  const s = setup(), projection = s.handle.exportMonth(MONTH, 0).projection;
  const p = s.binding.load(MONTH); await until(() => s.calls.length === 1); s.edit();
  s.reply(s.calls[0], {result: {kind: 'draft', revision: 4, schedule: projection}}); await p;
  assert.equal(s.month().loadAccepted, false); assert.equal(s.month().error, 'editor-changed-during-load');
  assert.ok(s.planner.get(0, MONTH).overrides[`${MONTH}-10`]); s.binding.dispose();
});
bridgeTest('pending controls block initial read/save and late hydration', async () => {
  const s = setup(); s.setPending(true);
  assert.throws(() => s.binding.load(MONTH), {code: 'unsaved-editor-changes'});
  s.setPending(false); const p = s.binding.load(MONTH); await until(() => s.calls.length === 1); s.setPending(true);
  s.reply(s.calls[0], {result: {kind: 'draft', revision: 0, schedule: null}}); await p;
  assert.equal(s.month().loadAccepted, false);
  s.setPending(false); await s.load(); s.edit(); s.setPending(true);
  assert.throws(() => s.binding.save(MONTH), {code: 'pending-editor-controls'}); s.binding.dispose();
});
bridgeTest('shared-team hydration refusal blocks persistence without changing editor teams', async () => {
  const s = setup(); await s.load(); s.edit();
  const projection = s.handle.exportMonth(NEXT, 0).projection;
  projection.store.teams.push({id: 'foreign', name: 'Foreign'});
  await s.load(NEXT, projection);
  assert.equal(s.month(NEXT).error, 'shared-teams'); assert.equal(s.month(NEXT).loadAccepted, false);
  assert.equal(s.planner.teamState[0].teams.some(t => t.id === 'foreign'), false); s.binding.dispose();
});
bridgeTest('separate month controllers retain uncertain commands and partial shared-team acknowledgements', async () => {
  const s = setup(); await s.load(); await s.load(NEXT);
  s.planner.addTeam(0, 'New shared team');
  let p = s.binding.save(MONTH); await until(() => s.calls.length === 3); s.calls[2].reject(Error('lost')); await p;
  p = s.binding.save(NEXT); await until(() => s.calls.length === 4); await s.complete(p);
  assert.equal(s.month().controller.status, 'uncertain');
  assert.deepEqual(s.binding.getSnapshot().editor.dirtyMonths, [MONTH]);
  assert.ok(s.binding.getSnapshot().editor.unresolved.length > 0);
  p = s.binding.retry(MONTH); await until(() => s.calls.length === 5);
  assert.equal(s.calls[2].options.body, s.calls[4].options.body); await s.complete(p);
  assert.deepEqual(s.binding.getSnapshot().editor.dirtyMonths, []);
  assert.deepEqual(s.binding.getSnapshot().editor.unresolved, []); s.binding.dispose();
});
for (const change of ['changeAuth', 'replaceHandle', 'dispose']) bridgeTest(`late save cannot acknowledge after ${change}`, async () => {
  const s = setup(); await s.load(); s.edit(); const p = s.binding.save(MONTH);
  await until(() => s.calls.length === 2);
  if (change === 'dispose') s.binding.dispose(); else s[change]();
  s.reply(s.calls[1], {result: {head: {draftRev: 1, publishedRev: 0}}, replayed: false}); await p;
  assert.equal(s.acks.length, 0); assert.equal(s.binding.getSnapshot().active, false);
});
bridgeTest('conflict never acknowledges or silently retries', async () => {
  const s = setup(); await s.load(); s.edit(); const p = s.binding.save(MONTH);
  await until(() => s.calls.length === 2); s.reply(s.calls[1], {error: 'conflict'}, 409); await p;
  assert.equal(s.acks.length, 0); assert.equal(s.planner.unsaved, true);
  assert.throws(() => s.binding.save(MONTH), {code: 'conflict-unresolved'}); s.binding.dispose();
});
bridgeTest('ack refusal keeps editor blocked; caller token cannot replace retained original', async () => {
  const s = setup(); await s.load(); s.edit();
  const realAck = s.handle.acknowledgeMonth;
  s.handle.acknowledgeMonth = (month, token, index) => realAck(month, {...token}, index);
  const p = s.binding.save(MONTH); await until(() => s.calls.length === 2); await s.complete(p);
  assert.equal(s.month().error, 'unknown-submission'); assert.equal(s.month().loadAccepted, false);
  assert.equal(s.planner.unsaved, true); assert.throws(() => s.binding.save(MONTH), {code: 'load-not-accepted'}); s.binding.dispose();
});
bridgeTest('outgoing lossy codec fails before sending and does not acknowledge', async () => {
  const s = setup({codecExtra: {encode: () => ({})}}); await s.load(); s.edit();
  await s.binding.save(MONTH);
  assert.equal(s.calls.length, 1); assert.equal(s.acks.length, 0);
  assert.equal(s.month().error, 'unsupported-data'); assert.equal(s.month().awaitingAcknowledgement, false); s.binding.dispose();
});
bridgeTest('wire reads require result.schedule, never result.draft or an unwrapped projection', async () => {
  // Confirmed against _scheduler-contract/projectRead and _scheduler-store at
  // 0fcfb0c02edf6e5bc694ea63d23adb22c86581e5. "draft" is only our decoded model field.
  for (const payload of [{result: {kind: 'draft', revision: 0, draft: null}},
    {kind: 'draft', revision: 0, schedule: null},
    {result: {kind: 'draft', revision: 0, schedule: null, draft: null}}]) {
    const s = setup(), p = s.binding.load(MONTH);
    await until(() => s.calls.length === 1); s.reply(s.calls[0], payload); await p;
    assert.equal(s.month().loadAccepted, false); assert.equal(s.month().controller.error, 'invalid-response');
    assert.equal(s.month().controller.draftRev, null); s.binding.dispose();
  }
});
bridgeTest('actual planner rejects foreign, wrong-month and stale acknowledgement identities', () => {
  const s = setup(), foreign = setup();
  const old = s.handle.exportMonth(MONTH, 0), otherMonth = s.handle.exportMonth(NEXT, 0);
  const alien = foreign.handle.exportMonth(MONTH, 0);
  assert.equal(s.handle.acknowledgeMonth(MONTH, alien.token, 0).reason, 'unknown-submission');
  assert.equal(s.handle.acknowledgeMonth(MONTH, otherMonth.token, 0).reason, 'wrong-scope');
  const newer = s.handle.exportMonth(MONTH, 0);
  assert.equal(s.handle.acknowledgeMonth(MONTH, newer.token, 0).ok, true);
  assert.equal(s.handle.acknowledgeMonth(MONTH, old.token, 0).reason, 'stale');
  s.binding.dispose(); foreign.binding.dispose();
});
bridgeTest('notification reentrancy coalesces save while preserving a synchronous new edit', async () => {
  const s = setup(); await s.load(); s.edit();
  let entered = false, coalesced;
  s.binding.subscribe(() => {
    if (!entered && s.month()?.operation === 'save') {
      entered = true; coalesced = s.binding.save(MONTH); s.edit(MONTH, '15');
    }
  });
  const p = s.binding.save(MONTH); assert.equal(p, coalesced);
  await until(() => s.calls.length === 2);
  assert.equal(s.calls[1].body.input.draft.overrides[`${MONTH}-15`], undefined);
  await s.complete(p); assert.equal(s.planner.unsaved, true); assert.equal(s.acks.length, 1); s.binding.dispose();
});
bridgeTest('subscriber disposal before dispatch prevents sending and acknowledgement', async () => {
  const s = setup(); await s.load(); s.edit(); let entered = false;
  s.binding.subscribe(() => {
    if (!entered && s.month()?.operation === 'save') {entered = true; s.binding.dispose();}
  });
  await s.binding.save(MONTH);
  assert.equal(s.calls.length, 1); assert.equal(s.acks.length, 0); assert.equal(s.binding.getSnapshot().active, false);
});
bridgeTest('actual cross-month off-day move stays unresolved after one durable acknowledgement', async () => {
  const s = setup({assignmentForDay: day => day === '2026-11-30' ? {on: ['b'], off: ['a'],
    absences: {a: {kind: 'legacy-off', source: {file: 'fictional.csv', line: 4}}}} : null});
  await s.load(); await s.load(NEXT);
  s.planner.applyOffDay(s.planner.reviewOffDay({index: 0, personId: 'a', from: '2026-11-30', to: '2026-12-01', mode: 'move'}));
  assert.deepEqual(s.binding.getSnapshot().editor.dirtyMonths, [MONTH, NEXT]);
  let p = s.binding.save(MONTH); await until(() => s.calls.length === 3); await s.complete(p);
  let aggregate = s.binding.getSnapshot().editor;
  assert.deepEqual(aggregate.dirtyMonths, [NEXT]); assert.equal(aggregate.atomic, false);
  assert.deepEqual(aggregate.unresolved.map(g => [g.reason, g.complete]), [['cross-month-move', false]]);
  p = s.binding.save(NEXT); await until(() => s.calls.length === 4); await s.complete(p);
  aggregate = s.binding.getSnapshot().editor;
  assert.deepEqual(aggregate.dirtyMonths, []); assert.deepEqual(aggregate.unresolved, []); s.binding.dispose();
});
