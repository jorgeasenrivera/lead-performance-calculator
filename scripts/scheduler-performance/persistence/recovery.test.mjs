import test from 'node:test';
import assert from 'node:assert/strict';
import { planReset, planRestore, assertNoOverwrite } from './recovery.mjs';
import { planDraftSave } from './cas.mjs';
import { planPublication } from './publish-plan.mjs';
import { createFakePort } from './fake-port.mjs';
import { verifyChain } from './audit-entry.mjs';
import { deserializeVersion } from './deserialize.mjs';

// Synthetic fixture. Copied into each test file because the persistence tests
// may not share a helper module; keep the copies identical.
const clone = value => JSON.parse(JSON.stringify(value));
const shift = (day, over = {}) => ({ storeId: 'cedar', personId: 'a', date: day, endDate: day, startMinute: 540, endMinute: 1020, timezone: 'America/New_York', ...over });
const makeDraft = (over = {}) => ({
  storeId: 'cedar', month: '2026-10',
  store: {
    people: [
      { id: 'a', name: 'Alex', start: 9, end: 17, off: [], maxHours: 40 },
      { id: 'b', name: 'Blair', start: 9, end: 17, off: [0], maxHours: 40 },
    ],
    rules: [{ effective: '2014-01-01', open: 9, close: 17, minimum: 1, capacity: 8, useCapacity: false, closedDays: [0], holidays: { '2026-11-26': 'closed' } }],
    teams: [{ id: 'oak', name: 'Oak team' }],
    memberships: [
      { storeId: 'cedar', personId: 'a', teamIds: ['oak'], from: '2014-01-01', to: '2100-12-31', unknown: false, source: { kind: 'fictional default' } },
      { storeId: 'cedar', personId: 'b', teamIds: [], from: '2014-01-01', to: '2100-12-31', unknown: true },
    ],
  },
  overrides: {
    '2026-10-05': { on: ['a'], off: ['b'], shifts: [shift('2026-10-05')], absences: { b: { kind: 'off', source: { kind: 'manager day edit' } } } },
  },
  ...over,
});
const ACTOR = { id: 'manager-1' };
const AT = '2026-10-18T09:00:00Z';

const codes = result => result.problems.map(p => p.code);
const FINGERPRINT = '[]';
const ID = { storeId: 'cedar', month: '2026-10' };
const draftWith = name => { const d = makeDraft(); d.store.people[0].name = name; return d; };
const save = (port, draft) => {
  const head = port.head('cedar', '2026-10');
  const planned = planDraftSave({ ...ID, draft, baseRev: head ? head.draftRev : 0, head, actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash('cedar', '2026-10') });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(port.apply(planned.plan).ok, true);
};
const publish = port => {
  const head = port.head('cedar', '2026-10');
  const planned = planPublication({ ...ID, draft: JSON.parse(JSON.stringify(deserializeVersion(port.versionText('draft', 'cedar', '2026-10', head.draftRev), ID).draft)), draftRev: head.draftRev, head, review: { fingerprint: FINGERPRINT, openIssues: 0 }, recomputedFingerprint: FINGERPRINT, adjacent: { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 0, next: 0 } }, actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash('cedar', '2026-10') });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(port.apply(planned.plan).ok, true);
};
// Draft 1 (Alex), draft 2 (Alexandra), published 1 and draft 3 (the publish moves the draft).
const history = () => {
  const port = createFakePort();
  save(port, draftWith('Alex'));
  save(port, draftWith('Alexandra'));
  publish(port);
  return port;
};
const resetInput = (port, over = {}) => { const head = port.head('cedar', '2026-10'); return { ...ID, baseRev: head.draftRev, head, freshDraft: makeDraft(), actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash('cedar', '2026-10'), ...over }; };
const restoreInput = (port, kind, rev, over = {}) => { const head = port.head('cedar', '2026-10'); return { ...ID, baseRev: head.draftRev, head, target: { text: port.versionText(kind, 'cedar', '2026-10', rev), kind, rev }, actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash('cedar', '2026-10'), ...over }; };

