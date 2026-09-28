/* C92: who may read a day's floor and phone-line rows through the server
   once the tables close to the public key. With the QR sign-in retired (C99),
   that is a TV with its store's key, and signed-in staff. The rules on their
   own, then the endpoint against rows held in memory, as sftp-arrival's tests do. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decide, rowAddress, staffMayUse, storeDay, wallKey, WALL_HEADER } from "../api/_floor-access.mjs";
import { handle } from "../api/floor-row.mjs";

const TODAY = "2026-09-28";
const NOON = new Date("2026-09-28T16:00:00Z");       // noon in New York
const SECRET = "w".repeat(40);
const row = (name = "floor", at = "2026-09-28T13:00:00Z") => ({ data: { name, line: [] }, updated_at: at });
const staff = (allowed) => ({ kind: "staff", allowed });

test("the rows live where the pages already look for them, and nowhere a body can invent", () => {
  assert.deepEqual(rowAddress("floor", "dm", TODAY), { table: "floor_public", id: "dm:2026-09-28" });
  assert.deepEqual(rowAddress("line", "dm", TODAY), { table: "queue_public", id: "dm:2026-09-28" });
  assert.equal(rowAddress("online", "dm", TODAY).id, "dm:2026-09-28:online");
  for (const bad of [["floor", "dm", "2026-9-28"], ["floor", "../x", TODAY], ["tickets", "dm", TODAY], ["floor", "dm:1", TODAY], ["floor", "", TODAY]]) {
    assert.equal(rowAddress(...bad), null, JSON.stringify(bad));
  }
});

test("the store's day is New York's, not the server's", () => {
  assert.equal(storeDay(new Date("2026-09-29T02:30:00Z")), "2026-09-28", "10:30 at night in New York is still the 28th");
  assert.equal(storeDay(new Date("2026-09-29T04:30:00Z")), "2026-09-29");
});

test("staff: an admin, the store on an approved profile, or a floor link; nobody inactive", () => {
  assert.equal(staffMayUse({ profile: { role: "admin", stores: [], active: true } }, "dm"), true);
  assert.equal(staffMayUse({ profile: { role: "manager", stores: ["dm"], active: true, pending: false } }, "dm"), true);
  assert.equal(staffMayUse({ profile: { role: "manager", stores: ["other"], active: true, pending: false } }, "dm"), false);
  assert.equal(staffMayUse({ profile: { role: "manager", stores: [], active: true, pending: true }, linkedStores: ["dm"] }, "dm"), true,
    "an associate's account a manager linked to the floor, still pending: three live accounts are this");
  assert.equal(staffMayUse({ profile: { role: "manager", stores: ["dm"], active: true, pending: true } }, "dm"), false, "pending is not approved");
  assert.equal(staffMayUse({ profile: { role: "admin", stores: [], active: false } }, "dm"), false);
  assert.equal(staffMayUse({ profile: null, linkedStores: ["dm"] }, "dm"), false, "no profile, no way in");
});

test("a TV reads today's row with its store's key, and nothing else", () => {
  const base = { room: "line", store: "dm", date: TODAY, today: TODAY };
  assert.equal(decide({ ...base, op: "read", via: { kind: "wall", ok: true } }).ok, true);
  assert.equal(decide({ ...base, op: "read", via: { kind: "wall", ok: false } }).status, 403);
  assert.equal(decide({ ...base, op: "read", via: { kind: "wall", ok: true }, date: "2026-09-27" }).status, 403, "a wall screen shows today");
  assert.equal(decide({ ...base, op: "write", via: { kind: "wall", ok: true } }).status, 400, "there is no write here at all");
  assert.equal(decide({ op: "wallkey", store: "dm", via: { kind: "wall", ok: true } }).status, 401, "a TV cannot make keys");
  assert.notEqual(wallKey("dm", SECRET), wallKey("other", SECRET), "one store's key opens nothing at another");
  assert.equal(wallKey("dm", "short"), "", "no key from a weak or missing secret");
  assert.equal(wallKey("dm", SECRET).length, 32);
});

test("nobody, and anything not asked for properly, is refused", () => {
  const base = { room: "floor", store: "dm", date: TODAY, today: TODAY };
  assert.equal(decide({ ...base, op: "read", via: null }).status, 401);
  assert.equal(decide({ ...base, op: "read", via: staff(false) }).status, 403);
  assert.equal(decide({ ...base, op: "read", via: staff(true) }).ok, true);
  assert.equal(decide({ ...base, op: "read", via: staff(true), date: "2026-09-01" }).ok, true, "staff read any day of their own store");
  assert.equal(decide({ ...base, op: "delete", via: staff(true) }).status, 400);
  assert.equal(decide({ ...base, op: "read", room: "tickets", via: staff(true) }).status, 400);
  assert.equal(decide({ op: "wallkey", store: "../x", via: staff(true) }).status, 400);
  assert.equal(decide({ op: "wallkey", store: "dm", via: staff(false) }).status, 403);
});

/* ---- the endpoint, against rows in memory ---- */

