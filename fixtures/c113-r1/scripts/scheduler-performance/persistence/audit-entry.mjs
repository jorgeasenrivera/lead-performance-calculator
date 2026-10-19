// Audit entries for schedule changes, built from supplied facts only.
//
// The actor is a parameter the caller passes in from whatever it trusts (in
// future, the server's own reading of the session). It is never read from the
// draft, the envelope or any field a browser could set, and an entry that tries
// to carry one anywhere else is refused. Naming who may act is a policy
// decision this module does not make: it records an actor id and nothing about
// roles.
//
// Entries are chained: each carries the hash of the one before it, so an entry
// edited, replaced or taken out of the INTERIOR of a segment shows when
// verifyChain runs.
//
// WHAT A CHAIN CAN AND CANNOT SHOW. verifyChain checks the segment it is handed:
// that each entry is well formed, matches its own hash, follows the one before
// it, and belongs to one store and month. It does NOT show that the segment is
// the whole log. A prefix of a valid chain (the last entry removed, or the last
// several, or all of them) is itself a valid chain, and an empty list verifies.
// The start can be anchored by passing the hash the first entry must follow;
// the END cannot be anchored by anything in the entries. Detecting a missing
// tail needs a trusted copy of the latest hash or count held somewhere the log's
// writer cannot reach, and where that lives is not decided here. Nor is the
// chain a signature: anyone who can write the whole log can write a new, equally
// valid one. It is evidence of careless change, not of authenticity or completeness.
//
// Entries do not record which sealer made their hash, so a chain can only be
// checked with the sealer it was written with.
//
// Pure: the time is passed in as text, never read.
import { identityProblems, validRev, validDate, validKind } from './identity.mjs';
import { canonicalize, DEFAULT_SEALER } from './envelope.mjs';
import { plainSnapshot, plainJsonProblem, LIMITS } from './validate.mjs';

export const ACTIONS = Object.freeze(['draft-save', 'publish', 'reset', 'restore']);
export const ENTRY_VERSION = 1;
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,79}$/;
const DIGEST = /^[0-9a-f]{16,128}$/;
const DETAIL_KEY = /^[a-z][A-Za-z]{0,30}$/;
const problem = (path, code, message) => ({ path, code, message });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function validTimestamp(value) {
  const parts = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?Z$/.exec(value);
  return Boolean(parts) && validDate(parts[1]);
}

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

const INPUT_KEYS = ['action', 'storeId', 'month', 'actor', 'at', 'fromRev', 'toRev', 'subject', 'prevHash', 'detail'];

