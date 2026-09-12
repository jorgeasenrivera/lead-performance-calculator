/**
 * The vitals feed: a measurement is checked and cut to size, a phone in a
 * reload loop is told enough, and the endpoint never becomes a fault itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanVital, tooMany, RATE, NAMES, handle } from "../api/vitals.mjs";

test("a vital is checked and cut to size", () => {
  assert.equal(cleanVital(null).ok, false);
  assert.equal(cleanVital({ name: "FPS", value: 1 }).ok, false, "only the web vitals");
  assert.equal(cleanVital({ name: "INP", value: "fast" }).ok, false);
  assert.equal(cleanVital({ name: "INP", value: -1 }).ok, false);
  assert.equal(cleanVital({ name: "LCP", value: 999999 }).ok, false, "a day is not a paint time");
  assert.equal(cleanVital({ name: "CLS", value: 0.04 }).ok, true);
  const c = cleanVital({ name: "INP", value: 87.12345, rating: "good", target: "t".repeat(500), screen: "line", store: "sage-demo", shell: true, nav: "navigate" });
  assert.ok(c.ok);
  assert.equal(c.row.value, 87.123);
  assert.equal(c.row.target.length, 200);
  assert.equal(c.row.shell, true);
  assert.equal(cleanVital({ name: "INP", value: 1, rating: "fine" }).row.rating, null, "an unknown rating is dropped, not refused");
  for (const n of NAMES) assert.ok(cleanVital({ name: n, value: 1 }).ok);
});

test("sixty in ten minutes from one device is a loop", () => {
  assert.equal(RATE.windowMinutes, 10);
  assert.equal(tooMany(RATE.perDevice - 1), false);
  assert.equal(tooMany(RATE.perDevice), true);
});

const res = () => { const r = { code: null, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
const deps = (recent = 0, fail = false) => { const d = { rows: [], recentFromDevice: async () => recent, insert: async (row) => { if (fail) throw new Error("down"); d.rows.push(row); } }; return d; };

test("the endpoint writes a row, refuses a loop, and is never a second fault", async () => {
  let d = deps(); let r = res();
  await handle({ method: "POST", headers: {}, body: JSON.stringify({ name: "INP", value: 120, rating: "good", device_id: "dev-1", screen: "floor" }) }, r, d);
  assert.equal(r.code, 204); assert.equal(d.rows.length, 1); assert.equal(d.rows[0].screen, "floor");
  r = res(); await handle({ method: "GET", headers: {}, body: null }, r, deps()); assert.equal(r.code, 405);
  r = res(); await handle({ method: "POST", headers: {}, body: "{nope" }, r, deps()); assert.equal(r.code, 400);
  r = res(); await handle({ method: "POST", headers: {}, body: { name: "INP", value: 1, device_id: "dev-1" } }, r, deps(RATE.perDevice)); assert.equal(r.code, 429);
  r = res(); await handle({ method: "POST", headers: {}, body: { name: "INP", value: 1 } }, r, deps(0, true)); assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: false });
});
