/* The feel scenario crosses two open rooms. The ordinary demo skips Sundays,
   which must stay true, so feel prepares its own current-day Phone Line.
   Execute the actual prep function with an in-memory mock and supplied clock;
   importing feel itself would launch a browser and a server. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildDemo, storeDay } from "../scripts/demo-seed.mjs";

const source = fs.readFileSync(new URL("../scripts/feel.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function prepFloor() {");
assert.ok(start >= 0, "the measured harness has its fixture prep");
const end = source.indexOf("\n}\n", start);
assert.ok(end > start, "the fixture prep has a complete function body");
const prepSource = source.slice(start, end + 2);
const STORE = "sage-demo";
const MOCK = "http://127.0.0.1:5433";
const sunday = "2026-10-18T05:01:00Z";

function fixture(at, alter = () => {}, phonePostStatus = 201) {
  const now = new Date(at);
  const demo = buildDemo(now);
  const tables = { app_data: [], floor_people: [], floor_public: [], queue_public: [] };
  for (const { table, row } of demo.rows) if (tables[table]) tables[table].push(structuredClone(row));
  const me = demo.roster.find((p) => p.name === "Dev Okonjo");
  tables.floor_people.push({ user_id: "fictional-user", store: STORE, person_id: me.id });
  tables.app_data.push({ key: "lpc:config:v2", value: { stores: [structuredClone(demo.storeConfig)] } });
  alter(tables, me, now);
  const before = structuredClone(tables);
  const writes = [];
  const fetch = async (url, options = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, MOCK, "fixture requests stay on the local mock");
    const table = u.pathname.slice("/rest/v1/".length);
    assert.ok(u.pathname.startsWith("/rest/v1/") && tables[table], "only known fixture tables are used");
    if (!options.method || options.method === "GET") return { json: async () => structuredClone(tables[table]) };
    assert.equal(options.method, "POST");
    const rows = JSON.parse(options.body);
    writes.push({ table, rows, headers: options.headers });
    if (table === "queue_public" && phonePostStatus !== 201) return { ok: false, status: phonePostStatus };
    const key = table === "app_data" ? "key" : "id";
    for (const row of rows) {
      const i = tables[table].findIndex((r) => r[key] === row[key]);
      if (i >= 0) {
        assert.match(options.headers.prefer || "", /resolution=merge-duplicates/, "an existing row is never silently overwritten");
        tables[table][i] = { ...tables[table][i], ...row };
      } else tables[table].push(row);
    }
    return { ok: true, status: 201 };
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    static now() { return now.getTime(); }
  }
  const prep = vm.runInNewContext(`(${prepSource})`, { fetch, Date: Clock, STORE, MOCK, day: () => storeDay(now) });
  return { tables, before, writes, me, date: storeDay(now), run: prep };
}

for (const [label, at] of [
  ["Saturday before midnight", "2026-10-18T03:59:59Z"],
  ["Sunday midnight", "2026-10-18T04:00:00Z"],
  ["Sunday failing CI time", sunday],
  ["Sunday daytime", "2026-10-18T16:00:00Z"],
  ["Monday midnight", "2026-10-19T04:00:00Z"],
  ["Sunday before the fall-back", "2026-11-01T05:30:00Z"],
  ["Sunday after the fall-back", "2026-11-01T06:30:00Z"],
]) {
  test(`feel has both current-day rooms: ${label}`, async () => {
    const f = fixture(at);
    const { id } = await f.run();
    assert.equal(id, `${STORE}:${f.date}`);
    const phone = f.tables.queue_public.find((r) => r.id === id);
    assert.ok(phone, "the exact Phone Line row the app reads exists");
    assert.equal(phone.qdate, f.date);
    assert.equal(phone.store, STORE);
    assert.ok(phone.data.token);
    assert.ok(phone.data.line.some((p) => p.id === f.me.id), "the linked associate is on the line");
    const floor = f.tables.floor_public.find((r) => r.id === id);
    assert.equal(floor.fdate, f.date);
    assert.ok(floor.data.line.some((p) => p.id === f.me.id));
    const existing = f.before.queue_public.find((r) => r.id === id);
    if (existing) {
      assert.deepEqual(f.tables.queue_public, f.before.queue_public, "weekday Phone Line rows are not rewritten");
      assert.equal(f.writes.filter((w) => w.table === "queue_public").length, 0);
    } else {
      assert.deepEqual(f.tables.queue_public.slice(0, -1), f.before.queue_public, "the prior trading day's rows are preserved");
      assert.deepEqual(phone.data, f.before.queue_public[0].data, "only the row's day identity and write timestamp are changed");
      const writes = f.writes.filter((w) => w.table === "queue_public");
      assert.equal(writes.length, 1);
      assert.equal(writes[0].headers.prefer, undefined, "plain insert refuses a colliding current row");
    }
  });
}

test("the ordinary Sunday demo stays closed unless feel explicitly prepares it", () => {
  const demo = buildDemo(new Date(sunday));
  assert.equal(storeDay(new Date(sunday)), "2026-10-18");
  assert.equal(demo.today, "2026-10-17");
  assert.ok(!demo.rows.some(({ table, row }) => table === "queue_public" && row.id === `${STORE}:2026-10-18`));
  assert.ok(demo.days.every((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0), "Sunday history policy is preserved");
});

test("preparing twice does not rewrite the current Phone Line", async () => {
  const f = fixture(sunday);
  await f.run();
  const once = structuredClone(f.tables.queue_public);
  await f.run();
  assert.deepEqual(f.tables.queue_public, once);
  assert.equal(f.writes.filter((w) => w.table === "queue_public").length, 1);
});

for (const [label, alter] of [
  ["missing seed", (t) => { t.queue_public = []; }],
  ["another store", (t) => { t.queue_public[0].store = "other-demo"; t.queue_public[0].id = "other-demo:2026-10-17"; }],
  ["the Online room", (t) => { t.queue_public[0].id += ":online"; }],
  ["a future row", (t) => { t.queue_public[0].qdate = "2026-10-19"; t.queue_public[0].id = `${STORE}:2026-10-19`; }],
  ["no token", (t) => { delete t.queue_public[0].data.token; }],
  ["no associate", (t, me) => { t.queue_public[0].data.line = t.queue_public[0].data.line.filter((p) => p.id !== me.id); }],
  ["invalid current row", (t) => { t.queue_public.push({ id: `${STORE}:2026-10-18`, store: STORE, qdate: "2026-10-18", data: {} }); }],
]) {
  test(`fixture setup refuses ${label}`, async () => {
    const f = fixture(sunday, alter);
    await assert.rejects(f.run(), /no Phone Line for its demo associate/);
    assert.deepEqual(f.tables.queue_public, f.before.queue_public);
    assert.equal(f.writes.filter((w) => w.table === "queue_public").length, 0);
  });
}

test("a rejected Phone Line insert fails setup instead of continuing", async () => {
  const f = fixture(sunday, () => {}, 409);
  await assert.rejects(f.run(), /Phone Line fixture could not be prepared \(409\)/);
  assert.deepEqual(f.tables.queue_public, f.before.queue_public);
});

test("the fixture does not widen the tab readiness predicate", () => {
  assert.match(source, /clickFelt\('\.ar-tab\[aria-label\*="Phone"\]', \{ kind: "visible", sel: "\.sfl-title" \}\)/);
  assert.match(source, /await p\.waitForFunction\(\(\) => window\.__felt && window\.__felt\.done != null, null, \{ timeout: 30000 \}\)/);
});
