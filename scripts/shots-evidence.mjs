/**
 * What a shots run can say about itself, in a file small and plain enough to
 * keep without reading it twice.
 * -------------------------------------------------------------------------
 * When the phone pictures fail, the log says which stage died and nothing about
 * what the page or the backend was doing. This writes one JSON file that does,
 * and is built so it cannot carry anything it should not: every string is a
 * member of a fixed list or a hash, every number is a bounded count, and no
 * request URL, header, token or response body is ever read into it.
 *
 * Two things it deliberately does not do:
 *   - It never reads a response body in the browser. The shapes in the file
 *     come from the fixture (scripts/shots-fixture.mjs), which generates its
 *     own answers and labels them, so there is nothing to decode and no read
 *     that a timeout could leave running.
 *   - It never probes the page on a run that is passing. The one probe runs in
 *     the failure handler, after the verdict is frozen and before the browser
 *     is closed, with a ceiling, because the run has already failed and
 *     nothing is waiting on it.
 *
 * The file is best effort. A kill, an out-of-memory, an import error before
 * main() or a launch failure before the try will leave no final file; a
 * "started" file with no "final" one after it is itself the evidence of that.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const MAX_BYTES = 16384;
export const MAX_REQUESTS = 64;
const MAX_CLASSES = 16;
const MAX_N = 1_000_000_000;

export const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
export const TABLES = ["app_data", "profiles", "floor_people", "deal_events", "queue_public", "floor_public"];
export const RPC_NAMES = ["sage_audit_append", "sage_audit_read", "sage_config_read", "sage_config_save", "sage_deal_events", "sage_dealer_links",
  "sage_dealer_map", "sage_dealer_unmap", "sage_floor_days", "sage_schedule_publish", "sage_schedule_read", "sage_store_read", "sage_ticket_status", "sage_ticket_submit"];
export const API_ROUTES = ["client-error", "delete-account", "floor-row", "open-room", "register-device", "room-command", "vitals"];
export const SHAPES = ["array-empty", "array-nonempty", "object-value-present", "object-value-null", "object-no-value-key", "null", "scalar", "non-json", "empty-body"];
export const CLASSES = new Set([
  "auth:token", "auth:user", "auth:other", "rest:root", "rpc:other", "api:other", "static", "report", "other",
  ...TABLES.map((t) => "rest:" + t), ...RPC_NAMES.map((n) => "rpc:" + n), ...API_ROUTES.map((r) => "api:" + r),
]);
const TRI = ["yes", "no", "unknown"];
const ERROR_CLASSES = ["none", "timeout", "browser-lost", "assertion", "unexpected-routes", "other"];
const CELLS = ["ordinary", "fixture-legacy", "fixture-compatible", "unknown"];
const FIXTURE_STATES = ["none", "ok", "unreachable", "invalid"];
/* What each set of counts covers, said in the file so nobody has to remember it. The
   browser's counts stop when the verdict is frozen: on a pass that is after the last
   context closed (earlier contexts' closes are inside it); on a failure it is before
   anything is closed. The fixture's report is read after that in both cases, so it is
   a separate and later window, not the same one; whether cleanup had happened by then
   depends on the path: a failure reads it from the catch, before the finally closes the
   browser; a pass reads it after the finally. The label says which. */
const BROWSER_WINDOWS = ["until-last-context-closed", "until-failure", null];
const FIXTURE_WINDOWS = ["until-report-read-before-cleanup", "until-report-read-after-cleanup", null];
const CLOCKS = ["fixed", "system"];
const SEEDS = ["shared", "fresh"];

/* The stage names shots.mjs prints, as a closed set. Anything else is "unknown",
   so a stage added later shows up as unknown rather than leaking a new string. */
const SIGN_IN_STEPS = ["open sign-in", "fill demo sign-in", "submit sign-in", "wait for room bar", "settle arrival", "dismiss welcome"];
const SIZE_STEPS = ["create context", ...SIGN_IN_STEPS, "scroll home", "swipe toward floor", "cancel swipe and open floor", "open phone", "return to floor", "close context"];
const UP_STEPS = ["prepare head of line", "create context", ...SIGN_IN_STEPS, "settle takeover", "close context"];
const SCREENS = ["home", "home-foot", "home-to-floor-mid", "floor", "line"];
export const STAGES = new Set(["starting",
  ...["normal", "large", "largest"].flatMap((t) => [...SIZE_STEPS.map((s) => `${t}: ${s}`), ...SCREENS.map((s) => `capture ${t}-${s}`)]),
  ...UP_STEPS.map((s) => `normal-up: ${s}`), "capture normal-up"]);
