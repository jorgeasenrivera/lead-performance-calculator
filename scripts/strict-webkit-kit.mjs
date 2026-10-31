/* WebKit qualification plumbing: a dependency-injected launcher and lifecycle state machine. CANDIDATE, NOT ENABLED.
 *
 * Base: PR 501 head 23dbdb7d84c8ec328a7fb6056dabad34e2ebeeef. Nothing imports this file. scripts/ci-fixture.sh still refuses WebKit (exit 5) and stays that way until an independent
 * review and a real sandbox proof exist. This file is the shape that proof has to fit, not the proof.
 *
 * Rules that are never relaxed here:
 *  - The real WebKit launch API is only ever called after BOTH an external prerequisites record and an external sandbox attestation say VERIFIED, are complete, are current, and
 *    match what is actually on the machine (executable path, its sha256, the Playwright version). Anything missing refuses before any launch call.
 *  - Callers cannot pass launch options. The only options are executablePath (from the verified record), headless and a timeout. No flags are guessed for WebKit.
 *  - Every wait is bounded. A start or connect that outlives its bound is never trusted to have failed: if it resolves later, the late handle is adopted and closed.
 *  - Close is single-flight. Cancel and close share it. A close that throws or hangs is a failure and is never swallowed.
 *  - An exit that was not observed is a failure (UNCERTAIN), never a pass. Nothing is killed by name, pattern or guessed pid: only the handle this launch created.
 *  - A receipt carries only closed-vocabulary reason codes, state names, booleans, numbers and hashes. No error text, no paths, no environment.
 *  - A run with mocked dependencies can never be qualifying: only dependencies built by realWebkitDeps() (registered in a module-private set) can be.
 *
 * What this file does NOT prove (runtime gaps, on purpose): that WebKit is sandboxed on any runner, how many processes WebKit starts, whether a descendant survives close,
 * that Playwright's WebKit launchServer/connect behave as assumed on the runner, and that the signal handlers Playwright installs by default are acceptable. Descendants are
 * reported "unproven" unless an externally supplied verifyNoDescendants says otherwise, and the real binding supplies none.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export const RECEIPT_VERSION = 1;
export const STATES = Object.freeze(["IDLE", "PREFLIGHT", "REFUSED", "STARTING", "CONNECTING", "HEALTH", "READY", "CLOSING", "CLOSED", "FAILED", "UNCERTAIN"]);
export const REASONS = Object.freeze([
  "launch-options-refused",
  "prerequisites-missing", "prerequisites-not-verified", "prerequisites-invalid",
  "attestation-missing", "attestation-not-verified", "attestation-invalid", "attestation-expired", "attestation-synthetic",
  "executable-mismatch", "version-mismatch", "hash-mismatch", "probe-failed",
  "start-threw", "start-timeout", "start-handle-invalid", "late-start-adopted",
  "connect-threw", "connect-timeout", "late-connect-adopted", "health-failed",
  "cancelled", "browser-close-threw", "browser-close-timeout", "server-close-threw", "server-close-timeout",
  "kill-threw", "kill-timeout", "exit-unobserved", "descendants-remaining", "adoption-pending",
]);
export const GAPS = Object.freeze(["synthetic-dependencies", "descendants-unproven", "run-not-clean"]);

const HEX64 = /^[0-9a-f]{64}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LOOPBACK_WS = /^ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+(?:\/|$)/;
const isoMs = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s) ? Date.parse(s) : NaN);

/* ---- the qualification contract (pure) ---- */

/* `prerequisites` and `attestation` come from OUTSIDE this repository's tests (a reviewed record from the sandbox lane). Returns closed-vocabulary refusal reasons; an empty list means
   the records are complete, VERIFIED and current. It does not look at the machine: that is probeMachine below. */
export function checkQualification({ prerequisites, attestation, now }) {
  const out = [];
  const p = prerequisites, a = attestation;
  if (p == null || typeof p !== "object") out.push("prerequisites-missing");
  else if (p.status !== "VERIFIED") out.push("prerequisites-not-verified");
  else if (!path.isAbsolute(String(p.webkitExecutable || "")) || !HEX64.test(String(p.webkitExecutableSha256 || "")) || !LABEL.test(String(p.playwrightVersion || "")) || !LABEL.test(String(p.verifiedBy || "")) || !(isoMs(p.verifiedAt) <= now)) out.push("prerequisites-invalid");
  if (a == null || typeof a !== "object") out.push("attestation-missing");
  else if (a.status !== "VERIFIED") out.push("attestation-not-verified");
  else if (a.kind !== "real-sandbox") out.push("attestation-synthetic");   // anything but the one real kind, including "mock", "synthetic", "unit-test"
  else if (a.engine !== "webkit" || !LABEL.test(String(a.sandboxId || "")) || !LABEL.test(String(a.runnerLabel || "")) || !LABEL.test(String(a.attestedBy || "")) || !HEX64.test(String(a.evidenceSha256 || "")) || !(isoMs(a.attestedAt) <= now) || !Number.isFinite(isoMs(a.expiresAt))) out.push("attestation-invalid");
  else if (!(isoMs(a.expiresAt) > now)) out.push("attestation-expired");
  return out;
}

