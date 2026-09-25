import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/arrival-surface.mjs", import.meta.url), "utf8");
function harness() {
  const timers = new Map(), frames = new Map(), nodes = [], warnings = [], windowEvents = new Map();
  let id = 0;
  function element(tag) {
    const classes = new Set(), listeners = new Map(), children = new Map();
    return { tag, dataset: {}, hidden: false, inert: false, style: { setProperty() {}, removeProperty() {} },
      classList: { add: (...cs) => cs.forEach(c => classes.add(c)), remove: (...cs) => cs.forEach(c => classes.delete(c)), contains: c => classes.has(c), toggle(c, yes) { if (yes) classes.add(c); else classes.delete(c); } },
      append(...items) { nodes.push(...items); }, remove() { this.removed = true; }, focus() {},
      getBoundingClientRect: () => ({ width: classes.has("sage-flight-lock") ? 1000 : 985 }),
      setAttribute() {}, querySelector(key) { if (!children.has(key)) children.set(key, element(key)); return children.get(key); },
      addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event),
      emit(event) { listeners.get(event)?.({ type: event, animationName: "sageArrivalScan" }); },
    };
  }
  const root = element("html"), app = element("root"), body = element("body");
  const context = vm.createContext({
    ARRIVAL_CSS: "", document: { documentElement: root, body, fonts: { ready: Promise.resolve() },
      getElementById: () => app, createElement: element, querySelector: () => null, querySelectorAll: () => [] },
    window: { location: { reload() {} }, addEventListener: (event, fn) => windowEvents.set(event, fn), removeEventListener: event => windowEvents.delete(event) },
    console: { warn: message => warnings.push(message) },
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimeout: n => timers.delete(n),
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: n => frames.delete(n),
  });
  vm.runInContext(source.replace(/^import[^\n]+\n/, "").replaceAll("export function ", "function "), context);
  return { context, root, app, nodes, warnings, timers, frames, windowEvents,
    timer(ms) { const [key, t] = [...timers].find(([, t]) => t.ms === ms); timers.delete(key); t.fn(); },
    frame() { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn()); },
  };
}

test("assembly cannot unlock before the real scan completion", () => {
  const h = harness(), surface = h.context.openArrivalSurface(false); let done = 0;
  surface.startScan(); surface.afterLanding(() => done++, 1400);
  const scan = h.nodes.find(n => n.className === "sage-arrival-scan");
  h.timer(1400); assert.equal(done, 0); assert.equal(h.app.inert, true);
  scan.emit("animationend"); assert.equal(done, 1);
  scan.emit("animationend"); assert.equal(done, 1);
  surface.dispose(); assert.equal(h.app.inert, false);
  assert.ok(!h.root.classList.contains("sage-flight-lock")); assert.equal(h.timers.size, 0);
  h.windowEvents.get("pointermove")(); assert.equal(h.windowEvents.size, 0);
});

test("a missing scan event is bounded and cancellation clears all timers", () => {
  const h = harness(), surface = h.context.openArrivalSurface(false); let done = 0;
  surface.startScan(); surface.afterLanding(() => done++, 1400);
  h.timer(1400); h.timer(2800);
  assert.equal(done, 1); assert.equal(h.warnings.length, 1); surface.dispose();
  const other = h.context.openArrivalSurface(false);
  other.startScan(); other.afterLanding(() => done++, 1400); other.dispose();
  assert.equal(h.timers.size, 0); assert.equal(done, 1);
  assert.ok(h.nodes.filter(n => n.tag !== "span").every(n => n.removed));
});

test("reduced motion never waits for a scan that cannot run", () => {
  const h = harness(), surface = h.context.openArrivalSurface(true); let done = 0;
  surface.startScan(); surface.afterLanding(() => done++, 360); h.timer(360);
  assert.equal(done, 1); assert.equal(h.timers.size, 0);
  assert.ok(!h.root.classList.contains("sage-flight-scan")); surface.dispose();
});

test("a later waiting phase cannot hide a known connection failure", () => {
  const h = harness(), surface = h.context.openArrivalSurface(false);
  surface.recovery(true); surface.phase("waiting");
  const panel = h.nodes.find(n => n.className === "sage-arrival-wait");
  assert.equal(panel.querySelector("h1").textContent, "Connection interrupted");
  assert.equal(panel.querySelector("button").hidden, false); surface.dispose();
});

test("committed surface preparation waits two frames and is cancellable", async () => {
  const h = harness(); let ready = 0;
  const cancel = h.context.prepareArrivalSurface(() => ready++);
  await new Promise(setImmediate);
  h.frame(); assert.equal(ready, 0); h.frame(); assert.equal(ready, 1);
  cancel(); assert.equal(h.timers.size, 0);
  const cancelAgain = h.context.prepareArrivalSurface(() => ready++);
  cancelAgain(); await new Promise(setImmediate); h.frame(); h.frame();
  assert.equal(ready, 1); assert.equal(h.frames.size, 0);
});

test("an image or font that never answers uses a bounded fallback", () => {
  const h = harness(); let ready = 0;
  h.context.document.fonts.ready = new Promise(() => {});
  const cancel = h.context.prepareArrivalSurface(() => ready++);
  h.timer(1800); h.frame(); h.frame(); assert.equal(ready, 1); cancel();
});
