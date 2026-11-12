import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createClient } from "@supabase/supabase-js";

/* The mock used to skip a filter it did not know, so `key=like.lpc:backup:%` answered every row of
   app_data. The app's backup pruning (pruneBackups in LeadPerformanceCalculator.jsx) lists the rows
   under lpc:backup: and lpc:config:backup:, reads the second-to-last colon part of each key as the
   backup id, and writes null over every one whose id the index is not keeping. Given every row, it
   read lpc:store:<store>:act:<day> as a backup whose id is the word "act" and nulled the activity
   rows, a stream of extra writes in the middle of every hero probe.

   Runs the actual mock on an ephemeral loopback port, the way mock-cors.test.mjs does. The subtests
   share the one mock process, so they run in the order written: reads, refusals, then the writes. */

const BACKUPS = ["lpc:backup:sage-demo:2026-10-01T00-00-00-000Z:v1", "lpc:backup:spacing-demo-2:2026-10-01T00-00-00-000Z:v1"];
const META = ["lpc:config:backup:2026-10-01T00-00-00-000Z:v1"];
/* Shares lpc:config:backup up to the colon, so only a loose match sweeps it in. */
const NEAR_MISS = "lpc:config:backups-index:v1";
/* Holds the prefix, but not at the start: a prefix match is not a substring match. */
const INNER = "old:lpc:backup:sage-demo:2026-09-01T00-00-00-000Z:v1";
/* Five colon parts, so the pruner reads "act" where a backup id would be. */
const UNRELATED = ["lpc:store:sage-demo:act:2026-10-03", "lpc:board:sage-demo:act:2026-10-03"];