test('reset starts the month again as the next draft and deletes nothing', () => {
  const port = history();
  const idsBefore = port.versionIds(), textsBefore = idsBefore.map(id => { const [s, m, k, r] = id.split('/'); return port.versionText(k, s, m, Number(r)); });
  const planned = planReset(resetInput(port));
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.deepEqual(planned.plan.resultingHead, { draftRev: 4, publishedRev: 1 });
  assert.equal(port.apply(planned.plan).ok, true);
  assert.deepEqual(port.head('cedar', '2026-10'), { draftRev: 4, publishedRev: 1 });
  const after = port.versionIds();
  assert.deepEqual(after, [...idsBefore, 'cedar/2026-10/draft/4'].sort());
  assert.deepEqual(idsBefore.map(id => { const [s, m, k, r] = id.split('/'); return port.versionText(k, s, m, Number(r)); }), textsBefore, 'every earlier version is byte for byte unchanged');
  const reset = deserializeVersion(port.versionText('draft', 'cedar', '2026-10', 4), ID);
  assert.deepEqual(reset.meta, { resetFrom: 3 });
  assert.equal(reset.draft.store.people[0].name, 'Alex', 'the fresh draft the caller supplied');
  const log = port.auditLog('cedar', '2026-10');
  assert.equal(log.at(-1).action, 'reset');
  assert.deepEqual(verifyChain(log), { ok: true });
});

test('reset never reuses a revision number, even after a restore', () => {
  const port = history();
  port.apply(planReset(resetInput(port)).plan);
  port.apply(planRestore(restoreInput(port, 'draft', 2)).plan);
  port.apply(planReset(resetInput(port)).plan);
  assert.deepEqual(port.versionIds().filter(id => id.includes('/draft/')).map(id => id.split('/')[3]), ['1', '2', '3', '4', '5', '6']);
});

test('reset leaves the published version alone', () => {
  const port = history();
  const published = port.versionText('published', 'cedar', '2026-10', 1);
  port.apply(planReset(resetInput(port)).plan);
  assert.equal(port.head('cedar', '2026-10').publishedRev, 1);
  assert.equal(port.versionText('published', 'cedar', '2026-10', 1), published);
});

test('reset refuses when there is nothing to reset, the base is stale, or the fresh draft is not valid', () => {
  assert.equal(planReset({ ...ID, baseRev: 0, head: null, freshDraft: makeDraft(), actor: ACTOR, at: AT }).code, 'nothing-to-reset');
  const port = history();
  assert.equal(planReset(resetInput(port, { baseRev: 1 })).code, 'stale');
  assert.equal(planReset(resetInput(port, { baseRev: 0 })).code, 'exists');
  const poisoned = makeDraft(); poisoned.overrides['2026-10-06'] = { on: ['zzz'], off: [] };
  assert.ok(codes(planReset(resetInput(port, { freshDraft: poisoned }))).includes('unknown-person'));
  assert.equal(planReset(resetInput(port, { freshDraft: makeDraft({ storeId: 'elm' }) })).code, 'invalid');
  assert.equal(planReset(resetInput(port, { actor: undefined })).code, 'invalid');
  assert.equal(planReset(resetInput(port, { head: undefined })).code, 'bad-head');
  assert.equal(planReset(undefined).code, 'invalid');
});

test('a stale reset applied late fails and changes nothing', () => {
  const port = history();
  const plan = planReset(resetInput(port)).plan;
  save(port, draftWith('Someone else first'));
  const before = port.snapshot();
  const result = port.apply(plan);
  assert.deepEqual([result.ok, result.code], [false, 'stale']);
  assert.equal(port.snapshot(), before);
});

test('restore brings an earlier draft back as the newest, leaving the original where it was', () => {
  const port = history();
  const original = port.versionText('draft', 'cedar', '2026-10', 1);
  const planned = planRestore(restoreInput(port, 'draft', 1));
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(port.apply(planned.plan).ok, true);
  assert.deepEqual(port.head('cedar', '2026-10'), { draftRev: 4, publishedRev: 1 });
  const restored = deserializeVersion(port.versionText('draft', 'cedar', '2026-10', 4), ID);
  assert.deepEqual(restored.meta, { restoredFrom: { kind: 'draft', rev: 1 } });
  assert.equal(restored.draft.store.people[0].name, 'Alex');
  assert.equal(port.versionText('draft', 'cedar', '2026-10', 1), original, 'revision 1 is untouched');
  const entry = port.auditLog('cedar', '2026-10').at(-1);
  assert.deepEqual([entry.action, entry.detail], ['restore', { restoredKind: 'draft', restoredRev: 1 }]);
});

test('a published version can be restored as a draft, and stays published and unchanged', () => {
  const port = history();
  const published = port.versionText('published', 'cedar', '2026-10', 1);
  assert.equal(port.apply(planRestore(restoreInput(port, 'published', 1)).plan).ok, true);
  assert.deepEqual(deserializeVersion(port.versionText('draft', 'cedar', '2026-10', 4), ID).meta, { restoredFrom: { kind: 'published', rev: 1 } });
  assert.equal(port.versionText('published', 'cedar', '2026-10', 1), published);
  assert.equal(port.head('cedar', '2026-10').publishedRev, 1);
});

