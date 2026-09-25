import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const core = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
const source = core.slice(core.indexOf("function settleViewport("), core.indexOf("const ARRIVAL ="));
function harness({ touch = 0, fine = true, coarse = false, vv = { height: 900, scale: 1 } } = {}) {
  let now = 0, id = 0, resolved = false;
  const frames = new Map(), intervals = new Map(), timers = new Map();
  const win = { innerHeight: 900, visualViewport: vv,
    matchMedia: q => ({ matches: q === "(pointer: fine)" ? fine : coarse }) };
  const context = vm.createContext({ window: win, navigator: { maxTouchPoints: touch },
    Date: { now: () => now },
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: n => frames.delete(n),
    setInterval: fn => { intervals.set(++id, fn); return id; }, clearInterval: n => intervals.delete(n),
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; }, clearTimeout: n => timers.delete(n),
  });
  vm.runInContext(source, context);
  context.settleViewport().then(() => { resolved = true; });
  return { win, frames, intervals, timers, resolved: () => resolved,
    async frame() { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn()); await Promise.resolve(); },
    async tick(ms) { now = ms; [...intervals.values()].forEach(fn => fn());
      for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); }
      await Promise.resolve(); },
  };
}

test("known non-touch desktop starts after one frame, not a keyboard delay", async () => {
  const h = harness();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.resolved(), false);
  await h.frame();
  assert.equal(h.resolved(), true);
  assert.equal(h.timers.size + h.frames.size, 0);
});

test("touch, unknown input, zoom and compressed viewport retain the keyboard floor", async () => {
  for (const options of [{ touch: 5 }, { touch: null }, { coarse: true },
    { fine: false }, { vv: { height: 480, scale: 1 } }, { vv: { height: 900, scale: 1.2 } }]) {
    const h = harness(options);
    assert.equal(h.frames.size, 0);
    for (let t = 40; t <= 200; t += 40) await h.tick(t);
    assert.equal(h.resolved(), false);
    await h.tick(240);
    assert.equal(h.resolved(), true);
    assert.equal(h.intervals.size + h.timers.size, 0);
  }
});

test("a late keyboard resize still needs two quiet ticks", async () => {
  const h = harness({ touch: 5 });
  for (let t = 40; t <= 200; t += 40) await h.tick(t);
  h.win.innerHeight = 950; await h.tick(240); await h.tick(280);
  assert.equal(h.resolved(), false);
  await h.tick(320);
  assert.equal(h.resolved(), true);
});

test("both desktop and touch waits remain bounded when frames or resizes stall", async () => {
  const desktop = harness(); await desktop.tick(520);
  assert.equal(desktop.resolved(), true);
  assert.equal(desktop.frames.size + desktop.timers.size, 0);
  const phone = harness({ touch: 5 });
  for (let t = 40; t <= 520; t += 40) { phone.win.innerHeight++; await phone.tick(t); }
  assert.equal(phone.resolved(), true);
  assert.equal(phone.intervals.size + phone.timers.size, 0);
});

test("sign-in pauses the existing breath without a rise or dot wave", () => {
  assert.match(core, /mode === "signin" \? " login-launch" : ""/);
  const rule = core.slice(core.indexOf(".login-card.login-launch .login-logo {"));
  assert.match(rule, /^\.login-card\.login-launch \.login-logo \{\s*animation: markBreathe 5\.4s ease-in-out infinite; animation-play-state:paused; \}/);
  assert.match(rule, /\.login-card\.login-launch \.login-logo circle \{ animation:none; \}/);
  assert.match(core, /\.login-logo \{ animation: markBreathe 5\.4s ease-in-out infinite; \}/);
});
