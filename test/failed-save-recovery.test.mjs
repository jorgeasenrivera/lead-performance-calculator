/* A refused save leaves a kept, visible attempt and no way to send it again.
 *
 * What this protects. Before, a refused save left the screen showing the change as if it had landed, with a pop-up as the only
 * record. Now each refused save is kept in this window only, shown with what it changed, and offered: review, return to the
 * editor, load the latest saved data, discard. The rules that make that safe, each a real failure found on the way:
 *   - a kept attempt is never sent again and never lends its copy, baseline or proof to a save (the first version of this had a
 *     "save again" that re-authorized the old intent);
 *   - a failure that arrives after a sign-out is not kept for the next person, checked where the list is written as well as
 *     before it is scheduled;
 *   - the refresh reads the store the way the store load does, a failed read of any part is a failure and never an empty store,
 *     "no row" is told from a failed read by the fallback object, and a store with no row is installed the way the store load
 *     installs one (the only thing that can give the next ordinary action a first-save proof);
 *   - a late answer is dropped if the sign-in, the store, the newest save, the install numbers or the two copies on screen moved;
 *   - the review lists every changed field with its full value, a new month included, an explicit zero and a deletion included.
 *
 * How it tests. The functions are cut out of src/LeadPerformanceCalculator.jsx by anchor and run against stubs; each anchor must
 * occur exactly once. Mutation controls rebuild the bad variants from the real text by one replacement and the same checks fail.
 * Limits. Not mounted. Keyboard, small and wide viewport, and the sign-in and store races are to be checked in a real browser against a
 * local mock; those runs are pending and nothing in this file claims they passed. Dependency-free: node:test only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { storeKey } from "../api/_store-keys.mjs";

const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const once = (a, what) => { assert.equal(app.split(a).length - 1, 1, what + " anchor must occur exactly once"); return app.indexOf(a); };
const cut = (start, end, what) => { const a = once(start, what); const b = app.indexOf(end, a); assert.ok(b > a, what + " end"); return app.slice(a, b + end.length); };
const PIECES = {
  record: cut("  const recordFailedSave = (storeId,", "\n  };\n  const patchFailed", "recordFailedSave").replace(/\n  const patchFailed$/, ""),
  latest: cut("  const loadLatestSaved = async (rec) => {", "\n  };\n  const discardFailed", "loadLatestSaved").replace(/\n  const discardFailed$/, ""),
  diff: cut("const failedDiffRows = (a, b) => {", "\n  return rows;\n};", "failedDiffRows"),
  loadStore: cut("async function loadStore(storeId, fallback, throwOnError, strictRows) {", "\n  return base;\n}", "loadStore"),
  block: cut("  /* ---- A save that was refused ----", "  const persistStoreNow = async", "recovery block"),
};
const run = (code, ctx, ret) => new Function("ctx", `with (ctx) { ${code}\n return ${ret}; }`)(ctx);

/* ---- never sent again ---- */
test("the recovery code never saves: nothing in it calls persistStore or a CAS, and no save-again action exists", () => {
  const code = PIECES.block + PIECES.diff;
  for (const bad of ["persistStore(", "persistStoreNow(", "saveStoreCAS(", "saveFailedAgain", "Save these changes again", "rec.baseline, rec.", "absenceProof("]) assert.equal(code.includes(bad), false, "must not contain " + bad);
  assert.equal(app.includes("Save these changes again"), false);
});

