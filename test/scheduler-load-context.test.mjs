/**
 * Where a store document came from: loaded for which store, under which sign-in, in memory only.
 * Synthetic documents and a fake auth adapter; no network, no storage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptLoad, adoptCached, beginLoad, currentReportedAuth, inheritLoadedUnder, loadedUnder, mayLeave, registerLeaveGuard, reportedAuthFor,
  invalidateReportedSession, resetLoadContext, retireSchedulerViews, trustedFor,
} from "../src/scheduler-load-context.mjs";
import { createReportedAuthAdapter } from "../src/reported-auth.mjs";
import { createReportedMonthReader, easternBusinessMonth, projectReportedMonth } from "../src/reported-month.mjs";
import { projectReportedMonthView } from "../src/use-reported-month.mjs";
import { deliveriesMonth } from "../src/scheduler-calendar-model.mjs";

const fakeAuth = (epoch = 0) => {
  let snapshot = Object.freeze({ principalEpoch: epoch, disposed: false });
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    signIn: () => { snapshot = Object.freeze({ principalEpoch: snapshot.principalEpoch + 1, disposed: false }); },
    dispose: () => { snapshot = Object.freeze({ principalEpoch: snapshot.principalEpoch + 1, disposed: true }); },
  };
};
const doc = (extra = {}) => ({ __storeId: "store-a", roster: [{ id: "r1", name: "Rae", roleId: "sales" }], ...extra });
const fresh = () => resetLoadContext();

test("a load is stamped with the sign-in it began under, and the stamp is not on the document", () => {
  fresh();
  const auth = fakeAuth(3), d = doc(), before = JSON.stringify(d);
  const ticket = beginLoad(auth, "store-a");
  assert.equal(ticket.epoch, 3);
  assert.deepEqual(acceptLoad(ticket, auth, d), { ok: true, stamped: true, doc: d });
  assert.deepEqual(loadedUnder(d), { storeId: "store-a", epoch: 3 });
  assert.equal(JSON.stringify(d), before, "nothing was written to the document, so nothing can be saved with it");
  assert.deepEqual(Object.keys(d), ["__storeId", "roster"]);
  assert.equal(Object.isFrozen(loadedUnder(d)), true);
  assert.deepEqual(JSON.parse(JSON.stringify({ ...d })), JSON.parse(before), "a save payload built from it carries no provenance");
});

test("a document that belongs to another store is refused before anything relabels it", () => {
  fresh();
  const auth = fakeAuth(), d = doc({ __storeId: "store-b" });
  const r = acceptLoad(beginLoad(auth, "store-a"), auth, d);
  assert.deepEqual(r, { ok: false, reason: "foreign" });
  assert.equal(d.__storeId, "store-b", "not relabelled");
  assert.equal(loadedUnder(d), null);
  const bare = {};
  assert.equal(acceptLoad(beginLoad(auth, "store-a"), auth, bare).ok, true, "an unmarked document is accepted, and the caller may mark it");
});

test("a new sign-in during the load refuses the answer, even for the same store, and the old epoch is never reused", () => {
  fresh();
  const auth = fakeAuth(1), d = doc();
  const ticket = beginLoad(auth, "store-a");
  auth.signIn();
  assert.deepEqual(acceptLoad(ticket, auth, d), { ok: false, reason: "principal" });
  assert.equal(loadedUnder(d), null);
  auth.signIn();
  assert.equal(acceptLoad(ticket, auth, doc()).reason, "ticket", "an already refused ticket cannot be used again under a later epoch");
  const disposedAuth = fakeAuth(0), t2 = beginLoad(disposedAuth, "store-a");
  disposedAuth.dispose();
  assert.equal(acceptLoad(t2, disposedAuth, doc()).reason, "principal", "a disposed adapter is no sign-in at all");
});

test("a newer load of the same store overtakes an older one, whichever answers last", () => {
  fresh();
  const auth = fakeAuth(), slow = doc(), quick = doc();
  const first = beginLoad(auth, "store-a"), second = beginLoad(auth, "store-a");
  assert.equal(acceptLoad(second, auth, quick).ok, true);
  assert.equal(acceptLoad(first, auth, slow).reason, "overtaken");
  assert.equal(loadedUnder(slow), null);
  const foreground = beginLoad(auth, "store-a"), refresh = beginLoad(auth, "store-a", "refresh");
  assert.equal(acceptLoad(refresh, auth, doc()).ok, true, "a refresh is its own lane");
  assert.equal(acceptLoad(foreground, auth, doc()).ok, true, "and does not overtake the load that is putting the store on screen");
  const stillCurrent = beginLoad(auth, "store-a"), other = beginLoad(auth, "store-b");
  assert.equal(acceptLoad(other, auth, doc({ __storeId: "store-b" })).ok, true, "another store's load is its own line");
  assert.equal(acceptLoad(stillCurrent, auth, doc()).ok, true, "the latest ticket for a store still stands");
});

test("with no adapter a load goes through unstamped, and nothing unstamped is ever trusted", () => {
  fresh();
  const d = doc();
  const ticket = beginLoad(null, "store-a");
  assert.equal(ticket.epoch, null);
  assert.deepEqual(acceptLoad(ticket, null, d), { ok: true, stamped: false, doc: d });
  assert.equal(loadedUnder(d), null);
  assert.deepEqual(trustedFor(d, "store-a", null), { ok: false, epoch: null });
  const auth = fakeAuth();
  assert.equal(trustedFor(d, "store-a", auth).ok, false);
  for (const bad of [null, undefined, "x", 5, []]) assert.equal(acceptLoad(beginLoad(auth, "store-a"), auth, bad).ok, false);
  assert.equal(acceptLoad(null, auth, d).reason, "ticket");
  assert.equal(beginLoad({ getSnapshot() { throw new Error("boom"); } }, "store-a").epoch, null);
  assert.equal(beginLoad({ getSnapshot: () => ({ principalEpoch: -1, disposed: false }) }, "store-a").epoch, null);
  assert.equal(beginLoad({ getSnapshot: () => ({ principalEpoch: 1.5, disposed: false }) }, "store-a").epoch, null);
});

test("a cached document is adopted only if it was loaded here, for this store, under the current sign-in", () => {
  fresh();
  const auth = fakeAuth(2), d = doc(), fromDevice = doc();
  acceptLoad(beginLoad(auth, "store-a"), auth, d);
  assert.deepEqual(adoptCached(d, "store-a", auth), { ok: true, doc: d });
  assert.equal(adoptCached(fromDevice, "store-a", auth).reason, "unknown", "a copy the device kept has no provenance");
  assert.equal(adoptCached(d, "store-b", auth).reason, "foreign");
  auth.signIn();
  assert.equal(adoptCached(d, "store-a", auth).reason, "stale", "never relabelled with the sign-in that is current now");
  assert.equal(loadedUnder(d).epoch, 2, "and its record still says what it was");
  assert.equal(adoptCached(null, "store-a", auth).reason, "unknown");
  assert.equal(adoptCached(d, "store-a", null).reason, "stale");
});

test("a local change keeps the old record, never the current epoch", () => {
  fresh();
  const auth = fakeAuth(5), d = doc();
  acceptLoad(beginLoad(auth, "store-a"), auth, d);
  const edited = inheritLoadedUnder(d, { ...d, roster: [] });
  assert.deepEqual(loadedUnder(edited), { storeId: "store-a", epoch: 5 });
  auth.signIn();
  const later = inheritLoadedUnder(edited, { ...edited });
  assert.equal(loadedUnder(later).epoch, 5, "still the epoch it was loaded under, so it is now stale");
  assert.equal(trustedFor(later, "store-a", auth).ok, false);
  const unknown = inheritLoadedUnder(doc(), { ...doc() });
  assert.equal(loadedUnder(unknown), null, "nothing known, nothing inherited");
  assert.equal(inheritLoadedUnder(d, d), d);
  assert.equal(inheritLoadedUnder(d, null), null);
  assert.equal(inheritLoadedUnder(null, edited), edited);
});

test("trusted means this store, this mark and this sign-in, all three", () => {
  fresh();
  const auth = fakeAuth(7), d = doc();
  acceptLoad(beginLoad(auth, "store-a"), auth, d);
  assert.deepEqual(trustedFor(d, "store-a", auth), { ok: true, epoch: 7 });
  assert.equal(trustedFor(d, "store-b", auth).ok, false);
  d.__storeId = "store-b";
  assert.equal(trustedFor(d, "store-a", auth).ok, false, "its own mark was changed after the load");
  d.__storeId = "store-a";
  auth.signIn();
  assert.equal(trustedFor(d, "store-a", auth).ok, false);
});

test("one adapter per client for the life of the page, made once however often it is asked for", () => {
  fresh();
  let made = 0;
  const clientA = {}, clientB = {};
  const create = () => { made += 1; return fakeAuth(); };
  const a = reportedAuthFor(clientA, create);
  assert.equal(reportedAuthFor(clientA, create), a);
  assert.equal(reportedAuthFor(clientA, create), a);
  assert.equal(made, 1, "a second render does not make a second adapter");
  assert.equal(currentReportedAuth(), a);
  const b = reportedAuthFor(clientB, create);
  assert.notEqual(b, a);
  assert.equal(currentReportedAuth(), b);
  assert.equal(reportedAuthFor(null, create), null);
  assert.equal(reportedAuthFor(clientA, undefined), null);
  fresh();
  assert.equal(reportedAuthFor({}, () => { throw new Error("boom"); }), null);
  assert.equal(currentReportedAuth(), null);
});

test("the leave guard: free with none, stays on false, goes on true, and a broken one is no guard", () => {
  resetLoadContext();
  assert.equal(mayLeave(), true);
  let asked = 0, answer = false;
  const off = registerLeaveGuard(() => { asked++; return answer; });
  assert.equal(mayLeave(), false);
  answer = true;
  assert.equal(mayLeave(), true);
  assert.equal(asked, 2);
  off();
  answer = false;
  assert.equal(mayLeave(), true, "an unregistered guard is not asked");
  registerLeaveGuard(() => { throw new Error("broken"); });
  assert.equal(mayLeave(), true);
  assert.equal(registerLeaveGuard(null)(), undefined);
});

test("an old guard's cleanup does not remove the one that replaced it", () => {
  resetLoadContext();
  const offOld = registerLeaveGuard(() => false);
  const offNew = registerLeaveGuard(() => false);
  offOld();
  assert.equal(mayLeave(), false);
  offNew();
  assert.equal(mayLeave(), true);
});

test("tickets cannot be forged, reused, or accepted by a different adapter with the same epoch", () => {
  fresh();
  const auth = fakeAuth(4), other = fakeAuth(4), ticket = beginLoad(auth, "store-a");
  assert.equal(acceptLoad({ ...ticket }, auth, doc()).reason, "ticket");
  assert.equal(acceptLoad(ticket, other, doc()).reason, "ticket");
  const accepted = doc();
  assert.equal(acceptLoad(ticket, auth, accepted).ok, true);
  assert.equal(acceptLoad(ticket, auth, doc()).reason, "ticket");
  assert.equal(adoptCached(accepted, "store-a", other).ok, false);
  assert.equal(trustedFor(accepted, "store-a", other).ok, false);
  const clone = inheritLoadedUnder(accepted, { ...accepted });
  assert.equal(trustedFor(clone, "store-a", other).ok, false);
  assert.equal(trustedFor(clone, "store-a", auth).ok, true);
});

test("a refused read attempt cannot later bless a fallback document", () => {
  fresh();
  const auth = fakeAuth(), ticket = beginLoad(auth, "store-a"), fallback = doc({ roster: [] });
  assert.equal(acceptLoad(ticket, auth, undefined).reason, "document");
  assert.equal(acceptLoad(ticket, auth, fallback).reason, "ticket");
  assert.equal(loadedUnder(fallback), null);
  assert.equal(trustedFor(fallback, "store-a", auth).ok, false);
});

test("pending session readiness issues no stamp and cannot be promoted when readiness arrives", () => {
  fresh();
  let snapshot = { principalEpoch: 2, disposed: false, sessionReady: false };
  const auth = { getSnapshot: () => snapshot }, d = doc(), ticket = beginLoad(auth, "store-a");
  snapshot = { ...snapshot, sessionReady: true };
  assert.deepEqual(acceptLoad(ticket, auth, d), { ok: true, stamped: false, doc: d });
  assert.equal(loadedUnder(d), null);
  assert.equal(adoptCached(d, "store-a", auth).reason, "unknown");
  const next = beginLoad(auth, "store-a");
  assert.equal(acceptLoad(next, auth, d).stamped, true);
});

test("reset removes issued tickets and stamps, and separate adapters do not overtake each other", () => {
  fresh();
  const auth = fakeAuth(), other = fakeAuth(), d = doc();
  const own = beginLoad(auth, "store-a");
  beginLoad(other, "store-a");
  assert.equal(acceptLoad(own, auth, d).ok, true);
  const outstanding = beginLoad(auth, "store-a");
  fresh();
  assert.equal(loadedUnder(d), null);
  assert.equal(acceptLoad(outstanding, auth, doc()).reason, "ticket");
});

test("retirement invokes only the current owner synchronously and removes its dirty question", () => {
  fresh();
  const calls = [];
  const old = registerLeaveGuard(() => false, reason => calls.push(["old", reason]));
  registerLeaveGuard(() => false, reason => calls.push(["current", reason]));
  old();
  assert.equal(retireSchedulerViews("session-ended"), true);
  assert.deepEqual(calls, [["current", "session-ended"]]);
  assert.equal(mayLeave(), true);
  assert.equal(retireSchedulerViews("again"), false);
});

test("retirement and stale cleanup preserve an owner registered by the retirement callback", () => {
  fresh();
  let nextRetired = 0;
  const old = registerLeaveGuard(() => true, () => registerLeaveGuard(() => false, () => nextRetired++));
  assert.equal(retireSchedulerViews("root-left"), true);
  old();
  assert.equal(mayLeave(), false);
  assert.equal(retireSchedulerViews("new-root-left"), true);
  assert.equal(nextRetired, 1);
  registerLeaveGuard(() => false, () => { throw Error("broken view cleanup"); });
  assert.equal(retireSchedulerViews("failed-view"), true);
  assert.equal(mayLeave(), true);
});

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const sessionFor = (number = 1, user = "synthetic-user") => {
  const sessionId = `${String(number).padStart(8, "0")}-1111-1111-1111-111111111111`;
  const body = Buffer.from(JSON.stringify({ sub: user, session_id: sessionId })).toString("base64url");
  return { user: { id: user }, access_token: `e30.${body}.signature` };
};
function authDouble({ lookup } = {}) {
  let callback, inside = false, calls = 0, unsubscribed = 0, session = sessionFor();
  const client = { auth: {
    onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { unsubscribed++; } } } }; },
    getSession() {
      assert.equal(inside, false, "the SDK's auth callback must finish before another SDK call");
      calls++;
      return lookup ? lookup() : Promise.resolve({ data: { session } });
    },
  } };
  return { client, get calls() { return calls; }, get unsubscribed() { return unsubscribed; },
    get session() { return session; }, set session(value) { session = value; },
    emit(event, value = session) { inside = true; try { return callback(event, value); } finally { inside = false; } },
  };
}

test("auth notifications invalidate synchronously and defer subscriber token lookup beyond the SDK lock", async () => {
  const sdk = authDouble(), auth = createReportedAuthAdapter(sdk.client, { timeoutMs: 500 });
  let pending, notified = 0;
  const off = auth.subscribe(() => { notified++; pending = auth.getAccessToken({ expectedEpoch: auth.getSnapshot().principalEpoch }); });
  try {
    assert.equal(auth.getSnapshot().sessionReady, false);
    assert.equal(await auth.getAccessToken(), null);
    assert.equal(sdk.calls, 0);
    assert.equal(sdk.emit("INITIAL_SESSION"), undefined, "the SDK callback never returns a promise");
    assert.equal(notified, 1);
    assert.equal(auth.getSnapshot().sessionReady, true);
    assert.equal(sdk.calls, 0);
    assert.equal(await pending, sdk.session.access_token);
    assert.equal(sdk.calls, 1);
  } finally { off(); auth.dispose(); }
});

test("token rotation preserves a session epoch while the same account's next login invalidates old loads", async () => {
  fresh();
  const sdk = authDouble(), auth = createReportedAuthAdapter(sdk.client);
  try {
    sdk.emit("SIGNED_IN");
    const epoch = auth.getSnapshot().principalEpoch, old = doc(), ticket = beginLoad(auth, "store-a");
    assert.equal(acceptLoad(ticket, auth, old).ok, true);
    sdk.emit("TOKEN_REFRESHED");
    sdk.emit("SIGNED_IN");
    assert.equal(auth.getSnapshot().principalEpoch, epoch);
    assert.equal(adoptCached(old, "store-a", auth).ok, true);
    const pending = beginLoad(auth, "store-a");
    sdk.session = sessionFor(2);
    sdk.emit("SIGNED_IN");
    assert.ok(auth.getSnapshot().principalEpoch > epoch);
    assert.equal(acceptLoad(pending, auth, doc()).reason, "principal");
    assert.equal(adoptCached(old, "store-a", auth).reason, "stale");
  } finally { auth.dispose(); }
});

test("explicit session invalidation blocks old lookup and old-session events until a distinct login", async () => {
  fresh();
  const sdk = authDouble(), auth = reportedAuthFor(sdk.client, createReportedAuthAdapter);
  try {
    sdk.emit("SIGNED_IN");
    const oldSession = sdk.session, ticket = beginLoad(auth, "store-a"), epoch = auth.getSnapshot().principalEpoch;
    const boundary = invalidateReportedSession();
    assert.ok(boundary.principalEpoch > epoch);
    assert.equal(boundary.sessionReady, false);
    assert.equal(acceptLoad(ticket, auth, doc()).reason, "principal");
    const calls = sdk.calls;
    assert.equal(await auth.getAccessToken(), null);
    for (const event of ["INITIAL_SESSION", "TOKEN_REFRESHED", "SIGNED_IN"]) sdk.emit(event, oldSession);
    assert.equal(auth.getSnapshot().sessionReady, false);
    assert.equal(sdk.calls, calls);
    sdk.session = sessionFor(2);
    sdk.emit("TOKEN_REFRESHED");
    assert.equal(auth.getSnapshot().sessionReady, false);
    sdk.emit("SIGNED_IN");
    assert.equal(auth.getSnapshot().sessionReady, true);
    assert.equal(await auth.getAccessToken(), sdk.session.access_token);
  } finally { fresh(); }
});

test("signed-out and malformed identities fail closed, including the same user's ended session", async () => {
  const sdk = authDouble(), auth = createReportedAuthAdapter(sdk.client);
  try {
    sdk.emit("SIGNED_IN");
    const old = sdk.session;
    sdk.emit("SIGNED_OUT", null);
    sdk.emit("SIGNED_IN", old);
    assert.equal(auth.getSnapshot().sessionReady, false);
    assert.equal(await auth.getAccessToken(), null);
    sdk.session = sessionFor(2);
    sdk.emit("SIGNED_IN");
    for (const session of [null, {}, { ...sdk.session, user: { id: "another-user" } },
      { user: { id: "synthetic-user" }, access_token: "e30.e30.signature" },
      { ...sdk.session, access_token: sdk.session.access_token + "\n" }]) {
      sdk.emit("TOKEN_REFRESHED", session);
      assert.equal(auth.getSnapshot().sessionReady, false);
      assert.equal(await auth.getAccessToken(), null);
    }
    assert.equal(sdk.calls, 0);
  } finally { auth.dispose(); }
});

test("an auth boundary cancels an already pending credential, and disposal owns its subscription once", async () => {
  const lookup = deferred(), sdk = authDouble({ lookup: () => lookup.promise });
  const auth = createReportedAuthAdapter(sdk.client, { timeoutMs: 500 });
  sdk.emit("SIGNED_IN");
  const token = auth.getAccessToken();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sdk.calls, 1);
  auth.invalidateSession();
  assert.equal(await token, null);
  lookup.resolve({ data: { session: sdk.session } });
  await turn();
  assert.equal(auth.getSnapshot().sessionReady, false);
  auth.dispose(); auth.dispose();
  assert.equal(sdk.unsubscribed, 1);
  assert.equal(auth.getSnapshot().disposed, true);
  assert.equal(await auth.getAccessToken(), null);
});

test("lookup cannot silently promote an unknown or different session without its SDK event", async () => {
  const sdk = authDouble(), auth = createReportedAuthAdapter(sdk.client);
  try {
    sdk.emit("SIGNED_IN");
    sdk.session = sessionFor(2);
    assert.equal(await auth.getAccessToken(), null);
    assert.equal(auth.getSnapshot().sessionReady, false);
    sdk.emit("SIGNED_IN");
    assert.equal(await auth.getAccessToken(), sdk.session.access_token);
  } finally { auth.dispose(); }
});

test("a rotated credential is read again within the original lookup budget", async () => {
  const first = deferred();
  let lookups = 0;
  const sdk = authDouble({ lookup: () => ++lookups === 1 ? first.promise : Promise.resolve({ data: { session: sdk.session } }) });
  const auth = createReportedAuthAdapter(sdk.client, { timeoutMs: 500 });
  try {
    sdk.emit("SIGNED_IN");
    const epoch = auth.getSnapshot().principalEpoch, pending = auth.getAccessToken();
    await new Promise(resolve => setTimeout(resolve, 0));
    sdk.emit("TOKEN_REFRESHED");
    first.resolve({ data: { session: sdk.session } });
    assert.equal(await pending, sdk.session.access_token);
    assert.equal(sdk.calls, 2);
    assert.equal(auth.getSnapshot().principalEpoch, epoch);
  } finally { auth.dispose(); }
});

test("an unresponsive SDK times out and a broken subscriber cannot break shared auth", async () => {
  const sdk = authDouble({ lookup: () => new Promise(() => {}) });
  const auth = createReportedAuthAdapter(sdk.client, { timeoutMs: 20 });
  try {
    auth.subscribe(() => { throw Error("broken view"); });
    sdk.emit("SIGNED_IN");
    await assert.rejects(auth.getAccessToken(), error => error.code === "REPORTED_AUTH_UNAVAILABLE");
    assert.equal(auth.getSnapshot().sessionReady, true);
  } finally { auth.dispose(); }
});

function readerAuth() {
  let snapshot = { principalEpoch: 3, disposed: false, sessionReady: true }, calls = 0;
  const listeners = new Set();
  return { getSnapshot: () => snapshot, get calls() { return calls; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async getAccessToken() { calls++; return "synthetic.token.value"; },
    change(patch) { snapshot = { ...snapshot, ...patch }; for (const fn of [...listeners]) fn(); },
  };
}
const context = (storeId = "store-a", month = "2026-11") => ({ active: true, storeId, loadedStoreId: storeId, month });
const monthPayload = (storeId = "store-a", month = "2026-11") => {
  const count = new Date(`${month}-01T12:00:00Z`); count.setUTCMonth(count.getUTCMonth() + 1, 0);
  return { storeId, month, days: Array.from({ length: count.getUTCDate() }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, "0")}`, status: "missing", count: null,
    vehicles: { new: null, used: null }, asOf: null,
  })) };
};
const response = payload => ({ status: 200, redirected: false, json: async () => payload });
function waitForStatus(reader, status) {
  if (reader.getSnapshot().status === status) return Promise.resolve(reader.getSnapshot());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(Error(`Reader did not reach ${status}`)); }, 1500);
    const off = reader.subscribe(() => {
      if (reader.getSnapshot().status === status) { clearTimeout(timer); off(); resolve(reader.getSnapshot()); }
    });
  });
}

test("missing endpoint and denied responses never create zero counts or planner history", async () => {
  for (const [status, expected] of [[404, "unavailable"], [500, "unavailable"], [401, "denied"], [403, "denied"]]) {
    const auth = readerAuth(), requests = [];
    const reader = createReportedMonthReader({ auth, fetchImpl: async (url, options) => { requests.push({ url, options }); return { status }; } });
    try {
      reader.setContext(context());
      const snapshot = await waitForStatus(reader, expected);
      assert.deepEqual(snapshot.days, []);
      const month = deliveriesMonth(snapshot, { storeId: "store-a", month: "2026-11", today: "2026-11-12", principalEpoch: 3 });
      assert.equal(month.total, null);
      assert.equal(month.days.length, 30);
      assert.ok(month.days.every(day => day.units === null && day.level === null));
      assert.equal(requests[0].url, "/api/daily-deliveries?store=store-a&month=2026-11");
      assert.equal(requests[0].options.cache, "no-store");
      assert.equal(requests[0].options.redirect, "error");
    } finally { reader.dispose(); }
  }
});

test("late answers from a previous store or closed view cannot replace the current snapshot", async () => {
  const auth = readerAuth(), requests = [];
  const reader = createReportedMonthReader({ auth, fetchImpl: (url, options) => {
    const job = { url, options, ...deferred() }; requests.push(job); return job.promise;
  } });
  try {
    reader.setContext(context()); await turn();
    reader.setContext(context("store-b")); await turn();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.signal.aborted, true);
    requests[1].resolve(response(monthPayload("store-b")));
    await waitForStatus(reader, "ready");
    const ready = reader.getSnapshot();
    requests[0].resolve(response(monthPayload())); await turn();
    assert.equal(reader.getSnapshot(), ready);
    reader.retry(); await turn();
    reader.setContext({ ...context("store-b"), active: false });
    assert.equal(reader.getSnapshot().status, "idle");
    assert.equal(requests[2].options.signal.aborted, true);
    requests[2].resolve(response(monthPayload("store-b"))); await turn();
    assert.equal(reader.getSnapshot().status, "idle");
    assert.deepEqual(reader.getSnapshot().days, []);
  } finally { reader.dispose(); }
});

test("unknown session and mismatched loaded store make no request; session end aborts an active one", async () => {
  const auth = readerAuth(); auth.change({ sessionReady: false });
  const request = deferred(); let calls = 0, signal;
  const reader = createReportedMonthReader({ auth, fetchImpl: (url, options) => { calls++; signal = options.signal; return request.promise; } });
  try {
    reader.setContext(context()); await turn();
    assert.equal(calls, 0); assert.equal(auth.calls, 0);
    auth.change({ sessionReady: true, principalEpoch: 4 }); await turn();
    assert.equal(calls, 1);
    auth.change({ sessionReady: false, principalEpoch: 5 });
    assert.equal(signal.aborted, true);
    assert.equal(reader.getSnapshot().status, "idle");
    request.resolve(response(monthPayload())); await turn();
    assert.deepEqual(reader.getSnapshot().days, []);
    auth.change({ sessionReady: true, principalEpoch: 6 });
    reader.setContext({ ...context(), loadedStoreId: "store-b" }); await turn();
    const before = calls;
    reader.retry(); await turn();
    assert.equal(calls, before);
    assert.equal(reader.getSnapshot().status, "idle");
  } finally { reader.dispose(); }
});

test("month projection requires every date and keeps explicit zero separate from missing", () => {
  const payload = monthPayload("store-a", "2024-02");
  payload.days[0] = { ...payload.days[0], status: "provisional", count: 0, vehicles: { new: 0, used: 0 },
    asOf: { timestamp: "2024-02-01T15:00:00.000Z", basis: "report_received" } };
  const days = projectReportedMonth(payload, { storeId: "store-a", month: "2024-02" });
  assert.equal(days.length, 29); assert.equal(days[0].count, 0); assert.equal(days[1].count, null);
  assert.equal(Object.isFrozen(days[0].vehicles), true);
  for (const bad of [{ ...payload, storeId: "store-b" }, { ...payload, days: payload.days.slice(1) },
    { ...payload, days: [...payload.days.slice(0, -1), payload.days[0]] },
    { ...payload, days: [{ ...payload.days[0], vehicles: { new: 1, used: 0 } }, ...payload.days.slice(1)] },
    { ...payload, days: [payload.days[0], { ...payload.days[1], count: 0 }, ...payload.days.slice(2)] }]) {
    assert.throws(() => projectReportedMonth(bad, { storeId: "store-a", month: "2024-02" }), /unavailable/);
  }
  assert.equal(easternBusinessMonth(new Date("2026-12-01T02:00:00Z")), "2026-11");
});

test("reader rejects malformed success and an unresponsive endpoint instead of inventing days", async () => {
  for (const fetchImpl of [async () => response({ storeId: "store-a", month: "2026-11", days: [] }),
    () => new Promise(() => {})]) {
    const reader = createReportedMonthReader({ auth: readerAuth(), fetchImpl, timeoutMs: 20 });
    try { reader.setContext(context()); await waitForStatus(reader, "unavailable"); assert.deepEqual(reader.getSnapshot().days, []); }
    finally { reader.dispose(); }
  }
});

test("hook projection masks old store, epoch and controller lifetime before effects run", () => {
  const auth = readerAuth(), scope = { auth, principalEpoch: 3, disposed: false, sessionReady: true, ...context() };
  const lifetime = { auth, closed: false, failed: false, context: context() };
  const snapshot = { ...context(), status: "ready", principalEpoch: 3, days: monthPayload().days };
  assert.equal(projectReportedMonthView(scope, lifetime, snapshot).status, "ready");
  assert.equal(projectReportedMonthView({ ...scope, storeId: "store-b", loadedStoreId: "store-b" }, lifetime, snapshot).status, "loading");
  assert.equal(projectReportedMonthView({ ...scope, principalEpoch: 4 }, lifetime, snapshot).status, "loading");
  assert.equal(projectReportedMonthView(scope, { ...lifetime, auth: readerAuth() }, snapshot).status, "loading");
  assert.equal(projectReportedMonthView(scope, { ...lifetime, closed: true }, snapshot).status, "loading");
  assert.equal(projectReportedMonthView({ ...scope, sessionReady: false }, lifetime, snapshot).status, "idle");
  assert.equal(projectReportedMonthView({ ...scope, loadedStoreId: "store-b" }, lifetime, snapshot).status, "idle");
  assert.equal(projectReportedMonthView(scope, { ...lifetime, failed: true }, snapshot).status, "unavailable");
});
