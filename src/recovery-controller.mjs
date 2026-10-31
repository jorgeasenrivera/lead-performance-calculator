/* Owns live recovery attempts independently of untrusted continuity storage.
   Dependencies are injected; constructing this owner sends no requests. */
export function createRecoveryController({ guard, continuity, getSession, writePassword, failedNotice, restoreOnBoot = true }) {
  let generation = 0, identity = null, sessionToken = null, context = null;
  let attempt = null, restored = false, batching = false, arrivalIdentity = null;
  const listeners = new Set();
  const snapshot = () => ({ ...guard.snapshot(),
    ...(continuity.snapshot().status === 'interrupted' ? { status: 'interrupted' } : {}), generation, sessionUserId: identity });
  const emit = () => { if (!batching) for (const fn of listeners) fn(snapshot()); };
  guard.subscribe(() => {
    if (guard.snapshot().status === 'failed' && context) continuity.failed(context);
    emit();
  });
  const invalidate = () => { generation++; attempt = null; arrivalIdentity = null; guard.invalidate(); };
  const settleIdentity = session => {
    const uid = session?.user?.id || null;
    identity = uid; sessionToken = session?.access_token || null;
    continuity.reconcileIdentity(uid);
    if (!restored && restoreOnBoot && guard.snapshot().status !== 'ready' && guard.snapshot().status !== 'pending') {
      continuity.restore(uid); context = continuity.snapshot().context || null;
      restored = true;
    }
  };
  return {
    snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onAuthEvent(event, session) {
      batching = true;
      try {
        const uid = session?.user?.id || null;
        if (event === 'PASSWORD_RECOVERY' && uid && session.access_token) {
          generation++; attempt = null; arrivalIdentity = null; identity = uid; sessionToken = session.access_token;
          guard.onAuthEvent(event, session);
          context = continuity.begin(uid); restored = true;
        } else {
          const hasProof = ['ready', 'pending'].includes(guard.snapshot().status);
          if (event === 'SIGNED_OUT' || ((hasProof || arrivalIdentity) && identity && uid && uid !== identity) ||
              (event === 'SIGNED_IN' && hasProof)) invalidate();
          guard.onAuthEvent(event, session);
          if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT' || uid) settleIdentity(session);
        }
      } finally { batching = false; emit(); }
    },
    settled(session) {
      if (restored || guard.snapshot().status === 'ready') return;
      batching = true;
      try { settleIdentity(session); } finally { batching = false; emit(); }
    },
    settle() { guard.settle(); },
    /* pageshow.persisted: discard all old proof before reading continuity. */
    reenter() {
      batching = true;
      try {
        invalidate();
        continuity.restore(identity); context = continuity.snapshot().context || null;
        restored = true;
      } finally { batching = false; emit(); }
    },
    dismiss() {
      const state = continuity.snapshot();
      continuity.dismiss(state.context);
      guard.dismiss();
      // A tracking/ready recovery still cannot be dismissed.
      if (guard.snapshot().status === 'ready' || guard.snapshot().status === 'pending') return false;
      attempt = null; context = null; emit(); return true;
    },
    arrivalFinished(expectedGeneration, userId) {
      if (generation === expectedGeneration && arrivalIdentity === userId) arrivalIdentity = null;
    },
    async save(password) {
      const bound = guard.binding(), started = generation, handle = context, ticket = {};
      if (!bound) return { error: failedNotice, lost: true };
      attempt = ticket;
      const current = () => generation === started && attempt === ticket && context === handle &&
        identity === bound.userId && guard.canSave(bound.userId) &&
        guard.binding()?.accessToken === bound.accessToken;
      let session;
      try { session = (await getSession())?.data?.session; } catch {}
      if (!current()) return { stale: true };
      if (session?.user?.id !== bound.userId || !session?.access_token || session.access_token !== sessionToken) {
        guard.invalidate(); continuity.failed(handle); emit();
        return { error: failedNotice, lost: true };
      }
      let result;
      try { result = await writePassword(bound.accessToken, password); }
      catch { result = { error: "Couldn't reach sign-in. Check your connection and try again." }; }
      if (!current()) return { stale: true };
      if (!result || result.error) {
        if (result?.lost) { guard.invalidate(); continuity.failed(handle); emit(); }
        return result || { error: "Couldn't reach sign-in. Check your connection and try again." };
      }
      // Cleanup status never decides whether an independently accepted save succeeded.
      continuity.succeeded(handle);
      context = null; arrivalIdentity = bound.userId; guard.done(); emit();
      return result;
    },
  };
}
