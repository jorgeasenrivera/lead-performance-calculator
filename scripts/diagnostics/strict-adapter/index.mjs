/* Test-only Playwright adapter for scripts/feel.mjs. Lives OUTSIDE the repository. Diagnostic, local, unpinned: it is not a qualification and not a release path.
 *
 * What it does. scripts/feel.mjs loads Playwright from FEEL_PLAYWRIGHT (a directory with index.mjs) and calls pw.chromium.launch(options), then b.newContext(...), ctx.route(...),
 * ctx.newPage(), b.close(). This module answers those calls with a browser launched through the repository's strict kit (scripts/strict-browser-kit.mjs launchStrict): the browser
 * server runs as an existing unprivileged user, the sandbox is on, bypass arguments are rejected, and every renderer is audited from the kernel. feel.mjs is NOT modified.
 *
 * What it refuses (fail closed, never ignored):
 *  - any launch option other than {} or { executablePath } equal to the strict kit's own resolved executable;
 *  - webkit (there is no strict WebKit launcher; it never falls back to Chromium);
 *  - page.route / page.routeWebSocket / context.routeWebSocket from the caller (feel.mjs uses only ctx.route; anything else is unsupported here).
 * What it guards. Every request and every WebSocket must be to an exact loopback origin in ADAPTER_ORIGINS. WebSocket policy: ws://127.0.0.1:<port> for the listed ports only is passed
 * through and recorded; any other socket is closed with 1008 and counted as a refusal, which fails the run. Service workers are blocked (context option serviceWorkers "block"), because
 * their fetches bypass context routes; this is a recorded deviation from the hosted check. Caller routes (feel's latency route) are wrapped so the origin check runs
 * BEFORE the caller's handler; a base guard covers requests no caller route matches. Loopback WebSockets pass through and are recorded; anything else is closed and recorded.
 * What it proves or fails. Renderer audits (kit auditRenderers, which asserts) run after the first page load and before close. A failed audit, zero successful audits, a refused
 * non-loopback request, a close that did not finish, or a bad kit all make the process exit non-zero even if feel.mjs itself would exit 0.
 * What it records (ADAPTER_OUT/adapter-evidence.json, written synchronously at exit): versions and sandbox evidence from the kit, audits, request/WebSocket counts and refusals,
 * and, only when ADAPTER_HOOK=1, an OBSERVATION of the page: every sage-jump-phase event (with the JavaScript stack for "off"), the Login props recoveryGeneration/resetting/linkFailed/
 * interrupted read from the React fiber of .signin-over, whether .signin-over is mounted, pageshow/pagehide with persisted, and the paths (no query, no body, no headers) of auth requests.
 * Observation changes no application source and sends nothing but those fields. It never reads an environment variable other than ADAPTER_*, STRICT_*, FEEL_* names listed below.
 *
 * Environment (all required unless noted):
 *   ADAPTER_KIT          absolute path of scripts/strict-browser-kit.mjs from the tree under test
 *   ADAPTER_KIT_SHA256   its expected sha256 (a mismatch is a failure)
 *   ADAPTER_OUT          absolute path of a NEW or empty directory for the evidence
 *   ADAPTER_LABEL        short label, letters digits and hyphens (main, head, ...)
 *   ADAPTER_ORIGINS      comma list of exact origins, default http://127.0.0.1:5433,http://127.0.0.1:5178
 *   ADAPTER_HOOK         "1" to observe, "0" (default) for none
 *   ADAPTER_REQUIRE_PINS "1" (hosted): pass the kit's pinsFromEnv() at launch; needs STRICT_REQUIRE_PINS=1 and the STRICT_EXPECT_* pins. Unset: unpinned as in delta 5.
 *   ADAPTER_REGISTER_EXIT  "0" only for the unit self-test
 *   STRICT_BROWSER_DRIVER  absolute path of the Playwright package directory; STRICT_BROWSER_RUN_AS  existing unprivileged user (a root session requires it)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const state = { label: null, out: null, kitSha: null, evidence: null, options: null, audits: [], auditFailed: false, closeInfo: null, requests: { total: 0, byOrigin: {} }, refused: [], websockets: [], authPaths: [], obs: [], obsDropped: 0, errors: [], hook: false, launched: false, closing: null, serverPid: null, contextOptionsAdded: [], evidenceFailed: false, finalAuditOk: false, shutdownUnverifiable: false };
const LIMITS = { obs: 500, refused: 50, ws: 50, auth: 100, stack: 4000 };
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
/* A deadline that REJECTS. A resolving sleep would let a timed-out step look like success. The timer is referenced on purpose: it must be able to fire even when nothing else keeps the loop alive. */
const withDeadline = (p, ms, what) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(what + " timed out")), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });
const deadlineMs = (name, fallback) => { const v = Number(process.env[name]); return Number.isInteger(v) && v >= 50 && v <= 60000 ? v : fallback; };
const note = (msg) => { if (state.errors.length < 50) state.errors.push(String(msg).slice(0, 300)); };

