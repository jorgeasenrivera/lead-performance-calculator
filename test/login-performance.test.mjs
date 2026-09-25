import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { summarizeLoginTrace, installLoginProbe, installLoginFaults } from "../scripts/login-performance.mjs";

test("local arrival fault cases cannot intercept production or unrelated requests", async () => {
  const calls = [];
  const original = async (...args) => { calls.push(args); return new Response("ok"); };
  const context = { location: { hostname: "127.0.0.1", href: "http://127.0.0.1:49213/", search: "?arrivalCase=interrupted" },
    window: { fetch: original }, URL, URLSearchParams, Response, JSON };
  vm.runInNewContext("(" + installLoginFaults.toString() + ")()", context);
  assert.equal((await context.window.fetch("http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc:store:sage-demo")).status, 503);
  assert.equal((await context.window.fetch("https://example.com/rest/v1/app_data?key=eq.lpc:store:example")).status, 200);
  assert.equal((await context.window.fetch("http://127.0.0.1:5433/rest/v1/profiles")).status, 200);
  assert.equal((await context.window.fetch("http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc:store:sage-demo", { method: "POST" })).status, 200);
  assert.equal(calls.length, 3);
  context.location.hostname = "example.com"; context.window.fetch = original;
  vm.runInNewContext("(" + installLoginFaults.toString() + ")()", context);
  assert.equal(context.window.fetch, original);
});

test("the login recorder distinguishes an unmeasured landing from zero blocking", () => {
  const result = summarizeLoginTrace({ hidden: false, events: [], frames: [], longTasks: [] });
  assert.equal(result.revealedAtMs, null);
  assert.equal(result.landingTaskMaxMs, null);
  assert.equal(result.frameMedianMs, null);
});

test("the sign-in recorder recognises both desktop and mobile manager heroes", () => {
  assert.match(installLoginProbe.toString(), /querySelector\("\.s2-hero,\.bp-hero"\)/);
  assert.doesNotMatch(installLoginProbe.toString(), /querySelector\("\.s2-tube"\)/);
});

test("the landing summary excludes work before the reveal", () => {
  const result = summarizeLoginTrace({ hidden: false,
    events: [{ name: "dashboard-revealed", at: 4000 }],
    frames: [{ at: 10, ms: 16 }, { at: 4110, ms: 110 }, { at: 4130, ms: 20 }],
    longTasks: [{ at: 2000, ms: 800 }, { at: 4100, ms: 120 }],
  });
  assert.equal(result.landingTaskMaxMs, 120);
  assert.equal(result.frameMedianMs, 20);
  assert.equal(result.mainThreadGapsOver50ms, 1);
});

test("a backgrounded sample cannot be used as foreground performance evidence", () => {
  assert.equal(summarizeLoginTrace({ hidden: true, events: [], frames: [], longTasks: [] }).validForegroundSample, false);
});

test("the recorder separates covered preparation from the landing clock", () => {
  const result = summarizeLoginTrace({ hidden: false, frames: [],
    events: [{ name: "dashboard-revealed", at: 4000 }, { name: "landing-started", at: 4400 }],
    longTasks: [{ at: 4100, ms: 297 }, { at: 4450, ms: 133 }],
  });
  assert.equal(result.landingTaskMaxMs, 297, "covered work remains visible in the full cost");
  assert.equal(result.landingStartedAtMs, 4400);
  assert.equal(result.taskMaxAfterLandingStartedMs, 133);
});

