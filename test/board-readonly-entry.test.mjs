import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { boardRequest, readPublicBoard, readOnlyPayload, mountReadOnlyBoard, watchBoardBuild } from "../src/read-only-board.mjs";
import { BOARD_GLYPHS } from "../src/board-glyphs.mjs";
import { LEADERBOARD_HTML } from "../src/leaderboard-template.mjs";

// Every identity, key and figure in these fixtures is fictional. These tests
// neither read production data nor demonstrate the final desktop comparison.
const ID = "fictional-readonly", MONTH = "2026-09", db = { url: "https://fictional.example.invalid", anonKey: "fictional-public-key" };
const NONCE = "a".repeat(32);
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function row() {
  return { storeId: ID, storeName: "Fictional Demo Motors", roles: [{ id: "sales" }], roster: [{ id: "a", name: "Alex Example", roleId: "sales" }],
    thresholds: Object.fromEntries(["internet", "phone", "showroom"].map((name) => [name, { green: 20, yellow: 10 }])),
    months: { [MONTH]: { stats: { "alex example": { internetUnits: 1, phoneUnits: 0.5, showroomUnits: 0, campaignUnits: 0 } },
      reportedTotal: { count: 7, status: "provisional", month: MONTH, asOf: null } } },
  };
}
function dom() {
  const make = (tag) => ({ tag, style: {}, children: [], setAttribute(name, value) { this[name] = value; }, replaceChildren(...children) { this.children = children; } });
  return { root: make("root"), document: { createElement: make } };
}

test("board query selection fails closed for missing, duplicate or malformed store values", () => {
  assert.equal(boardRequest(""), null); assert.equal(boardRequest("?other=value"), null);
  assert.deepEqual(boardRequest("?board=" + ID), { storeId: ID });
  for (const search of ["?board", "?board=", "?board=one&board=two", "?board=one&board=one", "?Board=one", "?BOARD=one",
    "?board=lpc%3Aconfig%3Av2", "?board=..%2Fsecret", "?board=%20one", "?board=%3Cscript%3E", "?board=" + "x".repeat(129)]) {
    assert.ok(boardRequest(search)?.error, search);
  }
});

test("initial read selects only the canonical public board key and configured anonymous headers", async () => {
  const calls = [];
  const value = await readPublicBoard(ID, db, { fetchFn: async (url, options) => { calls.push({ url, options }); return response([{ value: row() }]); } });
  assert.equal(value.storeName, "Fictional Demo Motors"); assert.equal(calls.length, 1);
  const { url, options } = calls[0], target = new URL(url);
  assert.equal(target.origin, db.url); assert.equal(target.pathname, "/rest/v1/app_data");
  assert.deepEqual([...target.searchParams], [["key", "eq.lpc:board:" + ID + ":v1"], ["select", "value"]]);
  assert.equal(options.method, "GET"); assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store");
  assert.deepEqual(options.headers, { apikey: db.anonKey, Authorization: "Bearer " + db.anonKey });
});

test("invalid identifiers and database details never reach transport", async () => {
  let calls = 0; const fetchFn = async () => { calls++; return response([]); };
  for (const id of ["", "lpc:store:private", "../config", [], null]) await assert.rejects(readPublicBoard(id, db, { fetchFn }));
  for (const config of [null, {}, { ...db, anonKey: "" }, { ...db, url: "javascript:alert(1)" }, { ...db, url: "https://user:password@example.invalid" }]) {
    await assert.rejects(readPublicBoard(ID, config, { fetchFn }));
  }
  assert.equal(calls, 0);
});

test("absence and response failures do not restore a session or refresh authentication", async () => {
  assert.equal(await readPublicBoard(ID, db, { fetchFn: async () => response([]) }), null);
  for (const status of [401, 403, 404, 500]) {
    const calls = [];
    await assert.rejects(readPublicBoard(ID, db, { fetchFn: async (url, options) => { calls.push({ url, options }); return response([], status); } }));
    assert.equal(calls.length, 1); assert.equal(calls[0].options.method, "GET"); assert.doesNotMatch(calls[0].url, /auth\/v1/);
  }
  for (const value of [null, {}, [{ value: null }], [{ value: [] }], [{ value: row() }, { value: row() }]]) {
    await assert.rejects(readPublicBoard(ID, db, { fetchFn: async () => response(value) }));
  }
  await assert.rejects(readPublicBoard(ID, db, { fetchFn: async () => ({ ok: true, json: async () => { throw Error("fictional invalid JSON"); } }) }));
});

