/* WebKit qualification plumbing: a dependency-injected launcher and lifecycle state machine. CANDIDATE, NOT ENABLED, NEVER QUALIFYING.
 *
 * Base: PR 501 head 23dbdb7d84c8ec328a7fb6056dabad34e2ebeeef. Nothing imports this file. scripts/ci-fixture.sh still refuses WebKit (exit 5) and stays that way until an independent
 * review and a real sandbox proof exist.
 *
 * EVERY receipt from this file says qualifying: false and lists why in `blocked`. That is on purpose and is not a bug to be fixed by trusting a label:
 *  - the attestation is only checked for SHAPE and freshness. Its evidence hash is not verified, and it is not bound to the binary, the Playwright version or the runner;
 *  - the executable hash covers the one file at the verified path (a launcher file, as the reviewer reported for pw_run.sh), not the browser binaries it starts, and nothing here proves otherwise;
 *  - no runtime sandbox proof and no process-tree proof exist for WebKit, and the real binding supplies no descendants check;
 *  - the "real" binding can be pointed at any driver directory, so being built by it proves nothing. It only changes `bindingKind`.
 * Qualification needs an external attestation verifier and a runtime proof that do not exist yet. When they do, they are a new reviewed change, not a flag here.
 *
 * No receipt reads as a WebKit pass. There is no `ok` field: `lifecycleOk` says only that this run's own bookkeeping was clean, `verdict` is the constant "NOT_QUALIFIED", and
 * webkitRunFailed() is true for every receipt this file can produce. start() resolves `ready`, meaning only "reached READY".
 *
 * Source evidence about Playwright, as REPORTED by the independent reviewer (I did not read it myself): Playwright v1.63.0, commit 1b025d7e20a026371cd5f98ba0cdce48892737c8,
 * packages/utils/processLauncher.ts. handleSIGINT, handleSIGTERM and handleSIGHUP default to true and are left at their defaults here. close() waits for the child to close and for temp
 * cleanup. kill() sends SIGKILL to the process group and waits, with NO timeout of its own, so the only bound on it is T.kill below. That group kill does NOT prove that descendants which
 * left the group are gone, so descendants stay "unproven" and a clean exit of the direct child is not process-tree evidence.
 *
 * What the lifecycle DOES guarantee (checked by synthetic tests only, never by a real browser):
 *  - The launch API is only called after both records pass the shape and freshness check and the machine matches them (path is canonical, executable path, sha256, Playwright version).
 *    Freshness is rechecked after start and before READY. Callers cannot pass launch options.
 *  - close() and cancel() are the same terminal path. Called before start, they stop start from ever launching. Called while starting or connecting, they WAIT for that step to settle
 *    (bounded), take ownership of whatever it produced, close it, and only then return. A step that never settles leaves the run UNCERTAIN with the unresolved work listed.
 *  - Every wait is bounded. Close is single-flight. A close that throws or hangs is a failure, escalating to kill() on the owned server handle only. Nothing is killed by name, pattern or guessed pid.
 *  - An exit that was not observed is UNCERTAIN. UNCERTAIN never turns into a pass: later events can only add reasons.
 *  - Receipts carry closed-vocabulary codes, state names, booleans, numbers. No error text, no paths, no hashes, no environment.
 *  - Bookkeeping cannot stop cleanup. A throwing injected clock, or any unexpected internal fault, is recorded as clock-fault or internal-fault, cleanup is still attempted, and the receipt is
 *    never clean. start(), close() and cancel() never reject.
 *
 * close() and cancel() are BOUNDED, NOT PROMPT. They wait for the step in flight (preflight up to 2 x preflight; start up to start + startGrace; connect up to connect + startGrace; health up to
 * health), then run the close path: lateWait for a timed-out start and again for a timed-out connect, browser close, server close, kill, exitObserve, and a descendants check if one was supplied
 * (each up to close, kill, exitObserve or close respectively). The worst case is the longest in-flight step plus that close path, a sum of the configured timeouts, roughly a minute with the defaults.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export const RECEIPT_VERSION = 3;
export const STATES = Object.freeze(["IDLE", "PREFLIGHT", "REFUSED", "STARTING", "CONNECTING", "HEALTH", "READY", "CLOSING", "CLOSED", "FAILED", "UNCERTAIN"]);
export const REASONS = Object.freeze([
  "launch-options-refused",
  "prerequisites-missing", "prerequisites-not-verified", "prerequisites-invalid",
  "attestation-missing", "attestation-not-verified", "attestation-invalid", "attestation-expired", "attestation-synthetic",
  "path-not-canonical", "executable-mismatch", "version-mismatch", "hash-mismatch", "probe-failed",
  "start-threw", "start-timeout", "start-unresolved", "start-handle-invalid", "late-start-adopted",
  "connect-threw", "connect-timeout", "connect-unresolved", "late-connect-adopted", "health-failed",
  "cancelled", "closed-before-start", "closed-before-ready",
  "browser-close-threw", "browser-close-timeout", "server-close-threw", "server-close-timeout",
  "kill-threw", "kill-timeout", "exit-unobserved", "descendants-remaining",
  "clock-fault", "internal-fault",
]);
/* Constant on purpose: nothing a run does can remove an item from this list. */
export const BLOCKED = Object.freeze([
  "no-reviewed-attestation-verifier", "evidence-not-bound-to-binary-version-runner", "executable-hash-covers-launcher-file-only", "no-process-tree-proof", "no-runtime-sandbox-proof",
]);

