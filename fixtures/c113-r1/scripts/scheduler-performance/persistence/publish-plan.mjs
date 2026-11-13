// A publication plan: the data describing what publishing a reviewed month
// would write. It checks, in a fixed order, that the thing being published is
// the thing that was reviewed, and then lists the writes. It does not write
// them, does not check who is asking, and does not decide who may publish.
// Those are future server decisions that are not made here.
//
// The order of the refusals is part of the contract, so a caller always learns
// the first thing that is wrong: identity, trusted inputs, the draft itself,
// the draft and published revisions, the review, the review fingerprint, then the
// neighbours (missing, malformed against the calendar, and only then moved).
import { identityProblems, adjacentMonths } from './identity.mjs';
import { validateDraft } from './validate.mjs';
import { serializeVersion } from './serialize.mjs';
import { DEFAULT_SEALER, MAX_ENVELOPE_CHARS } from './envelope.mjs';
import { evaluateWrite, headProblem, normalHead, invalid, auditFor, putVersionOp, expectHeadOp, appendAuditOp } from './cas.mjs';

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

// input: {
//   storeId, month,
//   draft,                      the draft that was reviewed
//   draftRev,                   the draft revision the review was done against
//   head,                       { draftRev, publishedRev } read just now, or null
//   review: { fingerprint, openIssues },        as recorded when it was marked reviewed
//   recomputedFingerprint,      the same fingerprint worked out again from `draft` now
//   adjacent: { reviewedAgainst: { prev, next }, now: { prev, next } },
//   actor, at, prevAuditHash
// }
export function planPublication(input, sealer = DEFAULT_SEALER) {
  const { storeId, month, draft, draftRev, head, review, recomputedFingerprint, adjacent, actor, at, prevAuditHash = null } = input || {};
  const identity = identityProblems({ storeId, month });
  if (identity.length) return invalid(identity);
  // Built here only to learn whether the trusted inputs are usable; the real
  // entry is built below once the revisions are known.
  const probe = auditFor({ action: 'publish', storeId, month, actor, at, fromRev: 0, toRev: 0, kind: 'published', rev: 1, digest: '0'.repeat(16), prevAuditHash }, sealer);
  if (!probe.ok) return invalid(probe.problems);
  const checked = validateDraft(draft, { storeId, month });
  if (!checked.ok) return invalid(checked.problems);
  const bad = head === undefined ? fail('bad-head', 'Pass the head you just read.') : headProblem(head);
  if (bad) return bad;
  const state = normalHead(head);
  if (state.draftRev === 0) return fail('nothing-to-publish', 'There is no saved draft for this month.');
  const verdict = evaluateWrite({ current: { rev: state.draftRev }, baseRev: draftRev });
  if (!verdict.ok) return { ...verdict, code: verdict.code === 'stale' ? 'stale-draft' : verdict.code };
  if (!review || typeof review.fingerprint !== 'string' || review.fingerprint.length === 0 || review.fingerprint.length > MAX_ENVELOPE_CHARS) return fail('not-reviewed', 'This month has not been marked reviewed.');
  if (!Number.isSafeInteger(review.openIssues) || review.openIssues < 0) return fail('not-reviewed', 'The number of open issues is missing.');
  if (review.openIssues > 0) return fail('open-issues', `${review.openIssues} open issues. Resolve them before publishing.`, { openIssues: review.openIssues });
  if (recomputedFingerprint !== review.fingerprint) return fail('fingerprint-mismatch', 'The month changed after it was reviewed. Review it again.');
  if (!Number.isSafeInteger(state.publishedRev + 1)) return fail('revision-exhausted', 'The published revision counter has reached its last safe value.', { currentRev: state.publishedRev });
  const neighbours = adjacentMonths(month);
  // Judged against the calendar neighbours of this month: a null beside a month
  // that exists is refused (bad-adjacent), never read as "nothing to protect".
  const sides = adjacent && adjacent.reviewedAgainst && adjacent.now ? evaluateWrite({ current: { rev: state.draftRev }, baseRev: draftRev, month, adjacent }) : fail('missing-adjacent', 'Pass the neighbouring months as reviewed and as they are now.');
  if (!sides.ok) return sides;
  const publishedRev = state.publishedRev + 1, nextDraftRev = draftRev + 1;
  const reviewDigest = sealer.digest(review.fingerprint);
  const published = serializeVersion({
    kind: 'published', storeId, month, rev: publishedRev, draft,
    meta: { sourceDraftRev: draftRev, supersedes: state.publishedRev, reviewDigest, adjacent: { prev: adjacent.reviewedAgainst.prev, next: adjacent.reviewedAgainst.next } },
  }, sealer);
  if (!published.ok) return invalid(published.problems);
  // The draft moves on too, so an editor still holding the old revision gets a
  // stale answer instead of silently saving over something already published.
  const moved = serializeVersion({ kind: 'draft', storeId, month, rev: nextDraftRev, draft, meta: { publishedRev } }, sealer);
  if (!moved.ok) return invalid(moved.problems);
  const entry = auditFor({ action: 'publish', storeId, month, actor, at, fromRev: draftRev, toRev: nextDraftRev, kind: 'published', rev: publishedRev, digest: published.envelope.hash.value, prevAuditHash, detail: { supersedes: state.publishedRev } }, sealer);
  if (!entry.ok) return invalid(entry.problems);
  const ops = [];
  // A neighbour must still be at the revision it was reviewed against.
  // One expectation per neighbour the calendar has, including a neighbour that
  // had no draft (revision 0): a draft that appears there later must stop the write.
  for (const side of ['prev', 'next']) {
    if (neighbours[side] !== null) ops.push(expectHeadOp({ storeId, month: neighbours[side], draftRev: adjacent.reviewedAgainst[side] }));
  }
  ops.push(
    putVersionOp({ kind: 'published', storeId, month, expectedRev: state.publishedRev, text: published.text }),
    putVersionOp({ kind: 'draft', storeId, month, expectedRev: draftRev, text: moved.text }),
    appendAuditOp(entry.entry),
  );
  return {
    ok: true,
    plan: {
      kind: 'publication', storeId, month, atomic: true, authorization: 'not-checked',
      ops, auditEntry: entry.entry, publishedRev, resultingHead: { draftRev: nextDraftRev, publishedRev },
    },
  };
}
