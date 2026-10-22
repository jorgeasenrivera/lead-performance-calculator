import test from 'node:test';
import assert from 'node:assert/strict';
import { planPublication } from './publish-plan.mjs';
import { planDraftSave } from './cas.mjs';
import { createFakePort } from './fake-port.mjs';
import { verifyChain } from './audit-entry.mjs';
import { deserializeVersion } from './deserialize.mjs';
import { checksum } from './envelope.mjs';

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
const FINGERPRINT = '[{"day":"2026-10-01","issues":[]}]';
// A draft that is really for this store and month: the fixture's day, memberships
// and shifts are all re-labelled, because the validator rightly refuses a draft
// that carries another store's or another month's data.
const draftFor = (storeId, month) => {
  const draft = makeDraft({ storeId, month });
  draft.store.memberships = draft.store.memberships.map(m => ({ ...m, storeId }));
  const day = `${month}-05`, record = draft.overrides['2026-10-05'];
  delete draft.overrides['2026-10-05'];
  record.shifts = record.shifts.map(sh => ({ ...sh, storeId, date: day, endDate: day }));
  draft.overrides[day] = record;
  return draft;
};
const saveDraft = (port, storeId = 'cedar', month = '2026-10', draft = draftFor(storeId, month)) => {
  const head = port.head(storeId, month);
  const planned = planDraftSave({ storeId, month, draft, baseRev: head ? head.draftRev : 0, head, actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash(storeId, month) });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(port.apply(planned.plan).ok, true);
};
// October with its neighbours September and November, as a manager would have them.
const ready = () => {
  const port = createFakePort();
  saveDraft(port);
  return port;
};
const publishInput = (port, over = {}) => {
  const head = port.head('cedar', '2026-10');
  return {
    storeId: 'cedar', month: '2026-10', draft: makeDraft(), draftRev: head.draftRev, head,
    review: { fingerprint: FINGERPRINT, openIssues: 0 }, recomputedFingerprint: FINGERPRINT,
    adjacent: { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 0, next: 0 } },
    actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash('cedar', '2026-10'), ...over,
  };
};

test('a reviewed month publishes: a published version, a moved draft, and one audit entry', () => {
  const port = ready();
  const planned = planPublication(publishInput(port));
  assert.equal(planned.ok, true, JSON.stringify(planned));
  const { plan } = planned;
  assert.deepEqual([plan.kind, plan.atomic, plan.authorization, plan.publishedRev], ['publication', true, 'not-checked', 1]);
  assert.deepEqual(plan.resultingHead, { draftRev: 2, publishedRev: 1 });
  assert.deepEqual(plan.ops.map(o => o.op), ['expect-head', 'expect-head', 'put-version', 'put-version', 'append-audit']);
  assert.equal(port.apply(plan).ok, true);
  assert.deepEqual(port.head('cedar', '2026-10'), { draftRev: 2, publishedRev: 1 });
  const published = deserializeVersion(port.versionText('published', 'cedar', '2026-10', 1), { storeId: 'cedar', month: '2026-10', kind: 'published', rev: 1 });
  assert.equal(published.ok, true, JSON.stringify(published.problems));
  assert.deepEqual(published.meta, { sourceDraftRev: 1, supersedes: 0, reviewDigest: checksum(FINGERPRINT), adjacent: { prev: 0, next: 0 } });
  assert.deepEqual(published.draft, makeDraft(), 'what was reviewed is what was published');
  const moved = deserializeVersion(port.versionText('draft', 'cedar', '2026-10', 2), { storeId: 'cedar', month: '2026-10', kind: 'draft', rev: 2 });
  assert.deepEqual(moved.meta, { publishedRev: 1 });
  const log = port.auditLog('cedar', '2026-10');
  assert.deepEqual(log.map(e => [e.action, e.fromRev, e.toRev]), [['draft-save', 0, 1], ['publish', 1, 2]]);
  assert.deepEqual(verifyChain(log), { ok: true });
  assert.deepEqual(log[1].subject, { kind: 'published', rev: 1, digest: JSON.parse(port.versionText('published', 'cedar', '2026-10', 1)).hash.value });
});

test('the full fingerprint is not stored, only its digest', () => {
  const port = ready();
  port.apply(planPublication(publishInput(port)).plan);
  assert.doesNotMatch(port.versionText('published', 'cedar', '2026-10', 1), /"issues"/);
});

test('publishing again supersedes the earlier version and leaves it readable', () => {
  const port = ready();
  port.apply(planPublication(publishInput(port)).plan);
  const firstText = port.versionText('published', 'cedar', '2026-10', 1);
  const second = planPublication(publishInput(port));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.plan.publishedRev, 2);
  assert.equal(port.apply(second.plan).ok, true);
  assert.equal(port.versionText('published', 'cedar', '2026-10', 1), firstText, 'version 1 is byte for byte what it was');
  assert.equal(deserializeVersion(port.versionText('published', 'cedar', '2026-10', 2), { storeId: 'cedar', month: '2026-10' }).meta.supersedes, 1);
  assert.deepEqual(port.versionIds().filter(id => id.includes('published')), ['cedar/2026-10/published/1', 'cedar/2026-10/published/2']);
});