const shutdownClean = (sh) => !!sh && sh.browserPidGone === true && Array.isArray(sh.remainingChildren) && sh.remainingChildren.length === 0;
/* Read-only /proc metadata: is the browser pid gone, and which direct children of THIS process remain (pid and name only). */
function shutdownEvidence(browserPid) {
  let browserPidGone = true;
  if (Number.isInteger(browserPid) && browserPid > 1) { try { process.kill(browserPid, 0); browserPidGone = false; } catch (e) { browserPidGone = e && e.code === "ESRCH"; } }
  const remainingChildren = [];
  const PROC = process.env.ADAPTER_PROC_ROOT && path.isAbsolute(process.env.ADAPTER_PROC_ROOT) ? process.env.ADAPTER_PROC_ROOT : "/proc";   // overridable only for the self-test
  try {
    for (const d of fs.readdirSync(PROC)) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const st = fs.readFileSync(PROC + "/" + d + "/status", "utf8");
        const ppid = Number((st.match(/^PPid:\s*(\d+)/m) || [])[1]);
        const stateCode = ((st.match(/^State:\s*(\S)/m) || [])[1]) || "";
        if (ppid === process.pid && stateCode !== "Z") remainingChildren.push({ pid: Number(d), name: ((st.match(/^Name:\s*(.*)$/m) || [])[1] || "").slice(0, 20) });
      } catch (e) { /* the process ended while being read */ }
    }
  } catch (e) { return { browserPidGone, remainingChildren: null }; }
  return { browserPidGone, remainingChildren };
}

export function adapterStatus() {
  const okAudits = state.audits.filter((a) => a.ok).length;
  const reasons = [];
  if (!state.launched) reasons.push("never launched");
  if (state.auditFailed) reasons.push("a renderer audit failed");
  if (state.launched && okAudits === 0) reasons.push("zero successful renderer audits");
  if (state.refused.length) reasons.push("a non-loopback request or socket was refused");
  if (state.launched && (!state.closeInfo || !state.closeInfo.ok)) reasons.push(state.closeInfo ? "close did not finish cleanly" : "close never completed (missing final audit and close)");
  if (state.launched && !state.finalAuditOk) reasons.push("no completed final renderer audit");
  if (state.evidenceFailed) reasons.push("evidence could not be written");
  if (state.shutdownUnverifiable) reasons.push("shutdown could not be verified");
  if (state.errors.length) reasons.push("adapter errors were recorded");
  return { bad: reasons.length > 0, reasons, okAudits };
}
function writeEvidence() {
  if (!state.out) return;
  try {
    const s = adapterStatus();
    fs.writeFileSync(path.join(state.out, "adapter-evidence.json"), JSON.stringify({ label: state.label, kitSha256: state.kitSha, hook: state.hook, pinsRequired: state.pinsRequired === true, options: state.options, status: s, audits: state.audits, evidence: state.evidence, contextOptionsAdded: state.contextOptionsAdded, requests: state.requests, refused: state.refused, websockets: state.websockets, authPaths: state.authPaths, observation: state.obs, observationDropped: state.obsDropped, closeInfo: state.closeInfo, errors: state.errors }, null, 2) + "\n");
  } catch (e) { state.evidenceFailed = true; note("evidence write failed"); try { process.stderr.write("adapter: evidence could not be written\n"); } catch (e2) {} }   // latched: the run is bad and exits non-zero
}

