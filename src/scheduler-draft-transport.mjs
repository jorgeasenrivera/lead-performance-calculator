// Source-only. Wire contract: ae282b3997f9c0657de4c7f3dba0851bf9da9337.
// The injected codec must round-trip the complete editor model, including unknown
// availability and provenance, or throw. It is not a C113 implementation.
export const draftError = (code, uncertain = false) => Object.assign(new Error(code), {code, uncertain});
const fail = () => { throw draftError('unsupported-data'); };
export const revision = n => Number.isSafeInteger(n) && n >= 0;
export const fields = (v, names) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Reflect.ownKeys(v).length === names.length && names.every(k => Object.hasOwn(v, k));

// Reject values JSON.stringify would silently omit or coerce. Bound recursion
// before copying, and detach caller-owned data before asynchronous work starts.
export function copyDraftJson(value, seen = new Set(), depth = 0, budget = {nodes: 0}) {
  if (++budget.nodes > 50000 || depth > 64) fail();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) fail();
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const keys = Reflect.ownKeys(value);
  if (array && (keys.length !== value.length + 1 || !keys.includes('length'))) fail();
  seen.add(value);
  const result = array ? [] : {};
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string' || (array && !/^(0|[1-9]\d*)$/.test(key))) fail();
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d.enumerable || !Object.hasOwn(d, 'value')) fail();
    Object.defineProperty(result, key, {value: copyDraftJson(d.value, seen, depth + 1, budget), enumerable: true});
  }
  seen.delete(value);
  return Object.freeze(result);
}
const canonical = v => JSON.stringify(v === null || typeof v !== 'object' ? v
  : Array.isArray(v) ? v.map(x => JSON.parse(canonical(x)))
    : Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(canonical(v[k]))])));
const equal = (a, b) => canonical(a) === canonical(b);
const statuses = {'invalid-request': 400, unauthenticated: 401, forbidden: 403, conflict: 409,
  'idempotency-conflict': 409, 'request-too-large': 413, 'contract-rejected': 422,
  'storage-not-configured': 503, 'contract-not-configured': 503, 'storage-unavailable': 503};

export function createSchedulerDraftTransport({auth, codec, fetchImpl, requestId, timeoutMs = 5000} = {}) {
  if (typeof auth?.getSnapshot !== 'function' || typeof auth?.getAccessToken !== 'function'
      || !['encode', 'decode', 'validateScope'].every(k => typeof codec?.[k] === 'function')
      || typeof fetchImpl !== 'function' || typeof requestId !== 'function'
      || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw draftError('configuration');
  const commands = new WeakMap();
  const scopeOf = value => {
    const scope = copyDraftJson({storeId: value?.storeId, month: value?.month});
    if (typeof scope.storeId !== 'string' || typeof scope.month !== 'string' || codec.validateScope(scope) !== true) fail();
    return scope;
  };
  const decode = (wire, scope) => {
    const raw = copyDraftJson(wire), model = copyDraftJson(codec.decode(raw, scope));
    if (!equal(raw, copyDraftJson(codec.encode(model, scope)))) fail();
    return model;
  };
  const encode = (model, scope) => {
    const original = copyDraftJson(model), raw = copyDraftJson(codec.encode(original, scope));
    if (!equal(original, decode(raw, scope))) fail();
    return raw;
  };
  const prepare = envelope => {
    const body = JSON.stringify(envelope);
    if (new TextEncoder().encode(body).length > 1048576) throw draftError('request-too-large');
    const command = Object.freeze({body});
    commands.set(command, envelope);
    return command;
  };
  return Object.freeze({
    prepareRead(value) { const scope = scopeOf(value); return prepare({op: 'read', ...scope, input: {kind: 'draft'}}); },
    prepareSave(value, baseRev, model) {
      const scope = scopeOf(value);
      if (!revision(baseRev)) fail();
      const draft = encode(model, scope), id = requestId();
      if (typeof id !== 'string' || !id.trim()) fail();
      return prepare({op: 'save', ...scope, requestId: id, input: {baseRev, draft}});
    },
    async send(command, {expectedEpoch, signal} = {}) {
      const envelope = commands.get(command);
      if (!envelope || !revision(expectedEpoch)) throw draftError('invalid-command');
      const abort = new AbortController();
      let sent = false, timer, cancel;
      const current = () => !signal?.aborted && !abort.signal.aborted
        && !auth.getSnapshot().disposed && auth.getSnapshot().principalEpoch === expectedEpoch;
      const check = () => { if (!current()) throw draftError('stale', sent); };
      const work = async () => {
        check();
        const token = await auth.getAccessToken({expectedEpoch, signal: abort.signal});
        check();
        if (token === null) throw draftError('unauthenticated');
        if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9._~-]+$/.test(token)) throw draftError('auth-unavailable');
        sent = true;
        const response = await fetchImpl('/api/scheduler', {method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
          headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: command.body, signal: abort.signal});
        check();
        if (response?.redirected || typeof response?.json !== 'function') throw draftError('invalid-response', true);
        const payload = copyDraftJson(await response.json());
        check();
        if (response.status !== 200) {
          if (!fields(payload, ['error']) || !Object.hasOwn(statuses, payload.error) || statuses[payload.error] !== response.status)
            throw draftError('invalid-response', true);
          throw draftError(payload.error, response.status === 503);
        }
        if (envelope.op === 'read') {
          const r = payload.result;
          if (!fields(payload, ['result']) || !fields(r, ['kind', 'revision', 'schedule']) || r.kind !== 'draft'
              || !revision(r.revision) || (r.revision === 0 ? r.schedule !== null : r.schedule === null)) throw draftError('invalid-response', true);
          return Object.freeze({kind: 'draft', revision: r.revision, draft: r.revision === 0 ? null : decode(r.schedule, scopeOf(envelope))});
        }
        const head = payload.result?.head;
        if (!fields(payload, ['result', 'replayed']) || typeof payload.replayed !== 'boolean'
            || !fields(payload.result, ['head']) || !fields(head, ['draftRev', 'publishedRev'])
            || !revision(head.draftRev) || !revision(head.publishedRev) || head.draftRev <= envelope.input.baseRev)
          throw draftError('invalid-response', true);
        return Object.freeze({head, replayed: payload.replayed});
      };
      try {
        return await Promise.race([work(), new Promise((_, reject) => {
          cancel = () => { abort.abort(); reject(draftError('stale', sent)); };
          signal?.addEventListener('abort', cancel, {once: true});
          if (signal?.aborted) cancel();
          timer = setTimeout(() => { abort.abort(); reject(draftError('timeout', sent)); }, timeoutMs);
        })]);
      } catch (error) {
        // Any local failure while interpreting a dispatched response may hide a
        // committed save. Only an exact server error can be definitive here.
        if (error?.code === 'unsupported-data' && sent) throw draftError('invalid-response', true);
        if (error?.code) throw error;
        throw draftError('transport-unavailable', sent);
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); abort.abort(); }
    },
  });
}