/* ---- a late failure ---- */
const recordCtx = (over = {}) => {
  const state = { list: [], sid: "u1", importLog: [] }; const updaters = [];
  const ctx = {
    authEpoch: 3, failedSeq: { current: 0 }, tab: "import", appModule: "perf", lastSaveError: "boom",
    sessionIdRef: { get current() { return state.sid; } },
    globalThis, setFailedSaves: (f) => { updaters.push(f); state.list = f(state.list); }, setImportLog: (f) => { state.importLog = f(state.importLog); }, ...over,
  };
  return { state, ctx, updaters };
};
const recordFn = (code = PIECES.record) => (ctx) => run(code + "\n", ctx, "recordFailedSave");
test("an attempt is kept when the same person is still signed in, in the same sign-in", () => {
  const { state, ctx } = recordCtx();
  recordFn()(ctx)("s1", { a: 1 }, { action: "Imported reports" }, { a: 0 }, [], 3, "u1");
  assert.equal(state.list.length, 1); assert.equal(state.list[0].reason, "boom"); assert.equal(state.importLog.length, 1);
});
test("a late failure after sign-out, or from an earlier sign-in, is not kept", () => {
  for (const [sid, epoch] of [[null, 3], ["u2", 3], ["u1", 4]]) {
    const { state, ctx } = recordCtx(); state.sid = sid; ctx.authEpoch = epoch;
    recordFn()(ctx)("s1", { a: 1 }, { action: "x" }, null, [], 3, "u1");
    assert.equal(state.list.length, 0, `sid ${sid} epoch ${epoch}`);
  }
});
test("the check also runs inside the state update: a callback queued before sign-out cannot repopulate the list", () => {
  const { state, ctx, updaters } = recordCtx({});
  let hold = null; ctx.setFailedSaves = (f) => { hold = f; };   // the update is applied later, as React may do
  recordFn()(ctx)("s1", { a: 1 }, { action: "x" }, null, [], 3, "u1");
  assert.equal(typeof hold, "function");
  state.sid = null;   // signed out before the update ran
  assert.deepEqual(hold([]), [], "the updater returns the list unchanged");
});
test("each refused save is kept, none replaced by a later one", () => {
  const { state, ctx } = recordCtx(); const rec = recordFn()(ctx);
  rec("s1", { a: 1 }, { action: "first" }, { a: 0 }, [], 3, "u1"); rec("s1", { a: 1, b: 2 }, { action: "second" }, { a: 0 }, [], 3, "u1");
  assert.deepEqual(state.list.map((f) => f.action), ["first", "second"]);
});

/* ---- the review ---- */
const diffRows = run(PIECES.diff, {}, "failedDiffRows");
test("a new month is listed field by field, with an explicit zero, and nothing is truncated", () => {
  const rows = diffRows({ months: {} }, { months: { "2026-10": { stats: { Ana: { sold: 0, units: 3, note: "x".repeat(500) } } } } });
  assert.deepEqual(rows.map((r) => r.path), ["months / 2026-10 / stats / Ana / sold", "months / 2026-10 / stats / Ana / units", "months / 2026-10 / stats / Ana / note"]);
  const zero = rows.find((r) => r.path.endsWith("sold")); assert.deepEqual([zero.from, zero.to], [undefined, 0]);
  assert.equal(rows.find((r) => r.path.endsWith("note")).to.length, 500);
});
test("a deletion and a removed object are listed; an empty object added is a change; an equal copy has none", () => {
  const rows = diffRows({ a: { b: 1, c: 2 }, gone: { x: 1 } }, { a: { b: 1 }, fresh: {} });
  assert.deepEqual(rows.map((r) => [r.path, r.from, r.to]).sort(), [["a / c", 2, undefined], ["fresh", undefined, {}], ["gone / x", 1, undefined]].sort());
  assert.deepEqual(diffRows({ a: [1, { z: 0 }] }, { a: [1, { z: 0 }] }), []);
});
test("a long list is not capped", () => {
  const big = {}; for (let i = 0; i < 400; i++) big["k" + i] = i;
  assert.equal(diffRows({}, big).length, 400);
});