export const stageName = (raw) => (STAGES.has(raw) ? raw : "unknown");

const isCount = (n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_N;
const isHex = (s, len) => typeof s === "string" && s.length === len && /^[0-9a-f]+$/.test(s);
const isStatus = (s) => s === 0 || (Number.isInteger(s) && s >= 100 && s <= 599);
const inc = (n) => Math.min(n + 1, MAX_N);

/* A request becomes a method and a class and nothing else. The path is read to
   choose the class and then dropped; the query string is never looked at. */
export function classifyRoute(method, pathname) {
  const m = String(method || "").toUpperCase();
  if (!METHODS.includes(m)) return null;
  const p = String(pathname || "");
  let c = "other";
  let hit;
  if (p === "/auth/v1/token") c = "auth:token";
  else if (p === "/auth/v1/user") c = "auth:user";
  else if (p.startsWith("/auth/v1/")) c = "auth:other";
  else if (p === "/rest/v1/") c = "rest:root";
  else if ((hit = p.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/))) c = RPC_NAMES.includes(hit[1]) ? "rpc:" + hit[1] : "rpc:other";
  else if ((hit = p.match(/^\/rest\/v1\/([a-z_]+)$/))) c = TABLES.includes(hit[1]) ? "rest:" + hit[1] : "other";
  else if ((hit = p.match(/^\/api\/([a-z-]+)$/))) c = API_ROUTES.includes(hit[1]) ? "api:" + hit[1] : "api:other";
  else if (p === "/__fixture/report") c = "report";
  else if (m === "GET" || m === "HEAD") c = "static";
  return { m, c };
}

/* The shape of something the fixture is about to send. It looks at the fixture's
   own value, never at bytes that came back from a browser. */
export function shapeOf(value) {
  if (value === undefined) return "empty-body";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? "array-nonempty" : "array-empty";
  if (typeof value === "object") {
    if (!Object.hasOwn(value, "value")) return "object-no-value-key";
    return value.value === null ? "object-value-null" : "object-value-present";
  }
  return "scalar";
}

/* Counts by (method, class, status). One status per entry would hide a route
   that answered 200 three times and 501 once, so the status is part of the key.
   What cannot be represented is counted in `dropped`, never lost silently. */
export function createRecorder() {
  const map = new Map();
  let dropped = 0, frozen = false, snap = null;
  return {
    observe(method, pathname, status) {
      if (frozen) return;
      const r = classifyRoute(method, pathname);
      if (!r || !isStatus(status)) { dropped = inc(dropped); return; }
      const k = `${r.m} ${r.c} ${status}`;
      if (map.has(k)) map.set(k, inc(map.get(k)));
      else if (map.size >= MAX_REQUESTS) dropped = inc(dropped);
      else map.set(k, 1);
    },
    /* After this, cleanup that fires failed requests cannot change the counts. */
    freeze() {
      if (!frozen) {
        frozen = true;
        snap = { requests: [...map].map(([k, n]) => { const [m, c, s] = k.split(" "); return { m, c, s: Number(s), n }; }), dropped };
      }
      return snap;
    },
  };
}

export function resolveCommit(env) {
  const sha = env && env.GITHUB_SHA;
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) ? { commit: sha, commitSource: "env" } : { commit: null, commitSource: "unknown" };
}

export function sha256File(file) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); } catch (e) { return null; }
}

/* ---- the validator: two shapes, exactly ---- */
const keysOk = (o, keys) => o && typeof o === "object" && !Array.isArray(o)
  && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const each = (arr, cap, f) => Array.isArray(arr) && arr.length <= cap && arr.every(f);

