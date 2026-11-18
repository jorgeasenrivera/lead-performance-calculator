// Inert foundation: no app import, native storage, credentials or network.
// The storage port must provide a cross-instance exclusive lock and atomic,
// durable replace. Never supply an unlocked read/write preferences adapter.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const states = new Set(['held', 'sending', 'uncertain', 'resolved', 'stopped', 'blocked']);
const contextKeys = ['actor', 'person', 'store', 'date', 'lifecycle'];
function fail(message) { throw new Error(message); }
function json(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('invalid JSON');
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (/token|password|secret|authorization|credential|__proto__|constructor|prototype/i.test(key)) fail('credential or unsafe field');
    out[key] = json(value[key]);
  }
  return out;
}
const equal = (a, b) => JSON.stringify(json(a)) === JSON.stringify(json(b));
function keys(value, expected) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join() !== [...expected].sort().join()) fail('invalid fields');
}
function context(value) {
  keys(value, contextKeys);
  for (const key of contextKeys) if (typeof value[key] !== 'string' || !value[key].trim()) fail('invalid context');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date) fail('invalid date');
  return json(value);
}
function intent(value) {
  keys(value, ['operationId', 'store', 'date', 'room', 'action', 'input']);
  if (typeof value.operationId !== 'string' || !uuid.test(value.operationId)) fail('invalid operation ID');
  for (const k of ['store', 'date', 'room', 'action']) if (typeof value[k] !== 'string' || !value[k].trim()) fail('invalid intent');
  return json(value);
}
function document(value) {
  keys(value, ['format', 'revision', 'records']);
  if (value.format !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.records)) fail('invalid journal');
  const seen = new Set();
  for (const r of value.records) {
    keys(r, ['intent', 'context', 'state', 'attempts', 'reason']);
    intent(r.intent); context(r.context);
    if (r.intent.store !== r.context.store || r.intent.date !== r.context.date || seen.has(r.intent.operationId)) fail('invalid binding');
    seen.add(r.intent.operationId);
    if (!states.has(r.state) || !Number.isSafeInteger(r.attempts) || r.attempts < 0 || typeof r.reason !== 'string') fail('invalid record');
    if (['sending', 'uncertain', 'resolved'].includes(r.state) && !r.attempts) fail('invalid attempt state');
  }
  return json(value);
}

export function createIntentJournal({ storage, verify, send, notify } = {}) {
  if (!storage || !['exclusive', 'read', 'replace'].every(k => typeof storage[k] === 'function')) fail('durable storage required');
  let fault = false;
  const load = async () => {
    if (fault) fail('storage fault; reopen with verified durable storage');
    try {
      const raw = await storage.read();
      // Only an explicit absent value means a new journal. Corrupt bytes never reset it.
      return raw === null ? { format: 1, revision: 0, records: [] } : document(JSON.parse(raw));
    } catch { fault = true; fail('journal unavailable; preserved without reset'); }
  };
  const save = async d => {
    d.revision++;
    try { await storage.replace(JSON.stringify(document(d))); }
    catch { fault = true; fail('durability uncertain; sending disabled'); }
  };
  const locked = fn => storage.exclusive(fn);
  const find = (d, id) => d.records.find(r => r.intent.operationId === id) || fail('unknown operation');
  const view = d => json(d);
  async function allowed(r) {
    if (typeof verify !== 'function' || typeof send !== 'function') return false;
    try {
      const proof = await verify(json(r.context), json(r.intent));
      if (proof?.context && !equal(context(proof.context), r.context)) return 'changed';
      // Trusted adapter contract, NOT a client boolean authorization mechanism.
      // Server remains authoritative. No such production adapter is supplied.
      return proof?.identityVerified === true && proof?.roomCommandVerified === true &&
        proof?.actionInputVerified === true && equal(context(proof.context), r.context);
    } catch { return false; }
  }
  return {
    snapshot: () => locked(async () => view(await load())),
    capture: async value => {
      const payload = intent(value.intent), binding = context(value.context);
      if (payload.store !== binding.store || payload.date !== binding.date) fail('context mismatch');
      return locked(async () => {
      const d = await load(), old = d.records.find(r => r.intent.operationId === payload.operationId);
      if (old) { if (!equal(old.intent, payload) || !equal(old.context, binding)) fail('operation ID reused'); return view(d); }
      d.records.push({ intent: payload, context: binding, state: 'held', attempts: 0, reason: 'review_required' });
      await save(d); return view(d);
      });
    },
    recover: () => locked(async () => {
      const d = await load(); let changed = false;
      for (const r of d.records) if (r.state === 'sending') { r.state = 'uncertain'; r.reason = 'interrupted'; changed = true; }
      if (changed) await save(d);
      return view(d); // Never dispatch on startup.
    }),
    stopRetrying: (id, expectedRevision) => locked(async () => {
      const d = await load(); if (d.revision !== expectedRevision) fail('stale review');
      const r = find(d, id); if (r.state === 'resolved') return view(d);
      r.state = 'stopped'; r.reason = 'not_cancellation';
      await save(d); return view(d); // Remains an ordering barrier, with no deletion.
    }),
    retireContext: async binding => {
      const old = context(binding);
      return locked(async () => {
      const d = await load(); let changed = false;
      for (const r of d.records) if (equal(r.context, old) && !['resolved', 'stopped', 'blocked'].includes(r.state)) {
        r.state = 'blocked'; r.reason = 'context_changed'; changed = true;
      }
      if (changed) await save(d);
      return view(d); // Returning to the old account/store/day never unblocks it.
      });
    },
    attempt: async (id, expectedRevision) => {
      let notification;
      const result = await locked(async () => {
      const d = await load(); if (d.revision !== expectedRevision) fail('stale review');
      const r = find(d, id);
      if (!['held', 'uncertain'].includes(r.state)) fail('not retryable');
      // Until conflict semantics are approved, all earlier unresolved actions block.
      if (d.records.slice(0, d.records.indexOf(r)).some(p => p.state !== 'resolved')) fail('predecessor unresolved');
      const preflight = await allowed(r);
      if (preflight === 'changed') { r.state = 'blocked'; r.reason = 'context_changed'; await save(d); }
      if (preflight !== true) fail('verified unchanged context and capability required');
      const previous = r.state;
      r.state = 'sending'; r.reason = 'outcome_unknown'; r.attempts++;
      await save(d); // Do not send unless the operation identity is durably recorded.
      const dispatchCheck = await allowed(r);
      if (dispatchCheck !== true) {
        r.state = dispatchCheck === 'changed' ? 'blocked' : previous;
        r.reason = 'context_or_capability_changed'; await save(d); return view(d);
      }
      let response;
      try {
        // Adapter must bind session to this exact context at actual dispatch.
        // It must use only /api/room-command, never the legacy fallback.
        response = await send(json(r.intent), json(r.context));
      } catch { response = null; }
      const ok = response && Number.isInteger(response.status) && response.status >= 200 && response.status < 300 &&
        response.body?.ok === true && response.body.row !== null && typeof response.body.row === 'object' && !Array.isArray(response.body.row);
      r.state = ok ? 'resolved' : 'uncertain';
      r.reason = ok ? 'confirmed_response' : 'unconfirmed_response';
      await save(d);
      // No response row is stored, applied, or forwarded. It may be historical.
      notification = { operationId: id, state: r.state };
      return view(d);
      });
      try { if (notification) await notify?.(notification); } catch { /* durable record remains the source for later UI reads */ }
      return result;
    },
  };
}
