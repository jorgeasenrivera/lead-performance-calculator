import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWrite, planDraftSave, expectHeadOp, putVersionOp, appendAuditOp, headProblem, normalHead } from './cas.mjs';
import { createFakePort } from './fake-port.mjs';
import { buildAuditEntry, verifyChain } from './audit-entry.mjs';
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
const elmDraft = () => {
  const d = makeDraft({ storeId: 'elm' });
  d.store.memberships = d.store.memberships.map(m => ({ ...m, storeId: 'elm' }));
  d.overrides['2026-10-05'].shifts[0].storeId = 'elm';
  return d;
};
// Plans a draft save from what the port holds right now, as a caller would.
const planSave = (port, over = {}) => {
  const storeId = over.storeId ?? 'cedar', month = over.month ?? '2026-10';
  const { head: given, ...rest } = over;
  const head = given !== undefined ? given : port.head(storeId, month);
  return planDraftSave({ storeId, month, draft: storeId === 'cedar' ? makeDraft() : elmDraft(), baseRev: head ? head.draftRev : 0, head, actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash(storeId, month), ...rest });
};

test('first write needs base 0 and nothing stored', () => {
  assert.deepEqual(evaluateWrite({ current: null, baseRev: 0 }), { ok: true, kind: 'first-write', nextRev: 1 });
  const missing = evaluateWrite({ current: null, baseRev: 2 });
  assert.deepEqual([missing.ok, missing.code, missing.currentRev], [false, 'missing-base', 0]);
});

test('writing over something that exists as if it were new is refused', () => {
  const result = evaluateWrite({ current: { rev: 3 }, baseRev: 0 });
  assert.deepEqual([result.ok, result.code, result.currentRev], [false, 'exists', 3]);
});

test('an update must be based on the current revision', () => {
  assert.deepEqual(evaluateWrite({ current: { rev: 3 }, baseRev: 3 }), { ok: true, kind: 'update', nextRev: 4 });
  const stale = evaluateWrite({ current: { rev: 3 }, baseRev: 2 });
  assert.deepEqual([stale.ok, stale.code, stale.currentRev, 'nextRev' in stale], [false, 'stale', 3, false]);
  const ahead = evaluateWrite({ current: { rev: 3 }, baseRev: 4 });
  assert.deepEqual([ahead.ok, ahead.code, ahead.currentRev], [false, 'ahead', 3]);
});

test('refuses a base revision that is not a whole number', () => {
  for (const bad of [-1, 1.5, '1', NaN, undefined, null, 2 ** 60]) assert.equal(evaluateWrite({ current: null, baseRev: bad }).code, 'bad-base', String(bad));
  assert.equal(evaluateWrite({ current: { rev: 0 }, baseRev: 0 }).code, 'bad-current');
  assert.equal(evaluateWrite({ current: undefined, baseRev: 0 }).code, 'bad-current');
  assert.equal(evaluateWrite().code, 'bad-base');
});

test('a version stored for another store or month is not the one being written to', () => {
  const result = evaluateWrite({ current: { rev: 1, storeId: 'elm', month: '2026-10' }, baseRev: 1, expect: { storeId: 'cedar', month: '2026-10' } });
  assert.equal(result.code, 'identity-mismatch');
  assert.equal(evaluateWrite({ current: { rev: 1, storeId: 'cedar', month: '2026-10' }, baseRev: 1, expect: { storeId: 'cedar', month: '2026-10' } }).ok, true);
});

test('a neighbouring month that moved after review refuses the write', () => {
  // The neighbours are the calendar neighbours of `month`, so the month must be said.
  const write = (month, reviewedAgainst, now) => evaluateWrite({ current: { rev: 1 }, baseRev: 1, month, adjacent: { reviewedAgainst, now } });
  assert.equal(write('2026-10', { prev: 2, next: 0 }, { prev: 2, next: 0 }).ok, true);
  assert.equal(write('2014-01', { prev: null, next: 4 }, { prev: null, next: 4 }).ok, true, 'no month before the first month');
  assert.equal(write('2100-12', { prev: 4, next: null }, { prev: 4, next: null }).ok, true, 'no month after the last month');
  const next = write('2026-10', { prev: 2, next: 0 }, { prev: 2, next: 1 });
  assert.deepEqual([next.code, next.sides], ['adjacent-moved', ['next']]);
  const both = write('2026-10', { prev: 1, next: 0 }, { prev: 2, next: 1 });
  assert.deepEqual(both.sides, ['prev', 'next']);
  const appeared = write('2026-10', { prev: 0, next: 0 }, { prev: 1, next: 0 });
  assert.equal(appeared.code, 'adjacent-moved', 'a neighbour that did not exist at review now does');
});

