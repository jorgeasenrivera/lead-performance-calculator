// Opt-in only. Nothing imports this from the application yet. The existing
// client owns auth; this adapter owns only this reader's invalidation lifetime.
const unavailable = () => Object.assign(new Error('Reported auth unavailable'), {code: 'REPORTED_AUTH_UNAVAILABLE'});

// This unverified identity is only a cache invalidation hint, never permission.
// Session id distinguishes a new login by the same account from token rotation.
const sessionKey = session => {
  try {
    const token = session?.access_token, user = session?.user?.id;
    if (typeof token !== 'string' || token.length > 8192 || typeof user !== 'string' || !user || user.length > 128) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.sub !== user || typeof claims.session_id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.session_id)) return null;
    return JSON.stringify([user, claims.session_id]);
  } catch { return null; }
};

export function createReportedAuthAdapter(client, {timeoutMs = 5000} = {}) {
  if (!client?.auth?.getSession || !client?.auth?.onAuthStateChange ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5000) throw unavailable();
  let closed = false, principalEpoch = 0, authRevision = 0, identity = null;
  let snapshot = Object.freeze({principalEpoch, disposed: false});
  const listeners = new Set();
  const invalidate = () => {
    snapshot = Object.freeze({principalEpoch: ++principalEpoch, disposed: closed});
    // Notifications invalidate values synchronously, but must not call an SDK
    // method while Supabase holds its auth lock. Token acquisition defers below.
    // A broken view listener must not break the shared auth session.
    for (const listener of [...listeners]) { try { listener(); } catch {} }
  };
  let subscription;
  try {
    subscription = client.auth.onAuthStateChange((event, session) => {
      if (closed) return;
      ++authRevision;
      const next = event === 'SIGNED_OUT' ? null : sessionKey(session);
      const routine = ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event);
      const unchanged = routine && next !== null && next === identity;
      identity = next;
      if (!unchanged) invalidate();
    })?.data?.subscription;
    if (typeof subscription?.unsubscribe !== 'function') throw unavailable();
  } catch { throw unavailable(); }

  const subscribe = listener => {
    if (closed) return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getAccessToken = ({expectedEpoch = principalEpoch, signal} = {}) => {
    const cancelled = () => closed || principalEpoch !== expectedEpoch || signal?.aborted;
    if (cancelled()) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const expires = Date.now() + timeoutMs;
      let done = false, run, deadline, unsubscribe;
      const finish = (token, failed = false) => {
        if (done) return;
        done = true;
        clearTimeout(run); clearTimeout(deadline);
        unsubscribe?.(); signal?.removeEventListener('abort', cancel);
        if (failed) reject(unavailable()); else resolve(token);
      };
      const cancel = () => finish(null);
      unsubscribe = subscribe(() => { if (cancelled()) cancel(); });
      signal?.addEventListener('abort', cancel, {once: true});
      deadline = setTimeout(() => finish(null, true), timeoutMs);
      // A macrotask lets even a synchronously notified subscriber request a
      // token without reentering the SDK inside onAuthStateChange's callback.
      const acquire = async () => {
        if (done) return;
        if (cancelled()) return cancel();
        if (Date.now() >= expires) return finish(null, true);
        try {
          const revision = authRevision;
          const result = await client.auth.getSession();
          if (done) return;
          if (cancelled()) return cancel();
          // A blocked event loop can deliver this promise before its overdue
          // timer. The wall-clock budget still applies to that late result.
          if (Date.now() >= expires) return finish(null, true);
          // A same-session notification may have rotated credentials during
          // lookup. Re-read outside the auth lock, within the original budget.
          if (revision !== authRevision) { run = setTimeout(acquire, 0); return; }
          if (result?.error || !result?.data || !Object.hasOwn(result.data, 'session')) throw unavailable();
          const session = result.data.session;
          const next = sessionKey(session);
          if (identity !== null && next !== identity) {
            identity = next; invalidate(); return cancel();
          }
          identity = next;
          if (session === null) return finish(null);
          const token = session?.access_token;
          if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9._~-]+$/.test(token)) throw unavailable();
          finish(token);
        } catch { if (cancelled()) cancel(); else finish(null, true); }
      };
      run = setTimeout(acquire, 0);
    });
  };
  const dispose = () => {
    if (closed) return;
    closed = true; identity = null; invalidate(); listeners.clear();
    try { subscription.unsubscribe(); } catch {}
  };
  return Object.freeze({getSnapshot: () => snapshot, subscribe, getAccessToken, dispose});
}