function requestsOk(r) {
  return each(r, MAX_REQUESTS, (e) => keysOk(e, ["m", "c", "s", "n"]) && METHODS.includes(e.m) && CLASSES.has(e.c) && isStatus(e.s) && isCount(e.n));
}
function histogramOk(h) {
  if (!h || typeof h !== "object" || Array.isArray(h)) return false;
  const ks = Object.keys(h);
  return ks.length <= SHAPES.length && ks.every((k) => SHAPES.includes(k) && isCount(h[k]));
}
export function validateFixtureReport(r) {
  return keysOk(r, ["schema", "mode", "clock", "seed", "dist", "requests", "shapes", "unexpectedByClass", "unexpected", "dropped", "droppedShapes", "droppedUnexpected"])
    && r.schema === 1 && (r.mode === "legacy" || r.mode === "compatible") && CLOCKS.includes(r.clock) && SEEDS.includes(r.seed)
    && keysOk(r.dist, ["files", "bytes", "sha256"]) && isCount(r.dist.files) && isCount(r.dist.bytes) && isHex(r.dist.sha256, 64)
    && each(r.requests, MAX_REQUESTS, (e) => keysOk(e, ["m", "c", "s", "n"]) && METHODS.includes(e.m) && CLASSES.has(e.c) && isStatus(e.s) && isCount(e.n))
    && each(r.shapes, MAX_CLASSES, (e) => keysOk(e, ["c", "h"]) && CLASSES.has(e.c) && histogramOk(e.h))
    && each(r.unexpectedByClass, MAX_CLASSES, (e) => keysOk(e, ["c", "n"]) && CLASSES.has(e.c) && isCount(e.n))
    && isCount(r.unexpected) && isCount(r.dropped) && isCount(r.droppedShapes) && isCount(r.droppedUnexpected);
}

const FULL_KEYS = ["schema", "phase", "commit", "commitSource", "cell", "engine", "stage", "pictures", "exit", "errorClass", "verdict", "binding", "page",
  "browserWindow", "fixtureWindow", "requests", "dropped", "unexpected", "fixtureState", "fixture"];
const FALLBACK_KEYS = ["schema", "invalid", "commit", "commitSource", "stage", "errorClass"];
const PAGE_TRI = ["loginCard", "signinOver", "arBar", "arBarUp", "rootInert", "flightLock"];
const PAGE_COUNTS = ["rooms", "notHiddenRooms"];

function commonOk(d) {
  return d.schema === 1 && (d.commit === null || isHex(d.commit, 40)) && (d.commitSource === (d.commit === null ? "unknown" : "env"))
    && (d.stage === "unknown" || STAGES.has(d.stage)) && (d.errorClass === null || ERROR_CLASSES.includes(d.errorClass));
}
export function validateEvidence(d) {
  if (keysOk(d, FALLBACK_KEYS)) return d.invalid === true && commonOk(d);
  if (!keysOk(d, FULL_KEYS) || !commonOk(d)) return false;
  const pageOk = d.page === null || (keysOk(d.page, [...PAGE_TRI, ...PAGE_COUNTS])
    && PAGE_TRI.every((k) => TRI.includes(d.page[k])) && PAGE_COUNTS.every((k) => d.page[k] === null || isCount(d.page[k])));
  return ["started", "running", "final"].includes(d.phase) && CELLS.includes(d.cell) && ["webkit", "chromium"].includes(d.engine)
    && isCount(d.pictures) && [0, 1, 3, null].includes(d.exit) && ["frozen", "not-frozen"].includes(d.verdict)
    && keysOk(d.binding, ["shots", "probeKit", "evidence", "fixture"]) && Object.values(d.binding).every((h) => h === null || isHex(h, 64))
    && BROWSER_WINDOWS.includes(d.browserWindow) && FIXTURE_WINDOWS.includes(d.fixtureWindow) && (d.fixtureWindow === null) === (d.fixture === null)
    && pageOk && requestsOk(d.requests) && isCount(d.dropped) && (d.unexpected === null || isCount(d.unexpected))
    && FIXTURE_STATES.includes(d.fixtureState) && (d.fixture === null || validateFixtureReport(d.fixture));
}

/* Bytes, not characters, and shed in a fixed order: the browser's request list,
   then the fixture's, then the fixture's shapes, and only then the fallback. A
   string is never truncated. */