test("both a stalled fetch and stalled response body time out without another request", async () => {
  for (const fetchFn of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    await assert.rejects(readPublicBoard(ID, db, { fetchFn, timeoutMs: 5 }), /timed out/);
  }
});

test("public rows cannot choose a database, token, key, sibling list or extra payload", () => {
  const value = { ...row(), db: { url: "https://private.invalid", anonKey: "PRIVATE_ROW_SENTINEL" }, tokens: { access_token: "PRIVATE_ROW_SENTINEL" },
    storeKey: "lpc:store:private", storesKey: "lpc:config:v2", readOnly: false, siblings: [{ key: "lpc:store:private" }], extra: "PRIVATE_ROW_SENTINEL" };
  const payload = readOnlyPayload(value, ID, db, NONCE);
  assert.equal(payload.storeId, ID); assert.equal(payload.storeKey, "lpc:board:" + ID + ":v1"); assert.equal(payload.storesKey, "lpc:board:stores:v1");
  assert.deepEqual(payload.db, db); assert.equal(payload.tokens, null); assert.equal(payload.readOnly, true);
  assert.equal(payload.siblings, undefined); assert.equal(payload.months, undefined); assert.equal(JSON.stringify(payload).includes("PRIVATE_ROW_SENTINEL"), false);
});

test("standalone glyphs exactly match the deployed app atlas without importing the app", () => {
  const source = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
  assert.deepEqual(Object.keys(BOARD_GLYPHS).sort(), ["car", "check", "clock", "close", "dot", "gear", "tridown", "triup", "warn"]);
  for (const [name, value] of Object.entries(BOARD_GLYPHS)) {
    const match = source.match(new RegExp("^  " + name + ":\\s*(\\[[^\\n]+\\])", "m")); assert.ok(match);
    assert.deepEqual(value, JSON.parse(match[1]));
  }
});

test("board bootstrap renders the actual template and never supplies session or write capabilities", async () => {
  const { root, document } = dom(); const scheduled = [];
  const stop = mountReadOnlyBoard({ request: { storeId: ID }, root, document, db, read: async () => row(), schedule: (fn, ms) => { scheduled.push({ fn, ms }); } });
  for (let i = 0; i < 20 && root.children[0]?.tag !== "iframe"; i++) await new Promise((resolve) => setImmediate(resolve));
  const frame = root.children[0]; assert.equal(frame.tag, "iframe"); assert.equal(frame.title, "TV Board");
  assert.match(frame.srcdoc, /"tokens":null/); assert.match(frame.srcdoc, /"readOnly":true/);
  assert.match(frame.srcdoc, /Content-Security-Policy/); assert.equal(scheduled.length, 0); stop();
});

test("failed or absent bootstrap retries reads, while stop and late responses cannot mount a frame", async () => {
  const { root, document } = dom(); const scheduled = []; let calls = 0, complete;
  const stop = mountReadOnlyBoard({ request: { storeId: ID }, root, document, db, read: async () => { calls++; return calls === 1 ? null : new Promise((r) => { complete = r; }); },
    schedule(fn, ms) { scheduled.push({ fn, ms }); return 9; }, cancel() {} });
  await settle(); assert.match(root.children[0].textContent, /No published board/); assert.equal(scheduled[0].ms, 60000);
  scheduled[0].fn(); await settle(); stop(); complete(row()); await settle(); assert.equal(root.children.length, 0);
  scheduled[0].fn(); await settle(); assert.equal(calls, 2);
  const invalid = dom(); let reads = 0;
  mountReadOnlyBoard({ ...invalid, db, request: { error: "invalid" }, read: () => { reads++; } });
  assert.equal(reads, 0); assert.equal(invalid.root.children[0].role, "alert");
});