test('neighbour snapshots must be real numbers for every neighbour the calendar has', () => {
  const write = (month, reviewedAgainst, now) => evaluateWrite({ current: { rev: 1 }, baseRev: 1, month, adjacent: { reviewedAgainst, now } });
  const bad = (result, side) => { assert.deepEqual([result.ok, result.code], [false, 'bad-adjacent']); if (side) assert.equal(result.side, side); };
  // F1: null on an interior month used to match itself and switch the protection off
  bad(write('2026-10', { prev: null, next: null }, { prev: null, next: null }), 'prev');
  bad(write('2026-10', { prev: 1, next: null }, { prev: 1, next: null }), 'next');
  bad(write('2026-10', { prev: null, next: 1 }, { prev: null, next: 1 }), 'prev');
  bad(write('2026-10', { prev: 0, next: 0 }, { prev: 0, next: null }), 'next');
  bad(write('2026-10', { prev: 0 }, { prev: 0 }));
  bad(write('2026-10', { prev: -1, next: 0 }, { prev: -1, next: 0 }));
  bad(write('2026-10', { prev: 1.5, next: 0 }, { prev: 1.5, next: 0 }));
  bad(write('2026-10', { prev: '1', next: 0 }, { prev: '1', next: 0 }));
  bad(write('2026-10', { prev: 2 ** 60, next: 0 }, { prev: 2 ** 60, next: 0 }));
  // at the ends of the range the missing side must be null, and the present side must not be
  bad(write('2014-01', { prev: 0, next: 4 }, { prev: 0, next: 4 }), 'prev');
  bad(write('2014-01', { prev: null, next: null }, { prev: null, next: null }), 'next');
  bad(write('2100-12', { prev: 4, next: 0 }, { prev: 4, next: 0 }), 'next');
  bad(write('2100-12', { prev: null, next: null }, { prev: null, next: null }), 'prev');
  // the other shapes of a bad request
  bad(evaluateWrite({ current: { rev: 1 }, baseRev: 1, adjacent: { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 0, next: 0 } } }));
  bad(evaluateWrite({ current: { rev: 1 }, baseRev: 1, month: '2026-13', adjacent: { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 0, next: 0 } } }));
  bad(evaluateWrite({ current: { rev: 1 }, baseRev: 1, month: '2026-10', adjacent: { reviewedAgainst: { prev: 0, next: 0 } } }));
  bad(evaluateWrite({ current: { rev: 1 }, baseRev: 1, month: '2026-10', adjacent: 'no' }));
  bad(evaluateWrite({ current: { rev: 1 }, baseRev: 1, month: '2026-10', adjacent: { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 0, next: 0 }, extra: { prev: 0, next: 0 } } }));
  bad(evaluateWrite({ current: { rev: 1 }, baseRev: 1, month: '2026-10', adjacent: [] }));
  bad(evaluateWrite({ current: { rev: 1 }, baseRev: 1, month: '2026-10', adjacent: null }));
  bad(evaluateWrite({ current: { rev: 1 }, baseRev: 1, month: '2026-10', adjacent: { reviewedAgainst: { prev: 0, next: 0, extra: 1 }, now: { prev: 0, next: 0 } } }));
});

test('a stale write is checked before the neighbours', () => {
  const result = evaluateWrite({ current: { rev: 3 }, baseRev: 1, month: '2026-10', adjacent: { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 1, next: 0 } } });
  assert.equal(result.code, 'stale');
  assert.equal(evaluateWrite({ current: { rev: 1 }, baseRev: 1, month: '2026-10', adjacent: { reviewedAgainst: { prev: null, next: 0 }, now: { prev: 1, next: 0 } } }).code, 'bad-adjacent', 'a malformed request is refused before it is compared');
});

