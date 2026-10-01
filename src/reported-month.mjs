// Source-only reader. Nothing in the app imports this until the calendar's
// production gates are cleared. The server, not this projection, owns evidence.
const empty = Object.freeze([]);
const unavailable = () => new Error('Reported month unavailable');
const validStore = value => typeof value === 'string' && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T12:00:00Z'))
  && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
const validMonth = value => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && validDay(value + '-01');
const countOf = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const monthDates = month => {
  const first = new Date(month + '-01T12:00:00Z');
  first.setUTCMonth(first.getUTCMonth() + 1, 0);
  return Array.from({length: first.getUTCDate()}, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

export function easternBusinessMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit'}).formatToParts(date);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}

export function projectReportedMonth(payload, {storeId, month}) {
  if (!validStore(storeId) || !validMonth(month) || payload?.storeId !== storeId || payload?.month !== month
      || !Array.isArray(payload.days)) throw unavailable();
  const dates = monthDates(month), seen = new Set();
  // The endpoint returns a full month. A missing row is a malformed response,
  // not a licence to turn an unsupported day into a known zero or empty success.
  if (payload.days.length !== dates.length) throw unavailable();
  const days = payload.days.map(day => {
    if (!day || !validDay(day.date) || !day.date.startsWith(month + '-') || seen.has(day.date)
        || !['provisional', 'missing', 'incomplete', 'conflict'].includes(day.status)) throw unavailable();
    seen.add(day.date);
    const split = day.vehicles;
    if (!split || typeof split !== 'object') throw unavailable();
    let asOf = null;
    if (day.status === 'provisional') {
      const stamp = day.asOf?.timestamp;
      if (!countOf(day.count) || typeof stamp !== 'string'
          || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stamp)
          || !validDay(stamp.slice(0, 10)) || !Number.isFinite(Date.parse(stamp))
          || new Date(stamp).toISOString() !== stamp
          || !['report_sent', 'report_received'].includes(day.asOf.basis)) throw unavailable();
      if (!(split.new === null && split.used === null)
          && !(countOf(split.new) && countOf(split.used) && split.new + split.used === day.count)) throw unavailable();
      asOf = Object.freeze({timestamp: stamp, basis: day.asOf.basis});
    } else if (day.count !== null || split.new !== null || split.used !== null || day.asOf !== null) throw unavailable();
    return Object.freeze({date: day.date, status: day.status, count: day.count,
      vehicles: Object.freeze({new: split.new, used: split.used}), asOf});
  }).sort((a, b) => a.date.localeCompare(b.date));
  return Object.freeze(days);
}

export function createReportedMonthReader({auth, fetchImpl = globalThis.fetch, timeoutMs = 5000,
    now = () => globalThis.performance.now()} = {}) {
  if (typeof auth?.getSnapshot !== 'function' || typeof auth?.subscribe !== 'function'
      || typeof auth?.getAccessToken !== 'function' || typeof fetchImpl !== 'function'
      || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5000) throw unavailable();
  let disposed = false, generation = 0, attempt = null;
  let context = Object.freeze({active: false, storeId: null, loadedStoreId: null, month: null});
  let snapshot = Object.freeze({status: 'idle', days: empty, storeId: null, month: null, principalEpoch: auth.getSnapshot().principalEpoch});
  const listeners = new Set();
  const publish = (status, days = empty) => {
    snapshot = Object.freeze({status, days, storeId: context.storeId, month: context.month,
      principalEpoch: auth.getSnapshot().principalEpoch});
    for (const listener of [...listeners]) { try { listener(); } catch {} }
  };
  const invalidate = () => {
    ++generation;
    const previous = attempt; attempt = null;
    if (previous) { clearTimeout(previous.timer); previous.controller.abort(); }
  };
  const start = () => {
    if (disposed) return;
    invalidate();
    const identity = auth.getSnapshot(), selected = context;
    if (!selected.active || identity.disposed || selected.storeId !== selected.loadedStoreId) return publish('idle');
    if (!validStore(selected.storeId) || !validMonth(selected.month)
        || !Number.isSafeInteger(identity.principalEpoch) || identity.principalEpoch < 0) return publish('unavailable');
    const job = {generation, epoch: identity.principalEpoch, controller: new AbortController(), expires: now() + timeoutMs};
    attempt = job;
    const current = () => !disposed && attempt === job && generation === job.generation
      && !job.controller.signal.aborted && auth.getSnapshot().principalEpoch === job.epoch && !auth.getSnapshot().disposed;
    const finish = (status, days) => {
      if (!current()) return;
      attempt = null; clearTimeout(job.timer); job.controller.abort(); publish(status, days);
    };
    const checkpoint = () => {
      if (!current()) return false;
      if (now() >= job.expires) { finish('unavailable'); return false; }
      return true;
    };
    job.timer = setTimeout(() => finish('unavailable'), timeoutMs);
    publish('loading');
    // Starting the generation before lookup prevents a late credential from
    // becoming a request after a store switch, close or same-store new session.
    void (async () => {
      try {
        if (!checkpoint()) return;
        const token = await auth.getAccessToken({expectedEpoch: job.epoch, signal: job.controller.signal});
        if (!checkpoint()) return;
        if (token === null) return finish('denied');
        if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9._~-]+$/.test(token)) return finish('unavailable');
        const response = await fetchImpl(`/api/daily-deliveries?store=${encodeURIComponent(selected.storeId)}&month=${encodeURIComponent(selected.month)}`, {
          method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
          headers: {Authorization: `Bearer ${token}`}, signal: job.controller.signal,
        });
        if (!checkpoint()) return;
        if (response?.status === 401 || response?.status === 403) return finish('denied');
        if (response?.status !== 200 || response.redirected || typeof response.json !== 'function') return finish('unavailable');
        const payload = await response.json();
        if (!checkpoint()) return;
        const days = projectReportedMonth(payload, selected);
        if (checkpoint()) finish('ready', days);
      } catch { if (checkpoint()) finish('unavailable'); }
    })();
  };
  const unsubscribeAuth = auth.subscribe(start);
  if (typeof unsubscribeAuth !== 'function') throw unavailable();
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    setContext(value) {
      if (disposed) return;
      const next = {active: value?.active === true, storeId: value?.storeId ?? null,
        loadedStoreId: value?.loadedStoreId ?? null, month: value?.month ?? null};
      if (Object.keys(next).every(key => next[key] === context[key])) return;
      context = Object.freeze(next); start();
    },
    retry: start,
    dispose() {
      if (disposed) return;
      disposed = true; invalidate(); unsubscribeAuth(); publish('idle'); listeners.clear();
    },
  });
}
