import test from 'node:test';
import assert from 'node:assert/strict';
import {createSchedulerDraftController} from '../src/scheduler-draft-state.mjs';
import {draftError} from '../src/scheduler-draft-transport.mjs';
const scope = {storeId: 'fictional', month: '2026-10', lifetime: 'editor-1'};
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; };
function setup() {
  let epoch = 1, ids = 0;
  const listeners = new Set(), calls = [];
  const auth = {getSnapshot: () => ({principalEpoch: epoch}), subscribe: fn => {listeners.add(fn); return () => listeners.delete(fn);}};
  const transport = {
    prepareRead: scope => ({op: 'read', scope}),
    prepareSave: (scope, rev, draft) => ({op: 'save', scope, rev, draft, id: ++ids}),
    send: (command, options) => {const d = deferred(); calls.push({command, options, ...d}); return d.promise;},
  };
  const c = createSchedulerDraftController({auth, transport}); c.setContext(scope);
  const tick = () => Promise.resolve();
  const load = async (revision = 0) => {const p = c.load(); await tick(); calls.at(-1).resolve({kind: 'draft', revision, draft: revision ? {n: 1} : null}); await p;};
  return {c, calls, tick, load, changeAuth() {epoch++; for (const fn of listeners) fn();}};
}
test('absent draft is editable; a read 503 does not create revision zero', async () => {
  const {c, calls, tick, load} = setup();
  const p = c.load(); await tick(); calls[0].reject(draftError('storage-not-configured')); await p;
  assert.equal(c.getSnapshot().draftRev, null); assert.equal(c.getSnapshot().status, 'unavailable');
  assert.throws(() => c.edit({n: 1}), {code: 'not-loaded'});
  await load(); assert.equal(c.getSnapshot().status, 'absent'); c.edit({n: 1});
  assert.equal(c.getSnapshot().dirty, true);
});
test('save coalesces clicks and retains edits made while saving', async () => {
  const {c, calls, load, tick} = setup(); await load(2); c.edit({n: 2});
  const p = c.save(); assert.equal(c.save(), p); await tick(); c.edit({n: 3});
  assert.deepEqual(calls[1].command.draft, {n: 2});
  calls[1].resolve({head: {draftRev: 3, publishedRev: 1}, replayed: false}); await p;
  assert.deepEqual(c.getSnapshot().draft, {n: 3}); assert.equal(c.getSnapshot().status, 'dirty');
  assert.equal(c.getSnapshot().publishedRev, 1); assert.equal(c.getSnapshot().kind, 'draft');
  const next = c.save(); await tick(); assert.equal(calls[2].command.rev, 3);
  calls[2].resolve({head: {draftRev: 4, publishedRev: 1}, replayed: false}); await next;
  assert.equal(c.getSnapshot().status, 'saved'); assert.equal(c.getSnapshot().scope.month, scope.month);
});
test('uncertain retry retains exact command and newer edits, blocks fresh save/load', async () => {
  const {c, calls, load, tick} = setup(); await load(); c.edit({n: 2});
  let p = c.save(); await tick(); const command = calls[1].command;
  calls[1].reject(draftError('timeout', true)); await p;
  c.edit({n: 3}); assert.equal(c.getSnapshot().status, 'uncertain');
  assert.throws(() => c.save(), {code: 'retry-required'}); assert.throws(() => c.load(), {code: 'unsaved-edits'});
  p = c.retry(); assert.equal(c.retry(), p); await tick(); assert.equal(calls[2].command, command);
  calls[2].resolve({head: {draftRev: 1, publishedRev: 0}, replayed: true}); await p;
  assert.deepEqual(c.getSnapshot().draft, {n: 3}); assert.equal(c.getSnapshot().dirty, true);
});
test('conflicts preserve edits and never automatically rebase or resubmit', async () => {
  const {c, calls, load, tick} = setup(); await load(5); c.edit({n: 2});
  const p = c.save(); await tick(); calls[1].reject(draftError('conflict')); await p;
  c.edit({n: 3}); assert.equal(c.getSnapshot().status, 'conflict');
  assert.throws(() => c.save(), {code: 'conflict-unresolved'});
  assert.throws(() => c.retry(), {code: 'nothing-to-retry'});
  assert.throws(() => c.load(), {code: 'unsaved-edits'});
  assert.equal(c.getSnapshot().draftRev, 5); assert.deepEqual(c.getSnapshot().draft, {n: 3}); assert.equal(calls.length, 2);
});
for (const boundary of ['store', 'month', 'lifetime', 'principal', 'dispose']) {
  test(`late save completion cannot cross ${boundary}`, async () => {
    const {c, calls, load, tick, changeAuth} = setup(); await load(1); c.edit({n: 2});
    const p = c.save(); await tick();
    if (boundary === 'principal') changeAuth();
    else if (boundary === 'dispose') c.dispose();
    else c.setContext({...scope, ...{store: {storeId: 'other'}, month: {month: '2026-11'}, lifetime: {lifetime: 'editor-2'}}[boundary]});
    const expected = c.getSnapshot();
    assert.equal(calls[1].options.signal.aborted, true);
    calls[1].resolve({head: {draftRev: 2, publishedRev: 0}, replayed: false}); await p;
    assert.equal(c.getSnapshot(), expected); assert.equal(expected.draft, null);
  });
}
test('late read cannot replace current month; replay never decreases known revisions', async () => {
  const {c, calls, tick, load} = setup(); const old = c.load(); await tick();
  c.setContext({...scope, month: '2026-11'}); await load(7);
  calls[0].resolve({kind: 'draft', revision: 1, draft: {old: true}}); await old;
  assert.equal(c.getSnapshot().draftRev, 7); c.edit({n: 2});
  let p = c.save(); await tick(); calls.at(-1).resolve({head: {draftRev: 8, publishedRev: 4}, replayed: false}); await p;
  c.edit({n: 3}); p = c.save(); await tick(); calls.at(-1).resolve({head: {draftRev: 6, publishedRev: 2}, replayed: true}); await p;
  assert.equal(c.getSnapshot().draftRev, 8); assert.equal(c.getSnapshot().publishedRev, 4);
});
test('subscriber reentrant save coalesces; model and snapshots are immutable', async () => {
  const {c, calls, tick, load} = setup(); await load(); const model = {nested: {n: 2}}; c.edit(model); model.nested.n = 3;
  let nested;
  c.subscribe(() => {if (c.getSnapshot().status === 'saving') nested = c.save();});
  const p = c.save(); assert.equal(nested, p); await tick();
  assert.equal(calls[1].command.draft.nested.n, 2);
  assert.throws(() => {c.getSnapshot().draft.nested.n = 4;}, TypeError);
  calls[1].resolve({head: {draftRev: 1, publishedRev: 0}, replayed: false}); await p;
});
test('denied retry cannot erase an earlier uncertain command', async () => {
  const {c, calls, load, tick} = setup(); await load(); c.edit({n: 2});
  let p = c.save(); await tick(); const command = calls[1].command;
  calls[1].reject(draftError('timeout', true)); await p;
  for (const code of ['unauthenticated', 'forbidden', 'auth-unavailable']) {
    p = c.retry(); await tick(); assert.equal(calls.at(-1).command, command);
    calls.at(-1).reject(draftError(code, false)); await p;
    assert.equal(c.getSnapshot().status, 'uncertain'); assert.throws(() => c.save(), {code: 'retry-required'});
  }
  p = c.retry(); await tick(); calls.at(-1).resolve({head: {draftRev: 1, publishedRev: 0}, replayed: true}); await p;
  assert.equal(c.getSnapshot().status, 'saved');
});
