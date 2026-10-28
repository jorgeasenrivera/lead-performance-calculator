/* The spacing fixture, on fabricated rows and a fake browser context. No browser, no network, no mock server. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeRowFixture, tablePlan, rewriteBody, answerRpc, installSpacingRoutes, readAppDataRow, MOCK_ORIGIN, FAILURES, CONFIG_KEY, storeKey, BASE_STORE, SECOND_STORE } from "../scripts/manager-spacing-fixture.mjs";

const SRC = process.env.SPACING_SRC && fs.readFileSync(process.env.SPACING_SRC, "utf8");
const PATCHED = process.env.SPACING_PATCHED && fs.readFileSync(process.env.SPACING_PATCHED, "utf8");
const HELPER = fs.readFileSync(new URL("../scripts/manager-spacing-fixture.mjs", import.meta.url), "utf8");

const NOW_A = new Date(Date.UTC(2031, 1, 3, 3, 0, 0));    // 22:00 on 2 February in New York
const NOW_B = new Date(Date.UTC(2031, 2, 1, 2, 0, 0));    // 21:00 on 28 February in New York
const DOCKS = [null, { rooms: 1, done: 0 }, { rooms: 2, done: 0 }, { rooms: 1, done: 1 }, { rooms: 2, done: 2 }];
const configRow = () => ({ key: CONFIG_KEY, updated_at: "2031-01-01T00:00:00.000Z", value: { version: 2, stores: [{ id: "sage-demo", name: "Demo", rooms: { floor: false, line: false }, tz: "America/New_York" }], standards: { "sage-demo": { sales: { tiers: [1, 2] } } }, holidays: [] } });
const storeRow = () => ({ key: storeKey("sage-demo"), updated_at: "2031-02-02T10:00:00.000Z", value: { people: [{ id: "p1" }], months: { "2031-02": { imports: { "2031-02-01": { appointment: true }, "2031-02-02": { video: true } }, other: 1 }, "2031-01": { imports: {} } } } });
const bareRow = () => ({ key: storeKey("sage-demo"), value: { people: [] } });
const ROWS = () => [configRow(), storeRow(), bareRow(), { key: "lpc:other", value: { a: 1 } }, { key: "k", value: null }, { key: "k" }, null, undefined];

/* The ORIGINAL inline rewrite, cut from the real manager-spacing.mjs text and evaluated, with the clock replaceable. */
function original(second, dockFixture, now) {
  const a = SRC.indexOf("const addStore="), b = SRC.indexOf("await route.fulfill({response,json:Array.isArray(data)?data.map(fixture):fixture(data)});");
  assert.ok(a > 0 && b > a, "the inline rewrite was found in the real script");
  const FixedDate = class extends Date { constructor(...args) { super(...(args.length ? args : [now.getTime()])); } };
  return new Function("second", "dockFixture", "Date", SRC.slice(a, b) + "\nreturn fixture;")(second, dockFixture, FixedDate);
}
const skipSrc = { skip: "set SPACING_SRC (the real manager-spacing.mjs) to run" };

test("the table rewrite is the original inline code, row for row: second store, dock rooms and imports, both clocks, array and single bodies", skipSrc.skip && !SRC ? skipSrc : {}, () => {
  let n = 0;
  for (const second of [false, true]) for (const dock of DOCKS) for (const now of [NOW_A, NOW_B]) for (const row of ROWS()) {
    const mine = makeRowFixture({ second, dock: () => dock, now: () => now })(structuredClone(row));
    const theirs = original(second, dock, now)(structuredClone(row));
    assert.deepEqual(mine, theirs, JSON.stringify({ second, dock, row: row && row.key }));
    n++;
  }
  assert.equal(n, 160);
  for (const second of [false, true]) for (const dock of DOCKS) {
    const body = [configRow(), storeRow()], one = storeRow();
    assert.deepEqual(rewriteBody(structuredClone(body), makeRowFixture({ second, dock: () => dock, now: () => NOW_A })), structuredClone(body).map(original(second, dock, NOW_A)));
    assert.deepEqual(rewriteBody(structuredClone(one), makeRowFixture({ second, dock: () => dock, now: () => NOW_A })), original(second, dock, NOW_A)(structuredClone(one)));
  }
});