test("the mock answers like as a literal prefix and refuses every other shape", async (t) => {
  let server;
  const listen = http.Server.prototype.listen;
  let ready;
  const listening = new Promise((resolve) => { ready = resolve; });
  const stub = t.mock.method(http.Server.prototype, "listen", function (_port, host) {
    server = this;
    return listen.call(this, 0, host, ready);
  });
  t.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  try { await import("../scripts/mock-supabase.mjs"); }
  finally { stub.mock.restore(); }
  await listening;
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rest = (path, init = {}) => fetch(origin + "/rest/v1/" + path, { signal: AbortSignal.timeout(5000), ...init });
  /* The app's own client, so the pattern reaches the mock encoded exactly as the app sends it. */
  const db = createClient(origin, "mock-anon-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const keysLike = async (pattern) => {
    const { data, error } = await db.from("app_data").select("key").like("key", pattern);
    assert.equal(error, null);
    return data.map((r) => r.key).sort();
  };
  const valueOf = async (key) => (await (await rest(`app_data?key=eq.${encodeURIComponent(key)}`)).json())[0]?.value;

  const seed = [...BACKUPS, ...META, NEAR_MISS, INNER, ...UNRELATED].map((key) => ({ key, value: { seeded: key } }));
  const put = await rest("app_data?on_conflict=key", { method: "POST", body: JSON.stringify(seed),
    headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates" } });
  assert.equal(put.status, 201);

  await t.test("a literal prefix and one trailing % answers the rows that start with it, and no others", async () => {
    const backups = await keysLike("lpc:backup:%");
    assert.deepEqual(backups, [...BACKUPS].sort(), "the lpc:backup: rows and nothing else");
    for (const key of [...UNRELATED, INNER]) assert.ok(!backups.includes(key), `${key} is not a backup`);
    /* The demo seed already holds a store's day rows, so check what the filter keeps and drops, not the whole list. */
    const days = await keysLike("lpc:store:sage-demo:act:%");
    assert.ok(days.every((key) => key.startsWith("lpc:store:sage-demo:act:")), "only the store's day rows");
    assert.ok(days.includes(UNRELATED[0]), "the seeded day row is there");
    assert.ok(!days.includes(UNRELATED[1]), "the board's day row is not a store day row");
  });

  await t.test("a row that shares the prefix only up to the colon is not a match", async () => {
    assert.deepEqual(await keysLike("lpc:config:backup:%"), META);
    assert.ok((await keysLike("lpc:config:%")).includes(NEAR_MISS), "the shorter prefix does take the index row");
  });

  await t.test("like is case sensitive and never matches a null or missing column", async () => {
    const post = await rest("profiles", { method: "POST", body: JSON.stringify([{ id: "like-1", name: "Dev Okonjo", email: null }]),
      headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates" } });
    assert.equal(post.status, 201);
    const names = async (filter) => (await (await rest(`profiles?${filter}`)).json()).map((r) => r.id);
    assert.deepEqual(await names("name=like.Dev%25"), ["like-1"]);
    assert.deepEqual(await names("name=like.dev%25"), [], "like, unlike ilike, is case sensitive");
    /* The prefixes are the first letters of "null" and "undefined": a null or missing column must not be read as that text. */
    assert.deepEqual(await names("email=like.n%25"), [], "a null column matches nothing");
    assert.deepEqual(await names("nickname=like.u%25"), [], "a column the row does not have matches nothing");
  });

  await t.test("any other shape is refused with a 400 in PostgREST's error shape, not answered with every row", async () => {
    const refused = ["%backup%", "%", "", "lpc:backup:", "lpc:%:v1", "lpc:backup:%%", "lpc:backup:_%", "lpc:backup:*", "lpc\\:backup:%"];
    for (const pattern of refused) {
      const res = await rest(`app_data?key=like.${encodeURIComponent(pattern)}`);
      const body = await res.json();
      assert.equal(res.status, 400, `like.${pattern} must be refused`);
      assert.equal(body.code, "PGRST100");
      assert.match(body.message, /like/);
    }
    assert.equal((await rest("app_data?key=eq.nothing")).status, 200, "the mock is still answering");
  });

  await t.test("a refused update answers 400 and changes nothing", async () => {
    const res = await rest("app_data?key=like.%25backup%25", { method: "PATCH", body: JSON.stringify({ value: "changed" }),
      headers: { "content-type": "application/json" } });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "PGRST100");
    assert.deepEqual(await valueOf(BACKUPS[0]), { seeded: BACKUPS[0] });
  });

  await t.test("an update with a valid like touches the matching rows and no others", async () => {
    const res = await rest("app_data?key=like.lpc%3Abackup%3A%25", { method: "PATCH", body: JSON.stringify({ value: "touched" }),
      headers: { "content-type": "application/json" } });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).map((r) => r.key).sort(), [...BACKUPS].sort());
    for (const key of UNRELATED) assert.deepEqual(await valueOf(key), { seeded: key });
  });

  await t.test("backup pruning drops the backups and leaves every unrelated key alone", async () => {
    /* pruneBackups as written: list by prefix, take the id from the end of the key, skip the ids the
       index keeps, and null the rest through saveShared, which upserts {key, value: null}. */
    const alive = new Set();
    let dropped = 0;
    for (const prefix of ["lpc:backup:%", "lpc:config:backup:%"]) {
      for (const key of await keysLike(prefix)) {
        const parts = key.split(":");
        const id = parts.length >= 5 ? parts[parts.length - 2] : null;
        if (!id || alive.has(id)) continue;
        const { error } = await db.from("app_data").upsert({ key, value: null }, { onConflict: "key" });
        assert.equal(error, null);
        dropped++;
      }
    }
    assert.equal(dropped, BACKUPS.length + META.length, "one write for each backup row, none for anything else");
    for (const key of [...BACKUPS, ...META]) assert.equal(await valueOf(key), null, `${key} was pruned`);
    for (const key of [...UNRELATED, NEAR_MISS, INNER]) assert.deepEqual(await valueOf(key), { seeded: key }, `${key} is untouched`);
  });
});
