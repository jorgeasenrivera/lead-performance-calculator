// Draft to stored text. Takes a draft in the shape the planner is asked to
// export (see docs/scheduler-persistence-contract.md), refuses anything that
// would not read back, and returns canonical text.
//
// The draft is copied ONCE, by plainSnapshot, and that same copy is what gets
// checked, sealed, hashed and returned. Nothing is cloned afterwards, so a
// serialization hook or a getter on the caller's objects cannot make the stored
// form differ from the one that was validated.
//
// Review state (accepted, reviewFingerprint) belongs to one open page and is
// never stored. A stored "reviewed" flag would outlive the edits it vouched for.
import { identityProblems } from './identity.mjs';
import { validateSnapshot, plainSnapshot, LIMITS } from './validate.mjs';
import { sealSnapshot, DEFAULT_SEALER } from './envelope.mjs';

// Dropped silently, and only these. Any other unknown key is an error, so a
// field the contract does not know about cannot slip into storage.
export const LOCAL_ONLY_KEYS = Object.freeze(['accepted', 'reviewFingerprint']);

export function persistable(draft) {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) return draft;
  return Object.fromEntries(Object.entries(draft).filter(([key]) => !LOCAL_ONLY_KEYS.includes(key)));
}

const notObject = [{ path: '$', code: 'not-object', message: 'A draft is an object.' }];

// input: { kind, storeId, month, rev, draft, meta? }
export function serializeVersion(input, sealer = DEFAULT_SEALER) {
  const { kind, storeId, month, rev, draft, meta = {} } = input || {};
  const identity = identityProblems({ storeId, month });
  if (identity.length) return { ok: false, problems: identity };
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) return { ok: false, problems: notObject };
  const copied = plainSnapshot(draft);
  if (!copied.ok) return { ok: false, problems: copied.problems };
  const payload = persistable(copied.value);
  const checked = validateSnapshot(payload, { storeId, month });
  if (!checked.ok) return { ok: false, problems: checked.problems };
  const metaCopy = plainSnapshot(meta, { maxDepth: LIMITS.jsonDepth, path: 'meta' });
  if (!metaCopy.ok) return { ok: false, problems: metaCopy.problems };
  const sealed = sealSnapshot({ kind, storeId, month, rev, meta: metaCopy.value, payload }, sealer);
  return sealed.ok ? { ...sealed, warnings: checked.warnings } : sealed;
}
export const serializeDraft = (input, sealer) => serializeVersion({ ...input, kind: 'draft' }, sealer);