test("the table rewrite does what the spacing check relies on (stated here so the equivalence above is not the only evidence)", () => {
  const cfg = makeRowFixture()(configRow()).value;
  assert.deepEqual(cfg.stores.map((s) => s.id), ["sage-demo", "spacing-demo-2"]); assert.equal(cfg.stores[1].name, "Second Fictional Store"); assert.deepEqual(cfg.standards["spacing-demo-2"], cfg.standards["sage-demo"]);
  const second = makeRowFixture({ second: true })(storeRow());
  assert.equal(second.key, storeKey("spacing-demo-2")); assert.equal(second.value.__storeId, "spacing-demo-2");
  const first = makeRowFixture({ second: false })(storeRow()); assert.equal(first.key, storeKey("sage-demo")); assert.equal(first.value.__storeId, undefined);
  const dock = makeRowFixture({ dock: () => ({ rooms: 2, done: 2 }), now: () => NOW_A });
  assert.deepEqual(dock(configRow()).value.stores.map((s) => s.rooms), [{ floor: true, line: true }, { floor: true, line: true }]);
  assert.deepEqual(dock(storeRow()).value.months["2031-02"].imports["2031-02-02"], { appointment: true, video: true, activity: true }, "the New York day, not the UTC day");
  assert.deepEqual(dock(storeRow()).value.months["2031-02"].imports["2031-02-01"], { appointment: true }, "other days are kept");
  assert.deepEqual(makeRowFixture({ dock: () => ({ rooms: 1, done: 0 }), now: () => NOW_A })(storeRow()).value.months["2031-02"].imports["2031-02-02"], {});
  assert.deepEqual(makeRowFixture({ dock: () => ({ rooms: 1, done: 1 }), now: () => NOW_B })(storeRow()).value.months["2031-02"].imports["2031-02-28"], { appointment: true }, "month rollover in New York");
});

test("which table requests are for the second store, and where they are really sent", () => {
  const u = "http://127.0.0.1:5433/rest/v1/app_data?select=key%2Cvalue&key=eq.lpc%3Astore%3Aspacing-demo-2%3Av2";
  assert.deepEqual(tablePlan(u), { second: true, fetchUrl: u.replace("spacing-demo-2", "sage-demo") });
  assert.deepEqual(tablePlan("http://x/app_data?a=spacing-demo-2&b=spacing-demo-2").fetchUrl, "http://x/app_data?a=sage-demo&b=sage-demo", "every occurrence");
  const plain = "http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc%3Aconfig%3Av2";
  assert.deepEqual(tablePlan(plain), { second: false, fetchUrl: plain });
});

/* ---- the candidate's RPCs ---- */
const reader = (rows, calls = []) => async (key) => { calls.push(key); return rows.find((r) => r.key === key); };
const rpc = (name, body, rows, over = {}) => { const calls = []; return answerRpc({ name, bodyText: typeof body === "string" ? body : JSON.stringify(body), readRow: reader(rows, calls), ...over }).then((a) => ({ a, calls })); };

test("sage_config_read answers { value } and the value is exactly what the table path would have shown, for every dock state", async () => {
  for (const dock of DOCKS) {
    const { a, calls } = await rpc("sage_config_read", {}, [configRow(), storeRow()], { dock: () => dock, now: () => NOW_A });
    assert.equal(a.status, 200); assert.deepEqual(Object.keys(a.json), ["value"]); assert.deepEqual(calls, [CONFIG_KEY]);
    assert.deepEqual(a.json.value, makeRowFixture({ dock: () => dock, now: () => NOW_A })(configRow()).value);
    assert.deepEqual(a.json.value.stores.map((s) => s.id), ["sage-demo", "spacing-demo-2"]);
  }
  assert.deepEqual((await rpc("sage_config_read", "", [])).a, { status: 200, json: { value: null } }, "no row: value null, as the candidate fixture");
  assert.deepEqual((await rpc("sage_config_read", "not json", [configRow()])).a.status, 200, "config takes no arguments");
});

