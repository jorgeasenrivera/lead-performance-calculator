import { assertPublicMonth } from '../synthetic-fixtures/contract-oracle.mjs';

// Proposal-only reader. It never derives facts from month totals or digest rows.
export function createMonthReader({ fetch, onChange = () => {}, timeoutMs = 5000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let generation = 0, pending = null;
  let state = { phase: 'idle', storeId: null, month: null, generation: 0, revision: null, days: [] };
  const emit = (next) => { state = next; onChange(state); };
  const invalidate = () => {
    generation++;
    if (pending) { pending.active = false; clearTimer(pending.timer); pending.controller.abort(); pending = null; }
  };
  const cancel = ({ silent = false } = {}) => {
    invalidate();
    const next = { phase: 'idle', storeId: null, month: null, generation, revision: null, days: [] };
    if (silent) state = next; else emit(next);
  };
  const select = ({ storeId, month, revision = 0 }) => {
    invalidate();
    const own = { active: true, generation, controller: new AbortController() };
    pending = own;
    const base = { storeId, month, revision, generation, days: [] };
    const current = () => own.active && pending === own && generation === own.generation;
    const finish = (next) => {
      if (!current()) return false;
      own.active = false; clearTimer(own.timer); pending = null;
      emit({ ...base, ...next }); return true;
    };
    emit({ ...base, phase: 'loading' });
    own.timer = setTimer(() => {
      if (finish({ phase: 'error', kind: 'timeout' })) own.controller.abort();
    }, timeoutMs);
    own.done = (async () => {
      try {
        const response = await fetch(`/api/daily-deliveries?store=${encodeURIComponent(storeId)}&month=${encodeURIComponent(month)}`, { signal: own.controller.signal });
        if (!current()) return;
        if (!response.ok) {
          finish({ phase: [401, 403].includes(response.status) ? 'denied' : 'error', kind: String(response.status) });
          return;
        }
        const payload = await response.json();
        if (!current()) return;
        assertPublicMonth(payload, { storeId, month });
        finish({ phase: 'ready', days: payload.days });
      } catch (_) { finish({ phase: 'error', kind: 'unavailable' }); }
    })();
    return own.done;
  };
  return { select, cancel, get state() { return state; } };
}

export function visibleMonth(state, { storeId, month, revision = 0, active = true }) {
  if (!active) return { phase: 'idle', storeId, month, revision, days: [] };
  if (state.storeId !== storeId || state.month !== month || state.revision !== revision) {
    return { phase: 'loading', storeId, month, revision, days: [] };
  }
  return state;
}
