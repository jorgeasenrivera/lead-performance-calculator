/* Load provenance for the first save: does an absent-row proof survive, and who may use it.
 *
 * What this protects. A store row that was read as absent may be created by the first save from that exact copy. That authority
 * must not outlive: another observed row, a sign-in or sign-out, a newer installed copy in the slot the consumer reads, a spent
 * save, or an await in which the same object is installed again. Each of those was a real failure found on the way to this code:
 *   v3  a proof stamped at completion, so a read that began before a sign-out answered for the session that was gone;
 *   v4  one counter moved by every completion, so two overlapping absent reads (a refresh while a missing store loads) left the
 *       installed copy with no proof;
 *   c11 a proof valid in ANY slot it was ever installed in, so an old screen intent survived because the object was still cached;
 *   c13 the rollback caller captured its proof AFTER its restore-point await, so a same-object reinstall during the await
 *       authorized an already-selected intent.
 *
 * How it tests. Nothing here restates the logic. The functions are cut out of src/LeadPerformanceCalculator.jsx by anchor (the
 * way test/row-cas.test.mjs does it) and run: the proof block (loadMark, markLoad, installBaseline, proofHolds, absenceProof),
 * the three auth functions, persistStore's selector, the board-display callback and the rollback callback. The component's own
 * state and the network are stubs. Every anchor must occur exactly once, so a refactor fails loudly instead of passing silently.
 *
 * Mutation controls. Each earlier bad variant is rebuilt from the real text by one exact replacement, and the same checks must
 * fail for it. A test that cannot tell the bad variant from the good one proves nothing.
 *
 * Limits. This does not mount React, so it does not prove the load sites call these functions at the right moments, that React
 * commits what was installed, or the retry behavior after a refused save (a refused first save leaves the screen copy without a
 * proof until the page is reloaded). Those were checked in a real browser against a local mock and are recorded outside this
 * repository. Dependency-free: node:test only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { storeKey } from "../api/_store-keys.mjs";

const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const once = (text, needle, label) => {
  const at = text.indexOf(needle);
  assert.ok(at >= 0, `${label}: anchor not found`);
  assert.equal(text.indexOf(needle, at + 1), -1, `${label}: anchor must occur exactly once`);
  return at;
};
const between = (from, to, label) => { const a = once(app, from, label); const b = app.indexOf(to, a); assert.ok(b > a, `${label}: end anchor not found`); return app.slice(a, b); };
const fnAt = (start, label) => { const a = once(app, start, label); return app.slice(a, app.indexOf("\n}\n", a) + 3); };
const swap = (text, from, to, label) => { once(text, from, label); return text.replace(from, () => to); };

const PIECES = {
  proof: between("const absenceAtLoad = new WeakMap();", "async function saveStoreCAS(", "proof block"),
  signIn: fnAt("async function authSignIn(", "authSignIn"),
  signOut: fnAt("async function authSignOut() {", "authSignOut"),
  onAuth: fnAt("function onAuthChange(cb) {", "onAuthChange"),
  persist: between("const persistStore = (storeId, next, audit, sourceBaseline", "const persistStoreNow = async", "persistStore"),
  board: (() => { const a = once(app, "window.__lpcSaveBoardDisplay = async (storeId, display) => {", "board display callback"); return app.slice(a, app.indexOf("\n    };", a) + 7); })(),
  rollback: (() => { const s = "onRestoreStore={"; const a = once(app, s + "async (storeId, snap) => {", "rollback callback") + s.length; const e = app.indexOf("\n                }} />", a); assert.ok(e > a, "rollback end anchor"); return app.slice(a, e + "\n                }".length); })(),
};

const STORE = "sage-x", ACTOR = "actor-1";
const buildProof = (src = PIECES.proof) => new Function("storeKey", `${src}
return { loadMark, markLoad, installBaseline, proofHolds, absenceProof, observeRowPresent, bumpAuthEpoch, installGeneration, loadGeneration, epoch: () => authEpoch };`)(storeKey);
const doc = (tag) => ({ roster: [], months: {}, __storeId: STORE, tag });
// a completed absent read, then its install into a slot
const complete = (P, d, mark, actor = ACTOR) => P.markLoad(d, STORE, actor, true, mark);
const read = (P, d, slot) => { const m = P.loadMark(STORE); complete(P, d, m); if (slot) P.installBaseline(d, STORE, slot); return d; };
const cap = (P, d, slot) => P.absenceProof(d, STORE, ACTOR, slot);

const authApi = (P, src = {}) => {
  const handlers = []; const calls = [];
  const supabase = { auth: { onAuthStateChange: (cb) => { handlers.push(cb); return { data: { subscription: { unsubscribe() {} } } }; }, signInWithPassword: async () => ({ error: null }), signOut: async () => { calls.push("signOut"); } } };
  const text = [src.signIn || PIECES.signIn, src.signOut || PIECES.signOut, src.onAuth || PIECES.onAuth].join("\n");
  const api = new Function("supabase", "bumpAuthEpoch", `${text}\nreturn { authSignIn, authSignOut, onAuthChange };`)(supabase, P.bumpAuthEpoch);
  return { ...api, fire: (event) => handlers.forEach((h) => h(event)), handlers };
};

const persistApi = (P, ctx, src = PIECES.persist) => {
  const seen = [];
  const full = { saveSeq: { current: 0 }, saveChain: { current: Promise.resolve() }, proofHolds: P.proofHolds, absenceProof: P.absenceProof,
    persistStoreNow: async (...args) => { seen.push({ storeId: args[0], baseline: args[4], absence: args[6] }); }, session: { id: ACTOR }, view: STORE, storeData: null, adminData: {}, ...ctx };
  const persistStore = new Function("ctx", `with (ctx) { ${src}\nreturn persistStore; }`)(full);
  return { persistStore, seen };
};

// ---- the checks. Each returns true or false; the real source must satisfy all of them, each mutant must break the one it targets.
const checks = (over = {}) => {
  const out = {};
  const run = (name, f) => { try { out[name] = !!f(); } catch { out[name] = false; } };
  const fresh = () => buildProof(over.proof);

  run("overlap: latest installed holds, superseded does not (completion d1 then d2)", () => { const P = fresh(); const m1 = P.loadMark(STORE), m2 = P.loadMark(STORE); const d1 = doc("d1"), d2 = doc("d2"); complete(P, d1, m1); P.installBaseline(d1, STORE, "cache"); complete(P, d2, m2); P.installBaseline(d2, STORE, "cache");
    return cap(P, d2, "cache") && !cap(P, d1, "cache"); });
  run("overlap: latest installed holds, superseded does not (completion d2 then d1)", () => { const P = fresh(); const m1 = P.loadMark(STORE), m2 = P.loadMark(STORE); const d1 = doc("d1"), d2 = doc("d2"); complete(P, d2, m2); P.installBaseline(d2, STORE, "cache"); complete(P, d1, m1); P.installBaseline(d1, STORE, "cache");
    return cap(P, d1, "cache") && !cap(P, d2, "cache"); });
  run("a completed read that was never installed carries no usable proof", () => { const P = fresh(); const d = doc("d"); complete(P, d, P.loadMark(STORE)); return !cap(P, d, "screen") && !cap(P, d, "cache"); });
  run("a row observed after the read started denies the proof", () => { const P = fresh(); const m = P.loadMark(STORE); P.observeRowPresent(storeKey(STORE)); const d = doc("d"); complete(P, d, m); P.installBaseline(d, STORE, "screen"); return !cap(P, d, "screen"); });
  run("a row observed after install revokes a held capture", () => { const P = fresh(); const d = read(P, doc("d"), "screen"); const c = cap(P, d, "screen"); const before = P.proofHolds(c, STORE, ACTOR); P.observeRowPresent(storeKey(STORE)); return before && !P.proofHolds(c, STORE, ACTOR); });
  run("a copy the proof was not issued for, another actor or another store never holds", () => { const P = fresh(); const d = read(P, doc("d"), "screen"); const c = cap(P, d, "screen");
    return c && !P.proofHolds(c, STORE, "someone-else") && !P.proofHolds(c, "other-store", ACTOR) && !P.proofHolds({ proof: { storeId: STORE, actor: ACTOR, epoch: 0, gen: 0, installs: { screen: 1 }, live: true }, slot: "screen", inst: 1 }, STORE, ACTOR) && !P.proofHolds(null, STORE, ACTOR); });
  run("a spent proof (live false) no longer holds", () => { const P = fresh(); const d = read(P, doc("d"), "screen"); const c = cap(P, d, "screen"); c.proof.live = false; return !P.proofHolds(c, STORE, ACTOR); });
  run("capture is frozen and records the slot and the install number", () => { const P = fresh(); const d = read(P, doc("d"), "screen"); const c = cap(P, d, "screen"); return Object.isFrozen(c) && c.slot === "screen" && typeof c.inst === "number"; });
  run("cross-slot supersession: a newer screen copy retires the old screen intent although the object is still cached", () => { const P = fresh(); const d = read(P, doc("d"), "cache"); P.installBaseline(d, STORE, "screen"); const old = cap(P, d, "screen"); read(P, doc("d2"), "screen");
    return old && !P.proofHolds(old, STORE, ACTOR) && cap(P, d, "cache") && true; });
  run("cross-slot supersession the other way: a newer cache copy retires the old cache intent, the screen intent of the same copy still holds", () => { const P = fresh(); const d = read(P, doc("d"), "cache"); P.installBaseline(d, STORE, "screen"); const oldCache = cap(P, d, "cache"); const screen = cap(P, d, "screen"); read(P, doc("d3"), "cache");
    return oldCache && !P.proofHolds(oldCache, STORE, ACTOR) && P.proofHolds(screen, STORE, ACTOR); });
  run("a screen install does not retire a copy installed only in the cache, and the reverse", () => { const P = fresh(); const dB = read(P, doc("dB"), "cache"); const dC = read(P, doc("dC"), "screen"); return cap(P, dB, "cache") && cap(P, dC, "screen"); });
  run("installing the same object again cannot reauthorize an older capture, a fresh capture holds", () => { const P = fresh(); const d = read(P, doc("d"), "screen"); const old = cap(P, d, "screen"); P.installBaseline(d, STORE, "screen");
    return !P.proofHolds(old, STORE, ACTOR) && P.proofHolds(cap(P, d, "screen"), STORE, ACTOR); });

  const authCase = (name, f) => run(name, () => { const P = fresh(); const a = authApi(P, over.auth); return f(P, a); });
  authCase("a read that began before SIGNED_OUT gets no proof, one that began after does", (P, a) => { a.onAuthChange(() => {}); const m = P.loadMark(STORE); a.fire("SIGNED_OUT"); const d = doc("d"); complete(P, d, m); P.installBaseline(d, STORE, "screen"); const staleHeld = !!cap(P, d, "screen");   // judged before the next install can supersede it
    const after = doc("after"); const m2 = P.loadMark(STORE); complete(P, after, m2); P.installBaseline(after, STORE, "screen"); return !staleHeld && !!cap(P, after, "screen"); });
  authCase("TOKEN_REFRESHED is not a session boundary", (P, a) => { a.onAuthChange(() => {}); const m = P.loadMark(STORE); const e = P.epoch(); a.fire("TOKEN_REFRESHED"); const d = doc("d"); complete(P, d, m); P.installBaseline(d, STORE, "screen"); return P.epoch() === e && !!cap(P, d, "screen"); });
  return out;
};

const asyncChecks = async (over = {}) => {
  const P = buildProof(over.proof); const a = authApi(P, over.auth);
  try { const e0 = P.epoch(); await a.authSignIn("e", "p"); const e1 = P.epoch(); await a.authSignOut(); return { "sign-in and sign-out both move the epoch": e1 === e0 + 1 && P.epoch() === e0 + 2 }; } catch { return { "sign-in and sign-out both move the epoch": false }; }
};

const consumerChecks = async (over = {}) => {
  const out = {}; const run = async (name, f) => { try { out[name] = !!(await f()); } catch { out[name] = false; } };
  await run("default selector: screen copy when the view is the store, cache copy otherwise, each with its own slot", async () => {
    const P = buildProof(over.proof); const d = read(P, doc("d"), "screen"); const k = read(P, doc("k"), "cache");
    const a = persistApi(P, { view: STORE, storeData: d, adminData: { [STORE]: k } }, over.persist); await a.persistStore(STORE, doc("n"), { action: "t" });
    const b = persistApi(P, { view: "another", storeData: null, adminData: { [STORE]: k } }, over.persist); await b.persistStore(STORE, doc("n"), { action: "t" });
    return a.seen[0].absence && a.seen[0].absence.slot === "screen" && b.seen[0].absence && b.seen[0].absence.slot === "cache"; });
  await run("an explicit baseline without a capture has unknown provenance and carries no proof, an explicit null too", async () => {
    const P = buildProof(over.proof); const d = read(P, doc("d"), "screen"); const a = persistApi(P, { storeData: d, adminData: { [STORE]: d } }, over.persist);
    await a.persistStore(STORE, doc("n"), { action: "t" }, d); await a.persistStore(STORE, doc("n"), { action: "t" }, d, [], null); return a.seen[0].absence === null && a.seen[1].absence === null; });
  await run("an explicit capture is revalidated, not trusted: a superseded one is dropped, a current one is passed on", async () => {
    const P = buildProof(over.proof); const d = read(P, doc("d"), "screen"); const c = cap(P, d, "screen"); const a = persistApi(P, { storeData: d, adminData: { [STORE]: d } }, over.persist);
    await a.persistStore(STORE, doc("n"), { action: "t" }, J(d), [], c); P.installBaseline(d, STORE, "screen"); await a.persistStore(STORE, doc("n"), { action: "t" }, J(d), [], c);
    return a.seen[0].absence === c && a.seen[1].absence === null; });
  await run("board display reads the cache first and captures for that slot", async () => {
    const P = buildProof(over.proof); const k = read(P, doc("k"), "cache"); const s = read(P, doc("s"), "screen"); const calls = [];
    const ctx = { window: {}, adminData: { [STORE]: k }, storeData: s, view: STORE, session: { id: ACTOR }, absenceProof: P.absenceProof, persistStore: async (...args) => { calls.push(args); } };
    new Function("ctx", `with (ctx) { ${over.board || PIECES.board} }`)(ctx); await ctx.window.__lpcSaveBoardDisplay(STORE, { x: 1 });
    return calls[0][3] === k && calls[0][5] && calls[0][5].slot === "cache" && P.proofHolds(calls[0][5], STORE, ACTOR); });
  await run("rollback: a same-object reinstall during the restore-point await retires the already-selected intent", async () => {
    const P = buildProof(over.proof); const d = read(P, doc("d"), "cache"); const sent = []; let release; const gate = new Promise((r) => { release = r; });
    const ctx = { adminData: { [STORE]: d }, emptyStoreData: () => doc("empty"), session: { id: ACTOR, name: "t" }, config: { stores: [{ id: STORE, name: "S" }] }, absenceProof: P.absenceProof,
      saveRestorePoint: async () => { await gate; }, persistStore: async (...args) => { sent.push(args); } };
    const fn = new Function("ctx", `with (ctx) { return (${over.rollback || PIECES.rollback}); }`)(ctx);
    const running = fn(STORE, { t: new Date().toISOString(), data: { roster: [], months: {} } }); P.installBaseline(d, STORE, "cache"); release(); await running;
    return sent.length === 1 && sent[0][5] && !P.proofHolds(sent[0][5], STORE, ACTOR) && !!P.absenceProof(d, STORE, ACTOR, "cache"); });
  await run("rollback: with nothing installed during the await the intent still holds", async () => {
    const P = buildProof(over.proof); const d = read(P, doc("d"), "cache"); const sent = [];
    const ctx = { adminData: { [STORE]: d }, emptyStoreData: () => doc("empty"), session: { id: ACTOR, name: "t" }, config: { stores: [{ id: STORE, name: "S" }] }, absenceProof: P.absenceProof, saveRestorePoint: async () => {}, persistStore: async (...args) => { sent.push(args); } };
    const fn = new Function("ctx", `with (ctx) { return (${over.rollback || PIECES.rollback}); }`)(ctx); await fn(STORE, { t: new Date().toISOString(), data: { roster: [], months: {} } });
    return sent.length === 1 && P.proofHolds(sent[0][5], STORE, ACTOR); });
  await run("rollback of a store with no cached copy carries no proof (a fresh empty copy has no provenance)", async () => {
    const P = buildProof(over.proof); const sent = [];
    const ctx = { adminData: {}, emptyStoreData: () => doc("empty"), session: { id: ACTOR, name: "t" }, config: { stores: [{ id: STORE, name: "S" }] }, absenceProof: P.absenceProof, saveRestorePoint: async () => {}, persistStore: async (...args) => { sent.push(args); } };
    const fn = new Function("ctx", `with (ctx) { return (${over.rollback || PIECES.rollback}); }`)(ctx); await fn(STORE, { t: new Date().toISOString(), data: { roster: [], months: {} } });
    return sent.length === 1 && sent[0][5] === null; });
  return out;
};
const J = (v) => JSON.parse(JSON.stringify(v));

const allChecks = async (over = {}) => ({ ...checks(over), ...(await asyncChecks(over)), ...(await consumerChecks(over)) });
const failing = (r) => Object.keys(r).filter((k) => r[k] !== true);

test("the real source satisfies every provenance, auth-epoch, consumer-capture and rollback check", async () => {
  const r = await allChecks();
  assert.ok(Object.keys(r).length >= 20, "the checks ran");
  assert.deepEqual(failing(r), [], "failing checks: " + failing(r).join(" | "));
});

test("the cut-out pieces are what the application runs (anchors, no stubs of the logic under test)", () => {
  for (const [name, text] of Object.entries(PIECES)) assert.ok(text.length > 30, `${name} piece is not empty`);
  assert.ok(PIECES.proof.includes("const installBaseline = ") && PIECES.proof.includes("const proofHolds = "), "proof block carries the install and capture logic");
  assert.ok(PIECES.rollback.includes("await saveRestorePoint(") && PIECES.rollback.includes("absenceProof("), "rollback callback cut-out contains the await and the capture");
});

// ---- mutation controls: each earlier bad variant, rebuilt from the real text by one exact replacement, must be told apart.
const MUTANTS = [
  { name: "v3: proof not bound to the auth epoch the read began in",
    over: () => ({ proof: swap(PIECES.proof, " && readGen.epoch === authEpoch", "", "markLoad epoch check") }),
    expect: ["a read that began before SIGNED_OUT gets no proof, one that began after does"] },
  { name: "v4: every completion bumps one shared counter (overlapping absent reads deny each other)",
    over: () => ({ proof: swap(PIECES.proof, "  if (clean) { const p = {", "  loadGeneration.set(storeId, now + 1);\n  if (clean) { const p = {", "markLoad bump") }),
    expect: ["overlap: latest installed holds, superseded does not (completion d1 then d2)", "overlap: latest installed holds, superseded does not (completion d2 then d1)"] },
  { name: "cand11: a proof is valid in ANY slot it was installed in",
    over: () => ({ proof: swap(PIECES.proof, "    && typeof cap.inst === \"number\" && p.installs[cap.slot] === cap.inst\n    && installGeneration.get(storeId + \"|\" + cap.slot) === cap.inst;", "    && Object.entries(p.installs).some(([slot, n]) => installGeneration.get(storeId + \"|\" + slot) === n);", "proofHolds slots") }),
    expect: ["cross-slot supersession: a newer screen copy retires the old screen intent although the object is still cached"] },
  { name: "capture re-read from the mutable install table (same-object reinstall reauthorizes an old intent)",
    over: () => ({ proof: swap(PIECES.proof, "    && typeof cap.inst === \"number\" && p.installs[cap.slot] === cap.inst\n    && installGeneration.get(storeId + \"|\" + cap.slot) === cap.inst;", "    && installGeneration.get(storeId + \"|\" + cap.slot) === p.installs[cap.slot];", "proofHolds recapture") }),
    expect: ["installing the same object again cannot reauthorize an older capture, a fresh capture holds"] },
  { name: "presence observation removed",
    over: () => ({ proof: swap(PIECES.proof, "const observeRowPresent = (key) => { const id = storeIdOfKey(key); if (id) loadGeneration.set(id, (loadGeneration.get(id) || 0) + 1); };", "const observeRowPresent = () => {};", "observeRowPresent") }),
    expect: ["a row observed after the read started denies the proof", "a row observed after install revokes a held capture"] },
  { name: "SIGNED_OUT does not move the epoch",
    over: () => ({ auth: { onAuth: swap(PIECES.onAuth, "if (event === \"SIGNED_OUT\") bumpAuthEpoch(); ", "", "onAuthChange bump") } }),
    expect: ["a read that began before SIGNED_OUT gets no proof, one that began after does"] },
  { name: "sign-out does not move the epoch",
    over: () => ({ auth: { signOut: swap(PIECES.signOut, "  bumpAuthEpoch();\n", "", "authSignOut bump") } }),
    expect: ["sign-in and sign-out both move the epoch"] },
  { name: "an explicit baseline without a capture is trusted (unknown provenance gets a proof)",
    over: () => ({ persist: swap(PIECES.persist, "(sourceBaseline !== undefined ? null : absenceProof(loaded, storeId, actor, slot))", "absenceProof(loaded, storeId, actor, slot)", "persistStore provenance") }),
    expect: ["an explicit baseline without a capture has unknown provenance and carries no proof, an explicit null too"] },
  { name: "default selector always reads the screen slot",
    over: () => ({ persist: swap(PIECES.persist, "const slot = view === storeId && storeData?.__storeId === storeId ? \"screen\" : \"cache\";", "const slot = \"screen\";", "persistStore slot") }),
    expect: ["default selector: screen copy when the view is the store, cache copy otherwise, each with its own slot"] },
  { name: "board display captures for the screen slot although it read the cache",
    over: () => ({ board: swap(PIECES.board, "adminData[storeId] ? \"cache\" : \"screen\"", "\"screen\"", "board slot") }),
    expect: ["board display reads the cache first and captures for that slot"] },
  { name: "c13: rollback captures its proof after the restore-point await",
    over: () => { const line = "const proof = adminData[storeId] ? absenceProof(current, storeId, session && session.id, \"cache\") : null;"; const a = once(PIECES.rollback, line, "rollback capture"); const end = PIECES.rollback.indexOf("\n", a); const without = PIECES.rollback.slice(0, a) + PIECES.rollback.slice(end + 1);
      return { rollback: swap(without, "await persistStore(storeId, restored,", line + "\n                  await persistStore(storeId, restored,", "rollback persist") }; },
    expect: ["rollback: a same-object reinstall during the restore-point await retires the already-selected intent"] },
];

for (const m of MUTANTS) {
  test(`mutation control: ${m.name}`, async () => {
    const r = await allChecks(m.over());
    const dead = failing(r);
    for (const want of m.expect) assert.ok(dead.includes(want), `the mutant survived the check "${want}"`);
    assert.ok(dead.length >= m.expect.length, "the mutant was killed");
  });
}