const REFUSALS = [
  ['a bad store', i => ({ ...i, storeId: 'Cedar' }), 'invalid'],
  ['a missing actor', i => ({ ...i, actor: undefined }), 'invalid'],
  ['a missing time', i => ({ ...i, at: undefined }), 'invalid'],
  ['an invalid draft', i => { const d = makeDraft(); d.overrides['2026-10-06'] = { on: ['zzz'], off: [] }; return { ...i, draft: d }; }, 'invalid'],
  ['a draft for another store', i => ({ ...i, draft: makeDraft({ storeId: 'elm' }) }), 'invalid'],
  ['an unknown head', i => ({ ...i, head: undefined }), 'bad-head'],
  ['nothing saved yet', i => ({ ...i, head: null }), 'nothing-to-publish'],
  ['a draft revision that is not the current one', i => ({ ...i, head: { draftRev: 3, publishedRev: 0 } }), 'stale-draft'],
  ['a revision ahead of the draft', i => ({ ...i, draftRev: 5 }), 'ahead'],
  ['no review', i => ({ ...i, review: undefined }), 'not-reviewed'],
  ['an empty fingerprint', i => ({ ...i, review: { fingerprint: '', openIssues: 0 } }), 'not-reviewed'],
  ['an unknown number of open issues', i => ({ ...i, review: { fingerprint: FINGERPRINT } }), 'not-reviewed'],
  ['open issues', i => ({ ...i, review: { fingerprint: FINGERPRINT, openIssues: 2 } }), 'open-issues'],
  ['a month that changed after review', i => ({ ...i, recomputedFingerprint: `${FINGERPRINT} ` }), 'fingerprint-mismatch'],
  ['no fingerprint recomputed', i => ({ ...i, recomputedFingerprint: undefined }), 'fingerprint-mismatch'],
  ['no neighbour information', i => ({ ...i, adjacent: undefined }), 'missing-adjacent'],
  ['neighbours missing from the review snapshot', i => ({ ...i, adjacent: { now: { prev: 0, next: 0 } } }), 'missing-adjacent'],
  ['a neighbour that moved after review', i => ({ ...i, adjacent: { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 0, next: 1 } } }), 'adjacent-moved'],
];
for (const [name, change, code] of REFUSALS) {
  test(`refuses ${name} with ${code}`, () => {
    const port = ready();
    const input = change(publishInput(port));
    const before = port.snapshot();
    const result = planPublication(input);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(port.snapshot(), before, 'planning writes nothing');
  });
}

test('the first thing wrong is the thing reported', () => {
  const port = ready();
  const base = publishInput(port);
  const open = { fingerprint: FINGERPRINT, openIssues: 1 };
  const moved = { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 1, next: 0 } };
  assert.equal(planPublication({ ...base, head: { draftRev: 4, publishedRev: 0 }, review: open }).code, 'stale-draft', 'stale before open issues');
  assert.equal(planPublication({ ...base, review: open, recomputedFingerprint: 'x' }).code, 'open-issues', 'open issues before the fingerprint');
  assert.equal(planPublication({ ...base, recomputedFingerprint: 'x', adjacent: moved }).code, 'fingerprint-mismatch', 'the fingerprint before the neighbours');
  assert.equal(planPublication({ ...base, actor: undefined, review: open }).code, 'invalid', 'inputs before the review');
  assert.equal(planPublication({ ...base, adjacent: moved }).sides.join(), 'prev');
});

test('open issues are counted in the answer', () => {
  const port = ready();
  assert.equal(planPublication(publishInput(port, { review: { fingerprint: FINGERPRINT, openIssues: 3 } })).openIssues, 3);
});

test('an edit saved after the plan was made makes applying it fail, and nothing is written', () => {
  const port = ready();
  const plan = planPublication(publishInput(port)).plan;
  saveDraft(port); // another manager saves draft revision 2 first
  const before = port.snapshot();
  const result = port.apply(plan);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stale');
  assert.equal(port.snapshot(), before);
  assert.equal(port.head('cedar', '2026-10').publishedRev, 0, 'the published version was rolled back with the rest');
});