/* ---- the refresh ---- */
const latestCtx = (over = {}) => {
  const calls = { patches: [], installs: [], stores: [], admin: [], marks: [] };
  const rec = { id: 7, storeId: "s1", actor: "u1", epoch: 3 };
  const st = { sid: "u1", view: "s1", seq: 5, screen: { o: "screen" }, cache: { o: "cache" }, inst: { "s1|screen": 2, "s1|cache": 4 }, epoch: 3, list: [rec], genNow: 0 };
  const fallbackKeep = { v: null };
  const ctx = {
    rec, st, calls,
    get authEpoch() { return st.epoch; },
    sessionIdRef: { get current() { return st.sid; } }, viewRef: { get current() { return st.view; } },
    storeDataRef: { get current() { return st.screen; } }, adminDataRef: { get current() { return { s1: st.cache }; } },
    saveSeq: { get current() { return st.seq; } }, pendingSaves: { get current() { return st.pending || 0; } }, loadGeneration: { get: () => st.genNow }, failedRef: { get current() { return st.list; } },
    installGeneration: { get: (k) => st.inst[k] }, patchFailed: (id, p) => calls.patches.push(p),
    loadMark: () => ({ gen: 0, epoch: st.epoch }), emptyStoreData: () => (fallbackKeep.v = { roster: [], months: {} }),
    supabase: {}, loadStore: async (id, fb) => fb, markLoad: (d, id, actor, absent) => calls.marks.push({ d, id, actor, absent }),
    installBaseline: (d, id, slot) => calls.installs.push(slot), setStoreData: (d) => calls.stores.push(d), setAdminData: (f) => calls.admin.push(f({})),
    ...over,
  };
  return ctx;
};
const latest = (ctx, code = PIECES.latest) => run(code.replace("const loadLatestSaved =", "const loadLatestSaved ="), ctx, "loadLatestSaved");
test("a successful read of an existing row installs it in both slots and says loaded", async () => {
  const ctx = latestCtx({ loadStore: async () => ({ roster: [{ name: "A" }], __storeId: "s1" }) });
  assert.equal(await latest(ctx)(ctx.rec), "loaded");
  assert.deepEqual([ctx.calls.installs, ctx.calls.stores.length, ctx.calls.patches.at(-1).refresh.state], [["screen", "cache"], 1, "loaded"]);
});
test("no row: the store load's own empty document is installed with an absence mark, and it says absent, never loaded", async () => {
  const ctx = latestCtx();
  assert.equal(await latest(ctx)(ctx.rec), "absent");
  assert.deepEqual([ctx.calls.marks.map((m) => m.absent), ctx.calls.installs, ctx.calls.patches.at(-1).refresh.state], [[true], ["screen", "cache"], "absent"]);
  assert.equal(ctx.calls.stores[0].__storeId, "s1");
});
test("a failed read, from any part of the composition, installs nothing and says failed", async () => {
  const ctx = latestCtx({ loadStore: async () => { throw new Error("activity rows unavailable"); } });
  assert.equal(await latest(ctx)(ctx.rec), "failed");
  assert.deepEqual([ctx.calls.installs, ctx.calls.stores, ctx.calls.patches.at(-1).refresh.state, ctx.calls.patches.at(-1).refresh.error], [[], [], "failed", "activity rows unavailable"]);
});
test("the refresh asks the shared store load for strict activity rows", async () => {
  let args; const ctx = latestCtx({ loadStore: async (...a) => { args = a; return a[1]; } });
  await latest(ctx)(ctx.rec);
  assert.deepEqual([args[0], args[2], args[3]], ["s1", true, true]);
});
const drop = (mutate) => async () => {
  const ctx = latestCtx({ loadStore: async (id, fb) => { mutate(ctx.st); return fb; } });
  const out = await latest(ctx)(ctx.rec);
  return { out, ctx };
};
for (const [name, mutate, want] of [
  ["a newer save started", (st) => { st.seq = 6; }, "skipped"],
  ["the selected store changed", (st) => { st.view = "s2"; }, "skipped"],
  ["a newer accepted load installed into the screen slot", (st) => { st.inst["s1|screen"] = 3; }, "skipped"],
  ["a newer accepted load installed into the cache slot", (st) => { st.inst["s1|cache"] = 5; }, "skipped"],
  ["the screen copy is a different object (a poll replaced it)", (st) => { st.screen = { o: "poll" }; }, "skipped"],
  ["the cached copy is a different object", (st) => { st.cache = { o: "other" }; }, "skipped"],
  ["the sign-in ended", (st) => { st.sid = null; }, null],
  ["the security epoch moved", (st) => { st.epoch = 4; }, null],
  ["the record was cleared", (st) => { st.list = []; }, null],
]) test(`a late answer is dropped when ${name}`, async () => {
  const { out, ctx } = await drop(mutate)();
  assert.equal(out, want);
  assert.deepEqual([ctx.calls.installs, ctx.calls.stores, ctx.calls.admin], [[], [], []], "nothing installed");
});