/* The page-side observer. A string, so it is exactly what the evidence says it is. Reads only; posts only the fields named above. */
const OBSERVER = `(() => {
  if (window.top !== window) return;
  const t0 = performance.now();
  const post = (r) => { try { window.__adapterNote(Object.assign({ t: Math.round(performance.now() - t0), path: location.pathname }, r)); } catch (e) {} };
  const proto = EventTarget.prototype, orig = proto.dispatchEvent;
  proto.dispatchEvent = function (ev) {
    try { if (ev && ev.type === "sage-jump-phase") post({ k: "phase", detail: String(ev.detail).slice(0, 16), stack: ev.detail === "off" ? String(new Error().stack).slice(0, ${LIMITS.stack}) : undefined }); } catch (e) {}
    return orig.call(this, ev);
  };
  for (const name of ["pageshow", "pagehide"]) window.addEventListener(name, (e) => post({ k: name, persisted: !!e.persisted }), true);
  /* Receiver for the diagnostic artifact's inserted calls (make-probe-dist.py). Booleans and one fixed-enum word only; anything else is dropped here and again on the Node side. */
  const STATUS = new Set(["idle", "pending", "ready", "failed", "interrupted", "n/a"]);
  let lastRoot = "";
  window.__rootProbe = (what, v) => {
    try {
      if (what !== "layer" && what !== "subjectChanged") return;
      const rec = { k: "root", what };
      if (what === "layer") {
        rec.configPresent = v.configPresent === true; rec.authReady = v.authReady === true; rec.jumpHold = v.jumpHold === true; rec.hasSession = v.hasSession === true;
        rec.recStatus = STATUS.has(v.recStatus) ? v.recStatus : "other";
        const sig = JSON.stringify(rec); if (sig === lastRoot) return; lastRoot = sig;
      }
      post(rec);
    } catch (e) {}
  };
  let last = "";
  setInterval(() => {
    try {
      const el = document.querySelector(".signin-over");
      let rec = { k: "layer", present: !!el };
      if (el) {
        const key = Object.keys(el).find((x) => x.startsWith("__reactFiber$"));
        let f = key ? el[key] : null, props = null;
        for (let i = 0; f && i < 12; i++, f = f.child) { const p = f.memoizedProps; if (p && typeof p === "object" && "recoveryGeneration" in p) { props = p; break; } }
        if (props) rec = { k: "layer", present: true, gen: props.recoveryGeneration, resetting: !!props.resetting, linkFailed: !!props.linkFailed, interrupted: !!props.interrupted };
      }
      const s = JSON.stringify(rec);
      if (s !== last) { last = s; post(rec); }
    } catch (e) {}
  }, 25);
})();`;

/* Observation records: a fixed set of keys, each with a fixed type. Strings are length-capped, recStatus and what are enums, numbers must be finite, booleans must be booleans. Unknown keys are dropped. */
const OBS_STRINGS = { k: 16, path: 200, detail: 16, stack: LIMITS.stack };
const OBS_ENUMS = { what: new Set(["layer", "subjectChanged"]), recStatus: new Set(["idle", "pending", "ready", "failed", "interrupted", "n/a", "other"]) };
const OBS_NUMBERS = ["t", "gen"];
const OBS_BOOLS = ["persisted", "present", "resetting", "linkFailed", "interrupted", "configPresent", "authReady", "jumpHold", "hasSession"];
export function sanitize(rec) {
  const keep = {};
  for (const [k, max] of Object.entries(OBS_STRINGS)) if (typeof rec[k] === "string") keep[k] = rec[k].slice(0, max);
  for (const [k, set] of Object.entries(OBS_ENUMS)) if (typeof rec[k] === "string" && set.has(rec[k])) keep[k] = rec[k];
  for (const k of OBS_NUMBERS) if (typeof rec[k] === "number" && Number.isFinite(rec[k])) keep[k] = rec[k];
  for (const k of OBS_BOOLS) if (typeof rec[k] === "boolean") keep[k] = rec[k];
  return keep;
}