test('a neighbouring month saved after review makes applying the plan fail', () => {
  const port = ready();
  saveDraft(port, 'cedar', '2026-11');
  const input = publishInput(port, { adjacent: { reviewedAgainst: { prev: 0, next: 1 }, now: { prev: 0, next: 1 } } });
  const plan = planPublication(input).plan;
  assert.deepEqual(plan.ops.slice(0, 2).map(o => [o.month, o.draftRev]), [['2026-09', 0], ['2026-11', 1]]);
  saveDraft(port, 'cedar', '2026-11'); // November moves to revision 2
  const before = port.snapshot();
  const result = port.apply(plan);
  assert.deepEqual([result.ok, result.code, result.opIndex], [false, 'head-moved', 1]);
  assert.equal(port.snapshot(), before);
  const fresh = planPublication(publishInput(port, { adjacent: { reviewedAgainst: { prev: 0, next: 1 }, now: { prev: 0, next: 2 } } }));
  assert.equal(fresh.code, 'adjacent-moved', 'planning with the true state says why');
});

test('the edge months have no neighbour on one side and no expectation for it', () => {
  const port = createFakePort();
  saveDraft(port, 'cedar', '2014-01');
  const head = port.head('cedar', '2014-01');
  const planned = planPublication({
    storeId: 'cedar', month: '2014-01', draft: draftFor('cedar', '2014-01'), draftRev: 1, head,
    review: { fingerprint: FINGERPRINT, openIssues: 0 }, recomputedFingerprint: FINGERPRINT,
    adjacent: { reviewedAgainst: { prev: null, next: 0 }, now: { prev: null, next: 0 } },
    actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash('cedar', '2014-01'),
  });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.deepEqual(planned.plan.ops.filter(o => o.op === 'expect-head').map(o => o.month), ['2014-02']);
  assert.equal(port.apply(planned.plan).ok, true);
});

test('publishing one store leaves every other store and month untouched', () => {
  const port = ready();
  saveDraft(port, 'elm');
  const elmBefore = [port.head('elm', '2026-10'), port.versionText('draft', 'elm', '2026-10', 1), port.auditLog('elm', '2026-10')];
  port.apply(planPublication(publishInput(port)).plan);
  assert.deepEqual([port.head('elm', '2026-10'), port.versionText('draft', 'elm', '2026-10', 1), port.auditLog('elm', '2026-10')], elmBefore);
  assert.equal(port.head('cedar', '2026-11'), null);
});

test('planning is pure: the input is untouched and the same input gives the same plan', () => {
  const port = ready();
  const input = publishInput(port), before = clone(input);
  const a = planPublication(input), b = planPublication(input);
  assert.deepEqual(input, before);
  assert.deepEqual(a, b);
});

test('an actor smuggled into the draft is refused, and the audit actor is the one passed in', () => {
  const port = ready();
  assert.equal(planPublication(publishInput(port, { draft: { ...makeDraft(), actor: { id: 'forged' } } })).code, 'invalid');
  const ok = planPublication(publishInput(port, { actor: { id: 'dot@sage' } }));
  assert.equal(ok.plan.auditEntry.actor.id, 'dot@sage');
});

test('the plan makes no claim about who may publish', () => {
  const port = ready();
  const { plan } = planPublication(publishInput(port, { actor: { id: 'anyone-at-all' } }));
  assert.equal(plan.authorization, 'not-checked');
  // The stored texts are schedule data (a fixture note says "manager day edit"),
  // not policy, so they are set aside; everything the plan itself says is checked.
  const metadata = { ...plan, ops: plan.ops.map(({ text, ...rest }) => rest) };
  assert.doesNotMatch(JSON.stringify(metadata), /role|admin|overseer|manager/i);
});

// ---- Review round 1 (F1): a publication always protects every neighbour that exists ----------

const NULLS = { reviewedAgainst: { prev: null, next: null }, now: { prev: null, next: null } };

test('F1: null neighbours on an interior month are refused, not turned into "no precondition"', () => {
  const port = ready();
  for (const [name, adjacent] of [
    ['both null', NULLS],
    ['previous null', { reviewedAgainst: { prev: null, next: 0 }, now: { prev: null, next: 0 } }],
    ['next null', { reviewedAgainst: { prev: 0, next: null }, now: { prev: 0, next: null } }],
    ['missing keys', { reviewedAgainst: {}, now: {} }],
    ['negative', { reviewedAgainst: { prev: -1, next: 0 }, now: { prev: -1, next: 0 } }],
    ['fractional', { reviewedAgainst: { prev: 0, next: 0.5 }, now: { prev: 0, next: 0.5 } }],
    ['text', { reviewedAgainst: { prev: '0', next: 0 }, now: { prev: '0', next: 0 } }],
    ['null only in the live snapshot', { reviewedAgainst: { prev: 0, next: 0 }, now: { prev: 0, next: null } }],
  ]) {
    const result = planPublication(publishInput(port, { adjacent }));
    assert.deepEqual([name, result.ok, result.code], [name, false, 'bad-adjacent']);
  }
});

