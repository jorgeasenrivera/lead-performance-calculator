/**
 * The error feed: the same fault is one line, a report is cut to size, and a
 * phone in a loop is told enough.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintOf, cleanReport, tooMany, RATE, KINDS } from "../api/_report.mjs";
import { handle } from "../api/client-error.mjs";

test("the same fault from two builds and two rows is one fingerprint", () => {
  const a = fingerprintOf("error", "row 41 not found", "TypeError: row 41 not found\n    at tick (https://www.sageonline.io/assets/index-B_OdGtjC.js:12:345)");
  const b = fingerprintOf("error", "row 42 not found", "TypeError: row 42 not found\n    at tick (https://www.sageonline.io/assets/index-C9kL2mQe.js?v=2:99:1)");
  assert.equal(a, b);
  assert.notEqual(a, fingerprintOf("error", "row not saved", ""));
  assert.notEqual(a, fingerprintOf("rejection", "row 41 not found", ""));
});

test("a report is checked and cut to size", () => {
  assert.equal(cleanReport(null).ok, false);
  assert.equal(cleanReport({ kind: "nope", message: "x" }).ok, false);
  assert.equal(cleanReport({ kind: "error" }).ok, false);
  const c = cleanReport({ kind: "write", message: "m".repeat(900), stack: "s".repeat(9000), store: "sage-demo", extra: { a: 1 } }, "shell");
  assert.ok(c.ok);
  assert.equal(c.row.message.length, 500);
  assert.equal(c.row.stack.length, 4000);
  assert.equal(c.row.source, "shell");
  assert.deepEqual(c.row.extra, { a: 1 });
  assert.equal(cleanReport({ kind: "error", message: "x" }, "server").row.source, "web", "a phone cannot claim to be the server");
  for (const k of KINDS) assert.ok(cleanReport({ kind: k, message: "x" }).ok);
});

test("twenty in ten minutes from one device is a loop", () => {
  assert.equal(RATE.windowMinutes, 10);
  assert.equal(tooMany(RATE.perDevice - 1), false);
  assert.equal(tooMany(RATE.perDevice), true);
});

const res = () => { const r = { code: null, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
const deps = (recent = 0) => { const d = { rows: [], userOf: async (jwt) => (jwt === "good" ? "u-1" : null), recentFromDevice: async () => recent, insert: async (row) => { d.rows.push(row); } }; return d; };

test("the endpoint writes a row, adds the account when signed in, and refuses a loop", async () => {
  let d = deps(); let r = res();
  await handle({ method: "POST", headers: { authorization: "Bearer good" }, body: { kind: "render", message: "boom", device_id: "dev-1" } }, r, d);
  assert.equal(r.code, 204); assert.equal(d.rows.length, 1); assert.equal(d.rows[0].user_id, "u-1"); assert.equal(d.rows[0].source, "web");
  d = deps(); r = res();
  await handle({ method: "POST", headers: { "x-sage-source": "shell" }, body: JSON.stringify({ kind: "error", message: "boom" }) }, r, d);
  assert.equal(r.code, 204); assert.equal(d.rows[0].source, "shell"); assert.equal(d.rows[0].user_id, undefined);
  d = deps(RATE.perDevice); r = res();
  await handle({ method: "POST", headers: {}, body: { kind: "error", message: "boom", device_id: "dev-1" } }, r, d);
  assert.equal(r.code, 429); assert.equal(d.rows.length, 0);
  r = res(); await handle({ method: "GET", headers: {} }, r, deps()); assert.equal(r.code, 405);
  r = res(); await handle({ method: "POST", headers: {}, body: { kind: "error" } }, r, deps()); assert.equal(r.code, 400);
});

test("a fault inside the feed is not a second fault for the phone", async () => {
  const d = deps(); d.insert = async () => { throw new Error("db down"); };
  const r = res();
  await handle({ method: "POST", headers: {}, body: { kind: "error", message: "boom" } }, r, d);
  assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: false });
});
