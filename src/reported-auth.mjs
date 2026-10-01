// Opt-in only. Nothing imports this from the application yet. The existing
// client owns auth; this adapter owns only this reader's invalidation lifetime.
const unavailable = () => Object.assign(new Error('Reported auth unavailable'), {code: 'REPORTED_AUTH_UNAVAILABLE'});

export function createReportedAuthAdapter(client, {timeoutMs = 5000} = {}) {
  if (!client?.auth?.getSession || !client?.auth?.onAuthStateChange ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5000) throw unavailable();
  let closed = false, principalEpoch = 0;
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
    subscription = client.auth.onAuthStateChange(() => { if (!closed) invalidate(); })?.data?.subscription;
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
      run = setTimeout(async () => {
        if (cancelled()) return cancel();
        if (Date.now() >= expires) return finish(null, true);
        try {
          const result = await client.auth.getSession();
          if (cancelled()) return cancel();
          // A blocked event loop can deliver this promise before its overdue
          // timer. The wall-clock budget still applies to that late result.
          if (Date.now() >= expires) return finish(null, true);
          if (result?.error || !result?.data || !Object.hasOwn(result.data, 'session')) throw unavailable();
          const session = result.data.session;
          if (session === null) return finish(null);
          const token = session?.access_token;
          if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9._~-]+$/.test(token)) throw unavailable();
          finish(token);
        } catch { if (cancelled()) cancel(); else finish(null, true); }
      }, 0);
    });
  };
  const dispose = () => {
    if (closed) return;
    closed = true; invalidate(); listeners.clear();
    try { subscription.unsubscribe(); } catch {}
  };
  return Object.freeze({getSnapshot: () => snapshot, subscribe, getAccessToken, dispose});
}