test("sage_store_read answers { value, updated_at, activity: {} } with the first-store and second-store rewrites, and the table path's dock imports", async () => {
  for (const dock of DOCKS) {
    const first = await rpc("sage_store_read", { p_store: "sage-demo" }, [storeRow()], { dock: () => dock, now: () => NOW_A });
    assert.deepEqual(first.a, { status: 200, json: { value: makeRowFixture({ dock: () => dock, now: () => NOW_A })(storeRow()).value, updated_at: "2031-02-02T10:00:00.000Z", activity: {} } });
    assert.deepEqual(first.calls, [storeKey("sage-demo")]);
    const second = await rpc("sage_store_read", { p_store: SECOND_STORE }, [storeRow()], { dock: () => dock, now: () => NOW_A });
    assert.deepEqual(second.calls, [storeKey(BASE_STORE)], "the second store's rows live under the first store's id");
    assert.equal(second.a.json.value.__storeId, "spacing-demo-2");
    assert.deepEqual(second.a.json.value, makeRowFixture({ second: true, dock: () => dock, now: () => NOW_A })(storeRow()).value);
  }
  assert.deepEqual((await rpc("sage_store_read", { p_store: "sage-demo" }, [])).a, { status: 200, json: null }, "no row: null");
  assert.equal((await rpc("sage_store_read", { p_store: "sage-demo" }, [bareRow()])).a.json.updated_at, null, "no timestamp on the row: null, as the candidate fixture");
  const other = await rpc("sage_store_read", { p_store: "other-store" }, [{ key: storeKey("other-store"), value: { people: [] } }]);
  assert.deepEqual(other.calls, [storeKey("other-store")]); assert.equal(other.a.json.value.__storeId, undefined, "only the second store is rewritten");
});

test("sage_store_read validates its argument like the candidate fixture and reads nothing when it is wrong", async () => {
  const bad = [{}, { p_store: null }, { p_store: 5 }, { p_store: ["sage-demo"] }, { p_store: "" }, { p_store: " sage-demo" }, { p_store: "a/b" }, { p_store: "-bad" }, { p_store: "x".repeat(65) }, { p_store: "sage-demo", extra: 1, p_store2: 1 } && { p_store: "a b" }, "", "not json", "[]", "null", '"str"', "5"];
  for (const body of bad) {
    const { a, calls } = await rpc("sage_store_read", body, [storeRow()]);
    assert.deepEqual(a, { status: 400, json: { code: "22023", message: "store required", details: "", hint: "" } }, JSON.stringify(body)); assert.deepEqual(calls, [], "no read");
  }
  assert.deepEqual((await rpc("sage_store_read", { p_store: "x".repeat(64) }, [])).calls, [storeKey("x".repeat(64))], "64 characters is fine");
  assert.equal((await rpc("sage_store_read", { p_store: "sage-demo", extra: 1 }, [storeRow()])).a.status, 200, "extra keys are not this module's concern");
});

test("any other function is not answered here (null), and nothing is read", async () => {
  for (const name of ["sage_schedule_read", "sage_config_save", "", "SAGE_CONFIG_READ", "sage_store_read_x", "sage_config_readx", "x"]) { const { a, calls } = await rpc(name, {}, [configRow()]); assert.equal(a, null, name); assert.deepEqual(calls, []); }
});

test("the dock is read when each call is made, as the script's variable was", async () => {
  let dock = null; const get = () => dock;
  assert.deepEqual((await rpc("sage_config_read", {}, [configRow()], { dock: get })).a.json.value.stores[0].rooms, { floor: false, line: false });
  dock = { rooms: 2, done: 0 };
  assert.deepEqual((await rpc("sage_config_read", {}, [configRow()], { dock: get })).a.json.value.stores[0].rooms, { floor: true, line: true });
});