test("the injected recorder and summary remain serializable browser functions", () => {
  assert.doesNotThrow(() => new Function(`(${installLoginProbe.toString()})(${summarizeLoginTrace.toString()})`));
  const source = installLoginProbe.toString();
  assert.ok(!/localStorage\.(setItem|removeItem|clear)/.test(source));
  assert.ok(!/\bfetch\(/.test(source));
  assert.ok(!/\.value\b/.test(source), "never record credentials or field values");
});

const core = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
test("arrival cannot accept the provisional overview or unmount on a boot failure", () => {
  assert.match(core, /const \[initialViewReady, setInitialViewReady\] = useState\(false\)/);
  assert.match(core, /if \(!config \|\| !session \|\| cfgProvisional\.current\) return;/);
  const initial = core.slice(core.indexOf("if (!viewPicked.current)"), core.indexOf("// Later runs happen"));
  assert.ok(initial.indexOf("setInitialViewReady(true)") > initial.indexOf("setView(first)"));
  const readiness = core.slice(core.indexOf("const landable ="), core.indexOf("useEffect(() => {", core.indexOf("const landable =")));
  assert.match(readiness, /arrivalDestinationReady && !cfgProvisional\.current/);
  assert.match(readiness, /arrivalFailed = loadErr \|\| bootStall/);
  assert.match(core, /if \(loadErr \|\| bootStall\) return wrap\(<Shell><BootStall/);
  assert.match(core, /ready=\{arrivalDestinationReady && !loadErr && !bootStall/);
  assert.match(core, /viewPicked\.current = false;\s*setInitialViewReady\(false\)/);
});
test("associate readiness does not wait for unrelated manager store documents", () => {
  assert.match(core, /arrivalDestinationReady = wantsFloor \? floorLinks !== undefined : initialViewReady/);
  assert.match(core, /identity=\{wantsFloor \? floorLinks : storeData\}/);
});
test("radial landing preserves a page child's cardIn instead of restarting it at cleanup", () => {
  const children = ":where(.page > *:not(.board-page):not(.tab-page), .board-page > *, .tab-page > *)";
  assert.ok(core.includes(children + " { animation: cardIn var(--t-settle) var(--ease) both; }"));
  const selector = ".sage-assemble " + children + ".sa-radial";
  const rule = core.slice(core.indexOf(selector), core.indexOf("}", core.indexOf(selector)) + 1);
  assert.match(rule, /animation: cardIn var\(--t-settle\) var\(--ease\) both, saRadial \.68s cubic-bezier\(\.16,0,\.3,1\) both;/);
  assert.match(rule, /animation-delay: 0ms, var\(--rd, 0ms\);/);
  assert.ok(core.indexOf(selector) > core.indexOf(".sage-assemble .sa-radial {"));
  assert.doesNotMatch(core, /\.sage-assemble \.sa-radial\s*\{[^}]*animation: cardIn/,
    "header and nested parts must not acquire a mount animation they never had");
});
test("an old daily mark cannot suppress any sign-in; Reduce Motion still can", () => {
  const source = core.slice(core.indexOf("function arrivalShort("), core.indexOf("/* ---- what the jump is waiting for"));
  let reduced = false, storageReads = 0;
  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: reduced }) },
    localStorage: { getItem: () => { storageReads++; return "2026-09-23"; } },
    today: () => "2026-09-23",
  });
  vm.runInContext(source, context);
  assert.equal(context.arrivalShort(), false);
  assert.equal(context.arrivalShort(), false, "second sign-in on the same day is full too");
  reduced = true;
  assert.equal(context.arrivalShort(), true);
  assert.equal(storageReads, 0, "daily marks no longer participate");
});
const coverFunction = core.slice(core.indexOf("function waitForArrivalCover("), core.indexOf("\nfunction runJump("));
function coverHarness() {
  let style = { position: "fixed", opacity: "0" }, exists = true, calls = 0, warnings = 0, id = 0;
  const frames = new Map(), timers = new Map();
  const context = vm.createContext({
    document: { querySelector: () => exists ? {} : null }, getComputedStyle: () => style,
    requestAnimationFrame: (fn) => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: (n) => frames.delete(n),
    setTimeout: (fn) => { timers.set(++id, fn); return id; }, clearTimeout: (n) => timers.delete(n),
    console: { warn: () => warnings++ },
  });
  vm.runInContext(coverFunction, context);
  return {
    start: () => context.waitForArrivalCover(() => calls++),
    style: (next) => { style = next; }, missing: () => { exists = false; },
    frame: () => { const batch = [...frames.values()]; frames.clear(); batch.forEach((fn) => fn()); },
    timeout: () => { const batch = [...timers.values()]; timers.clear(); batch.forEach((fn) => fn()); },
    state: () => ({ calls, warnings, pending: frames.size + timers.size }),
  };
}

