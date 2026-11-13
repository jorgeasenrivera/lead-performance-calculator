// Compare-and-swap for stored schedule versions, and the write plan primitives.
//
// A write names the revision it was based on. It lands only if that is still
// the current revision, and a miss returns the current revision and changes
// nothing. This is the same rule saveStoreCAS applies to a store row in the app
// (a first write must not overwrite, a later one must match what was read),
// stated as a pure function so it can be tested without a database.
//
// A plan is DATA: a list of operations and the entry that records them. Nothing
// here writes, reads or checks who is asking. That a plan is applied atomically,
// and that the person asking may apply it, are future server guarantees and are
// not decided or implemented by this module.
import { identityProblems, validRev, validKind, validMonth, adjacentMonths, versionId } from './identity.mjs';
import { serializeDraft } from './serialize.mjs';
import { buildAuditEntry } from './audit-entry.mjs';
import { DEFAULT_SEALER, adjacentSnapshotProblem } from './envelope.mjs';

const problem = (path, code, message) => ({ path, code, message });
const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
export const invalid = problems => fail('invalid', 'The input is not valid.', { problems });

// The neighbours a publication was reviewed against, checked against the CALENDAR.
// For every month that exists beside `month` the snapshot must be a real revision
// (0 when that month has no saved draft); null is valid only where the calendar
// has no such month (before 2014-01, after 2100-12). A null beside a month that
// exists would compare equal to itself and silently drop the precondition.
export function adjacentProblem(month, adjacent) {
  if (!validMonth(month)) return fail('bad-adjacent', 'Say which month the neighbours belong to.');
  if (adjacent === null || typeof adjacent !== 'object' || Array.isArray(adjacent) || Object.keys(adjacent).sort().join() !== 'now,reviewedAgainst') {
    return fail('bad-adjacent', 'Give the neighbours as reviewed and as they are now.');
  }
  for (const which of ['reviewedAgainst', 'now']) {
    const found = adjacentSnapshotProblem(month, adjacent[which], which);
    if (found) return fail('bad-adjacent', found.message, { which, ...(found.side ? { side: found.side } : {}) });
  }
  return null;
}

// current: null when nothing is stored, otherwise { rev, storeId?, month? }
// baseRev: the revision the writer read, 0 when it read nothing
// month + adjacent: optional. adjacent is { reviewedAgainst: { prev, next }, now: { prev, next } }
//   and is judged against the calendar neighbours of `month` (see adjacentProblem)
export function evaluateWrite({ current, baseRev, expect, month, adjacent } = {}) {
  if (!validRev(baseRev, 0)) return fail('bad-base', 'The base revision is a whole number, 0 or more.');
  if (current !== null && (current === undefined || !validRev(current.rev))) return fail('bad-current', 'The current version must be null or carry a revision.');
  if (current && expect && ['storeId', 'month'].some(k => current[k] !== undefined && expect[k] !== undefined && current[k] !== expect[k])) {
    return fail('identity-mismatch', 'The stored version belongs to a different store or month.');
  }
  if (current === null && baseRev > 0) return fail('missing-base', 'The writer is working from a version that no longer exists.', { currentRev: 0 });
  if (current !== null && baseRev === 0) return fail('exists', 'Something is already stored here; read it before writing.', { currentRev: current.rev });
  if (current !== null && baseRev < current.rev) return fail('stale', 'Someone else saved first.', { currentRev: current.rev });
  if (current !== null && baseRev > current.rev) return fail('ahead', 'The writer claims a revision that does not exist yet.', { currentRev: current.rev });
  // The next revision must itself be a safe whole number.
  if (!Number.isSafeInteger(baseRev + 1)) return fail('revision-exhausted', 'The revision counter has reached its last safe value.', { currentRev: baseRev });
  if (adjacent !== undefined) {
    const malformed = adjacentProblem(month, adjacent);
    if (malformed) return malformed;
    const sides = ['prev', 'next'].filter(side => adjacent.reviewedAgainst[side] !== adjacent.now[side]);
    if (sides.length) return fail('adjacent-moved', 'A neighbouring month changed after this was reviewed, and weekly hours cross month edges.', { sides });
  }
  return { ok: true, kind: current === null ? 'first-write' : 'update', nextRev: baseRev + 1 };
}

