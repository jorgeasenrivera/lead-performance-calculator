// The versioned envelope every stored schedule version travels in, and the
// canonical text it is written as.
//
// Canonical means the same data always gives the same bytes: keys sorted, no
// whitespace, one spelling per number. Stored text is therefore unique, so a
// copy that differs by a space or a repeated key can be refused instead of
// trusted, and a round trip can be compared byte for byte.
//
// Everything that is sealed, opened or written out first goes through one strict
// snapshot (plainSnapshot in validate.mjs), so the text, the checksum and the
// object handed back all describe the same data and no serialization hook can
// change it between the check and the copy.
//
// WHAT THE CHECKSUM IS AND IS NOT. It is an integrity check for accidental
// damage and for a payload moved under the wrong identity. It is NOT a defence
// against someone who can write the stored text, because anyone who can write
// the text can recompute the checksum. A keyed signature made on the server is
// future work and is not decided here.
//
// THE SEALER CONTRACT. A sealer is { alg, digest(text) }. `digest` is
// synchronous and deterministic, is used both to create and to verify, and
// returns lowercase hexadecimal of 16 to 128 characters. `alg` is a short name
// of lowercase letters, digits, "." "_" "-". Nothing here supports asynchronous
// signing, key rotation, or a verification-only (public key) object, and the
// audit entries elsewhere in this folder do not record which sealer made them.
// Swapping in a callback does not by itself make anything tamper-proof.
//
// Pure: no clock, no storage, no node: imports, no environment.
import { validStoreId, validMonth, validKind, validRev, adjacentMonths } from './identity.mjs';
import { plainSnapshot, LIMITS } from './validate.mjs';

export const FORMAT = 'sage.scheduler.version';
export const VERSION = 1;
export const MAX_ENVELOPE_CHARS = 1000000;
export const SEAL_VALUE = /^[0-9a-f]{16,128}$/;
export const SEAL_ALG = /^[a-z0-9][a-z0-9._-]{0,39}$/;

const problem = (path, code, message) => ({ path, code, message });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Writes already-snapshotted data. `state.used` is a running lower bound of the
// output length, so an enormous value stops early instead of being built in full.
function write(value, state) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') { state.used += value.length + 2; if (state.used > state.maxChars) throw problem('$', 'too-large', `Larger than ${state.maxChars} characters.`); return JSON.stringify(value); }
  if (typeof value === 'number') { state.used += 1; return JSON.stringify(value); }
  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) { state.used += 1; parts.push(write(item, state)); }
    return `[${parts.join(',')}]`;
  }
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    state.used += key.length + 4;
    if (state.used > state.maxChars) throw problem('$', 'too-large', `Larger than ${state.maxChars} characters.`);
    parts.push(`${JSON.stringify(key)}:${write(value[key], state)}`);
  }
  return `{${parts.join(',')}}`;
}

// For data that has already been through plainSnapshot.
export function canonicalizePlain(snapshot, { maxChars = Infinity } = {}) {
  try {
    const text = write(snapshot, { used: 0, maxChars });
    if (text.length > maxChars) return { ok: false, problems: [problem('$', 'too-large', `Larger than ${maxChars} characters.`)] };
    return { ok: true, text, value: snapshot };
  } catch (found) {
    if (found && typeof found.code === 'string') return { ok: false, problems: [found] };
    throw found;
  }
}

// For data of unknown origin: snapshot first, then write that snapshot.
export function canonicalize(value, { maxChars = Infinity } = {}) {
  const snapshot = plainSnapshot(value);
  return snapshot.ok ? canonicalizePlain(snapshot.value, { maxChars }) : snapshot;
}

// 64-bit FNV-1a over UTF-8, written by hand so that no crypto, TextEncoder or
// node: module is needed. An unpaired surrogate is encoded as U+FFFD, exactly
// as a standard UTF-8 encoder does, so every unpaired surrogate hashes alike.
function utf8(text) {
  const bytes = [];
  for (const symbol of text) {
    const code = symbol.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) bytes.push(0xef, 0xbf, 0xbd);
    else if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 63);
    else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
  }
  return bytes;
}
export function checksum(text) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of utf8(String(text))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}
export const DEFAULT_SEALER = Object.freeze({ alg: 'fnv1a64', digest: checksum });

function sealerProblem(sealer, digest) {
  if (!sealer || typeof sealer.alg !== 'string' || !SEAL_ALG.test(sealer.alg)) return problem('sealer.alg', 'bad-sealer', 'A sealer names itself in lowercase letters, digits, . _ or -.');
  if (typeof sealer.digest !== 'function') return problem('sealer.digest', 'bad-sealer', 'A sealer has a digest function.');
  if (digest !== undefined && !(typeof digest === 'string' && SEAL_VALUE.test(digest))) return problem('sealer.digest', 'bad-sealer', 'A sealer returns lowercase hexadecimal of 16 to 128 characters.');
  return null;
}