// ---- Review round 1 (L2): revision exhaustion ---------------------------------------------

test('a revision that cannot be incremented safely is refused at the CAS boundary', () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  const exhausted = evaluateWrite({ current: { rev: MAX }, baseRev: MAX });
  assert.deepEqual([exhausted.ok, exhausted.code, exhausted.currentRev, 'nextRev' in exhausted], [false, 'revision-exhausted', MAX, false]);
  assert.deepEqual(evaluateWrite({ current: { rev: MAX - 1 }, baseRev: MAX - 1 }), { ok: true, kind: 'update', nextRev: MAX });
  assert.equal(evaluateWrite({ current: { rev: MAX }, baseRev: MAX - 1 }).code, 'stale', 'stale still wins');
  assert.equal(evaluateWrite({ current: { rev: MAX }, baseRev: MAX, month: '2026-10', adjacent: { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 1, next: 0 } } }).code, 'revision-exhausted', 'exhaustion is checked before the neighbours');
  assert.equal(evaluateWrite({ current: null, baseRev: 0 }).nextRev, 1);
});

test('planning a save at the last safe revision is refused instead of producing an unsafe one', () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  const plan = head => planDraftSave({ storeId: 'cedar', month: '2026-10', draft: makeDraft(), baseRev: head.draftRev, head, actor: ACTOR, at: AT });
  const exhausted = plan({ draftRev: MAX, publishedRev: 0 });
  assert.deepEqual([exhausted.ok, exhausted.code], [false, 'revision-exhausted']);
  const last = plan({ draftRev: MAX - 1, publishedRev: 0 });
  assert.equal(last.ok, true, JSON.stringify(last));
  assert.equal(last.plan.resultingHead.draftRev, MAX);
});

test('operations validate what they are built from', () => {
  assert.deepEqual(expectHeadOp({ storeId: 'cedar', month: '2026-09', draftRev: 2 }), { op: 'expect-head', storeId: 'cedar', month: '2026-09', draftRev: 2 });
  assert.throws(() => expectHeadOp({ storeId: 'Cedar', month: '2026-09' }), TypeError);
  assert.throws(() => expectHeadOp({ storeId: 'cedar', month: '2026-09', draftRev: -1 }), TypeError);
  assert.throws(() => putVersionOp({ kind: 'other', storeId: 'cedar', month: '2026-09', expectedRev: 0, text: '' }), TypeError);
  assert.throws(() => putVersionOp({ kind: 'draft', storeId: 'cedar', month: '2026-09', expectedRev: -1, text: '' }), TypeError);
  assert.equal(putVersionOp({ kind: 'draft', storeId: 'cedar', month: '2026-09', expectedRev: 4, text: '{}' }).rev, 5);
  assert.deepEqual([headProblem(null), headProblem({ draftRev: 1, publishedRev: 0 })], [null, null]);
  assert.equal(headProblem({ draftRev: 1 }).code, 'bad-head');
  assert.deepEqual(normalHead(null), { draftRev: 0, publishedRev: 0 });
});

test('the first save, then an update, both land and chain their audit entries', () => {
  const port = createFakePort();
  const first = planSave(port);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.plan.resultingHead, { draftRev: 1, publishedRev: 0 });
  assert.equal(first.plan.authorization, 'not-checked');
  assert.equal(first.plan.atomic, true);
  assert.deepEqual(port.apply(first.plan), { ok: true, applied: 2 });
  assert.deepEqual(port.head('cedar', '2026-10'), { draftRev: 1, publishedRev: 0 });
  const second = planSave(port);
  assert.equal(second.ok, true);
  assert.deepEqual(port.apply(second.plan), { ok: true, applied: 2 });
  assert.deepEqual(port.head('cedar', '2026-10'), { draftRev: 2, publishedRev: 0 });
  const log = port.auditLog('cedar', '2026-10');
  assert.equal(log.length, 2);
  assert.deepEqual(verifyChain(log), { ok: true });
  assert.deepEqual(log.map(e => [e.action, e.fromRev, e.toRev]), [['draft-save', 0, 1], ['draft-save', 1, 2]]);
  assert.equal(deserializeVersion(port.versionText('draft', 'cedar', '2026-10', 2), { storeId: 'cedar', month: '2026-10', kind: 'draft', rev: 2 }).ok, true);
});

