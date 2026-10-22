// Unwired controller. The supplied reader must authorize every request server-side.
// Notifications are invalidations only; rendered content always comes from read.
export function createRefresh({ read, render, subscribe = () => () => {},
  setTimer = setTimeout, clearTimer = clearTimeout, interval = 2000, timeout = 4000 }) {
  if (!Number.isFinite(interval) || interval < 500 || interval > 3000 ||
      !Number.isFinite(timeout) || timeout < 100 || timeout > 4000) throw new Error('invalid-timing');
  let epoch = 0, identity = null, active = false, timer, unsubscribe = () => {}, pending = null;
  let revision = 0, dirty = false;
  function stopRequest() {
    if (pending) { clearTimer(pending.deadline); pending.abort.abort(); pending = null; }
  }
  function schedule() {
    clearTimer(timer);
    if (active && identity) timer = setTimer(refresh, interval);
  }
  async function refresh() {
    if (!active || !identity) return;
    if (pending) { dirty = true; return; }
    clearTimer(timer);
    const generation = epoch, scope = identity;
    const request = { abort: new AbortController() };
    pending = request;
    const current = () => epoch === generation && pending === request && active;
    request.deadline = setTimer(() => {
      if (!current()) return;
      request.abort.abort(); pending = null; dirty = false;
      render({ status: 'unavailable' }); schedule();
    }, timeout);
    try {
      const result = await read(scope, { signal: request.abort.signal });
      if (!current()) return;
      if (!result?.ok || !Number.isSafeInteger(result.revision) || result.revision < 0) {
        revision = 0; render({ status: 'unavailable' });
      } else if (result.revision >= revision) {
        revision = result.revision;
        render({ status: 'ready', revision, schedule: result.schedule });
      }
    } catch {
      if (current()) render({ status: 'unavailable' });
    } finally {
      if (current()) {
        clearTimer(request.deadline); pending = null;
        if (dirty) { dirty = false; void refresh(); } else schedule();
      }
    }
  }
  function reset() {
    epoch++; clearTimer(timer); stopRequest(); unsubscribe(); unsubscribe = () => {};
    revision = 0; dirty = false; render({ status: 'empty' });
  }
  function select(scope) {
    reset(); identity = scope == null ? null : structuredClone(scope); active = !!identity;
    if (identity) {
      const generation = epoch;
      unsubscribe = subscribe(identity, () => { if (generation === epoch) void refresh(); });
      void refresh();
    }
  }
  return {
    select,
    // A trusted auth/profile-change signal invalidates in-flight authorization too.
    // This does not approve anyone: the next read must independently authorize.
    accessChanged() { select(identity); },
    foreground(value) {
      active = !!value && !!identity;
      clearTimer(timer); stopRequest(); dirty = false;
      // Polling on resume also recovers a dropped notification connection.
      if (active) void refresh();
    },
    reconnect() { void refresh(); },
    dispose() { reset(); identity = null; active = false; },
  };
}