/* ---- the shared loader ---- */
test("loadStore swallows a failed activity read by default and raises it only when asked", async () => {
  const mk = (strict) => run(PIECES.loadStore, { storeKey: (i) => i, loadShared: async (k, fb) => fb, loadActivityRows: async () => { throw new Error("rows"); }, console: { error() {} } }, "loadStore");
  const fb = { activity: {} };
  assert.equal(await mk()("s1", fb, true), fb);
  await assert.rejects(() => mk()("s1", fb, true, true), /rows/);
});

/* ---- mutation controls ---- */
const mutate = (code, from, to) => { assert.equal(code.split(from).length - 1, 1, "mutation anchor must occur once: " + from); return code.replace(from, to); };
test("control: a record guard only before scheduling (not in the updater) lets a late callback repopulate", () => {
  const bad = mutate(PIECES.record, "(sessionIdRef.current !== actor0 || epoch0 !== authEpoch ? p : [...p, rec])", "[...p, rec]");
  const { state, ctx } = recordCtx(); let hold = null; ctx.setFailedSaves = (f) => { hold = f; };
  recordFn(bad)(ctx)("s1", { a: 1 }, { action: "x" }, null, [], 3, "u1"); state.sid = null;
  assert.equal(hold([]).length, 1, "the mutant repopulates");
});
test("control: dropping the identity check lets a poll's newer copy be replaced", async () => {
  const bad = mutate(PIECES.latest, "&& storeDataRef.current === before.screenObj && adminDataRef.current[id] === before.cacheObj", "");
  const ctx = latestCtx({ loadStore: async (id, fb) => { ctx.st.screen = { o: "poll" }; return fb; } });
  assert.equal(await latest(ctx, bad)(ctx.rec), "absent", "the mutant installs over the newer copy");
});
test("control: dropping the newest-save check installs under a newer save", async () => {
  const bad = mutate(PIECES.latest, "saveSeq.current === before.seq && ", "");
  const ctx = latestCtx({ loadStore: async (id, fb) => { ctx.st.seq = 9; return fb; } });
  assert.equal(await latest(ctx, bad)(ctx.rec), "absent");
});
test("control: reporting a failed read as an empty store would call it absent", async () => {
  const bad = mutate(PIECES.latest, "} catch (e) { r = { ok: false, error: e }; }", "} catch (e) { r = { ok: true, missing: true, value: fallback }; }");
  const ctx = latestCtx({ loadStore: async () => { throw new Error("down"); } });
  assert.equal(await latest(ctx, bad)(ctx.rec), "absent", "the mutant turns an error into absence");
});
test("control: a diff that truncates drops rows", () => {
  const bad = run(mutate(PIECES.diff, "  return rows;\n};", "  return rows.slice(0, 200);\n};"), {}, "failedDiffRows");
  const big = {}; for (let i = 0; i < 400; i++) big["k" + i] = i;
  assert.equal(bad({}, big).length, 200);
});