test('two writers from the same base: the first lands, the second is told it is stale and nothing changes', () => {
  const port = createFakePort();
  port.apply(planSave(port).plan);
  const head = port.head('cedar', '2026-10');
  const alice = planSave(port, { head }), bob = planSave(port, { head });
  assert.equal(alice.ok && bob.ok, true, 'both planned from the same read');
  assert.equal(port.apply(alice.plan).ok, true);
  const before = port.snapshot();
  const refused = port.apply(bob.plan);
  assert.deepEqual([refused.ok, refused.code, refused.opIndex], [false, 'stale', 0]);
  assert.equal(port.snapshot(), before, 'the refused plan left no trace');
  const replanned = planDraftSave({ storeId: 'cedar', month: '2026-10', draft: makeDraft(), baseRev: 1, head: port.head('cedar', '2026-10'), actor: ACTOR, at: AT });
  assert.deepEqual([replanned.ok, replanned.code, replanned.currentRev], [false, 'stale', 2], 'planning from an old base says so before anything is written');
});

test('a plan whose later step fails changes nothing at all', () => {
  const port = createFakePort();
  const good = planSave(port);
  const wrongPrev = buildAuditEntry({ action: 'draft-save', storeId: 'cedar', month: '2026-10', actor: ACTOR, at: AT, fromRev: 0, toRev: 1, subject: { kind: 'draft', rev: 1, digest: 'a'.repeat(16) }, prevHash: 'b'.repeat(16) }).entry;
  const broken = { ...good.plan, ops: [good.plan.ops[0], appendAuditOp(wrongPrev)] };
  const before = port.snapshot();
  const refused = port.apply(broken);
  assert.deepEqual([refused.ok, refused.code, refused.opIndex], [false, 'audit-chain', 1]);
  assert.equal(port.snapshot(), before, 'the draft written by step 0 was rolled back');
  assert.equal(port.head('cedar', '2026-10'), null);
  assert.equal(port.apply(good.plan).ok, true, 'the same store is still usable');
});

test('stores and months are separate: one save moves no other head, log or version', () => {
  const port = createFakePort();
  port.apply(planSave(port).plan);
  const cedarOnly = port.snapshot();
  assert.equal(port.head('elm', '2026-10'), null);
  assert.equal(port.head('cedar', '2026-11'), null);
  assert.deepEqual(port.auditLog('elm', '2026-10'), []);
  port.apply(planSave(port, { storeId: 'elm' }).plan);
  assert.deepEqual(port.head('elm', '2026-10'), { draftRev: 1, publishedRev: 0 });
  assert.deepEqual(port.head('cedar', '2026-10'), { draftRev: 1, publishedRev: 0 });
  assert.notEqual(port.snapshot(), cedarOnly);
  assert.deepEqual(port.versionIds(), ['cedar/2026-10/draft/1', 'elm/2026-10/draft/1']);
  assert.equal(verifyChain(port.auditLog('elm', '2026-10')).ok, true);
  assert.equal(port.lastAuditHash('elm', '2026-10') === port.lastAuditHash('cedar', '2026-10'), false);
});

test('the port refuses text filed under the wrong store, month, kind or revision', () => {
  const port = createFakePort();
  const cedar = planSave(port).plan.ops[0];
  for (const change of [{ storeId: 'elm' }, { month: '2026-11' }, { kind: 'published' }]) {
    const forged = { op: 'put-version', ...cedar, ...change };
    const result = port.apply({ ops: [forged] });
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.ok(['invalid-version', 'bad-op'].includes(result.code), result.code);
  }
  assert.equal(port.apply({ ops: [{ ...cedar, text: cedar.text.replace('Alex', 'Mallory') }] }).code, 'invalid-version', 'a tampered stored text');
  assert.equal(port.snapshot(), createFakePort().snapshot());
});

