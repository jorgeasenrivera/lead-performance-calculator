// Stored text to a validated draft. Every check that can fail is here, in one
// order: size, JSON, one strict snapshot, canonical form and size of that
// snapshot, wrapper (format, version, identity, hash, checksum), then the draft
// itself. The caller says what it expects to be holding, and a version stored
// for another store or month is refused.
//
// The snapshot is made once and everything after it, including the draft that
// is returned, is that snapshot. Text and already-parsed objects take the same
// path, so the same limits apply to both.
import { canonicalizePlain, openSnapshot, DEFAULT_SEALER, MAX_ENVELOPE_CHARS } from './envelope.mjs';
import { plainSnapshot, validateSnapshot } from './validate.mjs';

const problem = (path, code, message) => ({ path, code, message });

// input: canonical text, or an already-parsed envelope object.
// expect: { storeId, month, kind?, rev? }
export function deserializeVersion(input, expect = {}, sealer = DEFAULT_SEALER) {
  let parsed = input;
  if (typeof input === 'string') {
    // Checked before parsing so an enormous string is never parsed at all.
    if (input.length > MAX_ENVELOPE_CHARS) return { ok: false, problems: [problem('$', 'too-large', `A version is at most ${MAX_ENVELOPE_CHARS} characters.`)] };
    try { parsed = JSON.parse(input); }
    catch { return { ok: false, problems: [problem('$', 'invalid-json', 'The stored text is not valid JSON.')] }; }
  }
  const copied = plainSnapshot(parsed);
  if (!copied.ok) return copied;
  // The canonical form of the snapshot, with the same limit for text and objects.
  const canonical = canonicalizePlain(copied.value, { maxChars: MAX_ENVELOPE_CHARS });
  if (!canonical.ok) return canonical;
  // Stored text is canonical by construction. Anything else (extra spaces, a
  // repeated key that JSON.parse quietly collapsed) is not what was written.
  if (typeof input === 'string' && canonical.text !== input) return { ok: false, problems: [problem('$', 'not-canonical', 'The stored text is not in canonical form.')] };
  const opened = openSnapshot(copied.value, expect, sealer);
  if (!opened.ok) return opened;
  const { envelope } = opened;
  const checked = validateSnapshot(envelope.payload, { storeId: envelope.storeId, month: envelope.month });
  if (!checked.ok) return { ok: false, problems: checked.problems };
  return {
    ok: true,
    kind: envelope.kind, storeId: envelope.storeId, month: envelope.month, rev: envelope.rev,
    meta: envelope.meta,
    draft: checked.value,
    hash: envelope.hash.value,
    warnings: checked.warnings,
  };
}
