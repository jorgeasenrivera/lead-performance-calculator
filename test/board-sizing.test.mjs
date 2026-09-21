import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { LEADERBOARD_HTML } from "../src/leaderboard-template.mjs";

const key = (id) => "lpc:board:" + id + ":v1";
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const data = () => ({
  large: { storeName: "Large team", boardDisplay: { tscale: 0.8, rotate: ["small"], squeeze: 0.95, pad: 2, style: "bars", bg: "store" } },
  small: { storeName: "Small team", boardDisplay: { tscale: 1.2, style: "classic", rotate: [] } },
});

/* Run the shipped document's script. Only the network, pixels and clock are
   stand-ins: loop, nextStore, renderStore, tuning and saving are the real code.
   Keeping the controls wired catches failures a size-picker unit test misses. */
function screen({ rows = data(), storage = new Map(), publish } = {}) {
  const nodes = new Map(), timers = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", textContent: "", innerHTML: "",
      style: { setProperty: (name, value) => { node(id)[name] = value; } },
      classList: { add() {}, remove() {}, toggle() {} },
      querySelectorAll: () => [], remove() {},
    });
    return nodes.get(id);
  }
  const pageWindow = { opener: publish ? { __lpcSaveBoardDisplay: publish } : null };
  pageWindow.parent = pageWindow;
  const ctx = vm.createContext({
    document: { getElementById: node, createElement: () => node("convoy"), body: { style: { setProperty() {} }, appendChild() {} } },
    window: pageWindow,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    setInterval: () => {}, clearTimeout: () => {}, console,
  });
  const html = LEADERBOARD_HTML({ storeId: "large", storeKey: key("large"), storeName: "Large team", siblings: [{ id: "small", name: "Small team" }] }, { dot: ["1"] });
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  assert.equal(script.split("\n  loop();").length, 2, "one startup call is controlled by the test clock");
  vm.runInContext(script.replace("\n  loop();", ""), ctx);
  ctx.getStoreByKey = async (k) => structuredClone(rows[k === key("large") ? "large" : "small"]);
  const frames = [];
  ctx.render = () => frames.push({ store: ctx.CFG.storeId, size: ctx.DISP.tscale });
  const fire = (ms) => {
    const at = timers.findIndex((t) => t.ms === ms);
    assert.ok(at >= 0, "timer " + ms);
    timers.splice(at, 1)[0].fn();
  };
  return { ctx, storage, rows, node, frames, fire,
    boot: () => ctx.loop(),
    async rotate() { await ctx.nextStore(); fire(1250); fire(3600); },
    tune(value) { node("s-t").value = value * 100; node("s-t").oninput(); },
    save: () => node("tsave").onclick(),
  };
}

test("rotation applies the arriving store's published size before its first frame, in both directions", async () => {
  const s = screen();
  await s.boot(); await s.rotate(); await s.rotate();
  assert.deepEqual(s.frames, [{ store: "large", size: 0.8 }, { store: "small", size: 1.2 }, { store: "large", size: 0.8 }]);
  assert.equal(s.node("s-t").value, 80);
  assert.equal(s.node("root")["--tscale"], 0.8);
  assert.equal(s.ctx.DISP.squeeze, 0.95);
  assert.equal(s.ctx.DISP.pad, 2);
  assert.equal(s.ctx.DISP.style, "bars", "the screen's style is not the visitor's style");
});

test("each store's screen-specific override wins only for that store", async () => {
  const s = screen({ storage: new Map([["lpc:disp:t:large", "0.9"], ["lpc:disp:t:small", "1.3"]]) });
  await s.boot(); await s.rotate();
  assert.equal(s.ctx.DISP.tscale, 1.3);
  assert.equal(s.node("s-t").value, 130);
  await s.rotate();
  assert.equal(s.ctx.DISP.tscale, 0.9);
});

test("a store with no saved size uses 100%, not the previous store's size", async () => {
  const rows = data(); delete rows.small.boardDisplay.tscale;
  const s = screen({ rows });
  await s.boot(); await s.rotate();
  assert.equal(s.ctx.DISP.tscale, 1);
});

test("a routine refresh preserves a live unsaved size adjustment", async () => {
  const s = screen();
  await s.boot(); s.tune(1.1); await s.ctx.loop();
  assert.equal(s.ctx.DISP.tscale, 1.1);
});

test("saving a visitor then reopening never migrates its size into the home store", async () => {
  const s = screen();
  await s.boot(); await s.rotate(); s.tune(1.25); await s.save();
  assert.equal(s.storage.get("lpc:disp:t:small"), "1.25");
  assert.equal(s.storage.has("lpc:disp:t:large"), false);
  assert.equal(JSON.parse(s.storage.get("lpc:disp:large")).tscale, undefined);
  const reopened = screen({ storage: s.storage });
  await reopened.boot();
  assert.equal(reopened.ctx.DISP.tscale, 0.8);
  await reopened.rotate();
  assert.equal(reopened.ctx.DISP.tscale, 1.25);
  assert.equal(reopened.ctx.DISP.squeeze, 0.95);
});