const HEX64 = /^[0-9a-f]{64}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LOOPBACK_WS = /^ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+(?:\/|$)/;
const isoMs = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s) ? Date.parse(s) : NaN);

/* ---- the record contract: SHAPE and FRESHNESS only (pure). It does not verify the evidence and does not look at the machine. ---- */
/* Returns closed-vocabulary refusal reasons; empty means "well-formed, marked VERIFIED, and current at `now`". It says nothing about whether the claims are true. */
export function checkRecordShape({ prerequisites, attestation, now }) {
  const out = [];
  const p = prerequisites, a = attestation;
  if (p == null || typeof p !== "object") out.push("prerequisites-missing");
  else if (p.status !== "VERIFIED") out.push("prerequisites-not-verified");
  else if (!path.isAbsolute(String(p.webkitExecutable || "")) || !HEX64.test(String(p.webkitExecutableSha256 || "")) || !LABEL.test(String(p.playwrightVersion || "")) || !LABEL.test(String(p.verifiedBy || "")) || !(isoMs(p.verifiedAt) <= now)) out.push("prerequisites-invalid");
  if (a == null || typeof a !== "object") out.push("attestation-missing");
  else if (a.status !== "VERIFIED") out.push("attestation-not-verified");
  else if (a.kind !== "real-sandbox") out.push("attestation-synthetic");   // anything but the one kind, including "mock", "synthetic", "unit-test"
  else if (a.engine !== "webkit" || !LABEL.test(String(a.sandboxId || "")) || !LABEL.test(String(a.runnerLabel || "")) || !LABEL.test(String(a.attestedBy || "")) || !HEX64.test(String(a.evidenceSha256 || "")) || !(isoMs(a.attestedAt) <= now) || !Number.isFinite(isoMs(a.expiresAt))) out.push("attestation-invalid");
  else if (!(isoMs(a.expiresAt) > now)) out.push("attestation-expired");
  return out;
}

