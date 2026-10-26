/* Same-tab UI continuity only. A marker is untrusted and cannot prove a reset,
   supply a session, authorize a write, or say whether an interrupted PUT saved.
   The caller owns SDK validation, the existing recovery guard and app access.
   Inject sessionStorage (never localStorage); this module does no I/O at import. */
export const RECOVERY_INTERRUPTED_NOTICE = "This reset was interrupted. To choose a new password, request a fresh link.";
export const RECOVERY_CONTINUITY_KEY = "sage:recovery-continuity:v1";

const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const encode = (userId, id) => JSON.stringify({ version: 1, userId, id });
function decode(raw) {
  if (typeof raw !== "string" || raw.length > 400) return null;
  try {
    const value = JSON.parse(raw);
    if (value && value.version === 1 && identifier(value.userId) && identifier(value.id)
      && raw === encode(value.userId, value.id)) return value;
  } catch {}
  return null;
}

export function createRecoveryContinuity({ storage, makeId = () => globalThis.crypto.randomUUID() } = {}) {
  let active = null;
  const read = () => {
    try {
      if (storage) return { available: true, raw: storage.getItem(RECOVERY_CONTINUITY_KEY) };
    } catch {}
    return { available: false, raw: null };
  };
  const remove = () => { try { if (storage) { storage.removeItem(RECOVERY_CONTINUITY_KEY); return true; } } catch {} return false; };
  const write = (raw) => { try { storage?.setItem(RECOVERY_CONTINUITY_KEY, raw); } catch {} };
  const nextId = () => {
    try { const id = makeId(); if (identifier(id)) return id; } catch {}
    return null;
  };
  const snapshot = () => active ? Object.freeze({
    status: active.status, userId: active.userId, context: active.context,
    ...(active.status === "interrupted" ? { notice: RECOVERY_INTERRUPTED_NOTICE } : {}),
  }) : Object.freeze({ status: "idle" });
  const install = (userId, id, status) => {
    /* Object identity is local to this lifetime. A serialized, copied or late
       handle cannot complete/dismiss a newer recovery, even for the same user. */
    active = { userId, raw: id ? encode(userId, id) : null, status, context: Object.freeze({}) };
    return active.context;
  };
  const isLocal = (context) => !!active && active.context === context;
  const removeOwnedMarker = () => {
    const { available, raw } = read();
    /* Missing and unreadable storage cannot prove persisted ownership. This
       boolean reports cleanup only, never whether a password result is valid. */
    return !!(available && active?.raw && raw === active.raw && remove());
  };
  return {
    snapshot,
    /* Call only after validated PASSWORD_RECOVERY. Pass the SDK user ID, never
       a URL/email/marker identity. Returned handle is for lifecycle cleanup,
       not password authorization. Failure to persist costs continuity only. */
    begin(userId) {
      if (!identifier(userId)) return null;
      const id = nextId();
      const context = install(userId, id, "tracking");
      remove();
      if (id) write(active.raw);
      return context;
    },
    /* Call once Auth has settled, only for a cleared callback/re-entry, never
       over a freshly validated recovery. On persisted pageshow the owner must
       also invalidate old guard/write proof before restoring interruption UI. */
    restore(userId) {
      active = null;
      const { raw } = read();
      const marker = decode(raw);
      if (!identifier(userId) || !marker || marker.userId !== userId) {
        if (raw !== null) remove();
        return snapshot();
      }
      // Rotate the lifecycle marker too, so a surviving old instance cannot
      // clear the re-entry notice with a response from before the interruption.
      const id = nextId();
      install(userId, id, "interrupted");
      remove();
      if (id) write(active.raw);
      return snapshot();
    },
    /* A settled identity change or SIGNED_OUT, not a provisional boot null.
       Call before accepting any pending result. Same-user token rotation keeps
       context; a fresh recovery event must use begin even for the same user. */
    reconcileIdentity(userId) {
      if (active && active.userId !== userId) active = null;
      const { raw } = read();
      const marker = decode(raw);
      if (raw !== null && (!identifier(userId) || !marker || marker.userId !== userId)) remove();
      return snapshot();
    },
    /* The caller independently validates this failure against its current real
       guard/attempt. This updates only this instance's notice lifecycle. */
    failed(context) {
      if (!isLocal(context) || active.status !== "tracking") return false;
      active.status = "failed";
      return true;
    },
    /* Call AFTER the owner accepts success using its current live guard/binding
       and attempt identity, independently of this helper. Release local tracking
       even without storage. Return true only for verified marker removal, NOT
       success acceptance. Never gate guard.done or app arrival on this result. */
    succeeded(context) {
      if (!isLocal(context) || active.status !== "tracking") return false;
      const removed = removeOwnedMarker();
      active = null;
      return removed;
    },
    /* Untrusted storage cannot trap the person in local interruption UI. Clear
       the matching local notice, but remove storage only if it is still ours.
       Return value means local dismissal only, never a password outcome. */
    dismiss(context) {
      if (!isLocal(context) || !["failed", "interrupted"].includes(active.status)) return false;
      removeOwnedMarker(); active = null;
      return true;
    },
  };
}