const loopback = /^http:\/\/127\.0\.0\.1:\d+$/;
function configure() {
  const need = (name) => { const v = process.env[name]; if (!v) throw new Error("adapter: " + name + " is required"); return v; };
  const kit = need("ADAPTER_KIT"), kitSha = need("ADAPTER_KIT_SHA256"), out = need("ADAPTER_OUT"), label = need("ADAPTER_LABEL");
  if (!path.isAbsolute(kit) || !path.isAbsolute(out)) throw new Error("adapter: ADAPTER_KIT and ADAPTER_OUT must be absolute");
  if (!/^[A-Za-z0-9-]{1,40}$/.test(label)) throw new Error("adapter: ADAPTER_LABEL must be letters, digits and hyphens");
  const origins = (process.env.ADAPTER_ORIGINS || "http://127.0.0.1:5433,http://127.0.0.1:5178").split(",");
  if (!origins.length || !origins.every((o) => loopback.test(o))) throw new Error("adapter: ADAPTER_ORIGINS must be exact http://127.0.0.1:<port> origins");
  const bytes = fs.readFileSync(kit);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== kitSha) throw new Error("adapter: the strict kit does not match its expected sha256");
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error("adapter: ADAPTER_OUT must be new or empty");
  fs.mkdirSync(out, { recursive: true });
  return { kit, sha, out, label, origins: new Set(origins), hook: process.env.ADAPTER_HOOK === "1" };
}

function allowedUrl(url, origins) {
  if (/^(data:|blob:|about:blank)/.test(url)) return true;
  try { const u = new URL(url); const scheme = u.protocol === "ws:" ? "http:" : u.protocol === "wss:" ? "https:" : u.protocol; return origins.has(scheme + "//" + u.host); } catch (e) { return false; }
}