export function buildAuditEntry(rawInput, sealer = DEFAULT_SEALER) {
  if (!isObject(rawInput)) return { ok: false, problems: [problem('$', 'not-object', 'Audit input is an object.')] };
  // One strict copy; a key set to undefined counts as absent so it is reported as the missing field it is.
  const copied = plainSnapshot(rawInput, { maxDepth: LIMITS.jsonDepth, dropUndefined: true });
  if (!copied.ok) return copied;
  const input = copied.value;
  const out = [];
  for (const key of Object.keys(input)) if (!INPUT_KEYS.includes(key)) out.push(problem(key, 'unknown-key', `${key} is not an audit field.`));
  if (!ACTIONS.includes(input.action)) out.push(problem('action', 'bad-action', `Use one of ${ACTIONS.join(', ')}.`));
  out.push(...identityProblems(input));
  if (!isObject(input.actor) || Object.keys(input.actor).join() !== 'id' || typeof input.actor.id !== 'string' || !ACTOR_ID.test(input.actor.id)) out.push(problem('actor', 'bad-actor', 'Pass the trusted actor as { id }.'));
  if (!validTimestamp(input.at)) out.push(problem('at', 'bad-time', 'Pass the time as UTC text, YYYY-MM-DDTHH:MM:SSZ.'));
  if (!validRev(input.fromRev, 0) || !validRev(input.toRev, 0) || input.toRev < input.fromRev) out.push(problem('toRev', 'bad-rev', 'Revisions are whole numbers and do not go backwards.'));
  const s = input.subject;
  if (!isObject(s) || Object.keys(s).sort().join() !== 'digest,kind,rev' || !validKind(s.kind) || !validRev(s.rev) || !DIGEST.test(String(s.digest))) out.push(problem('subject', 'bad-subject', 'Name the version written: { kind, rev, digest }.'));
  if (input.prevHash !== null && !DIGEST.test(String(input.prevHash))) out.push(problem('prevHash', 'bad-prev-hash', 'Pass the hash of the previous entry, or null for the first.'));
  const detail = input.detail === undefined ? {} : input.detail;
  if (!isObject(detail) || plainJsonProblem(detail) || Object.keys(detail).length > 10) out.push(problem('detail', 'bad-detail', 'Detail is a flat object of up to 10 short values.'));
  else for (const [key, value] of Object.entries(detail)) {
    if (!DETAIL_KEY.test(key) || key === 'actor') out.push(problem(`detail.${key}`, 'bad-detail-key', 'This detail name is not allowed.'));
    else if (!(typeof value === 'boolean' || Number.isFinite(value) || (typeof value === 'string' && value.length <= 120))) out.push(problem(`detail.${key}`, 'bad-detail-value', 'Use a short text, a number or true or false.'));
  }
  if (out.length) return { ok: false, problems: out };
  const body = {
    entryVersion: ENTRY_VERSION, action: input.action, storeId: input.storeId, month: input.month,
    actor: { id: input.actor.id }, at: input.at, fromRev: input.fromRev, toRev: input.toRev,
    subject: { kind: s.kind, rev: s.rev, digest: s.digest }, detail: { ...detail }, prevHash: input.prevHash,
  };
  const canonical = canonicalize(body);
  if (!canonical.ok) return canonical;
  return { ok: true, entry: deepFreeze({ ...body, hash: sealer.digest(canonical.text) }) };
}

// Rebuilds the entry from its own fields; any edit, extra key or wrong hash fails.
export function verifyEntry(rawEntry, sealer = DEFAULT_SEALER) {
  if (!isObject(rawEntry)) return { ok: false, problems: [problem('$', 'not-object', 'An audit entry is an object.')] };
  const copied = plainSnapshot(rawEntry, { maxDepth: LIMITS.jsonDepth });
  if (!copied.ok) return copied;
  const { hash, entryVersion, ...fields } = copied.value;
  if (entryVersion !== ENTRY_VERSION) return { ok: false, problems: [problem('entryVersion', 'unsupported-version', 'This reader does not understand that entry version.')] };
  const rebuilt = buildAuditEntry(fields, sealer);
  if (!rebuilt.ok) return rebuilt;
  return rebuilt.entry.hash === hash ? { ok: true } : { ok: false, problems: [problem('hash', 'hash-mismatch', 'The entry does not match its hash.')] };
}

// entries: oldest first, all for one store and month. after: the hash the first
// one must follow (null when it is the first ever). Returns { ok: true } for any
// well-linked segment, INCLUDING an empty one or a prefix of a longer log: see
// the note at the top of this file.
export function verifyChain(rawEntries, { after = null } = {}, sealer = DEFAULT_SEALER) {
  if (!Array.isArray(rawEntries)) return { ok: false, index: -1, problems: [problem('$', 'not-array', 'A chain is a list of entries.')] };
  const copied = plainSnapshot(rawEntries, { maxDepth: LIMITS.jsonDepth });
  if (!copied.ok) return { ok: false, index: -1, problems: copied.problems };
  const entries = copied.value;
  let previous = after;
  for (let i = 0; i < entries.length; i++) {
    const checked = verifyEntry(entries[i], sealer);
    if (!checked.ok) return { ok: false, index: i, problems: checked.problems };
    if (entries[i].prevHash !== previous) return { ok: false, index: i, problems: [problem(`[${i}].prevHash`, 'chain-broken', 'This entry does not follow the one before it.')] };
    if (i > 0 && (entries[i].storeId !== entries[0].storeId || entries[i].month !== entries[0].month)) return { ok: false, index: i, problems: [problem(`[${i}]`, 'mixed-log', 'One log belongs to one store and month.')] };
    previous = entries[i].hash;
  }
  return { ok: true };
}