test("the static HTML cover keeps its full-screen CSS and reduced-motion exception", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /class="sage-flash"/);
  assert.match(core, /\.sage-flash \{ position:fixed; inset:0; background:#fff; opacity:0;\s*pointer-events:none; z-index:9500; \}/);
  assert.match(core, /\.sage-cover-active\.sage-beat-flash \.sage-flash, \.sage-cover-active\.sage-flash-hold \.sage-flash \{\s*animation: saFlashUp/);
  assert.match(core, /\.sage-assemble\.sage-cover-active \.sage-flash \{ animation: saFlashOut/);
  assert.doesNotMatch(core, /\.sage-assemble \.sage-flash \{/);
  const reduced = core.slice(core.indexOf("@media (prefers-reduced-motion: reduce) {", core.indexOf("@keyframes saRing")));
  assert.match(reduced.slice(0, 700), /\.sage-flash \{ animation:none !important; \}/);
});

test("a short login waiting for the network cannot raise the full-login cover", () => {
  assert.doesNotMatch(core, /(?:^|\n)\.sage-flash-hold \.sage-flash/);
  const short = core.slice(core.indexOf("  if (jumpShort) {", core.indexOf("function runJump(")), core.indexOf("  const W = window.innerWidth", core.indexOf("function runJump(")));
  assert.ok(short.includes("onFlash(); onDone();"));
  assert.ok(!short.includes("sage-cover-active"));
});

test("a fast display cannot hand over while the cover is still translucent", () => {
  const h = coverHarness(); h.start();
  for (let i = 0; i < 12; i++) h.frame();
  assert.equal(h.state().calls, 0);
  h.style({ position: "fixed", opacity: "0.8" }); h.frame();
  assert.equal(h.state().calls, 0);
  h.style({ position: "fixed", opacity: "1" }); h.frame();
  assert.equal(h.state().calls, 0, "allow a paint with the opaque cover");
  h.frame();
  assert.deepEqual(h.state(), { calls: 1, warnings: 0, pending: 0 });
});

test("failed sign-in can cancel the cover before it hands over", () => {
  const h = coverHarness(), cancel = h.start();
  h.style({ position: "fixed", opacity: "1" }); h.frame(); cancel(); h.frame(); h.timeout();
  assert.deepEqual(h.state(), { calls: 0, warnings: 0, pending: 0 });
});

test("missing or unstyled cover reports and releases rather than hanging sign-in", () => {
  for (const missing of [false, true]) {
    const h = coverHarness();
    if (missing) h.missing(); else h.style({ position: "static", opacity: "1" });
    h.start(); h.frame(); assert.equal(h.state().calls, 0);
    h.timeout(); h.frame(); h.timeout();
    assert.deepEqual(h.state(), { calls: 1, warnings: 1, pending: 0 });
  }
});

test("tunnel removal and DOM restoration happen inside the covered callback", () => {
  const flash = core.slice(core.indexOf("  const toFlash = () => {"), core.indexOf("  const onPost =", core.indexOf("  const toFlash = () => {")));
  const boundary = flash.indexOf("cancelCover = waitForArrivalCover");
  for (const operation of ["restoreDom();", 'root.classList.remove("sage-cv")', "removeChild(cv)", "onDone();"])
    assert.ok(flash.indexOf(operation) > boundary, operation + " stays behind the cover");
  const cleanup = core.slice(core.indexOf("  return () => {\n    stopped = true;", core.indexOf("function runJump(")), core.indexOf("let jumpOwnsEntrance"));
  assert.match(cleanup, /cancelCover\(\);/);
});

function landingHarness({ short = false, cover = true } = {}) {
  const classes = new Set(cover ? ["sage-cover-active", "jump-under", "sage-beat-flash"] : ["jump-under"]);
  const frames = new Map(); let id = 0, starts = 0, radial = 0, cleaned = 0;
  const context = vm.createContext({
    document: { documentElement: { classList: {
      contains: (c) => classes.has(c), add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
    } } }, jumpShort: short, jumpLanded: false,
    startArrivalScan: () => assert.ok(!classes.has("sage-preparing"), "scan starts only after covered preparation"),
    radialAssemble: () => { radial++; return () => cleaned++; },
    requestAnimationFrame: (fn) => { frames.set(++id, fn); return id; }, cancelAnimationFrame: (n) => frames.delete(n),
  });
  vm.runInContext(core.slice(core.indexOf("function landDashboard("), core.indexOf("function radialAssemble(")), context);
  return { classes, start: () => context.landDashboard(() => starts++),
    frame: () => { const batch = [...frames.values()]; frames.clear(); batch.forEach((f) => f()); },
    state: () => ({ starts, radial, cleaned, pending: frames.size }),
  };
}

test("full landing paints its first pose under the cover before starting its clock", () => {
  const h = landingHarness(), undo = h.start();
  assert.ok(h.classes.has("sage-preparing") && h.classes.has("signin-gone"));
  assert.equal(h.state().starts, 0);
  h.frame(); assert.equal(h.state().starts, 0);
  h.frame(); assert.equal(h.state().starts, 1);
  assert.ok(!h.classes.has("sage-preparing"));
  undo();
  assert.ok(h.classes.has("signin-gone"), "timer cleanup cannot resurrect the login layer before its React removal");
  assert.deepEqual(h.state(), { starts: 1, radial: 1, cleaned: 1, pending: 0 });
});

test("a cancelled preparation never starts the landing later", () => {
  const h = landingHarness(), undo = h.start(); h.frame(); undo(); h.frame();
  assert.deepEqual(h.state(), { starts: 0, radial: 1, cleaned: 1, pending: 0 });
  assert.ok(!h.classes.has("sage-preparing"));
});

test("short and uncovered landings do not acquire a white preparation delay", () => {
  for (const options of [{ short: true }, { cover: false }]) {
    const h = landingHarness(options), undo = h.start();
    assert.equal(h.state().starts, 1);
    assert.equal(h.state().pending, 0);
    assert.ok(!h.classes.has("sage-preparing")); undo();
  }
});

test("login visibility belongs to the React commit and preparation stays fully covered", () => {
  assert.match(core, /if \(!jumpHold\) document\.documentElement\.classList\.remove\("signin-gone"\);/);
  assert.match(core, /\.sage-preparing\.sage-cover-active \.sage-flash \{ animation:none; opacity:1; \}/);
  assert.match(core, /\.sage-preparing \.lpc, \.sage-preparing \.lpc \* \{ animation-play-state:paused !important; \}/);
});

test("repeat short login waits for the committed destination and owns its entrance until cleanup", () => {
  const timers = new Map(), phases = []; let flashes = 0, done = 0, timerId = 0, disposed = 0;
  const context = vm.createContext({
    document: { documentElement: {} }, jumpLanded: true, jumpOwnsEntrance: false,
    arrivalShort: () => true, tellPhase: (p) => phases.push(p),
    arrivalReady: true, arrivalSurfaceReady: false, arrivalFailed: false, activeEngineSend: null,
    openArrivalSurface: () => ({ covered() {}, wait() {}, dispose() { disposed++; } }),
    setTimeout: (f) => { timers.set(++timerId, f); return timerId; }, clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(core.slice(core.indexOf("function runJump("), core.indexOf("\n/* True from the press")), context);
  const undo = context.runJump({ onFlash: () => flashes++, onDone: () => done++ });
  assert.equal(context.jumpLanded, false);
  assert.equal(context.jumpOwnsEntrance, true);
  assert.deepEqual(phases, ["cruise"]);
  timers.get(1)();
  assert.equal(flashes, 0); assert.equal(done, 0);
  context.arrivalSurfaceReady = true;
  context.activeEngineSend({ type: "ready", ready: true });
  assert.equal(flashes, 1); assert.equal(done, 1);
  undo();
  assert.equal(context.jumpOwnsEntrance, false);
  assert.equal(timers.size, 0);
  assert.equal(disposed, 1);
  assert.deepEqual(phases, ["cruise", "off"]);
});
