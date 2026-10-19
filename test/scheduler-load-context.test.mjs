/**
 * Where a store document came from: loaded for which store, under which sign-in, in memory only.
 * Synthetic documents and a fake auth adapter; no network, no storage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptLoad, adoptCached, beginLoad, currentReportedAuth, inheritLoadedUnder, loadedUnder, mayLeave, registerLeaveGuard, reportedAuthFor,
  resetLoadContext, trustedFor,
} from "../src/scheduler-load-context.mjs";

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
  assert.equal(acceptLoad(ticket, auth, doc()).reason, "principal", "epochs only go up, so the old one cannot match again");
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
  const refresh = beginLoad(auth, "store-a", "refresh");
  assert.equal(acceptLoad(refresh, auth, doc()).ok, true, "a refresh is its own lane");
  assert.equal(acceptLoad(second, auth, doc()).ok, true, "and does not overtake the load that is putting the store on screen");
  const other = beginLoad(auth, "store-b");
  assert.equal(acceptLoad(other, auth, doc({ __storeId: "store-b" })).ok, true, "another store's load is its own line");
  assert.equal(acceptLoad(second, auth, doc()).ok, true, "the latest ticket for a store still stands");
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