async function renderer({ status = 200, readOnly = true, data = row() } = {}) {
  const elements = new Map(), intervals = [], requests = [], reads = [], writes = []; let saves = 0;
  const element = () => ({ innerHTML: "", textContent: "", value: "", style: { setProperty() {} }, classList: { add() {}, remove() {}, contains: () => false }, querySelectorAll: () => [], getAttribute: () => null });
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : ["2026-09-07T16:00:00Z"])); } static now() { return new Date("2026-09-07T16:00:00Z").getTime(); } }
  const parent = { __lpcSaveBoardDisplay: async () => { saves++; return true; } }, window = { parent, innerHeight: 1080, addEventListener() {} };
  const context = vm.createContext({ window, Date: Clock, Intl, URL, console, setTimeout: () => 1, clearTimeout() {},
    setInterval(fn, ms) { intervals.push({ fn, ms }); return 1; }, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    document: { body: element(), getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem(key) { reads.push(key); assert.notEqual(key, "lpc-auth"); return null; }, setItem(key) { writes.push(key); assert.notEqual(key, "lpc-auth"); } },
    fetch: async (url, options) => { requests.push({ url, options }); return response([{ value: new URL(url).searchParams.get("key") === "eq.lpc:board:stores:v1" ? { stores: [] } : data }], status); },
  });
  const payload = { ...readOnlyPayload(data, ID, db, NONCE), readOnly, tokens: { access_token: "FICTIONAL_SESSION", refresh_token: "FICTIONAL_REFRESH", ...db } };
  const html = LEADERBOARD_HTML(payload, BOARD_GLYPHS);
  let script = [...html.matchAll(/<script(?: nonce="[a-f0-9]+")?>([\s\S]*?)<\/script>/g)][0][1];
  script += "\nglobalThis.testBoard = { getStoreByKey, refreshToken, loop };";
  vm.runInContext(script, context); await settle();
  return { context, elements, intervals, requests, reads, writes, saves: () => saves, html };
}

test("actual read-only renderer polls with anonymous GETs and has no auth heartbeat or opener saves", async () => {
  const board = await renderer();
  assert.match(board.elements.get("root").innerHTML, /Provisional/);
  assert.match(board.elements.get("root").innerHTML, /Displayed associate credits: 1\.5/);
  assert.equal(board.intervals.some((t) => t.ms === 40 * 60 * 1000), false);
  assert.equal(await board.context.testBoard.refreshToken(), false);
  await board.intervals.find((t) => t.ms === 15 * 60 * 1000).fn(); await settle();
  await board.elements.get("tsave").onclick(); assert.equal(board.saves(), 0);
  for (const { url, options } of board.requests) {
    assert.equal(new URL(url).origin, db.url); assert.equal(options.method, "GET"); assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, "Bearer " + db.anonKey); assert.doesNotMatch(url, /auth\/v1|client-error|vitals/);
  }
});

test("actual renderer refuses private keys and authentication errors without any refresh attempt", async () => {
  const board = await renderer({ status: 401 }); const before = board.requests.length;
  for (const key of ["lpc:config:v2", "lpc:store:private", "lpc:board:../private", "lpc:board:one?other=private", null]) {
    const value = await board.context.testBoard.getStoreByKey(key); assert.match(value.__err, /cannot read/);
  }
  assert.equal(board.requests.length, before); assert.equal(await board.context.testBoard.refreshToken(), false);
  assert.ok(board.requests.every((r) => r.options.method === "GET"));
});

test("the normal renderer keeps its auth heartbeat and existing opener-save behavior", async () => {
  const board = await renderer({ readOnly: false });
  assert.equal(board.intervals.some((t) => t.ms === 40 * 60 * 1000), true);
  await board.elements.get("tsave").onclick(); assert.equal(board.saves(), 1);
});

test("missing reportedTotal remains Unknown and never reads or manufactures private observations", async () => {
  const data = row(); delete data.months[MONTH].reportedTotal; data.deliverySummaryObservations = "PRIVATE_OBSERVATION_SENTINEL";
  const board = await renderer({ data });
  assert.match(board.elements.get("root").innerHTML, /Unknown/); assert.doesNotMatch(board.html, /PRIVATE_OBSERVATION_SENTINEL/);
  assert.ok(board.requests.every((r) => new URL(r.url).searchParams.get("key").startsWith("eq.lpc:board:")));
});

