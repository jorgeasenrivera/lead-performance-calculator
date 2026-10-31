/* The board's display settings across two screens saving at once.
 *
 * What this protects. The TV window saves boardDisplay as one whole object. Nothing merged it, so a save that started from an
 * older copy wiped what another screen had just chosen, and the callback told the TV "saved" even when the save was refused, so
 * the TV never fell back to "Saved on this screen only". Both are fixed together: api/_store-merge.mjs settles the six known keys
 * one by one against the copy the save started from, keeps every other key exactly as the server has it (a save that changes one
 * is refused, a first save included), and the callback returns what the save really did.
 *
 * How it tests. The merge is the real mergeAgainstServer. The callbacks and saveStoreCAS are cut out of
 * src/LeadPerformanceCalculator.jsx and src/leaderboard-template.mjs by anchor and run against stubs, and each anchor must occur
 * exactly once. The integration tests run saveStoreCAS against an in-memory row.
 *
 * Mutation controls. Each of these is rebuilt from the real text by one replacement and the same checks must fail for it: no
 * merger at all (the whole object wins), a guessed winner on a clash (this save silently wins), unknown keys not refused, a
 * hardcoded true callback.
 *
 * Limits. Not mounted; the mounted two-tab run against a local mock is recorded outside this repository. Dependency-free.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeAgainstServer, BOARD_KEYS } from "../api/_store-merge.mjs";

const D = (o = {}) => ({ tscale: 1, squeeze: 1, pad: 0, style: "classic", bg: "navy", rotate: [], ...o });
const doc = (bd) => ({ __storeId: "s1", months: {}, activity: {}, ...(bd ? { boardDisplay: bd } : {}) });
const run = (base, mine, server, extra = {}) => mergeAgainstServer(structuredClone(mine), structuredClone(server), { baseline: structuredClone(base), reportedFields: [], ...extra });

test("a key this save did not change takes the newer value from the server", () => {
  const base = doc(D());
  const mine = doc(D({ tscale: 1.2 }));
  const server = doc(D({ style: "bars", bg: "store" }));
  const out = run(base, mine, server).boardDisplay;
  assert.deepEqual(out, D({ tscale: 1.2, style: "bars", bg: "store" }));
});

test("distinct keys changed on two screens keep both, in either order", () => {
  const base = doc(D());
  const a = doc(D({ tscale: 1.2, squeeze: 1, pad: 0, style: "bars" }));
  const b = doc(D({ bg: "store", rotate: ["s2"] }));
  const aThenB = run(base, b, a).boardDisplay;
  const bThenA = run(base, a, b).boardDisplay;
  const want = D({ tscale: 1.2, style: "bars", bg: "store", rotate: ["s2"] });
  assert.deepEqual(aThenB, want);
  assert.deepEqual(bThenA, want);
});

test("each known key survives on its own, including explicit zero", () => {
  for (const [k, v] of [["tscale", 1.2], ["squeeze", 0.8], ["pad", 4], ["style", "bars"], ["bg", "store"], ["rotate", ["s2", "s3"]]]) {
    const out = run(doc(D()), doc(D()), doc(D({ [k]: v }))).boardDisplay;
    assert.deepEqual(out[k], v, k + " from the server is kept when this save did not touch it");
  }
  const zero = run(doc(D({ pad: 4 })), doc(D({ pad: 0 })), doc(D({ pad: 4 }))).boardDisplay;
  assert.equal(zero.pad, 0, "an explicit zero chosen here is a change, not a missing value");
});

test("the same key changed to two different values on two screens is refused, not guessed", () => {
  const base = doc(D());
  assert.throws(() => run(base, doc(D({ pad: 4 })), doc(D({ pad: 2 }))), /another screen/);
  assert.throws(() => run(base, doc(D({ squeeze: 0.8 })), doc(D({ squeeze: 0.9 }))), /squeeze/);
  assert.throws(() => run(base, doc(D({ tscale: 1.2 })), doc(D({ tscale: 0.9 }))), /tscale/);
  try { run(base, doc(D({ pad: 4 })), doc(D({ pad: 2 }))); } catch (e) { assert.match(e.message, /board settings were left as they were/); assert.doesNotMatch(e.message, /Nothing was overwritten/); }
});

test("the same key changed to the same value is not a clash", () => {
  const out = run(doc(D()), doc(D({ style: "bars" })), doc(D({ style: "bars" }))).boardDisplay;
  assert.equal(out.style, "bars");
});

test("rotate is one choice: a different list on each side is a clash, never a union", () => {
  const base = doc(D({ rotate: ["s1"] }));
  assert.throws(() => run(base, doc(D({ rotate: ["s1", "s2"] })), doc(D({ rotate: ["s1", "s3"] }))), /rotate/);
  const one = run(base, doc(D({ rotate: ["s1", "s2"] })), doc(D({ rotate: ["s1"] }))).boardDisplay;
  assert.deepEqual(one.rotate, ["s1", "s2"], "ours replaces the whole list");
  const cleared = run(base, doc(D({ rotate: [] })), doc(D({ rotate: ["s1"] }))).boardDisplay;
  assert.deepEqual(cleared.rotate, [], "emptying the list is a change");
});

test("a key the server no longer has is not restored by an unchanged local copy", () => {
  const base = doc(D({ pad: 4 }));
  const server = doc({ tscale: 1, squeeze: 1, style: "classic", bg: "navy", rotate: [] });
  const out = run(base, doc(D({ pad: 4, tscale: 1.2 })), server).boardDisplay;
  assert.equal(Object.hasOwn(out, "pad"), false, "pad stays removed");
  assert.equal(out.tscale, 1.2);
});

test("a boardDisplay the server removed entirely is not brought back by an untouched local copy", () => {
  const out = run(doc(D()), doc(D()), doc());
  assert.equal(Object.hasOwn(out, "boardDisplay"), false);
  // A key this save changed against a server that removed the whole object is a divergent change on that key: refused, not guessed.
  assert.throws(() => run(doc(D()), doc(D({ tscale: 1.2 })), doc()), /tscale/);
  // The server removed the object; a key this save changed that the server never had (same as the baseline) is written, untouched keys stay removed.
  assert.deepEqual(run(doc({ tscale: 1.2 }), doc({ tscale: 1.2, bg: "store" }), doc()).boardDisplay, { bg: "store" });
});

test("a store with no boardDisplay, and a save without a baseline, behave as before", () => {
  assert.equal("boardDisplay" in run(doc(), doc(), doc()), false);
  const noBase = mergeAgainstServer(structuredClone(doc(D({ style: "bars" }))), structuredClone(doc(D({ bg: "store" }))), { reportedFields: [] });
  assert.equal(noBase.boardDisplay.bg, "navy", "without a baseline nothing is settled key by key");
});

const withExt = (o) => ({ ...D(), ...o });
test("a remote unknown key is kept exactly: added, changed, or deleted there", () => {
  const base = doc(withExt({ ext: "a", gone: 1 }));
  const mine = doc(withExt({ ext: "a", gone: 1, tscale: 1.2 }));
  const out = run(base, mine, doc({ ...D(), ext: "b", added: [1, 2] })).boardDisplay;   // ext changed, gone deleted, added appeared
  assert.equal(out.ext, "b"); assert.equal(Object.hasOwn(out, "gone"), false); assert.deepEqual(out.added, [1, 2]); assert.equal(out.tscale, 1.2);
});

test("a local unknown add, change or delete is refused, not dropped and not reported as saved", () => {
  const base = doc(withExt({ ext: "a" }));
  assert.throws(() => run(base, doc(withExt({ ext: "a", extra: 1 })), doc(withExt({ ext: "a" }))), /extra/);
  assert.throws(() => run(base, doc(withExt({ ext: "changed" })), doc(withExt({ ext: "a" }))), /ext/);
  assert.throws(() => run(base, doc(D()), doc(withExt({ ext: "a" }))), /ext/);
});

test("the first save of a store cannot skip the unknown-key refusal", () => {
  const base = doc(D());
  assert.throws(() => mergeAgainstServer(structuredClone(doc(withExt({ ext: 1 }))), null, { baseline: structuredClone(base), reportedFields: [] }), /ext/);
  assert.throws(() => mergeAgainstServer(structuredClone(doc(withExt({ ext: 1 }))), structuredClone({ __storeId: "other" }), { baseline: structuredClone(base), reportedFields: [] }), /ext/);
});

/* ---- the callbacks, cut from the real sources ---- */
const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
const tv = fs.readFileSync(new URL("../src/leaderboard-template.mjs", import.meta.url), "utf8");
const once = (src, a, what) => { assert.equal(src.split(a).length - 1, 1, what + " anchor must occur exactly once"); return src.indexOf(a); };
const cut = (src, start, end, what) => { const a = once(src, start, what); return src.slice(a, src.indexOf(end, a) + end.length); };
const boardCb = cut(app, "window.__lpcSaveBoardDisplay = async (storeId, display) => {", "\n    };", "board callback");
const tvSave = cut(tv, "document.getElementById('tsave').onclick = async function(){", "\n    };", "TV save");