/* ---- bounded waits ---- */
/* Never rejects. A timeout says "not known to have finished", not "stopped": whoever owns something must still resolve it. */
const settle = (promise, ms) => new Promise((resolve) => {
  let done = false;
  const timer = setTimeout(() => { if (!done) { done = true; resolve({ status: "timeout" }); } }, ms);
  promise.then(
    (value) => { if (!done) { done = true; clearTimeout(timer); resolve({ status: "ok", value }); } },
    () => { if (!done) { done = true; clearTimeout(timer); resolve({ status: "threw" }); } },
  );
});
const step = (fn, ms) => settle(Promise.resolve().then(fn), ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_TIMEOUTS = Object.freeze({ preflight: 10_000, start: 30_000, startGrace: 5_000, connect: 15_000, health: 5_000, close: 10_000, kill: 8_000, exitObserve: 1_000, lateWait: 5_000 });
function resolveTimeouts(t = {}) {
  const out = { ...DEFAULT_TIMEOUTS };
  for (const k of Object.keys(DEFAULT_TIMEOUTS)) if (t[k] !== undefined) { if (!Number.isInteger(t[k]) || t[k] < 1 || t[k] > 600_000) throw new Error("timeouts." + k + " must be an integer from 1 to 600000"); out[k] = t[k]; }
  return out;
}

/* The direct child's exit as Node reports it (ChildProcess.exitCode / signalCode). No process to read is "unobserved", not "exited". */
const exitedNow = (server) => { try { const cp = server.process(); return !!cp && (cp.exitCode !== null && cp.exitCode !== undefined ? true : (cp.signalCode !== null && cp.signalCode !== undefined)); } catch (e) { return false; } };
const looksLikeServer = (h) => !!h && ["wsEndpoint", "close", "kill", "process"].every((m) => typeof h[m] === "function");

/* ---- the real binding. Never called by the unit tests against a real browser. Building deps here changes bindingKind and NOTHING else: it grants no qualification. ---- */
const REAL = new WeakSet();
export function realWebkitDeps({ driverDir }) {
  if (!path.isAbsolute(String(driverDir || ""))) throw new Error("realWebkitDeps needs an absolute driverDir; nothing is resolved implicitly");
  let loaded = null;
  const load = () => loaded || (loaded = (() => { const req = createRequire(path.join(driverDir, "package.json")); return { webkit: req(driverDir).webkit, version: req(path.join(driverDir, "package.json")).version }; })());
  const deps = Object.freeze({
    now: () => Date.now(),
    playwrightVersion: async () => load().version,
    executablePath: async () => load().webkit.executablePath(),
    realPath: (file) => fs.promises.realpath(file),
    hashFile: (file) => new Promise((resolve, reject) => { const h = crypto.createHash("sha256"); fs.createReadStream(file).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex"))); }),
    launchServer: (options) => load().webkit.launchServer(options),
    connect: (ws, options) => load().webkit.connect(ws, options),
    /* verifyNoDescendants is deliberately absent: no process-tree evidence method is reviewed for WebKit. */
  });
  REAL.add(deps);
  return deps;
}

/* ---- the kit ---- */
/* deps: { now, playwrightVersion, executablePath, realPath, hashFile, launchServer, connect, verifyNoDescendants? } (async or sync).
   Returns { start, close, cancel, receipt, state }. start() resolves { ok, browser, receipt } and does not throw for an expected failure. close() and cancel() resolve the TERMINAL receipt. */
export function createWebkitKit({ deps, prerequisites, attestation, timeouts, launchOptions } = {}) {
  if (!deps || typeof deps.now !== "function") throw new Error("createWebkitKit needs deps");
  const T = resolveTimeouts(timeouts);
  const transitions = [], reasons = [], unresolved = [];
  let state = "IDLE", started = null, closing = null, intent = null, clockFault = false, lastNow = 0;
  let server = null, browser = null, ownedPid = null, forced = false, uncertain = false, launchAttempted = false, reachedReady = false, lateTails = 0, descendants = "unproven", shapeOk = false;
  let pendingStart = null, pendingConnect = null;
  const why = (r) => { if (!REASONS.includes(r)) throw new Error("unknown reason " + r); if (!reasons.includes(r)) reasons.push(r); };
  /* The injected clock is bookkeeping, not a reason to skip cleanup. A clock that throws or returns a non-number is recorded once, the last good time is used, and freshness then fails closed. */
  const nowMs = () => {
    try { const v = deps.now(); if (Number.isFinite(v)) { lastNow = v; return v; } } catch (e) { /* recorded below */ }
    if (!clockFault) { clockFault = true; why("clock-fault"); }
    return lastNow;
  };
  const t0 = nowMs();
  /* UNCERTAIN is a one-way door: nothing later can turn it into anything else. */
  const go = (s, at = nowMs()) => { if (state === "UNCERTAIN" && s !== "UNCERTAIN") return; state = s; transitions.push({ state: s, atMs: Math.max(0, at - t0) }); };
  const open = (r) => { if (!unresolved.includes(r)) unresolved.push(r); uncertain = true; };

  const receipt = () => ({
    version: RECEIPT_VERSION,
    qualifying: false, blocked: [...BLOCKED],   // constant: see the header
    bindingKind: REAL.has(deps) ? "real-binding-unreviewed" : "injected",
    verdict: "NOT_QUALIFIED",   // constant: no receipt from this file is a WebKit pass
    lifecycleOk: reachedReady && state === "CLOSED" && reasons.length === 0 && unresolved.length === 0 && lateTails === 0,   // this run's own bookkeeping was clean. NOT a qualification, NOT a pass.
    finalState: state, reachedReady, reasons: [...reasons], unresolved: [...unresolved], lateTails,
    ownership: server ? (ownedPid ? "server-handle-and-pid" : "server-handle-only") : "none",
    ownedPid, forced, descendants,
    records: { shapeChecked: true, shapeOk, evidenceBound: false, executableHashScope: "launcher-file-only" },
    timeouts: { ...T }, transitions: transitions.map((x) => ({ ...x })),
  });

  /* Takes a server a start step produced. An unusable handle cannot be closed, so it is unresolved work. */
  const acceptServer = (h) => {
    if (!looksLikeServer(h)) { why("start-handle-invalid"); open("start-handle-invalid"); return false; }
    server = h;
    try { const pid = h.process() && h.process().pid; ownedPid = Number.isInteger(pid) && pid > 1 ? pid : null; } catch (e) { ownedPid = null; }
    return true;
  };
  /* A step that never settles inside closeAll's wait stays ours: if it ever produces something, close it, and record that. It cannot change the state, which is already UNCERTAIN. */
  const tail = (promise, closeFn, killFn, reason) => {
    lateTails++;
    promise.then(async (late) => {
      try {
        let r = await step(() => closeFn(late), T.close);
        if (r.status !== "ok" && killFn) { r = await step(() => killFn(late), T.kill); if (r.status !== "ok") why(r.status === "threw" ? "kill-threw" : "kill-timeout"); }
      } catch (e) { /* nothing more can be shown */ }
      finally { lateTails--; why(reason); }
    }, () => { lateTails--; });
  };

  /* Never rejects. If anything unexpected breaks the close path, record it, make one bounded best-effort attempt on what is owned, and end UNCERTAIN. */
  const closeAll = () => closing || (closing = closeBody().catch(async () => {
    try { why("internal-fault"); } catch (e) { /* the vocabulary is fixed, this cannot fail */ }
    uncertain = true;
    try { if (browser) await step(() => browser.close(), T.close); } catch (e) { /* already uncertain */ }
    try { if (server) { const r = await step(() => server.close(), T.close); if (r.status !== "ok") await step(() => server.kill(), T.kill); } } catch (e) { /* already uncertain */ }
    go("UNCERTAIN");
    return receipt();
  }));
  const closeBody = async () => {
    if (state === "REFUSED") return receipt();   // nothing was ever launched, so there is nothing to close and no state to change
    go("CLOSING");
    // 1. Anything a timed-out step may still produce is waited for, bounded, and then owned.
    if (pendingStart) {
      const p = pendingStart; pendingStart = null;
      const r = await settle(p, T.lateWait);
      if (r.status === "ok") acceptServer(r.value);
      else if (r.status === "timeout") { open("start-unresolved"); why("start-unresolved"); tail(p, (h) => h.close(), (h) => h.kill(), "late-start-adopted"); }
    }
    if (pendingConnect) {
      const p = pendingConnect; pendingConnect = null;
      const r = await settle(p, T.lateWait);
      if (r.status === "ok") browser = r.value;
      else if (r.status === "timeout") { open("connect-unresolved"); why("connect-unresolved"); tail(p, (b) => b.close(), null, "late-connect-adopted"); }
    }
    // 2. Close what is owned, in order. A browser close failure is a failure, never swallowed; the server is still closed.
    if (browser) {
      const r = await step(() => browser.close(), T.close);
      if (r.status === "threw") why("browser-close-threw"); else if (r.status === "timeout") why("browser-close-timeout");
    }
    if (server) {
      const r = await step(() => server.close(), T.close);
      if (r.status !== "ok") {
        why(r.status === "threw" ? "server-close-threw" : "server-close-timeout");
        forced = true;   // escalate only against the handle this launch created
        const k = await step(() => server.kill(), T.kill);
        if (k.status === "threw") why("kill-threw"); else if (k.status === "timeout") why("kill-timeout");
      }
      let seen = exitedNow(server);
      for (let waited = 0; !seen && waited < T.exitObserve; waited += 10) { await sleep(10); seen = exitedNow(server); }
      if (!seen) { why("exit-unobserved"); uncertain = true; }
      else if (typeof deps.verifyNoDescendants === "function") {
        const d = await step(() => deps.verifyNoDescendants(ownedPid), T.close);
        if (d.status === "ok" && d.value === "none-observed") descendants = "none-observed";
        else if (d.status === "ok" && d.value === "remaining") { descendants = "remaining"; why("descendants-remaining"); }
      }
    } else if (!launchAttempted) descendants = "not-applicable";   // launch was never called, so there is nothing that could remain
    const endAt = nowMs();   // read once, BEFORE the final state is chosen, so a clock fault is in the reasons when the state is decided and there is no second read after it
    const bad = uncertain || reasons.some((r) => ["kill-timeout", "kill-threw", "exit-unobserved", "descendants-remaining"].includes(r));
    go(bad ? "UNCERTAIN" : reasons.length ? "FAILED" : "CLOSED", endAt);
    return receipt();
  };

  const refuse = (r) => { why(r); go("REFUSED"); return { ready: false, browser: null, receipt: receipt() }; };
  const finish = async (r) => { if (r) why(r); const rc = await closeAll(); return { ready: false, browser: null, receipt: rc }; };
  /* Freshness is rechecked wherever a later step could outlive the record. A broken clock is not fresh. */
  const stale = () => { const now = nowMs(); if (clockFault) return "clock-fault"; const q = checkRecordShape({ prerequisites, attestation, now }); return q.length ? q[0] : null; };

  async function run() {
    if (closing) return { ready: false, browser: null, receipt: await closing };   // closed before start: launch is never called
    go("PREFLIGHT");
    if (launchOptions !== undefined) return refuse("launch-options-refused");
    if (clockFault) return refuse("clock-fault");
    const q = checkRecordShape({ prerequisites, attestation, now: nowMs() });
    if (clockFault) return refuse("clock-fault");
    if (q.length) { for (const r of q) why(r); go("REFUSED"); return { ready: false, browser: null, receipt: receipt() }; }
    shapeOk = true;
    // Machine probes: what is installed must be what the record names. This does not verify the record's evidence.
    const exeP = prerequisites.webkitExecutable;
    const probe = await step(async () => ({ exe: await deps.executablePath(), ver: await deps.playwrightVersion(), real: await deps.realPath(exeP) }), T.preflight);
    if (probe.status !== "ok") return refuse("probe-failed");
    if (probe.value.real !== exeP) return refuse("path-not-canonical");   // a symlink or relative hop would make the hash describe a different file than the one launched
    if (probe.value.exe !== exeP) return refuse("executable-mismatch");
    if (probe.value.ver !== prerequisites.playwrightVersion) return refuse("version-mismatch");
    const sha = await step(() => deps.hashFile(exeP), T.preflight);
    if (sha.status !== "ok") return refuse("probe-failed");
    if (sha.value !== prerequisites.webkitExecutableSha256) return refuse("hash-mismatch");
    if (intent !== null) return finish(null);

    go("STARTING");
    launchAttempted = true;
    const launching = Promise.resolve().then(() => deps.launchServer({ executablePath: exeP, headless: true, timeout: T.start }));
    const s = await settle(launching, T.start + T.startGrace);
    if (s.status === "timeout") { pendingStart = launching; return finish("start-timeout"); }   // closeAll waits for it, bounded, and owns whatever it produces
    if (s.status === "threw") return finish("start-threw");
    if (!acceptServer(s.value)) return finish(null);
    let ws; try { ws = server.wsEndpoint(); } catch (e) { ws = null; }
    if (typeof ws !== "string" || !LOOPBACK_WS.test(ws)) return finish("start-handle-invalid");
    if (intent !== null) return finish(null);
    { const st = stale(); if (st) return finish(st); }

    go("CONNECTING");
    const connecting = Promise.resolve().then(() => deps.connect(ws, { timeout: T.connect }));
    const c = await settle(connecting, T.connect + T.startGrace);
    if (c.status === "timeout") { pendingConnect = connecting; return finish("connect-timeout"); }
    if (c.status === "threw") return finish("connect-threw");
    browser = c.value;
    if (intent !== null) return finish(null);

    go("HEALTH");
    const hl = await step(() => browser && browser.isConnected() === true && typeof browser.version() === "string" && browser.version().length > 0, T.health);
    if (hl.status !== "ok" || hl.value !== true) return finish("health-failed");
    if (intent !== null) return finish(null);
    { const st = stale(); if (st) return finish(st); }
    reachedReady = true; go("READY");   // no await between the last check and here: a stop after this sees READY and closes through closeAll
    return { ready: true, browser, receipt: receipt() };
  }
  /* start() never rejects: an unexpected fault in the run is recorded and routed through the same close path. */
  const runSafe = () => run().catch(() => { try { why("internal-fault"); } catch (e) { /* fixed vocabulary */ } return finish(null); });

  /* close() and cancel(): one terminal path. Before READY they record why the run is not a pass, let the run's current step settle (it sees the intent and cleans up), then run the single shared close. */
  const stop = (kind) => {
    if (!closing && state !== "REFUSED") {
      if (kind === "cancel") { if (intent === null) intent = "cancelled"; why("cancelled"); }
      else if (state !== "READY" && intent === null) { intent = state === "IDLE" ? "closed-before-start" : "closed-before-ready"; why(intent); }
    }
    return started ? started.then(() => closeAll(), () => closeAll()) : closeAll();
  };

  return {
    start: () => started || (started = runSafe()),   // one run; a second call returns the same result and changes nothing
    close: () => stop("close"),
    cancel: () => stop("cancel"),
    receipt, state: () => state,
  };
}

/* Lifecycle only: true unless the run reached READY and then closed with nothing wrong and nothing unresolved. A caller that wants a WebKit result must NOT use this. */
export const lifecycleFailed = (r) => !(r && r.lifecycleOk === true && r.reachedReady === true && r.finalState === "CLOSED" && Array.isArray(r.reasons) && r.reasons.length === 0 && Array.isArray(r.unresolved) && r.unresolved.length === 0 && r.lateTails === 0);
/* The failure semantics an integration must use: anything short of an explicit qualifying receipt (and a clean lifecycle) is a failure. Today no receipt can qualify, so this is always true. */
export const webkitRunFailed = (r) => !(r && r.qualifying === true && r.verdict === "QUALIFIED" && !lifecycleFailed(r));
