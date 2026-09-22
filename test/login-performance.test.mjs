import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { summarizeLoginTrace, installLoginProbe } from "../scripts/login-performance.mjs";

test("the login recorder distinguishes an unmeasured landing from zero blocking", () => {
  const result = summarizeLoginTrace({ hidden: false, events: [], frames: [], longTasks: [] });
  assert.equal(result.revealedAtMs, null);
  assert.equal(result.landingTaskMaxMs, null);
  assert.equal(result.frameMedianMs, null);
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

test("the injected recorder and summary remain serializable browser functions", () => {
  assert.doesNotThrow(() => new Function(`(${installLoginProbe.toString()})(${summarizeLoginTrace.toString()})`));
  const source = installLoginProbe.toString();
  assert.ok(!/localStorage\.(setItem|removeItem|clear)/.test(source));
  assert.ok(!/\bfetch\(/.test(source));
  assert.ok(!/\.value\b/.test(source), "never record credentials or field values");
});

const core = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
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
  assert.match(core, /\.sage-beat-flash \.sage-flash, \.sage-flash-hold \.sage-flash \{\s*animation: saFlashUp/);
  assert.match(core, /\.sage-assemble\.sage-cover-active \.sage-flash \{ animation: saFlashOut/);
  assert.doesNotMatch(core, /\.sage-assemble \.sage-flash \{/);
  const reduced = core.slice(core.indexOf("@media (prefers-reduced-motion: reduce) {", core.indexOf("@keyframes saRing")));
  assert.match(reduced.slice(0, 700), /\.sage-flash \{ animation:none !important; \}/);
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