test("read-only HTML protects its script boundary and requires a fresh nonce", () => {
  const payload = readOnlyPayload({ ...row(), storeName: '</title><meta http-equiv="refresh" content="0;url=/?normal=1"><script>fetch("/api/fictional",{method:"POST"})</script>' }, ID, db, NONCE);
  const html = LEADERBOARD_HTML(payload, BOARD_GLYPHS);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<title>'));
  assert.match(html, /script-src 'nonce-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'/);
  assert.doesNotMatch(html, /<meta http-equiv="refresh"/);
  assert.match(html, /&lt;\/title&gt;/);
  assert.match(html, /\\u003c\/title>/); assert.equal([...html.matchAll(/<script nonce=/g)].length, 1);
  assert.throws(() => LEADERBOARD_HTML({ ...payload, readOnlyNonce: "invalid" }, BOARD_GLYPHS));
});

test("actual entry dispatch loads the normal bootstrap only when board mode is absent", async () => {
  const entry = new URL("../src/main.jsx", import.meta.url);
  const output = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, write: false, platform: "browser", format: "iife", logLevel: "silent",
    define: { "import.meta.env": JSON.stringify({ VITE_SUPABASE_URL: db.url, VITE_SUPABASE_ANON_KEY: db.anonKey }) },
    plugins: [{ name: "observe-normal-bootstrap-selection", setup(builder) {
      builder.onResolve({ filter: /app-entry\.jsx$/ }, () => ({ path: "normal", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "globalThis.normalBooted = true;" }));
    } }],
  });
  for (const search of ["", "?board=" + ID, "?board=", "?board=one&board=two"]) {
    const { root, document } = dom(); let gets = 0; const events = {}, timers = [];
    const context = vm.createContext({ window: { location: { search }, addEventListener(name, fn) { events[name] = fn; } }, document: { ...document, getElementById: () => root, querySelectorAll: () => [] },
      URLSearchParams, URL, AbortController, crypto: globalThis.crypto, setTimeout(fn, ms) { timers.push({ fn, ms }); return 1; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
      fetch: async () => { gets++; return response([]); },
    });
    vm.runInContext(output.outputFiles[0].text, context); await settle();
    assert.equal(context.normalBooted === true, search === "");
    assert.equal(gets, search === "?board=" + ID ? 1 : 0);
    if (search === "?board=" + ID) {
      events.pagehide({ persisted: true });
      timers.find((timer) => timer.ms === 60000).fn(); await settle(); assert.equal(gets, 2);
      events.pagehide({ persisted: false });
      timers.filter((timer) => timer.ms === 60000).at(-1).fn(); await settle(); assert.equal(gets, 2);
    }
  }
});


test("board build watch keeps GET-only update and nightly checks without normal app effects", async () => {
  const intervals = [], cancelled = [], requests = []; let reloads = 0, resolve;
  const doc = (name) => ({ querySelectorAll: () => [{ getAttribute: () => name }] });
  const stop = watchBoardBuild({ window: { location: { search: "?board=" + ID, pathname: "/", reload() { reloads++; } } }, document: doc("/assets/old.js"),
    fetchFn: async (url, options) => { requests.push({ url, options }); return { ok: true, text: async () => "current" }; },
    schedule(fn, ms) { intervals.push({ fn, ms }); return ms; }, cancel: (timer) => cancelled.push(timer),
    parse: () => doc("/assets/new.js"), now: () => new Date(2026, 8, 7, 4, 2) });
  await intervals.find((x) => x.ms === 600000).fn(); assert.equal(reloads, 1);
  assert.equal(requests[0].options.method, "GET"); assert.equal(requests[0].options.credentials, "omit"); assert.equal(requests[0].options.cache, "no-store"); assert.ok(requests[0].options.signal);
  assert.match(requests[0].url, /^\/\?_build=\d+$/);
  intervals.find((x) => x.ms === 300000).fn(); assert.equal(reloads, 2);
  stop(); await intervals[0].fn(); intervals[1].fn(); assert.equal(reloads, 2); assert.equal(cancelled.length, 2);
  const pending = [];
  const stopPending = watchBoardBuild({ window: { location: { search: "?board=" + ID, pathname: "/", reload() { reloads++; } } }, document: doc("old.js"),
    fetchFn: () => new Promise((r) => { resolve = r; }), schedule(fn) { pending.push(fn); }, cancel() {}, parse: () => doc("new.js") });
  const inflight = pending[0](); stopPending(); resolve({ ok: true, text: async () => "changed" }); await inflight;
  assert.equal(reloads, 2);
});