/* ---- the routes, against a fake browser context ---- */
function fakeContext(rows = [configRow(), storeRow()], reply = {}) {
  const routes = [], gets = [], getOptions = [];
  return { routes, gets, getOptions, route: async (pattern, handler) => { routes.push({ pattern, handler }); },
    request: { get: async (url, options) => {
      gets.push(url); getOptions.push(options);
      if (reply.throws) throw new Error("socket hang up");
      const u = new URL(url); const key = u.searchParams.get("key").replace(/^eq\./, "");
      const body = "body" in reply ? reply.body : rows.filter((r) => r.key === key);
      return { status: () => reply.status ?? 200, json: async () => { if (reply.badJson) throw new SyntaxError("Unexpected token"); return body; } };
    } } };
}
function fakeRoute({ url, method = "GET", postData = null, mock = [], status = 200, fetchThrows = false }) {
  const calls = { fetch: [], fulfill: [], fallback: 0, abort: [] };
  return { calls, request: () => ({ url: () => url, method: () => method, postData: () => postData }),
    fetch: async (o) => { calls.fetch.push(o); if (fetchThrows) throw new Error("fetch failed"); return { json: async () => mock, tag: "mock-response", status: () => status }; },
    fulfill: async (o) => { calls.fulfill.push(o); }, fallback: async () => { calls.fallback++; }, abort: async (c) => { calls.abort.push(c); } };
}

test("installSpacingRoutes: the table route is unchanged in pattern and behaviour; the RPC route answers the two reads and passes everything else on", async () => {
  let dock = null; const ctx = fakeContext();
  const installed = await installSpacingRoutes(ctx, { dock: () => dock, now: () => NOW_A });
  assert.equal(installed.refusals().total, 0);
  assert.deepEqual(ctx.routes.map((r) => r.pattern), ["http://127.0.0.1:5433/rest/v1/app_data?**", "http://127.0.0.1:5433/rest/v1/rpc/*"]);
  const [table, rpcRoute] = ctx.routes.map((r) => r.handler);
  /* table, second store */
  const t = fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc%3Astore%3Aspacing-demo-2%3Av2", mock: [storeRow()] });
  await table(t);
  assert.deepEqual(t.calls.fetch, [{ url: "http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc%3Astore%3Asage-demo%3Av2" }], "the baseline table path is called exactly as before: no new options");
  assert.equal(t.calls.fulfill[0].response.tag, "mock-response"); assert.equal(t.calls.fulfill[0].json[0].value.__storeId, "spacing-demo-2");
  /* rpc: config, with the dock changed after install */
  dock = { rooms: 2, done: 0 };
  const c = fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/sage_config_read", method: "POST", postData: "{}", mock: [] });
  await rpcRoute(c);
  assert.deepEqual(c.calls.fetch, [{ maxRedirects: 0 }], "the original request goes to the mock, redirects off, so its headers carry the answer"); assert.equal(c.calls.fallback, 0);
  assert.equal(c.calls.fulfill[0].status, 200); assert.equal(c.calls.fulfill[0].response.tag, "mock-response");
  assert.deepEqual(c.calls.fulfill[0].json.value.stores.map((s) => s.rooms.line), [true, true]);
  assert.ok(ctx.gets[0].startsWith("http://127.0.0.1:5433/rest/v1/app_data?") && ctx.gets[0].includes("select=key%2Cvalue%2Cupdated_at") && ctx.gets[0].includes("key=eq.lpc%3Aconfig%3Av2"), ctx.gets[0]);
  assert.deepEqual(ctx.getOptions[0], { maxRedirects: 0, failOnStatusCode: false, timeout: 15000 }, "no redirects, status checked by us");
  /* rpc: second store reads the first store's row */
  const s = fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/sage_store_read", method: "POST", postData: JSON.stringify({ p_store: "spacing-demo-2" }) });
  await rpcRoute(s);
  assert.ok(ctx.gets[1].includes("key=eq.lpc%3Astore%3Asage-demo%3Av2")); assert.equal(s.calls.fulfill[0].json.value.__storeId, "spacing-demo-2");
  assert.equal(s.calls.fulfill[0].json.activity !== undefined, true);
  /* rpc: invalid argument answers 400 without reading */
  const before = ctx.gets.length; const v = fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/sage_store_read", method: "POST", postData: "{}" });
  await rpcRoute(v); assert.equal(v.calls.fulfill[0].status, 400); assert.equal(ctx.gets.length, before);
  /* rpc: other functions, other methods, odd urls: passed on untouched */
  for (const r of [fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/sage_schedule_read", method: "POST", postData: "{}" }), fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/sage_config_read", method: "OPTIONS" }),
    fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/sage_config_read", method: "GET" }), fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/Sage_Config_Read", method: "POST" }), fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/sage_config_read/extra", method: "POST" })]) {
    await rpcRoute(r); assert.equal(r.calls.fallback, 1, r.request().url() + " " + r.request().method()); assert.deepEqual(r.calls.fulfill, []); assert.deepEqual(r.calls.fetch, []);
  }
});