test('F1 end to end: with the neighbours stated correctly, a change next door after planning stops the apply', () => {
  const port = ready();
  saveDraft(port, 'cedar', '2026-11');
  const planned = planPublication(publishInput(port, { adjacent: { reviewedAgainst: { prev: 0, next: 1 }, now: { prev: 0, next: 1 } } }));
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.deepEqual(planned.plan.ops.filter(o => o.op === 'expect-head').map(o => [o.month, o.draftRev]), [['2026-09', 0], ['2026-11', 1]], 'both neighbours are protected, including the one with no draft');
  saveDraft(port, 'cedar', '2026-11');
  const before = port.snapshot();
  assert.deepEqual([port.apply(planned.plan).ok, port.apply(planned.plan).code], [false, 'head-moved']);
  assert.equal(port.snapshot(), before);
});

test('F1: a neighbour with no draft at review (revision 0) is still protected when one appears', () => {
  const port = ready();
  const planned = planPublication(publishInput(port));
  assert.deepEqual(planned.plan.ops.filter(o => o.op === 'expect-head').map(o => [o.month, o.draftRev]), [['2026-09', 0], ['2026-11', 0]]);
  saveDraft(port, 'cedar', '2026-09'); // September gains its first draft
  const before = port.snapshot();
  const result = port.apply(planned.plan);
  assert.deepEqual([result.ok, result.code, result.opIndex], [false, 'head-moved', 0]);
  assert.equal(port.snapshot(), before);
  assert.equal(port.head('cedar', '2026-10').publishedRev, 0);
});

test('the first month protects only its later neighbour, and the last month only its earlier one', () => {
  for (const [month, neighbour, adjacent, moved] of [
    ['2014-01', '2014-02', { prev: null, next: 0 }, 'next'],
    ['2100-12', '2100-11', { prev: 0, next: null }, 'prev'],
  ]) {
    const port = createFakePort();
    saveDraft(port, 'cedar', month);
    const head = port.head('cedar', month);
    const input = { storeId: 'cedar', month, draft: draftFor('cedar', month), draftRev: 1, head, review: { fingerprint: FINGERPRINT, openIssues: 0 }, recomputedFingerprint: FINGERPRINT, adjacent: { reviewedAgainst: adjacent, now: adjacent }, actor: ACTOR, at: AT, prevAuditHash: port.lastAuditHash('cedar', month) };
    const planned = planPublication(input);
    assert.equal(planned.ok, true, `${month}: ${JSON.stringify(planned)}`);
    assert.deepEqual(planned.plan.ops.filter(o => o.op === 'expect-head').map(o => o.month), [neighbour]);
    assert.equal(planned.plan.auditEntry.month, month);
    // null on the side that does exist, or a number on the side that does not, is refused
    const wrong = { ...adjacent, [moved]: null }, bogus = { ...adjacent, [moved === 'next' ? 'prev' : 'next']: 0 };
    assert.equal(planPublication({ ...input, adjacent: { reviewedAgainst: wrong, now: wrong } }).code, 'bad-adjacent');
    assert.equal(planPublication({ ...input, adjacent: { reviewedAgainst: bogus, now: bogus } }).code, 'bad-adjacent');
    saveDraft(port, 'cedar', neighbour);
    const before = port.snapshot();
    assert.equal(port.apply(planned.plan).code, 'head-moved');
    assert.equal(port.snapshot(), before);
    assert.equal(planPublication({ ...input, adjacent: { reviewedAgainst: adjacent, now: { ...adjacent, [moved]: 1 } } }).code, 'adjacent-moved');
  }
});

test('bad neighbour data is reported before a neighbour is compared', () => {
  const port = ready();
  const result = planPublication(publishInput(port, { adjacent: { reviewedAgainst: { prev: null, next: 0 }, now: { prev: 7, next: 0 } } }));
  assert.equal(result.code, 'bad-adjacent');
});

// ---- Review round 1 (L2) ------------------------------------------------------------------

test('a published revision that cannot be incremented safely is refused with a result, not a thrown error', () => {
  const port = ready();
  const MAX = Number.MAX_SAFE_INTEGER;
  const exhausted = planPublication(publishInput(port, { head: { draftRev: 1, publishedRev: MAX } }));
  assert.deepEqual([exhausted.ok, exhausted.code], [false, 'revision-exhausted']);
  const draftEnd = planPublication(publishInput(port, { draftRev: MAX, head: { draftRev: MAX, publishedRev: 0 } }));
  assert.deepEqual([draftEnd.ok, draftEnd.code], [false, 'revision-exhausted']);
  const lastSafe = planPublication(publishInput(port, { head: { draftRev: 1, publishedRev: MAX - 1 } }));
  assert.equal(lastSafe.ok, true, JSON.stringify(lastSafe));
  assert.equal(lastSafe.plan.publishedRev, MAX);
});
