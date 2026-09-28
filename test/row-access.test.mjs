/* C92, the app's half. With the QR sign-in retired (C99), the one screen that
   reaches the day's rows through /api/floor-row is the TV, with its store's key;
   every signed-in screen uses the tables directly and never comes this way.
   The module on its own, then the wiring in the app. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ra = await import("../src/row-access.mjs");
const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mgr = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the rows it serves are the ones the app already names, and nothing else", () => {
  assert.deepEqual(ra.addressOf("floor_public", "dm:2026-09-28"), { room: "floor", store: "dm", date: "2026-09-28" });
  assert.deepEqual(ra.addressOf("queue_public", "dm:2026-09-28"), { room: "line", store: "dm", date: "2026-09-28" });
  assert.deepEqual(ra.addressOf("queue_public", "dm:2026-09-28:online"), { room: "online", store: "dm", date: "2026-09-28" });
  assert.equal(ra.addressOf("queue_public", ra.TICKET_PREFIX + "abc"), null, "tickets are not a day's row");
  assert.equal(ra.addressOf("floor_public", "dm:2026-09-28:online"), null);
  assert.equal(ra.addressOf("app_data", "dm:2026-09-28"), null);
});

test("a screen with no TV key is sent to the table, as before; a TV's key answers for its store", () => {
  assert.equal(ra.viaFor("floor_public", "tv:2026-09-28"), null);
  ra.rememberWallKey("tv", "");
  assert.equal(ra.viaFor("floor_public", "tv:2026-09-28"), null, "an empty key is no key");
  ra.rememberWallKey("tv", "K".repeat(32));
  assert.deepEqual(ra.viaFor("queue_public", "tv:2026-09-28").headers, { "x-sage-wall-key": "K".repeat(32) });
  assert.deepEqual(ra.viaFor("floor_public", "tv:2026-09-28").headers, { "x-sage-wall-key": "K".repeat(32) });
  assert.equal(ra.viaFor("floor_public", "xx:2026-09-28"), null, "not another store");
  assert.equal(ra.doorbellTopic("queue_public", "tv:2026-09-28"), "row:queue_public:tv:2026-09-28");
});

test("a read says who is asking in a header, never the body, and a refusal is thrown", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({ row: { line: [] }, stamp: "s1" }) }; };
  const via = ra.viaFor("queue_public", "tv:2026-09-28");
  assert.deepEqual(await ra.readVia(via, "s0", fetchImpl), { row: { line: [] }, stamp: "s1" });
  assert.equal(sent[0].url, "/api/floor-row");
  assert.equal(sent[0].init.headers["x-sage-wall-key"], "K".repeat(32));
  assert.deepEqual(JSON.parse(sent[0].init.body), { op: "read", room: "line", store: "tv", date: "2026-09-28", stamp: "s0" });
  const refused = async () => ({ ok: false, status: 403, json: async () => ({ error: "that screen's key is not this store's" }) });
  await assert.rejects(() => ra.readVia(via, null, refused), (e) => e.status === 403 && /not this store's/.test(e.message),
    "the helpers treat it as a failed read and hold what they have");
});

test("the app: the TV registers its key, and reads and listens through it; nothing else registers", () => {
  assert.match(app, /rememberWallKey\(qBoardParams\.store, qBoardParams\.key\)/, "the TV");
  assert.equal((app.match(/rememberWallKey\(/g) || []).length, 1, "and only the TV");
  assert.match(app, /const via = viaFor\(table, id\);\n  const read = async \(\) => \{/, "loadRowIfChanged, with the 18 September stamp rule intact");
  assert.match(app, /viaFor\(table, id\)\n        \? supabase\.channel\(doorbellTopic\(table, id\)\)\.on\("broadcast", \{ event: "changed" \}/, "useLiveRow listens to the doorbell");
  assert.match(app, /viaFor\(table, rowId\)\n          \? supabase\.channel\(doorbellTopic\(table, rowId\)\)\.on\("broadcast", \{ event: "changed" \}/, "the TV's own board");
  for (const gone of ["rememberDayCode", "storedDayCode", "writeVia", "ticketVia", "QueueQR", "loadQRCode", "queueSignInUrl", "qrcodeGen"]) {
    assert.ok(!app.includes(gone), `${gone} is gone from the app (C99)`);
  }
  for (const gone of ["qrcodeGen", "printSignIn", "SIGN_IN_POSTER", "floorSignInUrl", "TestLink"]) {
    assert.ok(!mgr.includes(gone), `${gone} is gone from the manager (C99)`);
  }
});

test("tickets fill the columns the table requires (C98), and the TV link carries its key", () => {
  const save = app.slice(app.indexOf("async function saveTicket("), app.indexOf("async function saveTicket(") + 700);
  assert.match(save, /\.upsert\(\{ id: TICKET_PREFIX \+ t\.id, store: t\.store \|\| "", qdate: day, data: t \}, \{ onConflict: "id" \}\)/);
  assert.match(mgr, /apiCall\("\/api\/floor-row", \{ method: "POST", body: \{ op: "wallkey", store: storeId \} \}\)/);
  assert.match(mgr, /`\$\{base\}&key=\$\{encodeURIComponent\(out\.key\)\}`/);
});