/* ---- a save that is queued or running ---- */
test("a refresh does not start while a save is queued or running, and keeps the attempt", async () => {
  let reads = 0; const ctx = latestCtx({ loadStore: async (id, fb) => { reads++; return fb; } }); ctx.st.pending = 1;
  assert.equal(await latest(ctx)(ctx.rec), "saving");
  assert.deepEqual([reads, ctx.calls.installs, ctx.calls.stores, ctx.calls.patches.at(-1).refresh.state, ctx.calls.patches.at(-1).busy], [0, [], [], "saving", false]);
});
test("a save that starts or is queued during the read stops the install", async () => {
  const ctx = latestCtx({ loadStore: async (id, fb) => { ctx.st.pending = 1; return fb; } });
  assert.equal(await latest(ctx)(ctx.rec), "skipped");
  assert.deepEqual([ctx.calls.installs, ctx.calls.stores], [[], []]);
});

/* ---- the absence mark, with the real proof code ---- */
const proofSrc = (() => { const a = once("const absenceAtLoad = new WeakMap();", "proof block"); const e = "\n  return proofHolds(cap, storeId, actor) ? cap : null;\n};"; const b = app.indexOf(e, a); assert.ok(b > a); return app.slice(a, b + e.length); })();
const realProof = () => new Function("storeKey", "ctx", proofSrc + "\nreturn { loadMark, markLoad, installBaseline, absenceProof, proofHolds, observeRowPresent, installGeneration, loadGeneration, epoch: () => authEpoch };")(storeKey, {});
const realCtx = (over = {}) => {
  const P = realProof(); const ctx = latestCtx({ loadMark: P.loadMark, markLoad: P.markLoad, installBaseline: P.installBaseline, installGeneration: P.installGeneration, loadGeneration: P.loadGeneration, ...over });
  Object.defineProperty(ctx, "authEpoch", { get: () => P.epoch() });
  ctx.st.epoch = 0; ctx.rec.epoch = 0; ctx.P = P;
  return ctx;
};
const lastStored = (ctx) => ctx.calls.stores.at(-1);
test("real marks: a clean absent read installs an empty copy that holds a first-save proof in the screen slot", async () => {
  const ctx = realCtx();
  assert.equal(await latest(ctx)(ctx.rec), "absent");
  assert.ok(ctx.P.absenceProof(lastStored(ctx), "s1", "u1", "screen"), "the proof is there");
});
test("real marks: a read that saw the row present during the absent read makes the answer stale, even though nothing on screen moved", async () => {
  const ctx = realCtx({ loadStore: async (id, fb) => { ctx.P.observeRowPresent(storeKey("s1")); return fb; } });
  assert.equal(await latest(ctx)(ctx.rec), "skipped");
  assert.deepEqual([ctx.calls.installs, ctx.calls.stores], [[], []]);
  assert.equal(ctx.calls.patches.at(-1).refresh.state, "skipped", "never labelled absent");
});
test("control: without the presence check a stale empty copy is installed and called absent, with no proof", async () => {
  const bad = mutate(PIECES.latest, " || (r.missing && (loadGeneration.get(id) || 0) !== mark.gen)", "");
  const ctx = realCtx({ loadStore: async (id, fb) => { ctx.P.observeRowPresent(storeKey("s1")); return fb; } });
  assert.equal(await latest(ctx, bad)(ctx.rec), "absent", "the mutant installs it");
  assert.equal(ctx.P.absenceProof(lastStored(ctx), "s1", "u1", "screen"), null, "and the real markLoad refused it a proof");
});
test("control: dropping the queue check lets a refresh replace the screen under a held save", async () => {
  const bad = mutate(mutate(PIECES.latest, "    if (pendingSaves.current > 0) {", "    if (false) {"), "pendingSaves.current === 0 && ", "");
  const ctx = latestCtx(); ctx.st.pending = 1;
  assert.equal(await latest(ctx, bad)(ctx.rec), "absent");
});