test("saving at home persists its size separately and retains the rotation list", async () => {
  const s = screen();
  await s.boot(); s.tune(0.85); await s.save();
  const reopened = screen({ storage: s.storage });
  await reopened.boot();
  assert.equal(reopened.ctx.DISP.tscale, 0.85);
  await reopened.rotate();
  assert.equal(reopened.ctx.DISP.tscale, 1.2);
});

test("genuine pre-per-store settings still migrate to the home store only", async () => {
  const storage = new Map([["lpc:disp:large", JSON.stringify({ tscale: 0.75, rotate: ["small"] })]]);
  const s = screen({ storage });
  await s.boot();
  assert.equal(s.ctx.DISP.tscale, 0.75);
  await s.rotate(); s.tune(1.35); await s.save();
  const reopened = screen({ storage });
  await reopened.boot();
  assert.equal(reopened.ctx.DISP.tscale, 0.75);
  await reopened.rotate();
  assert.equal(reopened.ctx.DISP.tscale, 1.35);
});

test("an explicit home override wins over the legacy size", async () => {
  const s = screen({ storage: new Map([["lpc:disp:large", '{"tscale":1.4}'], ["lpc:disp:t:large", "0.85"]]) });
  await s.boot();
  assert.equal(s.ctx.DISP.tscale, 0.85);
});

test("saving a visitor publishes its size while keeping the home's published size", async () => {
  const writes = [];
  const s = screen({ publish: async (id, display) => { writes.push({ id, display: JSON.parse(JSON.stringify(display)) }); return true; } });
  await s.boot(); await s.rotate(); s.tune(1.25); await s.save();
  assert.equal(writes[0].id, "small");
  assert.equal(writes[0].display.tscale, 1.25);
  assert.equal(writes[0].display.style, "classic");
  assert.equal(writes[1].id, "large");
  assert.equal(writes[1].display.tscale, 0.8);
  assert.equal(writes[1].display.style, "bars");
});

test("rotation during an awaited save cannot redirect the visitor's size to home", async () => {
  const writes = [], pendingHome = deferred();
  const s = screen({ publish: async (id, display) => { writes.push({ id, display: JSON.parse(JSON.stringify(display)) }); return true; } });
  await s.boot(); await s.rotate(); s.tune(1.25);
  const read = s.ctx.getStoreByKey;
  s.ctx.getStoreByKey = () => pendingHome.promise;
  const saved = s.save();
  s.ctx.getStoreByKey = read;
  await s.rotate();
  pendingHome.resolve(s.rows.large);
  await saved;
  assert.equal(writes[0].id, "small");
  assert.equal(writes[0].display.tscale, 1.25);
  assert.equal(writes[1].id, "large");
  assert.equal(writes[1].display.tscale, 0.8);
});

test("a save during the convoy still belongs to the visible store until the covered swap", async () => {
  const s = screen();
  await s.boot(); s.tune(0.85);
  await s.ctx.nextStore();
  assert.equal(s.ctx.CFG.storeId, "large");
  await s.save();
  assert.equal(s.storage.get("lpc:disp:t:large"), "0.85");
  assert.equal(s.storage.has("lpc:disp:t:small"), false);
  s.fire(1250); s.fire(3600);
  assert.equal(s.ctx.CFG.storeId, "small");
  assert.equal(s.ctx.DISP.tscale, 1.2);
});

test("a failed per-store size write never reports that the local save succeeded", async () => {
  const storage = new Map();
  storage.set = function(k, v) {
    if (k.startsWith("lpc:disp:t:")) throw new Error("storage full");
    return Map.prototype.set.call(this, k, v);
  };
  const s = screen({ storage });
  await s.boot(); s.tune(0.85); await s.save();
  assert.equal(s.node("tmsg").textContent, "Could not save.");
});

test("a failed home read keeps the save local instead of publishing an invented home size", async () => {
  for (const missing of [null, { __err: "offline" }]) {
    const writes = [];
    const s = screen({ publish: async (id) => { writes.push(id); return true; } });
    await s.boot(); await s.rotate(); s.tune(1.25);
    s.ctx.getStoreByKey = async () => missing;
    await s.save();
    assert.deepEqual(writes, []);
    assert.equal(s.storage.get("lpc:disp:t:small"), "1.25");
    assert.equal(s.node("tmsg").textContent, "Saved on this screen only.");
  }
});