export function buildFile(doc, maxBytes = MAX_BYTES) {
  const fits = (o) => validateEvidence(o) && Buffer.byteLength(JSON.stringify(o), "utf8") <= maxBytes;
  const d = JSON.parse(JSON.stringify(doc));
  if (fits(d)) return { text: JSON.stringify(d), kind: "full" };
  if (validateEvidence(d)) {
    while (d.requests.length && !fits(d)) { d.dropped = Math.min(d.dropped + d.requests[d.requests.length - 1].n, MAX_N); d.requests.pop(); }
    if (d.fixture) {
      while (d.fixture.requests.length && !fits(d)) { d.fixture.dropped = Math.min(d.fixture.dropped + d.fixture.requests.pop().n, MAX_N); }
      while (d.fixture.shapes.length && !fits(d)) { d.fixture.shapes.pop(); d.fixture.droppedShapes = inc(d.fixture.droppedShapes); }
    }
    if (fits(d)) return { text: JSON.stringify(d), kind: "full" };
  }
  /* Rebuilt from the few fields that can be checked on their own, so a document
     that failed for one bad field still leaves a note about the rest. */
  const commit = doc && isHex(doc.commit, 40) ? doc.commit : null;
  const fb = { schema: 1, invalid: true, commit, commitSource: commit ? "env" : "unknown", stage: doc && STAGES.has(doc.stage) ? doc.stage : "unknown",
    errorClass: doc && ERROR_CLASSES.includes(doc.errorClass) ? doc.errorClass : null };
  return fits(fb) ? { text: JSON.stringify(fb), kind: "fallback" } : null;
}

/* The fixture's own report, over loopback, capped by what was actually read:
   a Content-Length is a claim, not a limit. This is the fixture talking about
   itself, not a browser response. */
const REPORT_URL = /^http:\/\/127\.0\.0\.1:\d{2,5}\/__fixture\/report$/;
export async function readCapped(res, max) {
  const reader = res.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => {}); throw new Error("report over the cap"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function fetchFixtureReport(url, { ms = 1000, fetchImpl = globalThis.fetch } = {}) {
  if (!url) return { state: "none", report: null };
  if (!REPORT_URL.test(url)) return { state: "invalid", report: null };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    /* The URL was checked as loopback above; a redirect would walk away from that
       check, so a redirect is an error here rather than something to follow. */
    const res = await fetchImpl(url, { signal: ac.signal, redirect: "error" });
    if (res.redirected) return { state: "invalid", report: null };
    if (!res.ok) return { state: "unreachable", report: null };
    const report = JSON.parse(await readCapped(res, 8192));
    return validateFixtureReport(report) ? { state: "ok", report } : { state: "invalid", report: null };
  } catch (e) { return { state: ac.signal.aborted || e instanceof TypeError ? "unreachable" : "invalid", report: null }; } finally { clearTimeout(timer); }
}

/* One fixed script, read-only, and a hard ceiling. A closed or crashed page, a
   throw or a miss all come back as "unknown", never "no": not knowing is not
   the same as not being there. */
/* notHiddenRooms counts .ar-room elements that do not carry the hidden attribute. That is
   all it says. It is not what is on screen: an element can lack the attribute and still
   be display:none, transparent, behind another, or off the edge; and one can have it and
   be shown by a rule that overrides it. */
const PROBE = () => {
  const q = (s) => !!document.querySelector(s);
  return { loginCard: q(".login-card"), signinOver: q(".signin-over"), arBar: q(".ar-bar"), arBarUp: q(".ar-bar.up"),
    rootInert: !!(document.getElementById("root") || {}).inert, flightLock: document.documentElement.classList.contains("sage-flight-lock"),
    rooms: document.querySelectorAll(".ar-room").length, notHiddenRooms: document.querySelectorAll(".ar-room:not([hidden])").length };
};
const UNKNOWN_PAGE = { loginCard: "unknown", signinOver: "unknown", arBar: "unknown", arBarUp: "unknown", rootInert: "unknown", flightLock: "unknown", rooms: null, notHiddenRooms: null };
export async function probePage(page, ms = 1500) {
  if (!page) return { ...UNKNOWN_PAGE };
  let timer;
  try {
    const r = await Promise.race([page.evaluate(PROBE), new Promise((_, no) => { timer = setTimeout(() => no(new Error("ceiling")), ms); })]);
    const t = (v) => (v === true ? "yes" : v === false ? "no" : "unknown");
    const n = (v) => (isCount(v) ? v : null);
    return { loginCard: t(r.loginCard), signinOver: t(r.signinOver), arBar: t(r.arBar), arBarUp: t(r.arBarUp), rootInert: t(r.rootInert), flightLock: t(r.flightLock), rooms: n(r.rooms), notHiddenRooms: n(r.notHiddenRooms) };
  } catch (e) { return { ...UNKNOWN_PAGE }; } finally { clearTimeout(timer); }
}

export function classifyError(e, lost) {
  if (lost) return "browser-lost";
  if (e && e.unexpectedRoutes) return "unexpected-routes";
  if (e && e.name === "TimeoutError") return "timeout";
  if (e && (e.name === "AssertionError" || e.code === "ERR_ASSERTION")) return "assertion";
  return "other";
}