test("normal startup stays byte-identical while worker caches its entry and static closure", async () => {
  const normal = fs.readFileSync(new URL("../src/app-entry.jsx", import.meta.url));
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(normal).digest("hex"), "3ad65c837403e8006f0433dcfa0f00255bb5293f266225b3d40c28bd8654482f");
  const { default: config } = await import("../vite.config.js");
  const worker = config.plugins.find((plugin) => plugin.name === "sage-worker");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sage-readonly-cache-"));
  try {
    fs.writeFileSync(path.join(directory, "index.html"), '<script src="/assets/dispatcher.js"></script><link href="/fonts/fixture.woff2">');
    worker.configResolved({ build: { outDir: directory } });
    worker.generateBundle({}, {
      "assets/app.js": { type: "chunk", facadeModuleId: null, moduleIds: ["/src/app-entry.jsx"], fileName: "assets/app.js", imports: ["assets/vendor.js"], dynamicImports: ["assets/Manager.js"], viteMetadata: { importedCss: new Set(["assets/app.css"]) } },
      "assets/vendor.js": { type: "chunk", imports: [], viteMetadata: { importedCss: new Set() } },
    });
    worker.closeBundle();
    const sw = fs.readFileSync(path.join(directory, "sw.js"), "utf8");
    const cached = JSON.parse(sw.match(/const PRECACHE = (.+);/)[1]);
    assert.deepEqual(cached, ["/", "/assets/dispatcher.js", "/fonts/fixture.woff2", "/assets/app.js", "/assets/vendor.js", "/assets/app.css"]);
    assert.equal(cached.includes("/assets/Manager.js"), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


test("board build checks cannot activate a shared worker or restart a normal app tab", async () => {
  const intervals = [], calls = [], notices = []; let reloads = 0;
  const normalTab = { reloads: 0, startupWrites: 0 };
  const registration = { async update() { calls.push("update"); }, unregister() { calls.push("unregister"); },
    waiting: { postMessage() { calls.push("SKIP_WAITING"); normalTab.reloads++; normalTab.startupWrites++; } } };
  const workers = { controller: {}, register() { calls.push("register"); return Promise.resolve(registration); },
    async getRegistration() { calls.push("getRegistration"); return registration; },
    async getRegistrations() { calls.push("getRegistrations"); return [registration]; },
    addEventListener() { calls.push("worker listener"); }, removeEventListener() { calls.push("worker listener removal"); } };
  const doc = (name) => ({ querySelectorAll: () => [{ getAttribute: () => name }] });
  const stop = watchBoardBuild({ window: { navigator: { serviceWorker: workers }, location: { search: "?board=" + ID, pathname: "/", reload() { reloads++; } } },
    document: doc("old.js"), parse: () => doc("new.js"), schedule(fn, ms) { intervals.push({ fn, ms }); }, cancel() {},
    now: () => new Date(2026, 8, 7, 4, 2), onUpdateBlocked: () => notices.push("update available"),
    fetchFn: async () => ({ ok: true, text: async () => "new HTML" }) });
  await intervals.find((x) => x.ms === 600000).fn();
  await intervals.find((x) => x.ms === 600000).fn();
  intervals.find((x) => x.ms === 300000).fn();
  stop(); stop();
  assert.deepEqual(calls, []); assert.deepEqual(normalTab, { reloads: 0, startupWrites: 0 });
  assert.equal(reloads, 0); assert.deepEqual(notices, ["update available"]);
  assert.ok(registration.waiting, "a waiting worker is left to its owning app");
});

test("stalled watcher fetch and body checks are bounded, aborted and cannot overlap", async () => {
  for (const phase of ["fetch", "body"]) {
    const intervals = [], timers = [], requests = []; let resolveFetch, resolveBody, reads = 0, parses = 0, reloads = 0;
    const doc = (name) => ({ querySelectorAll: () => [{ getAttribute: () => name }] });
    const stop = watchBoardBuild({ window: { location: { search: "?board=" + ID, pathname: "/", reload() { reloads++; } } }, document: doc("old.js"),
      schedule(fn) { intervals.push(fn); }, cancel() {}, later(fn, ms) { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; }, clearLater(timer) { timer.cleared = true; },
      parse() { parses++; return doc("new.js"); },
      fetchFn: (url, options) => { requests.push(options); return phase === "fetch" ? new Promise((r) => { resolveFetch = r; })
        : Promise.resolve({ ok: true, text: () => { reads++; return new Promise((r) => { resolveBody = r; }); } }); } });
    const first = intervals[0](); await settle();
    intervals[0](); intervals[0](); await settle(); assert.equal(requests.length, 1, phase + " overlapping reads");
    assert.equal(timers.length, 1); assert.equal(timers[0].ms, 12000); timers[0].fn(); await first;
    assert.equal(requests[0].signal.aborted, true); assert.equal(timers[0].cleared, true);
    const second = intervals[0](); await settle(); assert.equal(requests.length, 2, phase + " retry after timeout");
    let ended = false; second.then(() => { ended = true; }); stop(); stop(); await settle(); assert.equal(ended, true); await second; assert.equal(requests[1].signal.aborted, true);
    if (phase === "fetch") resolveFetch({ ok: true, text: async () => { reads++; return "late"; } }); else resolveBody("late");
    await settle(); assert.equal(reads, phase === "fetch" ? 0 : 2); assert.equal(parses, 0); assert.equal(reloads, 0);
    await intervals[0](); assert.equal(requests.length, 2);
  }
});

test("watcher errors release the pending check and late bodies cannot publish after stop", async () => {
  const intervals = [], doc = (name) => ({ querySelectorAll: () => [{ getAttribute: () => name }] }); let calls = 0, reloads = 0, parseCalls = 0, resolveBody;
  const stop = watchBoardBuild({ window: { location: { search: "?board=" + ID, pathname: "/", reload() { reloads++; } } }, document: doc("old.js"),
    schedule(fn) { intervals.push(fn); }, cancel() {}, parse() { parseCalls++; return doc("new.js"); },
    fetchFn: async () => { calls++; return calls === 1 ? { ok: false } : calls === 2 ? { ok: true, text: async () => { throw Error("fictional body error"); } }
      : { ok: true, text: () => new Promise((r) => { resolveBody = r; }) }; } });
  await intervals[0](); await intervals[0](); const pending = intervals[0](); await settle(); assert.equal(calls, 3);
  let ended = false; pending.then(() => { ended = true; }); stop(); await settle(); assert.equal(ended, true); await pending; resolveBody("late"); await settle();
  assert.equal(parseCalls, 0); assert.equal(reloads, 0);
});

test("initial read cancellation and bootstrap cleanup invalidate every late response and render", async () => {
  const signal = new AbortController(); let resolveFetch, bodies = 0;
  const pending = readPublicBoard(ID, db, { signal: signal.signal, timeoutMs: 20,
    fetchFn: () => new Promise((r) => { resolveFetch = r; }) });
  signal.abort(); await assert.rejects(pending, /cancelled/);
  resolveFetch({ ok: true, json: async () => { bodies++; return [{ value: row() }]; } }); await settle(); assert.equal(bodies, 0);
  for (const phase of ["read", "render"]) {
    const { root, document } = dom(); let resolveRead, resolveRender, renders = 0, passedSignal; const timers = [];
    const stop = mountReadOnlyBoard({ request: { storeId: ID }, root, document, db,
      read: (id, config, options) => { passedSignal = options?.signal; return phase === "read" ? new Promise((r) => { resolveRead = r; }) : Promise.resolve(row()); },
      render: () => { renders++; return new Promise((r) => { resolveRender = r; }); }, schedule(fn) { timers.push(fn); }, cancel() {} });
    await settle(); stop(); stop(); const after = [...root.children]; assert.equal(passedSignal.aborted, true);
    if (phase === "read") resolveRead(row()); else resolveRender("late HTML"); await settle();
    assert.deepEqual(root.children, after); assert.equal(timers.length, 0); assert.equal(renders, phase === "read" ? 0 : 1);
  }
});


test("a late build response cannot reload a URL that has left board mode", async () => {
  let reloads = 0; const intervals = [], location = { search: "?board=" + ID, pathname: "/", reload() { reloads++; } };
  const doc = (name) => ({ querySelectorAll: () => [{ getAttribute: () => name }] }); let resolveBody;
  const stop = watchBoardBuild({ window: { location }, document: doc("old.js"), parse: () => doc("new.js"),
    schedule(fn) { intervals.push(fn); }, cancel() {}, fetchFn: async () => ({ ok: true, text: () => new Promise((r) => { resolveBody = r; }) }) });
  const pending = intervals[0](); await settle(); location.search = ""; resolveBody("new HTML"); await pending; stop(); assert.equal(reloads, 0);
});