/* ---- the new RPC reads fail closed ---- */
/* The latch, read as { word: count } for the words that fired. */
const fired = (inst) => Object.fromEntries(Object.entries(inst.refusals().counts).filter(([, n]) => n > 0));
const lastWord = (inst, prev) => { const now = inst.refusals().counts; const w = Object.keys(now).filter((k) => now[k] > (prev[k] || 0)); assert.equal(w.length, 1, "exactly one word fired"); return w[0]; };
const logs = () => { const l = []; return { l, log: (x) => l.push(x) }; };
const cfgRoute = (extra = {}) => fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/sage_config_read", method: "POST", postData: "{}", ...extra });
const storeRoute = (extra = {}) => fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/rpc/sage_store_read", method: "POST", postData: JSON.stringify({ p_store: "sage-demo" }), ...extra });

test("routes are installed for the exact loopback 5433 origin only; any other origin is refused before a route exists", async () => {
  assert.equal(MOCK_ORIGIN, "http://127.0.0.1:5433");
  for (const origin of ["http://127.0.0.1:5434", "http://localhost:5433", "https://127.0.0.1:5433", "http://127.0.0.1:5433/", "http://127.0.0.1:5433?x=1", "http://127.0.0.1", "http://evil.example:5433", "http://[::1]:5433", "http://127.0.0.1:5433@evil.example", "", null, 5]) {
    const ctx = fakeContext();
    await assert.rejects(() => installSpacingRoutes(ctx, { origin }), (e) => e.reason === "bad-origin", String(origin));
    assert.equal(ctx.routes.length, 0, "nothing registered for " + String(origin)); assert.equal(ctx.gets.length, 0);
  }
  await assert.rejects(() => readAppDataRow(fakeContext(), CONFIG_KEY, "http://127.0.0.1:5434"), (e) => e.reason === "bad-origin");
  const ok = fakeContext(); assert.equal((await installSpacingRoutes(ok)).refusals().total, 0); assert.equal(ok.routes.length, 2);
});

test("a successful empty array is the ONLY missing row: config { value: null }, store null; every other reply to the row read aborts and records a fixed word", async () => {
  const empty = fakeContext([], {}); const { log } = logs(); const inst = await installSpacingRoutes(empty, { log });
  const rpcRoute = empty.routes[1].handler;
  const c = cfgRoute(); await rpcRoute(c); assert.deepEqual(c.calls.fulfill[0].json, { value: null }); assert.deepEqual(c.calls.abort, []);
  const s = storeRoute(); await rpcRoute(s); assert.equal(s.calls.fulfill[0].json, null); assert.deepEqual(s.calls.abort, []); assert.equal(inst.refusals().total, 0);
  const cases = [
    ["503", { status: 503, body: [] }, "read-status"], ["401", { status: 401, body: [] }, "read-status"], ["404", { status: 404, body: [] }, "read-status"], ["500 with JSON error", { status: 500, body: { message: "x" } }, "read-status"],
    ["201", { status: 201, body: [] }, "read-status"], ["204", { status: 204, body: [] }, "read-status"], ["206", { status: 206, body: [] }, "read-status"],
    ["301", { status: 301, body: [] }, "read-redirect"], ["302", { status: 302, body: [] }, "read-redirect"], ["307", { status: 307, body: [] }, "read-redirect"], ["308", { status: 308, body: [] }, "read-redirect"],
    ["object body", { body: {} }, "read-shape"], ["null body", { body: null }, "read-shape"], ["string body", { body: "x" }, "read-shape"], ["number body", { body: 5 }, "read-shape"],
    ["array of non-objects", { body: [1] }, "read-shape"], ["array of null", { body: [null] }, "read-shape"], ["nested array", { body: [[]] }, "read-shape"], ["two rows", { body: [configRow(), configRow()] }, "read-shape"],
    ["a row of another key", { body: [{ key: "lpc:other", value: {} }] }, "read-shape"], ["a row without a key", { body: [{ value: {} }] }, "read-shape"],
    ["unparseable body", { badJson: true }, "read-error"], ["request throws", { throws: true }, "read-error"],
  ];
  for (const [name, reply, reason] of cases) {
    const ctx = fakeContext([configRow(), storeRow()], reply), lg = logs(); const inst2 = await installSpacingRoutes(ctx, { log: lg.log });
    for (const mk of [cfgRoute, storeRoute]) {
      const r = mk(); await ctx.routes[1].handler(r);
      assert.deepEqual(r.calls.fulfill, [], `${name}: no answer is invented`); assert.deepEqual(r.calls.abort, ["failed"], name); assert.deepEqual(r.calls.fetch, [], `${name}: the mock is not asked for headers either`); assert.equal(r.calls.fallback, 0);
    }
    assert.deepEqual(fired(inst2), { [reason]: 2 }, name); assert.deepEqual(lg.l, [`spacing-fixture: ${reason}`, `spacing-fixture: ${reason}`], "one fixed line each, nothing else");
    assert.ok(Object.keys(inst2.refusals().counts).every((x) => FAILURES.includes(x)));
  }
});