const runBoardCb = async (result, src = boardCb, { current = { __storeId: "s1" }, display = D({ style: "bars" }) } = {}) => {
  const window = {}; const calls = [];
  const ctx = { window, BOARD_KEYS, adminData: { s1: current }, view: "s1", storeData: null, session: { id: "u" }, absenceProof: () => null, persistStore: async (...a) => { calls.push(a); return result; } };
  new Function("ctx", `with (ctx) { ${src} }`)(ctx);
  const ret = await window.__lpcSaveBoardDisplay("s1", display);
  return { ret, calls };
};

test("the callback returns what the save did, not a hardcoded true", async () => {
  assert.equal((await runBoardCb(true)).ret, true);
  assert.equal((await runBoardCb(false)).ret, false);
  assert.equal((await runBoardCb(undefined)).ret, false);
});

test("the TV window says 'Saved on this screen only' when the callback returns false", async () => {
  const msgs = [];
  const run = async (cbResult) => {
    const msg = { textContent: "" };
    const ctx = {
      document: { getElementById: () => msg }, localStorage: { setItem() {} }, DKEY: "k", DISP: D(), tsizeKeep() {}, CFG: { storeId: "s1" }, HOME: { id: "s1", key: "k" },
      LAST: null, getStoreByKey: async () => null, setTimeout: () => 0,
      window: { opener: { __lpcSaveBoardDisplay: async () => cbResult }, parent: null },
    };
    ctx.window.parent = ctx.window;
    const el = {};
    ctx.document.getElementById = (id) => (id === "tmsg" ? msg : el);
    new Function("ctx", `with (ctx) { ${tvSave} }`)(ctx);
    await el.onclick();
    return msg.textContent;
  };
  assert.equal(await run(true), "Saved for this store, on every screen.");
  assert.equal(await run(false), "Saved on this screen only.");
});