function world() {
  const rows = new Map([["floor_public|dm:2026-09-28", row()], ["queue_public|dm:2026-09-28", row("line")]]);
  const users = { "jwt-mgr": { id: "u1" }, "jwt-other": { id: "u2" }, "jwt-assoc": { id: "u3" } };
  const profiles = { u1: { role: "manager", stores: ["dm"], active: true, pending: false },
    u2: { role: "manager", stores: ["xx"], active: true, pending: false },
    u3: { role: "manager", stores: [], active: true, pending: true } };
  const links = { u3: ["dm"] };
  const deps = {
    wallSecret: SECRET, now: () => NOON,
    userFor: async (jwt) => users[jwt] || null,
    profileOf: async (id) => profiles[id] || null,
    linkedStoresOf: async (id) => links[id] || [],
    getRow: async ({ table, id }) => rows.get(`${table}|${id}`) || null,
  };
  return { rows, deps };
}

async function call(deps, body, headers = {}, method = "POST") {
  let status = 0, out = null;
  const res = { status(c) { status = c; return this; }, json(o) { out = o; return this; } };
  await handle({ method, headers, body }, res, deps);
  return { status, out };
}

test("the endpoint: a TV key and a session each get exactly their share", async () => {
  const { rows, deps } = world();
  const read = { op: "read", room: "floor", store: "dm", date: TODAY };
  const tv = { [WALL_HEADER]: wallKey("dm", SECRET) };
  assert.equal((await call(deps, read)).status, 401, "no headers at all");
  assert.equal((await call(deps, read, tv, "GET")).status, 405);
  assert.equal((await call(deps, { ...read, room: "line" }, tv)).out.row.name, "line");
  assert.equal((await call(deps, read, { [WALL_HEADER]: wallKey("other", SECRET) })).status, 403);
  assert.equal((await call(deps, read, { [WALL_HEADER]: "x" })).status, 403);
  assert.equal((await call(deps, { ...read, date: "2026-09-27" }, tv)).status, 403);
  assert.equal((await call(deps, read, { authorization: "Bearer jwt-mgr" })).out.row.name, "floor");
  assert.equal((await call(deps, read, { authorization: "Bearer jwt-other" })).status, 403);
  assert.equal((await call(deps, read, { authorization: "Bearer jwt-assoc" })).status, 200, "linked associate");
  assert.equal((await call(deps, read, { authorization: "Bearer nonsense" })).status, 403);
  assert.deepEqual((await call(deps, { ...read, room: "online" }, tv)).out, { row: null, stamp: null }, "no row yet is not an error");
  const same = await call(deps, { ...read, stamp: rows.get("floor_public|dm:2026-09-28").updated_at }, tv);
  assert.deepEqual(same.out, { same: true, stamp: "2026-09-28T13:00:00Z" }, "a poll that finds nothing new costs a stamp");
  assert.equal((await call(deps, { ...read, op: "write" }, { authorization: "Bearer jwt-mgr" })).status, 400);
});

test("the endpoint: only staff at that store get a TV's key, and none without the secret", async () => {
  const { deps } = world();
  const key = await call(deps, { op: "wallkey", store: "dm" }, { authorization: "Bearer jwt-mgr" });
  assert.equal(key.out.key, wallKey("dm", SECRET));
  assert.equal((await call(deps, { op: "wallkey", store: "dm" }, { authorization: "Bearer jwt-other" })).status, 403);
  assert.equal((await call(deps, { op: "wallkey", store: "dm" }, { [WALL_HEADER]: wallKey("dm", SECRET) })).status, 401);
  assert.equal((await call(deps, { op: "wallkey", store: "dm" })).status, 401);
  assert.equal((await call({ ...deps, wallSecret: "" }, { op: "wallkey", store: "dm" }, { authorization: "Bearer jwt-mgr" })).status, 500);
});

test("the lock and the endpoint name the same three ways in for staff", () => {
  const sql = fs.readFileSync(new URL("../supabase/pending/02-lock.sql", import.meta.url), "utf8");
  assert.match(sql, /role = 'admin'/);
  assert.match(sql, /not p\.pending and store = any\(p\.stores\)/);
  assert.match(sql, /from public\.floor_people/);
  assert.match(sql, /p\.active/);
  assert.ok(!/to (public|anon)\b/.test(sql.replace(/--.*$/gm, "")), "no policy in the lock is written for the public key");
});
