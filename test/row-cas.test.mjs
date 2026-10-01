/* C89: two writers on one day's row no longer lose each other's change. The
   helper is lifted out of LeadPerformanceCalculator.jsx and run against an
   in-memory table that answers the way PostgREST does: an update touches only
   the rows its filters match, and a plain insert of an existing id is 23505. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const from = app.indexOf("const ROW_TRIES = ");
const to = app.indexOf("\n}\n", app.indexOf("async function mutateRowCAS(")) + 3;
const src = app.slice(from, to);
const build = new Function("supabase", src + "\nreturn { mutateRowCAS, nextRowStamp };");

/* A table, and a hook that runs between a read and the write that follows it. */
function db({ between } = {}) {
  const rows = new Map();
  let reads = 0, writes = 0;
  const q = (table) => {
    const f = {};
    const api = {
      select() { return api; },
      eq(k, v) { f[k] = { eq: v }; return api; },
      is(k) { f[k] = { isNull: true }; return api; },
      async maybeSingle() {
        reads++;
        const r = rows.get(f.id.eq);
        const out = { data: r ? { data: structuredClone(r.data), updated_at: r.updated_at } : null, error: null };
        if (between) await between(reads, api);
        return out;
      },
      update(patch) { api._patch = patch; return api; },
      insert(row) {
        if (rows.has(row.id)) return Promise.resolve({ error: { code: "23505" } });
        rows.set(row.id, { data: row.data, updated_at: row.updated_at }); writes++;
        return Promise.resolve({ error: null });
      },
    };
    /* update(...).eq(...).eq|is(...).select("id") */
    const sel = api.select;
    api.select = function () {
      if (!api._patch) return sel();
      const r = rows.get(f.id.eq);
      const ok = r && (f.updated_at && "eq" in f.updated_at ? r.updated_at === f.updated_at.eq : f.updated_at?.isNull ? r.updated_at == null : true);
      if (ok) { rows.set(f.id.eq, { data: api._patch.data, updated_at: api._patch.updated_at }); writes++; }
      return Promise.resolve({ data: ok ? [{ id: f.id.eq }] : [], error: null });
    };
    return api;
  };
  return { rows, client: { from: q }, get reads() { return reads; }, get writes() { return writes; } };
}

const add = (who) => (cur) => ({ ...(cur || {}), line: [...((cur && cur.line) || []), who] });

test("a write that lands between another's read and write is kept, not written over", async () => {
  const d = db();
  d.rows.set("dm:2026-09-28", { data: { line: ["ana"] }, updated_at: "2026-09-28T14:00:00.000Z" });
  let raced = false;
  d.client.from = ((orig) => (t) => {
    const api = orig(t);
    const ms = api.maybeSingle;
    api.maybeSingle = async () => {
      const out = await ms();
      /* The desk writes Ben in, once, right after this page read. */
      if (!raced) { raced = true; d.rows.set("dm:2026-09-28", { data: { line: ["ana", "ben"] }, updated_at: "2026-09-28T14:00:01.000Z" }); }
      return out;
    };
    return api;
  })(d.client.from);
  const { mutateRowCAS } = build(d.client);
  const out = await mutateRowCAS("floor_public", "dm:2026-09-28", { store: "dm", fdate: "2026-09-28" }, add("cy"), { what: "floor" });
  assert.deepEqual(out.line, ["ana", "ben", "cy"], "reapplied on top of the desk's write");
  assert.deepEqual(d.rows.get("dm:2026-09-28").data.line, ["ana", "ben", "cy"], "Ben is still on the line");
});

test("two pages writing at once both land", async () => {
  const d = db();
  d.rows.set("dm:2026-09-28", { data: { line: [] }, updated_at: "2026-09-28T14:00:00.000Z" });
  const { mutateRowCAS } = build(d.client);
  await Promise.all([
    mutateRowCAS("floor_public", "dm:2026-09-28", {}, add("ana"), { what: "floor" }),
    mutateRowCAS("floor_public", "dm:2026-09-28", {}, add("ben"), { what: "floor" }),
  ]);
  assert.deepEqual([...d.rows.get("dm:2026-09-28").data.line].sort(), ["ana", "ben"]);
});

test("two first writers: one inserts, the other reads it and adds to it", async () => {
  const d = db();
  const { mutateRowCAS } = build(d.client);
  await Promise.all([
    mutateRowCAS("queue_public", "dm:2026-09-28", { store: "dm", qdate: "2026-09-28" }, add("ana"), { what: "queue" }),
    mutateRowCAS("queue_public", "dm:2026-09-28", { store: "dm", qdate: "2026-09-28" }, add("ben"), { what: "queue" }),
  ]);
  assert.deepEqual([...d.rows.get("dm:2026-09-28").data.line].sort(), ["ana", "ben"]);
});

test("a change that changes nothing writes nothing, and a row that is never free says so", async () => {
  const d = db();
  d.rows.set("x", { data: { line: [] }, updated_at: "a" });
  const { mutateRowCAS } = build(d.client);
  assert.deepEqual(await mutateRowCAS("floor_public", "x", {}, () => null, { what: "floor" }), { line: [] });
  assert.equal(d.writes, 0);
  let n = 0;
  d.client.from = ((orig) => (t) => { const api = orig(t); const ms = api.maybeSingle;
    api.maybeSingle = async () => { const o = await ms(); d.rows.set("x", { data: { line: [] }, updated_at: "b" + (n++) }); return o; }; return api; })(d.client.from);
  await assert.rejects(() => mutateRowCAS("floor_public", "x", {}, add("ana"), { what: "floor" }), /The floor was busy, so nothing was changed/);
});

test("the stamp always moves forward, even on a slow clock", () => {
  const { nextRowStamp } = build(null);
  const ahead = new Date(Date.now() + 60_000).toISOString();
  assert.ok(Date.parse(nextRowStamp(ahead)) > Date.parse(ahead));
  assert.ok(Date.parse(nextRowStamp(null)) <= Date.now());
});

test("nothing in the app writes the day's rows around the guard", () => {
  assert.ok(!/from\((FLOOR_TABLE|QUEUE_TABLE)\)\.upsert\(/.test(app), "no whole-row upsert of the floor or the line");
  assert.match(app, /const run = \(\) => mutateRowCAS\(QUEUE_TABLE,/);
  assert.match(app, /const run = \(\) => mutateRowCAS\(FLOOR_TABLE,/);
});