test("the header fetch: redirects off, and an error, a redirect, a throw or a missing status aborts instead of being dressed up as success", async () => {
  const ctx = fakeContext(); const { l, log } = logs(); const inst = await installSpacingRoutes(ctx, { log });
  const handler = ctx.routes[1].handler;
  const ok = cfgRoute(); await handler(ok); assert.deepEqual(ok.calls.fetch, [{ maxRedirects: 0 }]); assert.equal(ok.calls.fulfill.length, 1); assert.deepEqual(ok.calls.abort, []);
  for (const [name, extra, reason] of [["503", { status: 503 }, "header-status"], ["401", { status: 401 }, "header-status"], ["204", { status: 204 }, "header-status"], ["302", { status: 302 }, "header-redirect"], ["301", { status: 301 }, "header-redirect"], ["throws", { fetchThrows: true }, "header-error"]]) {
    const prev = { ...inst.refusals().counts };
    const r = cfgRoute(extra); await handler(r);
    assert.deepEqual(r.calls.fulfill, [], name); assert.deepEqual(r.calls.abort, ["failed"], name); assert.deepEqual(r.calls.fetch, [{ maxRedirects: 0 }], name);
    assert.equal(lastWord(inst, prev), reason, name);
  }
  /* a response object with no status function at all */
  const prevOdd = { ...inst.refusals().counts };
  const odd = cfgRoute(); odd.fetch = async () => ({ json: async () => [], tag: "no-status" }); await handler(odd);
  assert.deepEqual(odd.calls.fulfill, []); assert.deepEqual(odd.calls.abort, ["failed"]); assert.equal(lastWord(inst, prevOdd), "header-status");
  assert.ok(l.every((x) => /^spacing-fixture: (header-status|header-redirect|header-error)$/.test(x)), "only fixed words are logged");
});

test("the read happens before the header fetch, and a request whose url is not under the exact origin is aborted, not answered", async () => {
  const ctx = fakeContext([], { status: 503 }); await installSpacingRoutes(ctx, { log: () => {} });
  const r = cfgRoute(); await ctx.routes[1].handler(r); assert.deepEqual(r.calls.fetch, [], "no header fetch after a failed read");
  const ctx2 = fakeContext(); const inst = await installSpacingRoutes(ctx2, { log: () => {} });
  for (const url of ["http://127.0.0.1:5434/rest/v1/rpc/sage_config_read", "http://evil.example/rest/v1/rpc/sage_config_read", "https://127.0.0.1:5433/rest/v1/rpc/sage_config_read"]) {
    const bad = fakeRoute({ url, method: "POST", postData: "{}" }); await ctx2.routes[1].handler(bad);
    assert.deepEqual(bad.calls.abort, ["failed"], url); assert.deepEqual(bad.calls.fulfill, []); assert.deepEqual(bad.calls.fetch, []);
  }
  assert.deepEqual(fired(inst), { "bad-origin": 3 });
});