test('refuses to plan without a trusted actor, a real time, or a valid draft', () => {
  const port = createFakePort();
  assert.equal(planSave(port, { actor: undefined }).code, 'invalid');
  assert.ok(codes(planSave(port, { actor: { id: 'x', role: 'admin' } })).includes('bad-actor'));
  assert.ok(codes(planSave(port, { at: 'yesterday' })).includes('bad-time'));
  const poisoned = makeDraft(); poisoned.overrides['2026-10-06'] = { on: ['zzz'], off: [] };
  assert.ok(codes(planSave(port, { draft: poisoned })).includes('unknown-person'));
  const smuggled = { ...makeDraft(), actor: { id: 'someone-else' } };
  assert.ok(codes(planSave(port, { draft: smuggled })).includes('unknown-key'), 'an actor inside the draft is refused, not used');
  assert.equal(planSave(port, { head: undefined, storeId: 'cedar' }).ok, true, 'the default head is read from the port');
  assert.equal(planDraftSave({ storeId: 'cedar', month: '2026-10', draft: makeDraft(), baseRev: 0, actor: ACTOR, at: AT }).code, 'bad-head');
  assert.equal(planDraftSave({ storeId: 'Cedar', month: '2026-10' }).code, 'invalid');
  assert.equal(planDraftSave(undefined).code, 'invalid');
});

test('the audit entry names the actor that was passed and the digest of what was written', () => {
  const port = createFakePort();
  const { plan } = planSave(port, { actor: { id: 'dot@sage' } });
  port.apply(plan);
  const [entry] = port.auditLog('cedar', '2026-10');
  assert.equal(entry.actor.id, 'dot@sage');
  assert.equal(entry.subject.digest, JSON.parse(port.versionText('draft', 'cedar', '2026-10', 1)).hash.value);
});

test('the port refuses malformed plans and unknown operations', () => {
  const port = createFakePort();
  for (const bad of [null, {}, { ops: [] }, { ops: 'x' }, { ops: Array.from({ length: 21 }, () => ({})) }]) assert.equal(port.apply(bad).code, 'bad-plan');
  assert.equal(port.apply({ ops: [{ op: 'drop-table', storeId: 'cedar', month: '2026-10' }] }).code, 'unknown-op');
  assert.equal(port.apply({ ops: [null] }).code, 'bad-op');
  assert.equal(port.apply({ ops: [{ op: 'put-version', storeId: 'cedar', month: '2026-10', kind: 'draft', expectedRev: 0, rev: 5, text: '{}' }] }).code, 'bad-op');
  assert.equal(port.apply({ ops: [{ op: 'append-audit', storeId: 'cedar', month: '2026-10', entry: { forged: true } }] }).code, 'bad-audit');
  assert.equal(port.apply({ ops: [{ op: 'expect-head', storeId: 'cedar', month: '2026-10', draftRev: 1 }] }).code, 'head-moved');
});

test('planning does not change its input', () => {
  const input = { storeId: 'cedar', month: '2026-10', draft: { ...makeDraft(), accepted: true }, baseRev: 0, head: null, actor: ACTOR, at: AT, prevAuditHash: null };
  const before = clone(input);
  planDraftSave(input);
  assert.deepEqual(input, before);
  assert.deepEqual(planDraftSave(input), planDraftSave(input), 'the same input gives the same plan');
});

// ---- Review round 1: the test double takes one strict copy of a plan -------------------------

test('the port refuses a plan that carries a getter, a hook or a custom prototype instead of reading through it', () => {
  const port = createFakePort();
  const good = planSave(port).plan;
  const before = port.snapshot();
  const withGetter = { ...good, ops: [Object.defineProperty({ ...good.ops[0] }, 'text', { get: () => good.ops[0].text, enumerable: true }), good.ops[1]] };
  const withHook = { ...good, ops: Object.assign([...good.ops], { toJSON: () => [] }) };
  const klass = Object.assign(new (class Plan {})(), good);
  for (const [name, plan] of [['getter', withGetter], ['array hook', withHook], ['class instance', klass]]) {
    assert.equal(port.apply(plan).code, 'bad-plan', name);
  }
  assert.equal(port.snapshot(), before);
  assert.equal(port.apply(good).ok, true, 'the same plan, plain, applies');
});