/* ---- bounded waits ---- */
/* Never rejects. A timeout says "not known to have finished", not "stopped": callers that own something must still adopt it if it settles later. */
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

const DEFAULT_TIMEOUTS = Object.freeze({ preflight: 10_000, start: 30_000, startGrace: 5_000, connect: 15_000, health: 5_000, close: 10_000, kill: 8_000, exitObserve: 1_000 });
function resolveTimeouts(t = {}) {
  const out = { ...DEFAULT_TIMEOUTS };
  for (const k of Object.keys(DEFAULT_TIMEOUTS)) if (t[k] !== undefined) { if (!Number.isInteger(t[k]) || t[k] < 1 || t[k] > 600_000) throw new Error("timeouts." + k + " must be an integer from 1 to 600000"); out[k] = t[k]; }
  return out;
}

/* The direct child's exit as Node reports it (ChildProcess.exitCode / signalCode). Unknown when there is no process to read: that is "unobserved", not "exited". */
const exitedNow = (server) => { try { const cp = server.process(); return !!cp && (cp.exitCode !== null && cp.exitCode !== undefined ? true : (cp.signalCode !== null && cp.signalCode !== undefined)); } catch (e) { return false; } };

/* ---- the real binding. Never called by the unit tests. Registering in REAL is what lets a run be qualifying. ---- */
const REAL = new WeakSet();
export function realWebkitDeps({ driverDir }) {
  if (!path.isAbsolute(String(driverDir || ""))) throw new Error("realWebkitDeps needs an absolute driverDir; nothing is resolved implicitly");
  let loaded = null;
  /* Lazy: the Playwright package is not touched until a launch is actually attempted after qualification passed. */
  const load = () => loaded || (loaded = (() => { const req = createRequire(path.join(driverDir, "package.json")); return { webkit: req(driverDir).webkit, version: req(path.join(driverDir, "package.json")).version }; })());
  const deps = Object.freeze({
    now: () => Date.now(),
    playwrightVersion: async () => load().version,
    executablePath: async () => load().webkit.executablePath(),
    hashFile: (file) => new Promise((resolve, reject) => { const h = crypto.createHash("sha256"); fs.createReadStream(file).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex"))); }),
    launchServer: (options) => load().webkit.launchServer(options),
    connect: (ws, options) => load().webkit.connect(ws, options),
    /* verifyNoDescendants is deliberately absent: no process-tree evidence method is reviewed for WebKit, so descendants stay "unproven". */
  });
  REAL.add(deps);
  return deps;
}

/* ---- the kit ---- */
/* deps: { now, playwrightVersion, executablePath, hashFile, launchServer, connect, verifyNoDescendants? } (all async-or-sync).
   Returns { start, close, cancel, receipt, state }. start() resolves { ok, browser, receipt } and does not throw for an expected failure. */
export function createWebkitKit({ deps, prerequisites, attestation, timeouts, launchOptions } = {}) {
  if (!deps || typeof deps.now !== "function") throw new Error("createWebkitKit needs deps");
  const T = resolveTimeouts(timeouts);
  const real = REAL.has(deps);
  const t0 = deps.now();
  const transitions = [], reasons = [], gaps = [];
  let state = "IDLE", started = null, closing = null, cancelRequested = false;
  let server = null, browser = null, ownedPid = null, forced = false, uncertain = false, pendingAdoptions = 0, descendants = "unproven", qualificationOk = false;
  const go = (s) => { state = s; transitions.push({ state: s, atMs: Math.max(0, deps.now() - t0) }); };
  const why = (r) => { if (!REASONS.includes(r)) throw new Error("unknown reason " + r); if (!reasons.includes(r)) reasons.push(r); };

  const receipt = () => {
    const clean = state === "CLOSED" && reasons.length === 0 && pendingAdoptions === 0;
    const g = [];
    if (!real) g.push("synthetic-dependencies");
    if (descendants !== "none-observed") g.push("descendants-unproven");
    if (!clean) g.push("run-not-clean");
    return {
      version: RECEIPT_VERSION,
      evidenceClass: real ? "real-launch" : "synthetic-unit-test",
      qualifying: real && qualificationOk && clean && g.length === 0,   // a claim about this run for the reviewer, never an approval
      ok: clean, finalState: state, reasons: [...reasons], gaps: g,
      ownership: server ? (ownedPid ? "server-handle-and-pid" : "server-handle-only") : "none",
      ownedPid, forced, descendants, pendingAdoptions,
      qualification: { checked: true, passed: qualificationOk },
      timeouts: { ...T }, transitions: transitions.map((x) => ({ ...x })),
    };
  };

  /* A handle that arrives after its bound ran out is still ours: close it (then kill it, for a server) with the same bounds, and record that it happened. If that cannot be shown, the run is UNCERTAIN. */
  const adopt = (promise, closeFn, killFn, reason) => {
    pendingAdoptions++;
    promise.then(async (late) => {
      try {
        let r = await step(() => closeFn(late), T.close);
        if (r.status !== "ok" && killFn) { r = await step(() => killFn(late), T.kill); if (r.status !== "ok") why(r.status === "threw" ? "kill-threw" : "kill-timeout"); }
        if (r.status !== "ok") uncertain = true;
      } catch (e) { uncertain = true; }
      finally { pendingAdoptions--; why(reason); if (uncertain) go("UNCERTAIN"); }
    }, () => { pendingAdoptions--; });
  };

  const closeAll = () => closing || (closing = (async () => {
    go("CLOSING");
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
        descendants = d.status === "ok" && d.value === "none-observed" ? "none-observed" : (d.status === "ok" && d.value === "remaining" ? "remaining" : "unproven");
        if (descendants === "remaining") why("descendants-remaining");
      }
    } else if (!uncertain) descendants = "none-observed";   // nothing was ever started, so there is nothing to remain
    const bad = reasons.some((r) => ["kill-timeout", "kill-threw", "exit-unobserved", "start-timeout", "connect-timeout", "descendants-remaining"].includes(r));
    go(uncertain || bad ? "UNCERTAIN" : reasons.length ? "FAILED" : "CLOSED");
    return receipt();
  })());

  const refuse = (r) => { why(r); go("REFUSED"); return { ok: false, browser: null, receipt: receipt() }; };
  const finish = async (r) => { if (r) why(r); await closeAll(); return { ok: false, browser: null, receipt: receipt() }; };

  async function run() {
    go("PREFLIGHT");
    if (launchOptions !== undefined) return refuse("launch-options-refused");
    const q = checkQualification({ prerequisites, attestation, now: deps.now() });
    if (q.length) { for (const r of q) why(r); go("REFUSED"); return { ok: false, browser: null, receipt: receipt() }; }
    // Machine probes: what is actually installed must be exactly what was verified.
    const probe = await step(async () => ({ exe: await deps.executablePath(), ver: await deps.playwrightVersion() }), T.preflight);
    if (probe.status !== "ok") return refuse("probe-failed");
    if (probe.value.exe !== prerequisites.webkitExecutable) return refuse("executable-mismatch");
    if (probe.value.ver !== prerequisites.playwrightVersion) return refuse("version-mismatch");
    const sha = await step(() => deps.hashFile(prerequisites.webkitExecutable), T.preflight);
    if (sha.status !== "ok") return refuse("probe-failed");
    if (sha.value !== prerequisites.webkitExecutableSha256) return refuse("hash-mismatch");
    qualificationOk = true;
    if (cancelRequested) return finish("cancelled");

    go("STARTING");
    const launching = Promise.resolve().then(() => deps.launchServer({ executablePath: prerequisites.webkitExecutable, headless: true, timeout: T.start }));
    const s = await settle(launching, T.start + T.startGrace);
    if (s.status === "timeout") { adopt(launching, (late) => late.close(), (late) => late.kill(), "late-start-adopted"); uncertain = true; return finish("start-timeout"); }   // nothing owned yet, so nothing can be closed here
    if (s.status === "threw") return finish("start-threw");
    const h = s.value;
    if (!h || typeof h.wsEndpoint !== "function" || typeof h.close !== "function" || typeof h.kill !== "function" || typeof h.process !== "function") { uncertain = true; return finish("start-handle-invalid"); }
    server = h;
    try { const pid = h.process() && h.process().pid; ownedPid = Number.isInteger(pid) && pid > 1 ? pid : null; } catch (e) { ownedPid = null; }
    let ws; try { ws = h.wsEndpoint(); } catch (e) { ws = null; }
    if (typeof ws !== "string" || !LOOPBACK_WS.test(ws)) return finish("start-handle-invalid");
    if (cancelRequested) return finish("cancelled");

    go("CONNECTING");
    const connecting = Promise.resolve().then(() => deps.connect(ws, { timeout: T.connect }));
    const c = await settle(connecting, T.connect + T.startGrace);
    if (c.status === "timeout") { adopt(connecting, (late) => late.close(), null, "late-connect-adopted"); return finish("connect-timeout"); }
    if (c.status === "threw") return finish("connect-threw");
    browser = c.value;
    if (cancelRequested) return finish("cancelled");

    go("HEALTH");
    const hl = await step(() => browser && browser.isConnected() === true && typeof browser.version() === "string" && browser.version().length > 0, T.health);
    if (hl.status !== "ok" || hl.value !== true) return finish("health-failed");
    if (cancelRequested) return finish("cancelled");
    go("READY");
    return { ok: true, browser, receipt: receipt() };
  }

  return {
    start: () => started || (started = run()),   // one run; a second call gets the same result and changes nothing
    close: () => closeAll(),
    cancel: () => { cancelRequested = true; why("cancelled"); return state === "READY" ? closeAll() : (closing || Promise.resolve(receipt())); },
    receipt, state: () => state,
  };
}

/* Same contract as strict-cleanup.cleanupFailed: only a completed, clean, fully accounted run is not a failure. */
export const webkitRunFailed = (r) => !(r && r.ok === true && r.finalState === "CLOSED" && Array.isArray(r.reasons) && r.reasons.length === 0 && r.pendingAdoptions === 0);