/* The one object shots.mjs holds. Nothing here throws into the run: a write that
   fails is dropped, because a note about the run must never be what fails it. */
export function createShotsEvidence({ engine, dir, here, env = process.env, fetchImpl = globalThis.fetch }) {
  const rec = createRecorder();
  const { commit, commitSource } = resolveCommit(env);
  const reportUrl = env.SHOTS_FIXTURE_REPORT_URL || "";
  let stage = "starting", pictures = 0, page = null, frozen = null, verdict = "not-frozen", errorClass = null, exitCode = null;
  let pageState = null, fixtureState = reportUrl ? "unreachable" : "none", fixture = null, written = "none", browserWindow = null, fixtureWindow = null;
  const file = () => path.join(dir, "shots-evidence.json");
  const binding = () => ({ shots: sha256File(path.join(here, "shots.mjs")), probeKit: sha256File(path.join(here, "probe-kit.mjs")),
    evidence: sha256File(path.join(here, "shots-evidence.mjs")), fixture: sha256File(path.join(here, "shots-fixture.mjs")) });
  const doc = (phase) => ({
    schema: 1, phase, commit, commitSource,
    cell: fixture ? `fixture-${fixture.mode}` : reportUrl ? "unknown" : "ordinary", engine, stage: stageName(stage), pictures, exit: exitCode, errorClass, verdict,
    binding: binding(), page: pageState, browserWindow, fixtureWindow: fixture ? fixtureWindow : null,
    requests: frozen ? frozen.requests : [], dropped: frozen ? frozen.dropped : 0,
    unexpected: fixture ? fixture.unexpected : null, fixtureState, fixture,
  });
  const write = (phase) => {
    try {
      const built = buildFile(doc(phase));
      if (!built) return;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file() + ".tmp", built.text);
      fs.renameSync(file() + ".tmp", file());
      written = built.kind;
    } catch (e) { /* best effort */ }
  };
  const settle = async (window) => {
    const got = await fetchFixtureReport(reportUrl, { fetchImpl });
    fixtureState = got.state; fixture = got.report; fixtureWindow = window;
  };
  const freeze = (why) => {
    if (!frozen) browserWindow = why;
    verdict = "frozen";
    frozen = rec.freeze();
  };
  return {
    stage(name) { stage = name; },
    setPictures(n) { pictures = isCount(n) ? n : pictures; },
    start() { write("started"); },
    watchPage(p) {
      page = p;
      p.on("response", (r) => { try { rec.observe(r.request().method(), new URL(r.url()).pathname, r.status()); } catch (e) {} });
      p.on("requestfailed", (q) => { try { rec.observe(q.method(), new URL(q.url()).pathname, 0); } catch (e) {} });
    },
    /* End of a run that got to the end: freeze, then ask the fixture, then
       decide. An unexpected route fails the run, and so does a fixture that was
       asked for and could not be read, because a check that could not look has
       not passed. */
    freeze() { freeze("until-last-context-closed"); },
    async passed() {
      freeze("until-last-context-closed");
      await settle("until-report-read-after-cleanup");   // called after the finally: the browser is already closed
      const missing = reportUrl && fixtureState !== "ok";
      const bad = fixture && fixture.unexpected > 0;
      exitCode = missing || bad ? 1 : 0;
      errorClass = missing ? "other" : bad ? "unexpected-routes" : "none";
      write("final");
      if (missing) throw Object.assign(new Error("the fixture report could not be read"), { fixtureReport: true });
      if (bad) throw Object.assign(new Error(`the fixture saw ${fixture.unexpected} unexpected route call(s)`), { unexpectedRoutes: true });
    },
    /* The failure path. The verdict was frozen by the caller's catch; the lost
       browser keeps exit 3 whatever else the fixture saw, and is never probed
       or asked anything, since there is nothing to ask. */
    async failed(e) {
      try {
        const lost = (e && e.lostBrowser) || null;
        freeze("until-failure");
        errorClass = classifyError(e, lost);
        exitCode = lost ? 3 : 1;
        if (lost) pageState = { ...UNKNOWN_PAGE };
        else { pageState = await probePage(page); await settle("until-report-read-before-cleanup"); }   // called from the catch: nothing is closed yet
        write("final");
      } catch (err) { /* best effort */ }
    },
    written: () => written,
  };
}