// Operations. The shapes are the whole contract between a plan and whatever
// applies it; fake-port.mjs applies them in memory for tests.
export function expectHeadOp({ storeId, month, draftRev, publishedRev }) {
  versionId('draft', storeId, month, 1); // identity check
  const op = { op: 'expect-head', storeId, month };
  if (draftRev !== undefined) { if (!validRev(draftRev, 0)) throw new TypeError('draftRev'); op.draftRev = draftRev; }
  if (publishedRev !== undefined) { if (!validRev(publishedRev, 0)) throw new TypeError('publishedRev'); op.publishedRev = publishedRev; }
  return op;
}
export function putVersionOp({ kind, storeId, month, expectedRev, text }) {
  if (!validKind(kind) || !validRev(expectedRev, 0) || typeof text !== 'string') throw new TypeError('put-version');
  versionId(kind, storeId, month, expectedRev + 1);
  return { op: 'put-version', kind, storeId, month, expectedRev, rev: expectedRev + 1, text };
}
export function appendAuditOp(entry) {
  return { op: 'append-audit', storeId: entry.storeId, month: entry.month, entry };
}

// head: what the caller read just now. null when nothing is stored for this
// store and month, otherwise { draftRev, publishedRev }, each 0 when absent.
export function headProblem(head) {
  if (head === null) return null;
  const ok = head && typeof head === 'object' && validRev(head.draftRev, 0) && validRev(head.publishedRev, 0);
  return ok ? null : fail('bad-head', 'The head is null or { draftRev, publishedRev }.');
}
export const normalHead = head => head === null ? { draftRev: 0, publishedRev: 0 } : { draftRev: head.draftRev, publishedRev: head.publishedRev };

// Shared by every plan: who, when and where the log stands. All supplied.
export function auditFor({ action, storeId, month, actor, at, fromRev, toRev, kind, rev, digest, prevAuditHash = null, detail }, sealer = DEFAULT_SEALER) {
  return buildAuditEntry({ action, storeId, month, actor, at, fromRev, toRev, subject: { kind, rev, digest }, prevHash: prevAuditHash, ...(detail ? { detail } : {}) }, sealer);
}

// Save a draft: one new immutable draft version and one audit entry.
export function planDraftSave(input, sealer = DEFAULT_SEALER) {
  const { storeId, month, draft, baseRev, head, actor, at, prevAuditHash = null } = input || {};
  const identity = identityProblems({ storeId, month });
  if (identity.length) return invalid(identity);
  const bad = headProblem(head === undefined ? undefined : head);
  if (head === undefined || bad) return bad || fail('bad-head', 'Pass the head you just read.');
  const state = normalHead(head);
  const verdict = evaluateWrite({ current: state.draftRev > 0 ? { rev: state.draftRev } : null, baseRev });
  if (!verdict.ok) return verdict;
  const written = serializeDraft({ storeId, month, rev: verdict.nextRev, draft }, sealer);
  if (!written.ok) return invalid(written.problems);
  const entry = auditFor({ action: 'draft-save', storeId, month, actor, at, fromRev: baseRev, toRev: verdict.nextRev, kind: 'draft', rev: verdict.nextRev, digest: written.envelope.hash.value, prevAuditHash }, sealer);
  if (!entry.ok) return invalid(entry.problems);
  return {
    ok: true,
    plan: {
      kind: 'draft-save', storeId, month, atomic: true, authorization: 'not-checked',
      ops: [putVersionOp({ kind: 'draft', storeId, month, expectedRev: baseRev, text: written.text }), appendAuditOp(entry.entry)],
      auditEntry: entry.entry,
      resultingHead: { draftRev: verdict.nextRev, publishedRev: state.publishedRev },
    },
  };
}

export { adjacentMonths };