test('restore PLANS from a supplied head that shows no draft (planning only, nothing is applied)', () => {
  const port = createFakePort();
  save(port, makeDraft());
  publish(port);
  const head = { draftRev: 0, publishedRev: 1 }; // a draft head the caller reads as absent
  const text = port.versionText('published', 'cedar', '2026-10', 1);
  const planned = planRestore({ ...ID, baseRev: 0, head, target: { text, kind: 'published', rev: 1 }, actor: ACTOR, at: AT });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(planned.plan.ops[0].rev, 1);
});

test('restore refuses text for another store, month, kind or revision, and text that was altered', () => {
  const port = history();
  const base = restoreInput(port, 'draft', 1);
  assert.ok(codes(planRestore({ ...base, target: { ...base.target, rev: 2 } })).includes('rev-mismatch'));
  assert.ok(codes(planRestore({ ...base, target: { ...base.target, kind: 'published' } })).includes('kind-mismatch'));
  assert.ok(codes(planRestore({ ...base, month: '2026-11' })).includes('identity-mismatch'));
  assert.ok(codes(planRestore({ ...base, storeId: 'elm' })).includes('identity-mismatch'));
  assert.ok(codes(planRestore({ ...base, target: { ...base.target, text: base.target.text.replace('Alex', 'Mallory') } })).includes('hash-mismatch'));
  assert.equal(planRestore({ ...base, target: { kind: 'draft', rev: 1 } }).code, 'bad-target');
  assert.equal(planRestore({ ...base, target: undefined }).code, 'bad-target');
  assert.equal(planRestore({ ...base, baseRev: 1 }).code, 'stale');
  assert.equal(planRestore({ ...base, actor: { id: 'a', role: 'admin' } }).code, 'invalid');
});

test('a plan that would land on a stored version is named, and the port refuses to overwrite', () => {
  const port = history();
  const plan = planReset(resetInput(port)).plan;
  assert.deepEqual(assertNoOverwrite(plan, port.versionIds()), { ok: true });
  const clash = assertNoOverwrite(plan, [...port.versionIds(), 'cedar/2026-10/draft/4']);
  assert.deepEqual([clash.ok, clash.code, clash.ids], [false, 'would-overwrite', ['cedar/2026-10/draft/4']]);
  assert.equal(assertNoOverwrite(undefined, []).ok, true, 'no plan, no clash');
  // The same plan applied twice: the second time the head has moved, so nothing is replaced.
  assert.equal(port.apply(plan).ok, true);
  const before = port.snapshot();
  assert.equal(port.apply(plan).code, 'stale');
  assert.equal(port.snapshot(), before);
});

test('a published version cannot be replaced by any plan; only superseded', () => {
  const port = history();
  const text = port.versionText('published', 'cedar', '2026-10', 1);
  const forged = { ops: [{ op: 'put-version', kind: 'published', storeId: 'cedar', month: '2026-10', expectedRev: 0, rev: 1, text }] };
  const before = port.snapshot();
  assert.equal(port.apply(forged).code, 'stale');
  assert.equal(port.snapshot(), before);
});

test('recovery plans do not change their input and carry no authorization claim', () => {
  const port = history();
  const reset = resetInput(port), restore = restoreInput(port, 'draft', 1);
  const copies = [JSON.parse(JSON.stringify(reset)), JSON.parse(JSON.stringify(restore))];
  const a = planReset(reset), b = planRestore(restore);
  assert.deepEqual([reset, restore], copies);
  assert.deepEqual([a.plan.authorization, b.plan.authorization], ['not-checked', 'not-checked']);
  assert.deepEqual(planReset(reset), a, 'the same input gives the same plan');
});

// ---- Review round 1: the draft high-water mark ----------------------------------------------

test('a head that forgets the draft high-water mark cannot be applied: the store must keep it', () => {
  const port = history(); // draft revisions 1 to 3 exist
  const forgotten = { draftRev: 0, publishedRev: 1 };
  const planned = planRestore({ ...ID, baseRev: 0, head: forgotten, target: { text: port.versionText('published', 'cedar', '2026-10', 1), kind: 'published', rev: 1 }, actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash('cedar', '2026-10') });
  assert.equal(planned.ok, true, 'planning trusts the head it is given');
  assert.equal(planned.plan.ops[0].rev, 1, 'and would claim revision 1, which already exists');
  const before = port.snapshot();
  const refused = port.apply(planned.plan);
  assert.deepEqual([refused.ok, refused.code], [false, 'stale'], 'the port keeps the high-water mark and refuses');
  assert.equal(port.snapshot(), before);
  assert.equal(assertNoOverwrite(planned.plan, port.versionIds()).code, 'would-overwrite', 'and the overwrite check names it');
});