// What "adjacent" means in published metadata: the draft revision of each
// calendar neighbour of `month` when it was reviewed, 0 when that neighbour had
// no saved draft, and null ONLY where the calendar has no such month (before
// 2014-01, after 2100-12). A null beside a month that exists would switch off
// the check that neighbour is there to give.
export function adjacentSnapshotProblem(month, adjacent, path = 'adjacent') {
  const expected = adjacentMonths(month);
  if (!expected) return problem(path, 'bad-adjacent', 'The month is not valid.');
  if (!isObject(adjacent) || Object.keys(adjacent).sort().join() !== 'next,prev') return { ...problem(path, 'bad-adjacent', 'Give the previous and next neighbour revisions.') };
  for (const side of ['prev', 'next']) {
    const ok = expected[side] === null ? adjacent[side] === null : validRev(adjacent[side], 0);
    if (!ok) return { ...problem(`${path}.${side}`, 'bad-adjacent', expected[side] === null ? `There is no ${side} month, so this must be null.` : `The ${side} month ${expected[side]} exists: give its draft revision, 0 if none.`), side };
  }
  return null;
}

function metaProblems(kind, meta, month) {
  if (!isObject(meta)) return [problem('meta', 'bad-meta', 'Meta is an object.')];
  const out = [], allowed = kind === 'published'
    ? { sourceDraftRev: 1, supersedes: 0, reviewDigest: null, adjacent: null }
    : { restoredFrom: null, resetFrom: 1, publishedRev: 1 };
  for (const key of Object.keys(meta)) if (!Object.hasOwn(allowed, key)) out.push(problem(`meta.${key}`, 'unknown-key', `${key} is not allowed on a ${kind} version.`));
  const bad = plainSnapshot(meta, { maxDepth: LIMITS.jsonDepth, path: 'meta' });
  if (!bad.ok) out.push(bad.problems[0]);
  if (kind === 'published') {
    if (!validRev(meta.sourceDraftRev)) out.push(problem('meta.sourceDraftRev', 'bad-rev', 'Name the draft revision this was published from.'));
    if (!validRev(meta.supersedes, 0)) out.push(problem('meta.supersedes', 'bad-rev', 'Name the published revision this replaces, or 0.'));
    if (typeof meta.reviewDigest !== 'string' || !SEAL_VALUE.test(meta.reviewDigest)) out.push(problem('meta.reviewDigest', 'bad-digest', 'Record the digest of the reviewed state.'));
    // Skipped when the month itself is invalid: that is reported on its own.
    if (validMonth(month)) { const adjacent = adjacentSnapshotProblem(month, meta.adjacent, 'meta.adjacent'); if (adjacent) out.push(adjacent); }
  } else {
    if (Object.hasOwn(meta, 'resetFrom') && !validRev(meta.resetFrom)) out.push(problem('meta.resetFrom', 'bad-rev', 'Name the draft revision this reset.'));
    if (Object.hasOwn(meta, 'publishedRev') && !validRev(meta.publishedRev)) out.push(problem('meta.publishedRev', 'bad-rev', 'Name the published revision.'));
    if (Object.hasOwn(meta, 'restoredFrom')) {
      const r = meta.restoredFrom;
      if (!isObject(r) || !validKind(r.kind) || !validRev(r.rev) || Object.keys(r).length !== 2) out.push(problem('meta.restoredFrom', 'bad-restore', 'Name the kind and revision restored from.'));
    }
  }
  return out;
}

// For fields whose `payload` and `meta` are ALREADY snapshots. fields: { kind, storeId, month, rev, meta, payload }
export function sealSnapshot(fields, sealer = DEFAULT_SEALER) {
  const out = [];
  if (!isObject(fields)) return { ok: false, problems: [problem('$', 'not-object', 'Envelope fields are an object.')] };
  const bad = sealerProblem(sealer);
  if (bad) return { ok: false, problems: [bad] };
  if (!validKind(fields.kind)) out.push(problem('kind', 'bad-kind', 'Use draft or published.'));
  if (!validStoreId(fields.storeId)) out.push(problem('storeId', 'bad-store-id', 'Use a valid store id.'));
  if (!validMonth(fields.month)) out.push(problem('month', 'bad-month', 'Use a month from 2014-01 to 2100-12.'));
  if (!validRev(fields.rev)) out.push(problem('rev', 'bad-rev', 'Use a revision of 1 or more.'));
  if (validKind(fields.kind)) out.push(...metaProblems(fields.kind, fields.meta, fields.month));
  if (out.length) return { ok: false, problems: out };
  const body = { format: FORMAT, version: VERSION, kind: fields.kind, storeId: fields.storeId, month: fields.month, rev: fields.rev, meta: fields.meta, payload: fields.payload };
  const canonical = canonicalizePlain(body, { maxChars: MAX_ENVELOPE_CHARS });
  if (!canonical.ok) return canonical;
  const value = sealer.digest(canonical.text);
  const wrong = sealerProblem(sealer, value);
  if (wrong) return { ok: false, problems: [wrong] };
  const envelope = { ...body, hash: { alg: sealer.alg, value } };
  const text = canonicalizePlain(envelope, { maxChars: MAX_ENVELOPE_CHARS });
  return text.ok ? { ok: true, envelope, text: text.text } : text;
}

