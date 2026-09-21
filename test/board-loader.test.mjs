import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createBoardRenderer, renderLeaderboard } from "../src/board-loader.mjs";

const core = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const manager = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the TV template is not requested until a board needs it, and concurrent boards share it", async () => {
  let downloads = 0;
  const download = deferred();
  const render = createBoardRenderer(() => { downloads++; return download.promise; });
  assert.equal(downloads, 0);
  const a = render({ name: "A" }, "dots");
  const b = render({ name: "B" }, "dots");
  await settle();
  assert.equal(downloads, 1);
  download.resolve({ LEADERBOARD_HTML: (p, pix) => p.name + pix });
  assert.deepEqual(await Promise.all([a, b]), ["Adots", "Bdots"]);
  assert.equal(await render({ name: "C" }, "dots"), "Cdots");
  assert.equal(downloads, 1);
});

test("a failed template download is not retained as a permanently rejected promise", async () => {
  let attempts = 0;
  const render = createBoardRenderer(() => {
    if (++attempts === 1) throw new Error("offline");
    return { LEADERBOARD_HTML: () => "ready" };
  });
  await assert.rejects(render({}, {}), /offline/);
  assert.equal(await render({}, {}), "ready");
  assert.equal(attempts, 2);
});

test("the real lazy template embeds the caller's payload and glyphs", async () => {
  const payload = { storeName: "Demo Motors", rows: [], tokens: null };
  const pix = { arrow: [[1, 0]] };
  const html = await renderLeaderboard(payload, pix);
  assert.ok(html.includes(JSON.stringify(payload)));
  assert.ok(html.includes(JSON.stringify(pix)));
  assert.ok(html.includes("</script></body></html>"));
  assert.ok(!manager.includes("function LEADERBOARD_HTML("));
  assert.ok(!core.includes("await managerChunk();"), "opening a TV no longer imports the manager to obtain a template");
});

function popupHarness(render) {
  const events = [];
  const popup = { closed: false,
    document: { open: () => events.push("erase"), write: (html) => events.push(html), close: () => events.push("finish") },
    location: { replace: (url) => events.push(url) },
  };
  let blocked = false;
  const start = core.indexOf("async function openLeaderboard(");
  const source = core.slice(start, core.indexOf("\n}\n", start) + 2);
  const launch = vm.runInNewContext("(" + source + ")", {
    window: { open: () => { events.push("open"); return blocked ? null : popup; }, location: { pathname: "/" } },
    loadStore: async () => { events.push("data"); return {}; },
    buildBoardPayload: () => ({ storeName: "Demo Motors" }),
    publishBoard: async () => ({ ok: true }), boardKey: (id) => "board_" + id,
    SUPABASE_URL: "http://127.0.0.1:5433", SUPABASE_ANON_KEY: "mock-anon-key", PIX: {},
    /* The board now tells the screen where to read the group's store list, so
       the real handler needs the constant this context stands in for. C84. */
    PUBLIC_STORES_KEY: "lpc:board:stores:v1",
    renderLeaderboard: render, console: { error: () => {} },
  });
  return { launch: () => launch({ stores: [] }, "demo store"), events, popup, block: () => { blocked = true; } };
}

test("opening a TV keeps user activation and does not erase the old board while downloading", async () => {
  const template = deferred();
  const h = popupHarness(() => template.promise);
  const result = h.launch();
  assert.equal(h.events[0], "open");
  await settle();
  assert.deepEqual(h.events, ["open", "data"]);
  template.resolve("complete board");
  assert.equal(await result, true);
  assert.deepEqual(h.events, ["open", "data", "erase", "complete board", "finish"]);
});

test("a blocked popup returns the existing blocked result without loading data", async () => {
  const h = popupHarness(() => { throw new Error("must not render"); });
  h.block();
  assert.equal(await h.launch(), false);
  assert.deepEqual(h.events, ["open"]);
});

test("a failed popup download opens the existing retrying TV route for the correct store", async () => {
  const h = popupHarness(async () => { throw new Error("offline"); });
  assert.equal(await h.launch(), true);
  assert.deepEqual(h.events, ["open", "data", "/?board=demo%20store"]);
});

test("closing the popup during its download prevents later document writes or navigation", async () => {
  for (const fail of [false, true]) {
    const template = deferred();
    const h = popupHarness(() => template.promise);
    const result = h.launch();
    await settle();
    h.popup.closed = true;
    if (fail) template.reject(new Error("offline")); else template.resolve("board");
    assert.equal(await result, true);
    assert.deepEqual(h.events, ["open", "data"]);
  }
});

/* Execute the actual effect, not a copy of its retry or cancellation logic.
   The JSX return is irrelevant to these asynchronous lifecycle checks. */
function screenHarness(render, read = async () => ({ storeName: "Demo Motors" })) {
  const start = manager.indexOf("function BoardScreen(");
  const source = manager.slice(start, manager.indexOf("\n  return (", start)) + "\n}";
  const html = [], messages = [];
  let state = 0, cleanup, retry;
  vm.runInNewContext("(" + source + ")({storeId:'demo'})", {
    useState: () => [null, ++state === 1 ? (v) => html.push(v) : (v) => messages.push(v)],
    useBuildWatchdog: () => {}, useEffect: (effect) => { cleanup = effect(); },
    loadShared: read, boardKey: (id) => "board_" + id, renderLeaderboard: render, PIX: {},
    PUBLIC_STORES_KEY: "lpc:board:stores:v1",
    SUPABASE_URL: "http://127.0.0.1:5433", SUPABASE_ANON_KEY: "mock-anon-key",
    setInterval: (fn) => { retry = fn; return 1; }, clearInterval: () => {}, console: { error: () => {} },
  });
  return { html, messages, cleanup: () => cleanup(), retry: () => retry() };
}

test("TV requests do not overlap while the template is pending and stop after success", async () => {
  let reads = 0;
  const template = deferred();
  const h = screenHarness(() => template.promise, async () => { reads++; return {}; });
  await settle();
  h.retry(); h.retry();
  await settle();
  assert.equal(reads, 1);
  template.resolve("board");
  await settle();
  h.retry();
  await settle();
  assert.equal(reads, 1);
  assert.deepEqual(h.html, ["board"]);
  h.cleanup();
});

test("leaving a store during its template download discards its result", async () => {
  const template = deferred();
  const h = screenHarness(() => template.promise);
  await settle();
  h.cleanup();
  template.resolve("old store");
  await settle();
  assert.deepEqual(h.html, []);
  assert.deepEqual(h.messages, []);
});

test("a TV template failure reaches the existing error state and the next retry can recover", async () => {
  let attempts = 0;
  const h = screenHarness(async () => {
    if (++attempts === 1) throw new Error("offline");
    return "recovered board";
  });
  await settle();
  assert.deepEqual(h.html, []);
  assert.match(h.messages[0], /keeps trying/);
  h.retry();
  await settle();
  assert.deepEqual(h.html, ["recovered board"]);
  h.cleanup();
});

test("an unpublished board does not download a template", async () => {
  let renders = 0;
  const h = screenHarness(async () => { renders++; }, async () => null);
  await settle();
  assert.equal(renders, 0);
  assert.match(h.messages[0], /not been published/);
  h.cleanup();
});
