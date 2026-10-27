/* The daily admin backup waits for a password reset to be over, runs once after it, and stops writing the moment its account or recovery is no longer the one in charge.
 *
 * What this protects. A reset link signs the person in as their own account before they have chosen a password. The app used to treat that as an ordinary admin opening the tool and
 * wrote the day's backup (a store snapshot, a settings snapshot, the index, then a prune) as the recovery session. Now the backup is queued, not started, while recovery is anything
 * but idle; it starts once when recovery is saved or left; it is discarded if a different account is in or the role is no longer admin; and a running backup checks before every
 * write that it is still the same account and the same idle recovery generation.
 *
 * How it tests. runAutoBackup, pruneBackups and the queue-and-start closure are cut out of src/LeadPerformanceCalculator.jsx by anchor (each must occur exactly once) and run against stubs
 * that record every write. The stubbed saveShared follows the real one's rule (a stale caller writes nothing and returns false). The mounted browser cases run the real saveShared, the real
 * SDK and the real recovery controller; this file does not claim those. Mutation controls rebuild the old behaviour and each tempting shortcut from the real text and must be caught.
 * Dependency-free: node:test only.
 */
import { test as nodeTest } from "node:test";
/* every test is bounded: a hung or spinning one fails in thirty seconds instead of stalling the run */
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const once = (a, what) => { assert.equal(src.split(a).length - 1, 1, what + " anchor must occur exactly once"); return src.indexOf(a); };
const cut = (start, end, what) => { const a = once(start, what); const b = src.indexOf(end, a); assert.ok(b > a, what + " end"); return src.slice(a, b + end.length); };
const RUN = cut("async function runAutoBackup(config, adminData, byName, isCurrent = () => true) {", "\n}\n", "runAutoBackup");
const PRUNE = cut("async function pruneBackups(keep, isCurrent = () => true) {", "\n}\n", "pruneBackups");
const START = cut("  const startBackup = () => {", "\n  useEffect(() => { startBackup(); }", "startBackup").replace(/\n  useEffect\(\(\) => \{ startBackup\(\); \}$/, "");
const MOUNT = cut("  useEffect(() => { mounted.current = true;", "}, []);", "the unmount cleanup");
const WATCH = cut("  useEffect(() => { const t = activeTicket.current; if (t && t.check) t.check(); }, [", "]);", "the profile watch");
const FIRST_LOAD = "if (session.role === \"admin\") { adminDataFor.current = readSubject; pendingBackup.current = { userId: session.id, subject: readSubject, first: { config, all }, name: session.name }; startBackup(); }";

/* ---- runAutoBackup and pruneBackups against a recording stub ---- */
function harness({ runCode = RUN, pruneCode = PRUNE, stale = Infinity, staleAfterWrites = Infinity, existing = [], rows = [], metaRows = [] } = {}) {
  const writes = [], errors = [], reads = [], lateWrites = [];   // lateWrites: anything written after the first stale answer, which a correct backup never does
  let calls = 0, staleSeen = false;
  // two ways to go stale: after the first `stale` questions, or after `staleAfterWrites` writes have landed (the second is what a write with no question in front of it cannot hide from)
  const isCurrent = () => { const ok = writes.length < staleAfterWrites && ++calls <= stale; if (!ok) staleSeen = true; return ok; };
  const loadShared = async (key) => { reads.push(key); return key === "lpc:config:backups-index:v1" ? existing : []; };
  const saveShared = async (key, value, quiet, isCur = () => true) => { if (!isCur()) return false; writes.push(key); if (staleSeen) lateWrites.push(key); return true; };   // the real one's rule: a stale caller writes nothing
  const supabase = { from: () => ({ select: () => ({ like: async (_c, pat) => ({ data: (pat === "lpc:backup:%" ? rows : metaRows).map((key) => ({ key })), error: null }) }) }) };
  const consoleStub = { error: (...a) => errors.push(a.join(" ")) };
  const mod = new Function("loadShared", "saveShared", "supabase", "console", "BACKUP_INDEX_KEY", "AUDIT_KEY", "AUTO_BACKUP_EVERY_HOURS", "KEEP_BACKUPS", "backupStoreKey", "backupMetaKey", "lastSaveError",
    pruneCode + "\n" + runCode + "\nreturn { runAutoBackup, pruneBackups };")(loadShared, saveShared, supabase, consoleStub, "lpc:config:backups-index:v1", "lpc:audit", 20, 14,
    (s, id) => `lpc:backup:${s}:${id}:v1`, (id) => `lpc:config:backup:${id}:v1`, null);
  return { mod, writes, errors, reads, lateWrites, questions: () => calls, isCurrent };
}
const data = { s1: { roster: [], months: {} }, s2: { roster: [], months: {} } };   // two stores, so the loop over stores has a boundary between its writes

test("a backup nobody interrupts writes the store snapshot, the settings snapshot, the index, and prunes what the index does not keep", async () => {
  const h = harness({ rows: ["lpc:backup:s1:OLD:v1", "lpc:backup:s1:NEW:v1"], metaRows: ["lpc:config:backup:OLD:v1"] });
  const keep = await h.mod.runAutoBackup({ stores: [] }, data, "Alex", () => true);
  const id = keep[0].id;
  // NEW is not the new id either, so it goes with OLD; the rows of the backup just written are spared because the index keeps them
  assert.deepEqual(h.writes.slice(0, 4), [`lpc:backup:s1:${id}:v1`, `lpc:backup:s2:${id}:v1`, `lpc:config:backup:${id}:v1`, "lpc:config:backups-index:v1"]);
  assert.deepEqual(h.writes.slice(4), ["lpc:backup:s1:OLD:v1", "lpc:backup:s1:NEW:v1", "lpc:config:backup:OLD:v1"]);
  assert.deepEqual(h.errors, []);
});
test("the default isCurrent keeps the old behaviour for every other caller", async () => {
  const h = harness();
  const keep = await h.mod.runAutoBackup({ stores: [] }, data, "Alex");
  assert.equal(keep.length, 1); assert.equal(h.writes.length, 4);
});
test("a day that already has a backup writes nothing", async () => {
  const h = harness({ existing: [{ id: "x", t: new Date().toISOString() }] });
  await h.mod.runAutoBackup({ stores: [] }, data, "Alex", () => true);
  assert.deepEqual(h.writes, []);
});

/* Property: whenever the answer turns stale, however far into the backup that is, nothing is written after it, and a stale stop is not reported as a failed backup. */
test("going stale at ANY boundary stops all further writes and deletes, with no failure logged and no rollback", async () => {
  const rows = ["lpc:backup:s1:OLD:v1", "lpc:backup:s1:OLD2:v1"], metaRows = ["lpc:config:backup:OLD:v1"];
  const full = harness({ rows, metaRows });
  await full.mod.runAutoBackup({ stores: [] }, data, "Alex", full.isCurrent);
  const total = full.questions();
  assert.ok(total >= 10, "the backup asks often enough to be interruptible at each step: " + total);
  for (let k = 0; k < total; k++) {
    const h = harness({ stale: k, rows, metaRows });
    await h.mod.runAutoBackup({ stores: [] }, data, "Alex", h.isCurrent);
    assert.deepEqual(h.lateWrites, [], `k=${k}: nothing may be written after the answer turned stale`);
    assert.deepEqual(h.errors, [], `k=${k}: a stale stop must not log a failed backup`);
    const norm = (w) => w.map((x) => x.replace(/\d{4}-\d\d-\d\dT[\d-]+Z/, "<id>"));   // the id is a timestamp, different on every run
    assert.deepEqual(norm(h.writes), norm(full.writes).slice(0, h.writes.length), `k=${k}: what was written is a leading part of the normal order, so no delete comes before the index`);
    if (k === 0) assert.deepEqual(h.writes, [], "stale before anything: nothing is written");
  }
  for (let n = 0; n <= full.writes.length; n++) {
    const h = harness({ staleAfterWrites: n, rows, metaRows });
    await h.mod.runAutoBackup({ stores: [] }, data, "Alex", h.isCurrent);
    assert.ok(h.writes.length <= n, `going stale after ${n} writes must stop at ${n}, saw ${h.writes.length}`);
    assert.deepEqual(h.errors, [], `n=${n}: no failure logged`);
  }
});
test("stale after the snapshot rows but before the index leaves no index and runs no prune", async () => {
  const h = harness({ stale: 5, rows: ["lpc:backup:s1:OLD:v1"] });
  await h.mod.runAutoBackup({ stores: [] }, data, "Alex", h.isCurrent);
  assert.ok(!h.writes.includes("lpc:config:backups-index:v1") || h.writes.length <= 3);
  assert.ok(!h.writes.includes("lpc:backup:s1:OLD:v1"), "no prune delete after going stale");
});
test("pruneBackups deletes nothing once it is stale, between the listing and each delete", async () => {
  for (let k = 0; k < 8; k++) {
    const h = harness({ stale: k, rows: ["lpc:backup:s1:A:v1", "lpc:backup:s1:B:v1"], metaRows: ["lpc:config:backup:A:v1"] });
    await h.mod.pruneBackups([{ id: "KEEP" }], h.isCurrent);
    const after = h.writes.length;
    assert.ok(after <= 3);
    if (k === 0) assert.equal(after, 0);
  }
  const all = harness({ rows: ["lpc:backup:s1:A:v1", "lpc:backup:s1:B:v1"], metaRows: ["lpc:config:backup:A:v1"] });
  await all.mod.pruneBackups([{ id: "KEEP" }], () => true);
  assert.equal(all.writes.length, 3, "the unstopped prune deletes all three");
});

/* ---- the queue, the start and the ticket, against deferred promises at the real awaits ----
   One composite is built from the real runAutoBackup, pruneBackups, the unmount cleanup and startBackup. Every read and write the backup waits on can be held by the test, so the account,
   the role, the recovery generation or the mount state is changed WHILE the backup is parked at an await, then released: what the backup dispatches afterwards is what is asserted. */
const spinState = { any: false };   // set when any composite's backup restarted more than fifty times, which is a spin
function composite({ session = { id: "u1", role: "admin" }, queued = true, hasSupabase = true, rows = [], metaRows = [], startCode = START, watchCode = WATCH } = {}) {
  const state = { status: "idle", generation: 3, sessionUserId: "u1" };
  const holds = [], dispatched = [], dispatchedRuns = [], deletes = [], deleteRuns = [], errors = [], active = { now: 0, max: 0 };   // *Runs: which run (1, 2, ...) sent each one; runs are serialised, so it is the run active at that moment
  const sessionRef = { current: session }, configSubjectRef = { current: "subj-1" }, pendingBackup = { current: null }, backupInFlight = { current: false }, mounted = { current: true }, activeTicket = { current: null }, listeners = new Set();
  const configRef = { current: { c: 1 } }, adminDataRef = { current: { s1: { roster: [] }, s2: { roster: [] } } }, adminDataFor = { current: "subj-1" }, cfgProvisional = { current: false };
  const runAutoBackupSpy = { runs: 0, args: [], spun: false };
  const gate = (name) => { const h = holds.find((x) => !x.used && x.re.test(name)); if (!h) return null; h.used = true; h.hit = true; return h.promise; };
  const hold = (re) => { let release; const h = { re, used: false, hit: false, promise: new Promise((r) => { release = r; }) }; h.release = () => release(); holds.push(h); return h; };
  const loadShared = async (key) => { const g = gate("read:" + key); if (g) await g; return key === "lpc:config:backups-index:v1" ? [] : []; };
  const saveShared = async (key, value, quiet, isCur = () => true) => {
    if (!isCur()) return false;
    dispatched.push(key); dispatchedRuns.push(runAutoBackupSpy.runs); if (value === null) { deletes.push(key); deleteRuns.push(runAutoBackupSpy.runs); }          // dispatched means sent: it cannot be undone, only not followed by another
    const g = gate("write:" + key); if (g) await g;
    return isCur();                                                       // the real one: a stale caller gets false back
  };
  const supabase = hasSupabase ? { from: () => ({ select: () => ({ like: async (_c, pat) => { const g = gate("list:" + pat); if (g) await g; return { data: (pat === "lpc:backup:%" ? rows : metaRows).map((key) => ({ key })), error: null }; } }) }) } : null;
  const recoveryFlow = { snapshot: () => ({ ...state }), subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const emit = () => { for (const fn of [...listeners]) fn({ ...state }); };   // the controller emits on every auth or recovery change
  const useRef = (v) => ({ current: v });
  let cleanup = null; const useEffect = (fn) => { cleanup = fn(); };
  const body = `${PRUNE}\n${RUN}\nconst realRun = runAutoBackup; runAutoBackup = async (...a) => { spy.runs++; spy.args.push(a.slice(0, 3)); if (spy.runs > 50) { mounted.current = false; spy.spun = true; spinState.any = true; } active.now++; active.max = Math.max(active.max, active.now); try { return await realRun(...a); } finally { active.now--; } };\n${MOUNT}\n${startCode}\nreturn startBackup;`
    .replace("async function runAutoBackup(", "let runAutoBackup; runAutoBackup = async function runAutoBackup(").replace(/(let runAutoBackup; runAutoBackup = async function runAutoBackup\([\s\S]*?\n\}\n)/, "$1;");
  const startBackup = new Function("loadShared", "saveShared", "supabase", "console", "BACKUP_INDEX_KEY", "AUDIT_KEY", "AUTO_BACKUP_EVERY_HOURS", "KEEP_BACKUPS", "backupStoreKey", "backupMetaKey", "lastSaveError",
    "recoveryFlow", "sessionRef", "configSubjectRef", "pendingBackup", "backupInFlight", "mounted", "activeTicket", "configRef", "adminDataRef", "adminDataFor", "cfgProvisional", "useEffect", "spy", "active",
    body)(loadShared, saveShared, supabase, { error: (...a) => errors.push(a.join(" ")) }, "lpc:config:backups-index:v1", "lpc:audit", 20, 14, (s2, id) => `lpc:backup:${s2}:${id}:v1`, (id) => `lpc:config:backup:${id}:v1`, null,
    recoveryFlow, sessionRef, configSubjectRef, pendingBackup, backupInFlight, mounted, activeTicket, configRef, adminDataRef, adminDataFor, cfgProvisional, useEffect, runAutoBackupSpy, active);
  const watchBody = watchCode.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/)[1];   // the real effect's body
  const watch = () => new Function("activeTicket", watchBody)(activeTicket);
  const notify = () => { emit(); watch(); };
  const queue = (over = {}) => { pendingBackup.current = { userId: "u1", subject: "subj-1", first: { config: { c: 1 }, all: { s1: { roster: [] }, s2: { roster: [] } } }, name: "Alex", ...over }; };
  if (queued) queue();
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { configRef, adminDataRef, adminDataFor, cfgProvisional, dispatchedRuns, deleteRuns, notify, emit, watch, activeTicket, state, holds, hold, dispatched, deletes, errors, active, sessionRef, configSubjectRef, pendingBackup, mounted, startBackup, queue, settle, spy: runAutoBackupSpy, unmount: () => cleanup && cleanup(), backupInFlight };
}
const keyOf = (d) => d.replace(/\d{4}-\d\d-\d\dT[\d-]+Z/, "<id>");
const full = ["lpc:backup:s1:<id>:v1", "lpc:backup:s2:<id>:v1", "lpc:config:backup:<id>:v1", "lpc:config:backups-index:v1"];

test("while recovery is pending, ready, failed or interrupted nothing starts and the queue is kept", async () => {
  for (const status of ["pending", "ready", "failed", "interrupted"]) {
    const c = composite(); c.state.status = status; c.startBackup(); await c.settle();
    assert.equal(c.spy.runs, 0, status); assert.ok(c.pendingBackup.current, status + ": the queue is kept"); assert.deepEqual(c.dispatched, [], status);
  }
});
test("a backup that was deferred through recovery backs up what is CURRENT when it starts, not what the first load read", async () => {
  const c = composite(); c.state.status = "ready"; c.startBackup(); c.state.status = "pending"; c.startBackup();
  c.adminDataRef.current = { s1: { fresh: 1 } }; c.configRef.current = { c: 7 };      // the config and the admin data were reloaded while it waited
  c.state.status = "idle"; c.startBackup(); await c.settle();
  assert.deepEqual(c.spy.args[0], [{ c: 7 }, { s1: { fresh: 1 } }, "Alex"]);
  const d = composite(); d.state.status = "ready"; d.startBackup(); d.state.status = "idle"; d.adminDataFor.current = "subj-OTHER"; d.startBackup(); await d.settle();
  assert.equal(d.spy.runs, 0, "data that belongs to another profile is never used"); assert.ok(d.pendingBackup.current, "and the entry waits");
  const e = composite(); e.startBackup(); await e.settle(); assert.deepEqual(e.spy.args[0][0], { c: 1 }, "a run that starts at once still uses exactly what the first load read");
});
test("once recovery is idle the queued backup runs to the end exactly once and is then cleared; repeated starts do nothing", async () => {
  const c = composite(); c.state.status = "ready"; c.startBackup(); assert.equal(c.spy.runs, 0);
  c.state.status = "idle"; c.startBackup(); await c.settle();
  assert.deepEqual(c.dispatched.map(keyOf), full); assert.equal(c.pendingBackup.current, null);
  c.startBackup(); c.startBackup(); await c.settle(); assert.equal(c.spy.runs, 1, "exactly once");
});
test("a normal opening with no recovery at all starts at once and finishes, as before", async () => {
  const c = composite(); c.startBackup(); await c.settle(); assert.deepEqual(c.dispatched.map(keyOf), full);
});
test("another account, a non-admin or no account discards the queue; an unknown identity waits; another identity discards; no database client skips the identity check", async () => {
  for (const [label, mutate] of [["another user", (c) => { c.state.sessionUserId = "u2"; }], ["not admin any more", (c) => { c.sessionRef.current = { id: "u1", role: "manager" }; }], ["signed out", (c) => { c.sessionRef.current = null; }], ["profile is another user's", (c) => { c.sessionRef.current = { id: "u9", role: "admin" }; }], ["the profile changed (active, pending or stores)", (c) => { c.configSubjectRef.current = "subj-2"; }]]) {
    const c = composite(); mutate(c); c.startBackup(); await c.settle();
    assert.equal(c.spy.runs, 0, label); assert.equal(c.pendingBackup.current, null, label + ": discarded");
  }
  const w = composite(); w.state.sessionUserId = null; w.startBackup(); await w.settle();
  assert.equal(w.spy.runs, 0); assert.ok(w.pendingBackup.current, "kept until the identity is known"); w.state.sessionUserId = "u1"; w.startBackup(); await w.settle(); assert.equal(w.spy.runs, 1);
  const p = composite({ hasSupabase: false }); p.state.sessionUserId = null; p.startBackup(); await p.settle(); assert.equal(p.spy.runs, 1);
});

/* A backup parked at each real await; the world changes; the await is released. Nothing more may be dispatched, and the old run may never be revived by values that come back. */
const PARKS = [["the index read", /^read:lpc:config:backups-index:v1$/], ["the first store write", /^write:lpc:backup:s1:/], ["the second store write", /^write:lpc:backup:s2:/], ["the audit read", /^read:lpc:audit$/], ["the settings write", /^write:lpc:config:backup:/], ["the index write", /^write:lpc:config:backups-index:v1$/]];
const CHANGES = {
  "a new recovery generation": { go: (c) => { c.state.generation = 4; c.state.status = "ready"; c.emit(); }, back: (c) => { c.state.generation = 3; c.state.status = "idle"; c.emit(); } },
  "interrupted recovery": { go: (c) => { c.state.status = "interrupted"; c.emit(); }, back: (c) => { c.state.status = "idle"; c.emit(); } },
  "a role downgrade": { go: (c) => { c.sessionRef.current = { id: "u1", role: "manager" }; c.watch(); }, back: (c) => { c.sessionRef.current = { id: "u1", role: "admin" }; c.watch(); } },
  "an inactive or pending profile": { go: (c) => { c.configSubjectRef.current = "subj-2"; c.watch(); }, back: (c) => { c.configSubjectRef.current = "subj-1"; c.watch(); } },
  "another account": { go: (c) => { c.state.sessionUserId = "u2"; c.emit(); }, back: (c) => { c.state.sessionUserId = "u1"; c.emit(); } },
  "sign-out": { go: (c) => { c.sessionRef.current = null; c.state.sessionUserId = null; c.notify(); }, back: (c) => { c.sessionRef.current = { id: "u1", role: "admin" }; c.state.sessionUserId = "u1"; c.notify(); } },
  "an unmount": { go: (c) => c.unmount(), back: (c) => { c.mounted.current = true; } },
};
test("EVERY change at EVERY real await: nothing is dispatched after it, even when the old values come back before the await returns", async () => {
  for (const [parkName, re] of PARKS) for (const [changeName, change] of Object.entries(CHANGES)) {
    for (const comesBack of [false, true]) {
      const c = composite(); const h = c.hold(re); c.startBackup();
      for (let i = 0; i < 50 && !h.hit; i++) await new Promise((r) => setTimeout(r, 2));
      assert.ok(h.hit, `${parkName}: the backup reached its await`);
      const before = c.dispatched.length;
      change.go(c); if (comesBack) change.back(c); h.release(); await c.settle();
      const oldRunLate = c.dispatchedRuns.slice(before).filter((r) => r === 1).length;
      assert.equal(oldRunLate, 0, `${parkName} / ${changeName}${comesBack ? " (values returned)" : ""}: the OLD run dispatched ${oldRunLate} after the change`);
      assert.ok(c.active.max <= 1, "runs never overlap");
      if (!comesBack) assert.equal(c.dispatched.length, before, `${parkName} / ${changeName}: nothing at all is dispatched while the change stands`);
      else if (c.spy.runs > 1) assert.deepEqual(c.dispatched.slice(before).map(keyOf), full.slice(0, c.dispatched.length - before), "a second run, if the values really came back and it is eligible, is a complete separate run (writes in order, one index)");
      assert.deepEqual(c.errors, [], `${parkName} / ${changeName}: a stale stop is not a failed backup`);
    }
  }
});
test("the prune's listing and its deletes are parked and cancelled the same way", async () => {
  for (const [listName, listRe] of [["the backup listing", /^list:lpc:backup:%$/], ["the settings listing", /^list:lpc:config:backup:%$/]]) for (const [changeName, change] of Object.entries(CHANGES)) {
    const c = composite({ rows: ["lpc:backup:s1:OLD:v1", "lpc:backup:s1:OLD2:v1"], metaRows: ["lpc:config:backup:OLD:v1"] });
    const h = c.hold(listRe); c.startBackup();
    for (let i = 0; i < 50 && !h.hit; i++) await new Promise((r) => setTimeout(r, 2));
    assert.ok(h.hit, listName); const delBefore = c.deletes.length; change.go(c); change.back(c); h.release(); await c.settle();
    assert.equal(c.deleteRuns.slice(delBefore).filter((r) => r === 1).length, 0, `${listName} / ${changeName}: the old run deleted after it went stale (even with the values back)`);
  }
  const ok = composite({ rows: ["lpc:backup:s1:OLD:v1"], metaRows: ["lpc:config:backup:OLD:v1"] }); ok.startBackup(); await ok.settle();
  assert.equal(ok.deletes.length, 2, "the unstopped prune deletes both orphans");
});
test("a run that went stale leaves the queue for the same account and the same profile, and starts a NEW ticket when things are idle: one complete backup, never two at once", async () => {
  const c = composite(); const h = c.hold(/^write:lpc:backup:s1:/); c.startBackup();
  for (let i = 0; i < 50 && !h.hit; i++) await new Promise((r) => setTimeout(r, 2));
  c.state.generation = 4; c.state.status = "ready"; c.notify();   // a new recovery: the old ticket dies
  h.release(); await c.settle();
  assert.equal(c.dispatched.length, 1, "only the write that was already out");
  assert.ok(c.pendingBackup.current, "the queue survives the cancellation");
  assert.equal(c.spy.runs, 1);
  c.state.status = "idle";                                        // the reset is saved or left; the generation moved on, so a new ticket is captured
  c.startBackup(); await c.settle();
  assert.equal(c.spy.runs, 2, "a new run, not the old one revived");
  assert.deepEqual(c.dispatched.slice(1).map(keyOf), full, "one complete backup after the first stale stop");
  assert.equal(c.pendingBackup.current, null); assert.equal(c.active.max, 1, "never two backups at once");
  c.startBackup(); await c.settle(); assert.equal(c.spy.runs, 2, "and not again");
});
test("an old run that settles after an account change does not clear, start or disturb the NEW account's queue, which then runs serialised after it", async () => {
  const c = composite(); const h = c.hold(/^write:lpc:backup:s1:/); c.startBackup();
  for (let i = 0; i < 50 && !h.hit; i++) await new Promise((r) => setTimeout(r, 2));
  c.state.sessionUserId = "u2"; c.sessionRef.current = { id: "u2", role: "admin" }; c.configSubjectRef.current = "subj-u2"; c.notify();
  c.queue({ userId: "u2", subject: "subj-u2", name: "Bea" });
  c.startBackup(); assert.equal(c.spy.runs, 1, "the new account does not start while the old run is still in flight (no concurrent index or prune writes)");
  h.release(); await c.settle();
  assert.equal(c.spy.runs, 2); assert.equal(c.active.max, 1);
  assert.deepEqual(c.dispatched.slice(1).map(keyOf), full, "the new account's own complete backup, after the old one stopped");
  assert.equal(c.pendingBackup.current, null);
});
test("a role downgrade or a changed profile discards the queue after the stale stop, so it is not run later for an account no longer allowed", async () => {
  for (const make of [(c) => { c.sessionRef.current = { id: "u1", role: "manager" }; }, (c) => { c.configSubjectRef.current = "subj-2"; }]) {
    const c = composite(); const h = c.hold(/^write:lpc:backup:s1:/); c.startBackup();
    for (let i = 0; i < 50 && !h.hit; i++) await new Promise((r) => setTimeout(r, 2));
    make(c); c.notify(); h.release(); await c.settle();
    assert.equal(c.pendingBackup.current, null); c.startBackup(); await c.settle(); assert.equal(c.spy.runs, 1); assert.equal(c.dispatched.length, 1);
  }
});
test("an unmount clears the queue and nothing starts afterwards", async () => {
  const c = composite(); c.unmount(); c.startBackup(); await c.settle();
  assert.equal(c.spy.runs, 0); assert.equal(c.pendingBackup.current, null);
});


const interruptEleven = async (startCode) => {
  const c = composite({ startCode });
  const holds = Array.from({ length: 11 }, () => c.hold(/^write:lpc:backup:s1:/));   // one per run, registered up front: a restart made as a run settles meets the next one
  c.startBackup();
  for (let i = 0; i < 11; i++) {
    const h = holds[i];
    for (let w = 0; w < 100 && !h.hit; w++) await new Promise((r) => setTimeout(r, 2));
    if (!h.hit) break;                                               // the entry was dropped: no run came back
    c.state.generation += 1; c.emit();                               // a new recovery interrupts it (idle again at once, so the next run can start as this one settles)
    h.release(); await c.settle();
  }
  await c.settle(); await c.settle();
  return c;
};
test("the entry is never dropped by repetition: ELEVEN interruptions of the same entry, then an eligible idle start still completes exactly one full backup", async () => {
  const c = await interruptEleven(START);
  assert.equal(c.spy.runs, 12, "eleven interrupted runs and one that finished");
  assert.deepEqual(c.dispatched.slice(-4).map(keyOf), full, "the last run is a complete backup");
  assert.equal(c.pendingBackup.current, null, "and only then is the entry cleared");
  assert.equal(c.active.max, 1);
  // the control: a start that drops an entry after eight starts (the rejected policy) fails this same scenario
  const capped = mutate(START, "    const generation = now.generation;", "    if ((queued.attempts = (queued.attempts || 0) + 1) > 8) { pendingBackup.current = null; return; }\n    const generation = now.generation;");
  const d = await interruptEleven(capped);
  assert.notEqual(d.spy.runs, 12, "the eight-start cap loses the backup: it never completes");
  assert.equal(d.pendingBackup.current, null);
  assert.ok(!d.dispatched.slice(-4).map(keyOf).every((k, i) => k === full[i]) || d.spy.runs < 12, "no complete last run under the cap");
});
test("a run parked at an ALREADY-DISPATCHED prune delete: change (and optionally revert) ownership, release, and the OLD run deletes nothing more; a later eligible run is distinguished", async () => {
  const rows = ["lpc:backup:s1:OLD:v1", "lpc:backup:s1:OLD2:v1"], metaRows = ["lpc:config:backup:OLD:v1"];
  for (const [changeName, change] of Object.entries(CHANGES)) for (const comesBack of [false, true]) {
    const c = composite({ rows, metaRows }); const h = c.hold(/^write:lpc:backup:s1:OLD:v1$/); c.startBackup();
    for (let w = 0; w < 100 && !h.hit; w++) await new Promise((r) => setTimeout(r, 2));
    assert.ok(h.hit, `${changeName}: the run reached its first prune delete`);
    assert.ok(c.deletes.includes("lpc:backup:s1:OLD:v1"), "that delete has already been dispatched (sent), only its answer is awaited");
    const delBefore = c.deletes.length;
    change.go(c); if (comesBack) change.back(c); h.release(); await c.settle();
    assert.equal(c.deleteRuns.slice(delBefore).filter((r) => r === 1).length, 0, `${changeName}${comesBack ? " (values returned)" : ""}: the OLD run sent another delete after ownership changed`);
    assert.ok(c.active.max <= 1);
    if (comesBack && c.spy.runs > 1) assert.ok(c.deleteRuns.slice(delBefore).every((r) => r === 2), "any later delete belongs to the new run");
  }
});

/* ---- where it is wired ---- */
test("the first load only queues (with the profile it was queued under) and asks to start; the only caller of runAutoBackup is the start", () => {
  once(FIRST_LOAD, "the first-load queue");
  assert.equal(src.split("runAutoBackup(").length - 1, 2, "the definition and the one call in startBackup");
  assert.ok(START.includes("runAutoBackup(data.config, data.all, queued.name, stillOurs)"));
  assert.ok(src.includes("useEffect(() => { startBackup(); }, [rec.status, rec.generation, rec.sessionUserId, session?.id, session?.role, adminData]);"), "it is retried whenever recovery or the account changes");
  assert.ok(START.includes('now.status !== "idle"') && START.includes("n.generation === generation") && START.includes("n.sessionUserId === queued.userId") && START.includes("configSubjectRef.current === queued.subject") && START.includes("mounted.current") && START.includes('w.role === "admin"'));
  assert.ok(START.includes("if (!ok) ticket.dead = true;") && START.includes("if (ticket.dead) return false;"), "the ticket is irreversible");
  assert.ok(START.includes("const unwatch = recoveryFlow.subscribe(() => { stillOurs(); });") && START.includes("ticket.check = stillOurs; activeTicket.current = ticket;"), "recovery and account changes are observed, not only sampled");
  assert.ok(WATCH.includes("session?.role") && WATCH.includes("configSubject") && MOUNT.includes("activeTicket.current.dead = true"), "a profile change and an unmount kill the running ticket");
});

/* ---- mutation controls ---- */
const mutate = (text, from, to) => { assert.ok(text.includes(from), "mutation anchor not found: " + from); return text.replace(from, to); };
const lateAndQueueCheck = async (startCode, watchCode = WATCH) => {
  // the awaits above, run against a mutated startBackup: returns what a broken version gets wrong
  const problems = []; spinState.any = false;
  const park = async (change, comesBack) => { const c = composite({ startCode, watchCode }); const h = c.hold(/^write:lpc:backup:s1:/); c.startBackup(); for (let i = 0; i < 50 && !h.hit; i++) await new Promise((r) => setTimeout(r, 2)); const before = c.dispatched.length; change.go(c); if (comesBack) change.back(c); h.release(); await c.settle(); return c.dispatchedRuns.slice(before).filter((r) => r === 1).length; };
  for (const [name, change] of Object.entries(CHANGES)) { if (await park(change, true) > 0) problems.push("revived after " + name + " returned"); if (await park(change, false) > 0) problems.push("kept writing after " + name); }
  const q = composite({ startCode, watchCode }); const h = q.hold(/^write:lpc:backup:s1:/); q.startBackup(); for (let i = 0; i < 50 && !h.hit; i++) await new Promise((r) => setTimeout(r, 2));
  q.state.generation = 4; q.state.status = "ready"; q.notify(); h.release(); await q.settle(); if (!q.pendingBackup.current) problems.push("lost the queue on a stale stop");
  const st = composite({ startCode, watchCode }); st.state.status = "ready"; st.startBackup(); await st.settle(); if (st.spy.runs) problems.push("started during recovery");
  const two = composite({ startCode, watchCode }); const h2 = two.hold(/^write:lpc:backup:s1:/); two.startBackup(); for (let i = 0; i < 50 && !h2.hit; i++) await new Promise((r) => setTimeout(r, 2)); two.startBackup(); two.startBackup(); if (two.spy.runs > 1) problems.push("two runs at once"); h2.release(); await two.settle();
  const nq = composite({ startCode, watchCode }); const h3 = nq.hold(/^write:lpc:backup:s1:/); nq.startBackup(); for (let i = 0; i < 50 && !h3.hit; i++) await new Promise((r) => setTimeout(r, 2));
  nq.state.sessionUserId = "u2"; nq.sessionRef.current = { id: "u2", role: "admin" }; nq.configSubjectRef.current = "subj-u2"; nq.notify(); nq.queue({ userId: "u2", subject: "subj-u2" }); h3.release(); await nq.settle(); if (nq.spy.runs < 2) problems.push("cleared or skipped the new account's queue");
  const fr = composite({ startCode, watchCode }); const hf = fr.hold(/^write:lpc:backup:s1:/); fr.startBackup(); for (let i = 0; i < 50 && !hf.hit; i++) await new Promise((r) => setTimeout(r, 2));
  fr.state.generation = 4; fr.emit();                                   // a new recovery that is already over (idle again): the stop is by generation alone
  fr.adminDataRef.current = { s1: { fresh: 1 } }; fr.configRef.current = { c: 2 }; hf.release(); await fr.settle();   // the restart happens as the old run settles
  if (fr.spy.runs < 2 || JSON.stringify(fr.spy.args[1]) !== JSON.stringify([{ c: 2 }, { s1: { fresh: 1 } }, "Alex"])) problems.push("a restart reused the old snapshot instead of the current config and admin data");
  const xs = composite({ startCode, watchCode }); const hx = xs.hold(/^write:lpc:backup:s1:/); xs.startBackup(); for (let i = 0; i < 50 && !hx.hit; i++) await new Promise((r) => setTimeout(r, 2));
  xs.state.generation = 4; xs.state.status = "ready"; xs.emit(); hx.release(); await xs.settle(); xs.state.status = "idle"; xs.adminDataFor.current = "subj-OTHER"; xs.adminDataRef.current = { s9: { other: 1 } }; xs.startBackup(); await xs.settle();
  if (xs.spy.runs > 1) problems.push("a restart used admin data that was loaded for another profile");
  const df = composite({ startCode, watchCode }); df.state.status = "ready"; df.startBackup(); df.adminDataRef.current = { s1: { fresh: 1 } }; df.state.status = "idle"; df.startBackup(); await df.settle();
  if (JSON.stringify(df.spy.args[0]) !== JSON.stringify([{ c: 1 }, { s1: { fresh: 1 } }, "Alex"])) problems.push("a deferred entry backed up the old snapshot");
  const rq = composite({ startCode, watchCode }); const h4 = rq.hold(/^write:lpc:backup:s1:/); rq.startBackup(); for (let i = 0; i < 50 && !h4.hit; i++) await new Promise((r) => setTimeout(r, 2));
  rq.queue({ name: "Alex again" }); h4.release(); await rq.settle(); if (rq.spy.runs < 2) problems.push("lost an entry queued during the run");
  if (spinState.any) problems.push("it spun (restarted without end)");
  const dr = composite({ startCode, watchCode, session: { id: "u1", role: "manager" } }); dr.startBackup(); await dr.settle(); if (dr.spy.runs) problems.push("ran for a non-admin");
  return problems;
};
test("the real startBackup passes every awaited scenario, and each shortcut is caught by a named one", async () => {
  assert.deepEqual(await lateAndQueueCheck(START), []);
  const mutants = {
    "no latch": mutate(START, "      if (!ok) ticket.dead = true;\n", ""),
    "sampled only, not observed": mutate(START, "const unwatch = recoveryFlow.subscribe(() => { stillOurs(); });", "const unwatch = () => {};"),
    "queue dropped on a stale stop": mutate(START, "if (pendingBackup.current) startBackup();", "if (!ours) pendingBackup.current = null;"),
    "queue cleared unconditionally": mutate(START, "if (ours && pendingBackup.current === queued) pendingBackup.current = null;", "if (ours) pendingBackup.current = null;"),
    "the old snapshot is reused": mutate(START, "else if (!ours && pendingBackup.current === queued) queued.first = null;", ""),
    "a deferred entry keeps the old snapshot": mutate(START, 'if (now.status !== "idle") { queued.first = null; return; }', 'if (now.status !== "idle") return;'),
    "data for another profile is accepted": mutate(START, " || adminDataFor.current !== queued.subject", ""),
    "no serialisation": mutate(START, "if (!queued || backupInFlight.current || !mounted.current) return;", "if (!queued || !mounted.current) return;"),
    "a profile change is not observed": null,
    "starts during recovery": mutate(START, 'if (now.status !== "idle") { queued.first = null; return; }', ""),
    "ignores the role": mutate(START, 'if (!who || who.role !== "admin" || who.id !== queued.userId', 'if (!who || who.id !== queued.userId'),
  };
  for (const [name, code] of Object.entries(mutants)) { if (code === null) continue; assert.notEqual(code, START, name); const found = await lateAndQueueCheck(code); assert.ok(found.length > 0, `the mutant "${name}" must be caught`); }
  const noWatch = mutate(WATCH, "t.check()", "void t");
  assert.ok((await lateAndQueueCheck(START, noWatch)).length > 0, "the mutant where a profile change is not observed must be caught");
});
