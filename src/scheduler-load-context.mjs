/**
 * Where a store document came from, kept in memory and never saved.
 * -------------------------------------------------------------------------
 * The scheduler reads two things about a document: which store it belongs to (`__storeId`, which
 * IS saved with it) and which sign-in it was loaded under. The second is not a property of the
 * document, because anything on the document is written back by a save. It lives here instead:
 * a weak map from the document object to `{storeId, epoch}`, so a document that is dropped takes
 * its record with it and nothing about it can reach a payload.
 *
 * The epoch is the reported-auth adapter's `principalEpoch`: it moves when a different person (or
 * a new session) signs in, and not when a token is refreshed. A load takes the epoch before it asks
 * and again when it has the answer. If it moved, or a newer load for the same store has begun, the
 * answer is not accepted, and a document is never given the current epoch just because it is in hand.
 *
 * Pure: no React, no network, no storage, no clock. The dashboard (the core) is the only writer.
 */

const stamps = new WeakMap();
const generations = new Map();
let current = null;

const isEpoch = (n) => Number.isSafeInteger(n) && n >= 0;
const snapshotOf = (auth) => {
  try {
    const s = auth && typeof auth.getSnapshot === "function" ? auth.getSnapshot() : null;
    return s && isEpoch(s.principalEpoch) && s.disposed !== true ? s : null;
  } catch {
    return null;
  }
};

/**
 * The one reported-auth adapter for this page, created from the app's own client the first time it is
 * asked for and kept for the life of the page. It is made here, not inside a component, so a StrictMode
 * double render cannot leave a second one listening, and the reader hook (which borrows it and never
 * closes it) sees the same one the loads were stamped by. No client, no adapter.
 */
export function reportedAuthFor(client, create) {
  if (current && current.client === client) return current.auth;
  if (!client || typeof create !== "function") return null;
  let auth = null;
  try { auth = create(client); } catch { auth = null; }
  current = auth ? { client, auth } : null;
  return auth;
}
/** The adapter the dashboard made, for the screens that borrow it. Null when there is none. */
export function currentReportedAuth() { return current ? current.auth : null; }
/** For tests: forget the adapter and every generation. */
export function resetLoadContext() { current = null; generations.clear(); }

/**
 * Start a load of `storeId`: the epoch it begins under, and its place in line. A newer `beginLoad` for
 * the same store and lane makes this one stale, whichever answers last. A background refresh is its own
 * lane, so it cannot overtake the load that is putting the store on screen.
 */
export function beginLoad(auth, storeId, lane = "load") {
  const key = `${storeId}|${lane}`;
  const generation = (generations.get(key) || 0) + 1;
  generations.set(key, generation);
  const snap = snapshotOf(auth);
  return Object.freeze({ storeId, lane, generation, epoch: snap ? snap.principalEpoch : null });
}

/**
 * Take the answer to a load, or refuse it with a reason. Checked in this order, and nothing is
 * changed on a refusal: a document that says it is another store's (before anything relabels it);
 * a load that has been overtaken; a sign-in that has changed since it began; a missing or invalid
 * adapter, in which case the document is let through unstamped, exactly as before, and the
 * scheduler will treat it as unknown.
 */
export function acceptLoad(ticket, auth, doc) {
  if (!ticket || typeof ticket.storeId !== "string") return { ok: false, reason: "ticket" };
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, reason: "document" };
  if (doc.__storeId && doc.__storeId !== ticket.storeId) return { ok: false, reason: "foreign" };
  if (generations.get(`${ticket.storeId}|${ticket.lane}`) !== ticket.generation) return { ok: false, reason: "overtaken" };
  if (ticket.epoch === null) return { ok: true, stamped: false, doc };
  const snap = snapshotOf(auth);
  if (!snap || snap.principalEpoch !== ticket.epoch) return { ok: false, reason: "principal" };
  stamps.set(doc, Object.freeze({ storeId: ticket.storeId, epoch: ticket.epoch }));
  return { ok: true, stamped: true, doc };
}

/** What a document was loaded under, or null (never loaded here, from a device copy, or a different object). */
export function loadedUnder(doc) {
  return doc && typeof doc === "object" && stamps.has(doc) ? stamps.get(doc) : null;
}

/**
 * A document in hand (the admin preload's copy for a store) may be shown only if it was loaded for this
 * store under the sign-in that is current now. Anything else needs a fresh load.
 */
export function adoptCached(doc, storeId, auth) {
  const stamp = loadedUnder(doc);
  if (!stamp) return { ok: false, reason: "unknown" };
  if (stamp.storeId !== storeId || (doc.__storeId && doc.__storeId !== storeId)) return { ok: false, reason: "foreign" };
  const snap = snapshotOf(auth);
  if (!snap || snap.principalEpoch !== stamp.epoch) return { ok: false, reason: "stale" };
  return { ok: true, doc };
}

/**
 * A local change (a save, a merge, an edit) makes a new document from an old one. It keeps the old one's
 * record as it was, never the current epoch: if the old one was loaded under a sign-in that has ended,
 * so was the new one. No record on the old one, no record on the new.
 */
export function inheritLoadedUnder(prev, next) {
  const stamp = loadedUnder(prev);
  if (stamp && next && typeof next === "object" && next !== prev) stamps.set(next, stamp);
  return next;
}

/**
 * Whether `doc` may be shown for `storeId` right now: stamped for this store, still carrying this store's
 * mark, and under the sign-in that is current. The entries use this to decide what to mask; it never throws.
 */
export function trustedFor(doc, storeId, auth) {
  const stamp = loadedUnder(doc);
  const snap = snapshotOf(auth);
  if (!stamp || !snap) return { ok: false, epoch: null };
  const ok = stamp.storeId === storeId && doc.__storeId === storeId && stamp.epoch === snap.principalEpoch;
  return { ok, epoch: ok ? stamp.epoch : null };
}