test("the baseline table path is untouched by all of this: same pattern, same single fetch option, no abort path, no redirect option", async () => {
  const ctx = fakeContext(); await installSpacingRoutes(ctx, { log: () => {} });
  assert.equal(ctx.routes[0].pattern, "http://127.0.0.1:5433/rest/v1/app_data?**");
  const t = fakeRoute({ url: "http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc%3Aconfig%3Av2", mock: [configRow()], status: 503 });
  await ctx.routes[0].handler(t);
  assert.deepEqual(t.calls.fetch, [{ url: "http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc%3Aconfig%3Av2" }]); assert.equal(t.calls.fulfill.length, 1, "as before, whatever the status"); assert.deepEqual(t.calls.abort, []);
  const tableBlock = HELPER.slice(HELPER.indexOf("await context.route(`${origin}/rest/v1/app_data?**`"), HELPER.indexOf("await context.route(`${origin}/rest/v1/rpc/*`"));
  assert.ok(!/maxRedirects|abort|fail\(/.test(tableBlock));
});

test("the helper stays inside its box, and the one-place edit of manager-spacing.mjs changes nothing else", () => {
  assert.ok(!/^\s*import\s/m.test(HELPER), "no imports at all"); assert.ok(!/(?<!route\.)\bfetch\(|XMLHttpRequest|process\.env|child_process|localStorage|setTimeout|waitFor/.test(HELPER));
  if (!SRC || !PATCHED) return;
  const o = SRC.split("\n"), p = PATCHED.split("\n");
  const SUCCESS = "console.log('Keyboard/navigation passed: last row Enter/Escape, search clear, Summary return, dealer switching, People reachability and 150% text');";
  assert.equal(p.length, o.length - 21 + 1 + 1 + 1 + 1, "the 21-line block became one line, plus an import line, the early verdict line and the terminal verdict line (the success message only moved)");
  const imp = p.indexOf("import { installSpacingRoutes } from './manager-spacing-fixture.mjs';");
  assert.equal(imp, 4); assert.equal(o[3], "import { chromium, webkit } from 'playwright';");
  const call = p.indexOf("const spacingFx = await installSpacingRoutes(context, { dock: () => dockFixture });");
  assert.equal(p.filter((l) => l.includes("installSpacingRoutes(")).length, 1);
  const early = p.indexOf("  spacingFx.assertNoRefusals();"), fin = p.indexOf("} finally {"), term = p.indexOf("spacingFx.assertNoRefusals();");
  assert.equal(p.filter((l) => l.includes("assertNoRefusals")).length, 2, "an early and a terminal check, no more");
  assert.ok(early > 0 && p[early - 1] === "  assert.deepEqual(errors,[]);" && p[early + 1] === "} finally {", "the early check follows the last existing assertion and is the last line of the try");
  assert.ok(term > fin && p[term - 1] === "}" && p[term + 1] === SUCCESS, "the terminal check is the first statement after the try/finally, and the success message follows it");
  assert.equal(p.filter((l) => l.trim() === SUCCESS).length, 1);
  const geo = p.findIndex((l) => l.includes("fixtureRefusals:{scope:'until-geometry-write',...spacingFx.refusals()}"));
  assert.ok(geo > fin && geo < term, "the evidence is labelled with where it was captured");
  /* undo the edits: the import, the route block, the early check, the geometry change, the terminal check; the success message goes back into the try */
  const body = p.slice(call + 1, early).concat(p.slice(early + 1, term), p.slice(term + 2));
  const restored = [...p.slice(0, imp), ...p.slice(imp + 1, call), ...o.slice(25, 46), ...body];
  const gi = restored.findIndex((l) => l.includes("fixtureRefusals:{scope"));
  restored[gi] = restored[gi].replace(",fixtureRefusals:{scope:'until-geometry-write',...spacingFx.refusals()}", "");
  const fi = restored.indexOf("} finally {");
  restored.splice(fi, 0, "  " + SUCCESS);
  assert.deepEqual(restored, o, "undoing exactly these edits gives the original script, byte for byte");
  for (const kept of ["setDefaultTimeout(20000)", "setDefaultNavigationTimeout(30000)", "page.waitForFunction", "serviceWorkers: 'block'"]) assert.equal(PATCHED.split(kept).length, SRC.split(kept).length, kept + " unchanged");
});