// For fields of unknown origin: one snapshot, then the same checks.
export function seal(fields, sealer = DEFAULT_SEALER) {
  if (!isObject(fields)) return { ok: false, problems: [problem('$', 'not-object', 'Envelope fields are an object.')] };
  const snapshot = plainSnapshot(fields);
  return snapshot.ok ? sealSnapshot(snapshot.value, sealer) : snapshot;
}

// Checks the wrapper only: format, version, identity, meta, hash wrapper and
// checksum. The payload itself is checked by deserialize, which knows what a
// draft is. `snapshot` must already be a plainSnapshot copy.
export function openSnapshot(envelope, expect = {}, sealer = DEFAULT_SEALER) {
  if (!isObject(envelope)) return { ok: false, problems: [problem('$', 'not-object', 'A stored version is an object.')] };
  const keys = Object.keys(envelope).sort().join(',');
  if (keys !== 'format,hash,kind,meta,month,payload,rev,storeId,version') return { ok: false, problems: [problem('$', 'bad-shape', 'This is not a stored schedule version.')] };
  if (envelope.format !== FORMAT) return { ok: false, problems: [problem('format', 'bad-format', 'This is not a stored schedule version.')] };
  if (envelope.version !== VERSION) return { ok: false, problems: [problem('version', 'unsupported-version', `Version ${String(envelope.version)} is not supported; this reader understands ${VERSION}.`)] };
  const out = [];
  if (!validKind(envelope.kind)) out.push(problem('kind', 'bad-kind', 'Use draft or published.'));
  if (!validStoreId(envelope.storeId)) out.push(problem('storeId', 'bad-store-id', 'Use a valid store id.'));
  if (!validMonth(envelope.month)) out.push(problem('month', 'bad-month', 'Use a month from 2014-01 to 2100-12.'));
  if (!validRev(envelope.rev)) out.push(problem('rev', 'bad-rev', 'Use a revision of 1 or more.'));
  if (validKind(envelope.kind)) out.push(...metaProblems(envelope.kind, envelope.meta, envelope.month));
  if (out.length) return { ok: false, problems: out };
  for (const key of ['kind', 'storeId', 'month', 'rev']) {
    if (expect[key] !== undefined && envelope[key] !== expect[key]) out.push(problem(key, key === 'kind' ? 'kind-mismatch' : key === 'rev' ? 'rev-mismatch' : 'identity-mismatch', `Expected ${key} ${String(expect[key])}, found ${String(envelope[key])}.`));
  }
  if (out.length) return { ok: false, problems: out };
  const { hash, ...body } = envelope;
  // Exactly an algorithm name and a hex digest: an extra field would be accepted
  // by the reader yet covered by nothing.
  if (!isObject(hash) || Object.keys(hash).sort().join() !== 'alg,value' || typeof hash.alg !== 'string' || !SEAL_ALG.test(hash.alg) || typeof hash.value !== 'string' || !SEAL_VALUE.test(hash.value)) {
    return { ok: false, problems: [problem('hash', 'bad-hash', 'The checksum is exactly { alg, value }, with a hexadecimal value.')] };
  }
  const bad = sealerProblem(sealer);
  if (bad) return { ok: false, problems: [bad] };
  if (hash.alg !== sealer.alg) return { ok: false, problems: [problem('hash.alg', 'unsupported-hash', 'This reader cannot check that checksum.')] };
  const canonical = canonicalizePlain(body);
  if (!canonical.ok) return canonical;
  if (hash.value !== sealer.digest(canonical.text)) return { ok: false, problems: [problem('hash.value', 'hash-mismatch', 'The stored version does not match its checksum.')] };
  return { ok: true, envelope };
}

// For an envelope of unknown origin: one snapshot, then the same checks. What it
// returns is the snapshot, never the object it was given.
export function open(envelope, expect = {}, sealer = DEFAULT_SEALER) {
  if (!isObject(envelope)) return { ok: false, problems: [problem('$', 'not-object', 'A stored version is an object.')] };
  const snapshot = plainSnapshot(envelope);
  return snapshot.ok ? openSnapshot(snapshot.value, expect, sealer) : snapshot;
}
