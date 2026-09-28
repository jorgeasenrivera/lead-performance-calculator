/* C92, the app's half: a screen with no account reaches the day's rows through
   /api/floor-row with the code it holds; a signed-in screen registers nothing
   and never comes this way. The module on its own, then the wiring in the app. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const ra = await import("../src/row-access.mjs");
const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mgr = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the rows it serves are the ones the app already names, and nothing else", () => {
  assert.deepEqual(ra.addressOf("floor_public", "dm:2026-09-28"), { room: "floor", store: "dm", date: "2026-09-28" });
  assert.deepEqual(ra.addressOf("queue_public", "dm:2026-09-28"), { room: "line", store: "dm", date: "2026-09-28" });
  assert.deepEqual(ra.addressOf("queue_public", "dm:2026-09-28:online"), { room: "online", store: "dm", date: "2026-09-28" });
  assert.equal(ra.addressOf("queue_public", "ticket:abc"), null, "tickets are not a day's row");
  assert.equal(ra.addressOf("floor_public", "dm:2026-09-28:online"), null);
  assert.equal(ra.addressOf("app_data", "dm:2026-09-28"), null);
});

test("a screen that registered nothing is sent to the table, as before", () => {
  assert.equal(ra.viaFor("floor_public", "zz:2026-09-28"), null);
});

test("today's code answers for that store's rows that day, and a TV's key when there is no code", () => {
  ra.rememberDayCode("dm", "2026-09-28", "abc123");
  assert.deepEqual(ra.viaFor("floor_public", "dm:2026-09-28").headers, { "x-sage-day-token": "abc123" });
  assert.deepEqual(ra.viaFor("queue_public", "dm:2026-09-28").headers, { "x-sage-day-token": "abc123" }, "the floor's code also reads the line");
  assert.equal(ra.viaFor("floor_public", "dm:2026-09-29"), null, "not another day");
  assert.equal(ra.viaFor("floor_public", "xx:2026-09-28"), null, "not another store");
  ra.rememberWallKey("tv", "K".repeat(32));
  assert.deepEqual(ra.viaFor("queue_public", "tv:2026-09-28").headers, { "x-sage-wall-key": "K".repeat(32) });
});

test("the code is kept on the phone for a table tag, one per store, today's only", () => {
  ra.rememberDayCode("tag", "2026-09-28", "t0d4y");
  assert.equal(ra.storedDayCode("tag", "2026-09-28"), "t0d4y");
  assert.equal(ra.storedDayCode("tag", "2026-09-29"), null, "yesterday's code opens nothing tomorrow");
  ra.rememberDayCode("tag", "2026-09-29", "n3xt");
  assert.equal(ra.storedDayCode("tag", "2026-09-28"), null, "and is replaced, not kept");
});

test("reads, writes and tickets say who is asking in headers, never the body", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({ row: { token: "abc123" }, stamp: "s1" }) }; };
  const via = ra.viaFor("floor_public", "dm:2026-09-28");
  await ra.readVia(via, "s0", fetchImpl);
  await ra.writeVia(via, { token: "abc123", line: [] }, fetchImpl);
  assert.equal(await ra.ticketVia("dm", "2026-09-28", { id: "tk12345" }, fetchImpl), true);
  assert.equal(await ra.ticketVia("nowhere", "2026-09-28", { id: "tk12345" }, fetchImpl), false, "no code, no ticket this way");
  assert.equal(sent.length, 3);
  for (const s of sent) {
    assert.equal(s.url, "/api/floor-row");
    assert.equal(s.init.headers["x-sage-day-token"], "abc123");
    assert.ok(!JSON.parse(s.init.body).token, "the code is not in the body");
  }
  assert.deepEqual(JSON.parse(sent[0].init.body), { op: "read", room: "floor", store: "dm", date: "2026-09-28", stamp: "s0" });
  const refused = async () => ({ ok: false, status: 403, json: async () => ({ error: "that code is not today's" }) });
  await assert.rejects(() => ra.readVia(via, null, refused), /not today's/, "a refusal is thrown, so the helpers treat it as a failed read");
});

test("the app's helpers ask first, and a signed-in screen never registers", () => {
  for (const [fn, table] of [["loadQueueRow", "QUEUE_TABLE"], ["saveQueueRow", "QUEUE_TABLE"], ["loadFloorRow", "FLOOR_TABLE"], ["saveFloorRow", "FLOOR_TABLE"]]) {
    const body = app.slice(app.indexOf(`async function ${fn}(`), app.indexOf(`async function ${fn}(`) + 400);
    assert.match(body, new RegExp(`const via = viaFor\\(${table},`), fn);
  }
  assert.match(app, /const via = viaFor\(table, id\);\n  const read = async \(\) => \{/, "loadRowIfChanged, with the 18 September stamp rule intact");
  assert.match(app, /if \(e && \(e\.status === 403 \|\| e\.status === 404\)\) return \{ row: null \};/,
    "a refused code reads as no row, so the page still says the code isn't for today");
  assert.match(app, /viaFor\(table, id\)\n        \? supabase\.channel\(doorbellTopic\(table, id\)\)\.on\("broadcast", \{ event: "changed" \}/, "useLiveRow listens to the doorbell");
  assert.match(app, /useState\(\(\) => \{ if \(!account\) \{ const code = token \|\| \(tag \? storedDayCode\(store, date\) : null\); if \(code\) rememberDayCode\(store, date, code\); \} return null; \}\);/, "FloorSignIn, table tag included");
  assert.match(app, /useState\(\(\) => \{ if \(!account && token\) rememberDayCode\(store, date, token\); return null; \}\);/, "QueueSignIn");
  assert.match(app, /rememberWallKey\(qBoardParams\.store, qBoardParams\.key\)/, "the TV");
});

test("tickets fill the columns the table requires (C98), and the TV link carries its key", () => {
  const save = app.slice(app.indexOf("async function saveTicket("), app.indexOf("async function saveTicket(") + 900);
  assert.match(save, /store: t\.store \|\| "", qdate: day, data: t/);
  assert.match(save, /if \(!\(await getTokens\(\)\) && t\.store && \(await ticketVia\(t\.store, day, t\)\)\) return true;/);
  assert.match(mgr, /apiCall\("\/api\/floor-row", \{ method: "POST", body: \{ op: "wallkey", store: storeId \} \}\)/);
  assert.match(mgr, /`\$\{base\}&key=\$\{encodeURIComponent\(out\.key\)\}`/);
});
