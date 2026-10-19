// Recovery plans: reset a month and restore an earlier version, without ever
// overwriting one. Every write creates the next numbered version and leaves the
// old ones where they were, so "reset" hides a draft rather than deleting it and
// a published version, once written, is only ever superseded by a later one.
//
// Like every plan here these are data. They do not apply themselves and they do
// not decide who may recover a month.
import { identityProblems, versionId } from './identity.mjs';
import { deserializeVersion } from './deserialize.mjs';
import { serializeVersion } from './serialize.mjs';
import { DEFAULT_SEALER } from './envelope.mjs';
import { evaluateWrite, headProblem, normalHead, invalid, auditFor, putVersionOp, appendAuditOp } from './cas.mjs';

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

function common(input, sealer) {
  const { storeId, month, baseRev, head } = input || {};
  const identity = identityProblems({ storeId, month });
  if (identity.length) return invalid(identity);
  const bad = head === undefined ? fail('bad-head', 'Pass the head you just read.') : headProblem(head);
  if (bad) return bad;
  const state = normalHead(head);
  const verdict = evaluateWrite({ current: state.draftRev > 0 ? { rev: state.draftRev } : null, baseRev });
  if (!verdict.ok) return verdict;
  return { ok: true, state, nextRev: verdict.nextRev };
}

// Start the month again from `freshDraft`, which the caller builds from its own
// defaults (the model owns what a fresh month is; this module does not).
export function planReset(input, sealer = DEFAULT_SEALER) {
  const { storeId, month, baseRev, freshDraft, actor, at, prevAuditHash = null } = input || {};
  const base = common(input, sealer);
  if (!base.ok) return base;
  if (base.state.draftRev === 0) return fail('nothing-to-reset', 'There is no saved draft to reset.');
  const written = serializeVersion({ kind: 'draft', storeId, month, rev: base.nextRev, draft: freshDraft, meta: { resetFrom: baseRev } }, sealer);
  if (!written.ok) return invalid(written.problems);
  const entry = auditFor({ action: 'reset', storeId, month, actor, at, fromRev: baseRev, toRev: base.nextRev, kind: 'draft', rev: base.nextRev, digest: written.envelope.hash.value, prevAuditHash }, sealer);
  if (!entry.ok) return invalid(entry.problems);
  return {
    ok: true,
    plan: {
      kind: 'reset', storeId, month, atomic: true, authorization: 'not-checked',
      ops: [putVersionOp({ kind: 'draft', storeId, month, expectedRev: baseRev, text: written.text }), appendAuditOp(entry.entry)],
      auditEntry: entry.entry, resultingHead: { draftRev: base.nextRev, publishedRev: base.state.publishedRev },
    },
  };
}

// Bring an earlier version back as the newest draft. `target` is the stored
// text the caller read, and the revision and kind it believes it is.
export function planRestore(input, sealer = DEFAULT_SEALER) {
  const { storeId, month, target, actor, at, prevAuditHash = null } = input || {};
  const base = common(input, sealer);
  if (!base.ok) return base;
  if (!target || typeof target.text !== 'string') return fail('bad-target', 'Pass the stored text to restore as target.text.');
  const read = deserializeVersion(target.text, { storeId, month, kind: target.kind, rev: target.rev }, sealer);
  if (!read.ok) return invalid(read.problems);
  const written = serializeVersion({ kind: 'draft', storeId, month, rev: base.nextRev, draft: read.draft, meta: { restoredFrom: { kind: read.kind, rev: read.rev } } }, sealer);
  if (!written.ok) return invalid(written.problems);
  const entry = auditFor({ action: 'restore', storeId, month, actor, at, fromRev: input.baseRev, toRev: base.nextRev, kind: 'draft', rev: base.nextRev, digest: written.envelope.hash.value, prevAuditHash, detail: { restoredKind: read.kind, restoredRev: read.rev } }, sealer);
  if (!entry.ok) return invalid(entry.problems);
  return {
    ok: true,
    plan: {
      kind: 'restore', storeId, month, atomic: true, authorization: 'not-checked',
      ops: [putVersionOp({ kind: 'draft', storeId, month, expectedRev: input.baseRev, text: written.text }), appendAuditOp(entry.entry)],
      auditEntry: entry.entry, resultingHead: { draftRev: base.nextRev, publishedRev: base.state.publishedRev },
    },
  };
}

// The check a caller can run against what it knows is stored: no put-version in
// the plan may land on a version that already exists.
export function assertNoOverwrite(plan, existingVersionIds) {
  const existing = new Set(existingVersionIds);
  const clashes = (plan?.ops || []).filter(op => op.op === 'put-version')
    .map(op => versionId(op.kind, op.storeId, op.month, op.rev)).filter(id => existing.has(id));
  return clashes.length ? fail('would-overwrite', 'This plan would replace a stored version.', { ids: clashes }) : { ok: true };
}