/* ---- mutation controls ---- */
test("control: the old whole-object behaviour fails the overlap checks", () => {
  const src = fs.readFileSync(new URL("../api/_store-merge.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("  if (board) mergeBoardDisplay(next, intent.baseline, serverCopy);"));
  const mutated = src.replace("  if (board) mergeBoardDisplay(next, intent.baseline, serverCopy);\n", "");
  assert.notEqual(mutated, src);
  const base = new URL("../api/", import.meta.url).href;
  const out = mutated.replace(/from "\.\/(_[^"]+)"/g, (_, f) => 'from "' + base + f + '"');
  return import("data:text/javascript;base64," + Buffer.from(out).toString("base64")).then((m) => {
    {
      const r = m.mergeAgainstServer(structuredClone(doc(D({ tscale: 1.2 }))), structuredClone(doc(D({ bg: "store" }))), { baseline: doc(D()), reportedFields: [] });
      assert.notDeepEqual(r.boardDisplay, D({ tscale: 1.2, bg: "store" }), "the unpatched merge loses the other screen's key");
    }
  });
});

test("control: a hardcoded true callback fails the false-result check", async () => {
  const bad = boardCb.replace("return saved === true;", "return true;");
  assert.notEqual(bad, boardCb);
  assert.equal((await runBoardCb(false, bad)).ret, true);
});

test("an ordinary TV save lays its known keys over the board on file, so an unknown extension survives and a newer remote value wins", async () => {
  const current = { __storeId: "s1", boardDisplay: { ...D(), ext: "from-baseline" } };
  const { ret, calls } = await runBoardCb(true, boardCb, { current, display: D({ style: "bars" }) });   // the TV never sends ext
  assert.equal(ret, true);
  const sent = calls[0][1];
  assert.equal(sent.boardDisplay.ext, "from-baseline", "omitted is not deleted");
  assert.equal(sent.boardDisplay.style, "bars");
  const server = { __storeId: "s1", months: {}, activity: {}, boardDisplay: { ...D(), ext: "newer-remote" } };
  const merged = mergeAgainstServer(structuredClone(sent), server, { baseline: structuredClone(current), reportedFields: [] });
  assert.equal(merged.boardDisplay.ext, "newer-remote");
  assert.equal(merged.boardDisplay.style, "bars");
});

test("the callback refuses a supplied unknown key that adds or changes something, and accepts one that matches what is on file", async () => {
  const current = { __storeId: "s1", boardDisplay: { ...D(), ext: "a" } };
  const added = await runBoardCb(true, boardCb, { current, display: { ...D(), newThing: 1 } });
  assert.deepEqual([added.ret, added.calls.length], [false, 0], "an unsupported add is refused before any save");
  const changed = await runBoardCb(true, boardCb, { current, display: { ...D(), ext: "b" } });
  assert.deepEqual([changed.ret, changed.calls.length], [false, 0]);
  const same = await runBoardCb(true, boardCb, { current, display: { ...D(), ext: "a" } });
  assert.deepEqual([same.ret, same.calls.length], [true, 1]);
  assert.equal((await runBoardCb(true, boardCb, { current, display: null })).ret, false);
});

test("the TV window's real save handler also falls back when the callback refuses", async () => {
  // covered by the false-result check above; this one proves a refusal for an unsupported key reaches the handler as false
  const r = await runBoardCb(true, boardCb, { current: { __storeId: "s1", boardDisplay: D() }, display: { ...D(), mystery: 1 } });
  assert.equal(r.ret, false);
});

/* ---- integration: saveStoreCAS against an in-memory row ---- */
const casSrc = (() => { const a = once(app, "async function saveStoreCAS(key, build, tries = 8, current = () => true) {", "saveStoreCAS"); return app.slice(a, app.indexOf("\n}\n", a) + 3); })();
function fakeDb(initial) {
  const row = { value: structuredClone(initial) }; const log = { updates: 0, inserts: 0 };
  const from = () => {
    const f = {}; let patch = null, ins = null, cols = null;
    const api = {
      select(c) { cols = c; if (patch) return Promise.resolve(api._apply()); return api; },
      eq(k, v) { f[k] = { eq: v }; return api; }, is(k) { f[k] = { isNull: true }; return api; },
      update(v) { patch = v; return api; },
      insert(v) { ins = v; if (row.value) return Promise.resolve({ error: { code: "23505" } }); row.value = structuredClone(v.value); log.inserts++; return Promise.resolve({ error: null }); },
      async maybeSingle() { if (!row.value) return { data: null, error: null }; return { data: cols && cols.startsWith("rev:") ? { rev: row.value.rev == null ? null : String(row.value.rev) } : { value: structuredClone(row.value) }, error: null }; },
      _apply() {
        const w = f["value->>rev"]; const rev = row.value && row.value.rev;
        const ok = row.value && (w.isNull ? rev == null : String(rev) === w.eq);
        if (ok) { row.value = structuredClone(patch.value); log.updates++; }
        return { data: ok ? [{ key: "k" }] : [], error: null };
      },
    };
    return api;
  };
  return { row, log, client: { from } };
}
const runCas = async (db, build) => {
  const f = new Function("supabase", "mergeAgainstServer", "casCache", "observeRowPresent", "buzz", "let lastSaveError = null;\n" + casSrc + "\nreturn { saveStoreCAS, err: () => lastSaveError };");
  const { saveStoreCAS, err } = f(db.client, mergeAgainstServer, new Map(), () => {}, () => {});
  const res = await saveStoreCAS("lpc:store:s1:v2", build);
  return { res, err: err() };
};
const monthsDoc = (extra = {}) => ({ __storeId: "s1", rev: 4, activity: {}, roster: [], boardDisplay: D(), months: { "2026-08": { stats: { Ana: { sold: 3 } } }, "2026-09": { stats: { Ana: { sold: 5, units: 2 } } } }, ...extra });

test("integration: a board change and an explicit-zero month edit land together, and the unrelated month is untouched", async () => {
  const base = monthsDoc();
  const db = fakeDb(base);
  const next = structuredClone(base); next.boardDisplay.tscale = 1.2; next.months["2026-09"].stats.Ana.units = 0;
  const { res } = await runCas(db, (server) => mergeAgainstServer(structuredClone(next), server, { baseline: structuredClone(base), reportedFields: [] }));
  assert.equal(res.ok, true);
  assert.equal(db.row.value.boardDisplay.tscale, 1.2);
  assert.equal(db.row.value.months["2026-09"].stats.Ana.units, 0, "explicit zero is stored, not dropped");
  assert.deepEqual(db.row.value.months["2026-08"], base.months["2026-08"], "the unrelated month is unchanged");
});

test("integration: a board clash refuses the save and leaves the stored row, monthly figures included, exactly as it was", async () => {
  const base = monthsDoc();
  const server = monthsDoc({ boardDisplay: D({ tscale: 0.9 }) });
  const db = fakeDb(server);
  const before = structuredClone(db.row.value);
  const next = structuredClone(base); next.boardDisplay.tscale = 1.2; next.months["2026-09"].stats.Ana.units = 0;
  const { res, err } = await runCas(db, (srv) => mergeAgainstServer(structuredClone(next), srv, { baseline: structuredClone(base), reportedFields: [] }));
  assert.equal(res.ok, false);
  assert.match(err, /tscale/);
  assert.deepEqual(db.row.value, before, "no part of the refused save reached the row");
  assert.equal(db.log.updates, 0);
});

/* ---- more mutation controls ---- */
const mutant = async (from, to) => {
  const src = fs.readFileSync(new URL("../api/_store-merge.mjs", import.meta.url), "utf8");
  assert.equal(src.split(from).length - 1, 1, "mutation anchor must occur once");
  const base = new URL("../api/", import.meta.url).href;
  const out = src.replace(from, to).replace(/from "\.\/(_[^"]+)"/g, (_, f) => 'from "' + base + f + '"');
  return import("data:text/javascript;base64," + Buffer.from(out).toString("base64"));
};
test("control: a guessed winner on a clash (this save silently wins) is caught", async () => {
  const m = await mutant("if (theirs && !sameValue(srv[k], mine[k])) { clashes.push(k); continue; }", "if (false) { clashes.push(k); continue; }");
  const r = m.mergeAgainstServer(structuredClone(doc(D({ tscale: 1.2 }))), structuredClone(doc(D({ tscale: 0.9 }))), { baseline: doc(D()), reportedFields: [] });
  assert.equal(r.boardDisplay.tscale, 1.2, "the mutant picks a winner where the real merge refuses");
  assert.throws(() => run(doc(D()), doc(D({ tscale: 1.2 })), doc(D({ tscale: 0.9 }))), /tscale/);
});
test("control: without the unknown-key refusal a local unknown change is silently lost", async () => {
  const m = await mutant("if (board) refuseUnknownBoardChanges(next, intent.baseline);", "");
  const r = m.mergeAgainstServer(structuredClone(doc({ ...D(), ext: 1 })), structuredClone(doc(D())), { baseline: doc(D()), reportedFields: [] });
  assert.equal(Object.hasOwn(r.boardDisplay, "ext"), false, "the mutant drops it without saying");
  assert.throws(() => run(doc(D()), doc({ ...D(), ext: 1 }), doc(D())), /ext/);
});