async function launch(options) {
  if (state.launched) throw new Error("adapter: one launch per process");
  const cfg = configure();
  state.label = cfg.label; state.out = cfg.out; state.kitSha = cfg.sha; state.hook = cfg.hook; state.options = options === undefined ? null : Object.keys(options || {}).sort();
  const driver = process.env.STRICT_BROWSER_DRIVER;
  if (!driver || !path.isAbsolute(driver)) throw new Error("adapter: STRICT_BROWSER_DRIVER must be an absolute package directory");
  /* Launch options: preserve or reject, never ignore. */
  if (options !== undefined && options !== null) {
    if (typeof options !== "object" || Array.isArray(options) || Object.getPrototypeOf(options) !== Object.prototype) throw new Error("adapter: launch options must be a plain object");
    for (const key of Object.keys(options)) if (key !== "executablePath") throw new Error("adapter: unsupported launch option " + JSON.stringify(key.slice(0, 40)) + " (only executablePath equal to the strict kit's executable is accepted)");
    if (options.executablePath !== undefined) {
      let same = false;
      try { const expected = createRequire(path.join(driver, "package.json"))(driver).chromium.executablePath(); same = typeof options.executablePath === "string" && fs.realpathSync(options.executablePath) === fs.realpathSync(expected); } catch (e) { same = false; }
      if (!same) throw new Error("adapter: executablePath is not the strict kit's executable");
    }
  }
  const kit = await import(pathToFileURL(cfg.kit).href);
  /* Hosted runs: the reviewed pins go to the kit AT LAUNCH, so a different Playwright or Chrome, or a missing pin, fails before any page exists (delta 6).
     ADAPTER_REQUIRE_PINS=1 requires STRICT_REQUIRE_PINS=1 and uses the kit's own pinsFromEnv(). Unset, nothing changes: local and unpinned, as before. */
  let expect = {};
  if (process.env.ADAPTER_REQUIRE_PINS === "1") {
    if (process.env.STRICT_REQUIRE_PINS !== "1") throw new Error("adapter: ADAPTER_REQUIRE_PINS=1 needs STRICT_REQUIRE_PINS=1");
    expect = kit.pinsFromEnv();
  }
  state.pinsRequired = process.env.ADAPTER_REQUIRE_PINS === "1";
  const s = await kit.launchStrict({ driver, expect });
  state.launched = true;
  state.evidence = s.evidence;
  state.serverPid = s.evidence && s.evidence.browserProcess && s.evidence.browserProcess.pid;
  if (!s.evidence || !s.evidence.runAs || !(s.evidence.runAs.uid > 0)) { await s.close().catch(() => {}); throw new Error("adapter: the browser is not running as an unprivileged user"); }
  if (!Array.isArray(s.evidence.cdpArgv) || s.evidence.cdpArgv.some((a) => /^--(?:no-sandbox|disable-.*sandbox|single-process|no-zygote)/.test(a))) { await s.close().catch(() => {}); throw new Error("adapter: a sandbox bypass argument is present"); }

  const browser = s.browser;
  let firstLoadAudit = false;
  const audit = (label) => {
    const p = (async () => {
      try { const r = await s.auditRenderers(); state.audits.push({ label, ok: true, renderers: r.map((x) => ({ pid: x.pid, Seccomp: x.Seccomp, NoNewPrivs: x.NoNewPrivs, CapEff: x.CapEff, NSpid: x.NSpid })) }); }
      catch (e) { state.auditFailed = true; state.audits.push({ label, ok: false, error: String(e && e.message || e).slice(0, 300) }); }
    })();
    return p;
  };
  const pendingAudits = new Set();
  const trackedAudit = (label) => { const p = audit(label); pendingAudits.add(p); p.finally(() => pendingAudits.delete(p)); return p; };

  const origNewContext = browser.newContext.bind(browser);
  const wrappedNewContext = async (contextOptions) => {
    /* Context options are passed through unchanged, with ONE addition: serviceWorkers "block". A service worker's own fetches are not seen by context routes, so it could reach
       outside the loopback allowlist unobserved; blocking it is a deliberate, recorded deviation from the hosted check. A caller that asks for any other value is refused. */
    const base = contextOptions === undefined || contextOptions === null ? {} : contextOptions;
    if (typeof base !== "object" || Array.isArray(base)) throw new Error("adapter: context options must be an object");
    if (base.serviceWorkers !== undefined && base.serviceWorkers !== "block") throw new Error("adapter: serviceWorkers other than block is not supported");
    if (state.contextOptionsAdded.length === 0) state.contextOptionsAdded.push("serviceWorkers=block");
    const ctx = await origNewContext({ ...base, serviceWorkers: "block" });
    const origRoute = ctx.route.bind(ctx), origRouteWS = ctx.routeWebSocket.bind(ctx);
    const refuse = (kind, url) => { if (state.refused.length < LIMITS.refused) { let o = "unparseable"; try { o = new URL(url).origin; } catch (e) {} state.refused.push({ kind, origin: o }); } };
    await origRoute("**/*", (route) => { const url = route.request().url(); if (allowedUrl(url, cfg.origins)) return route.fallback(); refuse("request", url); return route.abort("blockedbyclient"); });
    await origRouteWS(/.*/, (ws) => {
      const url = ws.url();
      if (allowedUrl(url, cfg.origins)) { if (state.websockets.length < LIMITS.ws) { let o = ""; try { o = new URL(url).origin; } catch (e) {} state.websockets.push({ origin: o, passedThrough: true }); } ws.connectToServer(); }
      else { refuse("websocket", url); ws.close({ code: 1008, reason: "refused by the harness" }); }
    });
    /* Caller routes run only for allowed origins. */
    ctx.route = (url, handler, routeOptions) => origRoute(url, (route, request) => { const u = request.url(); if (allowedUrl(u, cfg.origins)) return handler(route, request); refuse("request", u); return route.abort("blockedbyclient"); }, routeOptions);
    ctx.routeWebSocket = () => { throw new Error("adapter: context.routeWebSocket is not supported"); };
    const origNewPage = ctx.newPage.bind(ctx);
    ctx.newPage = async (...args) => {
      const page = await origNewPage(...args);
      page.route = () => { throw new Error("adapter: page.route is not supported"); };
      page.routeWebSocket = () => { throw new Error("adapter: page.routeWebSocket is not supported"); };
      if (!firstLoadAudit) { firstLoadAudit = true; page.once("load", () => { trackedAudit("first-load"); }); }
      return page;
    };
    ctx.on("request", (r) => {
      state.requests.total++;
      let o = "unparseable", p = "";
      try { const u = new URL(r.url()); o = u.origin; p = u.pathname; } catch (e) {}
      state.requests.byOrigin[o] = (state.requests.byOrigin[o] || 0) + 1;
      if (/^\/auth\/v1\//.test(p) && state.authPaths.length < LIMITS.auth) state.authPaths.push({ method: r.method(), path: p });
    });
    if (cfg.hook) {
      await ctx.exposeBinding("__adapterNote", (_src, rec) => {
        if (state.obs.length >= LIMITS.obs) { state.obsDropped++; return; }
        if (rec && typeof rec === "object") state.obs.push(sanitize(rec));
      });
      await ctx.addInitScript(OBSERVER);
    }
    return ctx;
  };
  const unsupportedNewPage = () => { throw new Error("adapter: browser.newPage is not supported (feel.mjs uses newContext)"); };

  /* One close, once, bounded. */
  const closeAll = () => {
    /* A repeated or concurrent caller close (feel.mjs's own b.close(), or a "disconnected" handler such as lostBrowserWatch calling it while the kit close is running) gets the EXISTING promise,
       never a failure and never a second close. The underlying browser is untouched, so the kit's close reaches the original close exactly once. */
    if (!state.closing) {
      state.closing = (async () => {
        const auditMs = deadlineMs("ADAPTER_AUDIT_DEADLINE_MS", 8000), closeMs = deadlineMs("ADAPTER_CLOSE_DEADLINE_MS", 12000);
        let finalAudit = false, closed = false;
        /* Earlier audits must have completed, and a FINAL audit must complete ok before the browser is closed. A timeout is a failure, not a pass. */
        try { await withDeadline(Promise.all([...pendingAudits]), auditMs, "earlier audit"); } catch (e) { state.auditFailed = true; state.audits.push({ label: "earlier", ok: false, error: "timed out" }); note("earlier audit: " + e.message); }
        try {
          const before = state.audits.length;
          await withDeadline(trackedAudit("final"), auditMs, "final audit");
          const last = state.audits[state.audits.length - 1];
          finalAudit = state.audits.length > before && !!last && last.label === "final" && last.ok === true;
          if (!finalAudit) note("final audit did not pass");
        } catch (e) { state.auditFailed = true; state.audits.push({ label: "final", ok: false, error: "timed out" }); note("final audit: " + e.message); }
        state.finalAuditOk = finalAudit;
        let shutdown = { browserPidGone: null, remainingChildren: null };
        try { await withDeadline(s.close(), closeMs, "close"); closed = true; } catch (e) { note("close: " + e.message); try { if (Number.isInteger(state.serverPid) && state.serverPid > 1) process.kill(state.serverPid, "SIGKILL"); } catch (e2) {} }
        if (closed) {
          /* Clean shutdown is evidence, not an assumption: the browser pid is gone and this process has no child left. Evidence that cannot be read is a FAILURE (latched), never an exception. */
          try {
            for (let i = 0; i < 30; i++) { shutdown = shutdownEvidence(state.serverPid); if (shutdownClean(shutdown)) break; if (!Array.isArray(shutdown.remainingChildren)) break; await new Promise((r) => setTimeout(r, 100)); }   /* referenced: the loop must stay alive while the shutdown is checked */
          } catch (e) { shutdown = { browserPidGone: null, remainingChildren: null }; }
          if (!Array.isArray(shutdown.remainingChildren) || typeof shutdown.browserPidGone !== "boolean") { state.shutdownUnverifiable = true; note("shutdown could not be verified"); }
          else if (!shutdownClean(shutdown)) note("shutdown not clean");
        }
        state.closeInfo = { ok: finalAudit && closed && shutdownClean(shutdown), finalAudit, closed, shutdown };
        writeEvidence();
      })();
    }
    return state.closing;
  };
  /* The caller gets a FACADE. The kit's own `close()` calls `browser.close()` on the ORIGINAL object (strict-browser-kit.mjs, "const close = async () => { await browser.close(); ... }"), so the
     original object must stay untouched: if its close were replaced by closeAll, the kit's close would await closeAll from inside closeAll and wait on itself until the deadline. The facade
     answers close/newContext/newPage itself and forwards everything else to the original object with the original as `this`. It cannot be written to. */
  const facade = new Proxy(browser, {
    get(target, prop) {
      if (prop === "close") return () => closeAll();
      if (prop === "newContext") return wrappedNewContext;
      if (prop === "newPage") return unsupportedNewPage;
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
    set() { return false; },
    defineProperty() { return false; },
    deleteProperty() { return false; },
  });
  if (process.env.ADAPTER_REGISTER_EXIT !== "0") {
    process.on("exit", (code) => { writeEvidence(); if (adapterStatus().bad && !code) process.exitCode = 1; });
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { closeAll().finally(() => process.exit(sig === "SIGINT" ? 130 : 143)); });
  }
  writeEvidence();
  return facade;
}

export const chromium = { launch };
export const webkit = { launch() { throw new Error("adapter: WebKit has no strict launcher here and never falls back to Chromium"); } };
export const _state = state;
