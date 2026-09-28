/* C92: who may read and write a day's floor and phone-line rows once the
   tables close to the public key. The rules on their own, then the endpoint
   against rows held in memory, as sftp-arrival's tests do. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decide, rowAddress, staffMayUse, storeDay, wallKey, TOKEN_HEADER, WALL_HEADER } from "../api/_floor-access.mjs";
import { handle } from "../api/floor-row.mjs";

const TODAY = "2026-09-28";
const NOON = new Date("2026-09-28T16:00:00Z");       // noon in New York
const SECRET = "w".repeat(40);
const row = (token = "abc123", at = "2026-09-28T13:00:00Z") => ({ data: { token, line: [] }, updated_at: at });
const staff = (allowed) => ({ kind: "staff", allowed });

test("the rows live where the pages already look for them, and nowhere a body can invent", () => {
  assert.deepEqual(rowAddress("floor", "dm", TODAY), { table: "floor_public", id: "dm:2026-09-28", dateCol: "fdate" });
  assert.deepEqual(rowAddress("line", "dm", TODAY), { table: "queue_public", id: "dm:2026-09-28", dateCol: "qdate" });
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

test("a phone with one of today's codes: today's rows at that store, never another day, never the code itself", () => {
  const base = { room: "floor", store: "dm", date: TODAY, today: TODAY, row: row() };
  const ok = { kind: "token", ok: true }, bad = { kind: "token", ok: false };
  assert.equal(decide({ ...base, op: "read", via: ok }).ok, true);
  assert.equal(decide({ ...base, op: "read", via: bad }).status, 403);
  assert.equal(decide({ ...base, op: "read", via: ok, date: "2026-09-27" }).status, 403, "yesterday's row, even with its own code");
  assert.equal(decide({ ...base, op: "read", via: ok, row: null }).status, 404, "a room not open today");
  assert.equal(decide({ ...base, op: "write", via: ok, data: { token: "abc123", line: [1] } }).ok, true);
  assert.equal(decide({ ...base, op: "write", via: ok, data: { token: "mine", line: [] } }).status, 403,
    "a phone cannot reset the code and lock the desk out");
  assert.equal(decide({ ...base, op: "write", via: ok, data: { line: [] } }).status, 403);
});

test("a TV reads today's row with its store's key, and writes nothing", () => {
  const base = { room: "line", store: "dm", date: TODAY, today: TODAY, row: row() };
  assert.equal(decide({ ...base, op: "read", via: { kind: "wall", ok: true } }).ok, true);
  assert.equal(decide({ ...base, op: "read", via: { kind: "wall", ok: false } }).status, 403);
  assert.equal(decide({ ...base, op: "write", via: { kind: "wall", ok: true }, data: { token: "abc123" } }).status, 403);
  assert.equal(decide({ ...base, op: "read", via: { kind: "wall", ok: true }, date: "2026-09-27" }).status, 403);
  assert.notEqual(wallKey("dm", SECRET), wallKey("other", SECRET), "one store's key opens nothing at another");
  assert.equal(wallKey("dm", "short"), "", "no key from a weak or missing secret");
  assert.equal(wallKey("dm", SECRET).length, 32);
});

test("nobody, and anything not asked for properly, is refused", () => {
  const base = { room: "floor", store: "dm", date: TODAY, today: TODAY, row: row() };
  assert.equal(decide({ ...base, op: "read", via: null }).status, 401);
  assert.equal(decide({ ...base, op: "read", via: staff(false) }).status, 403);
  assert.equal(decide({ ...base, op: "delete", via: staff(true) }).status, 400);
  assert.equal(decide({ ...base, op: "write", via: staff(true), data: [1] }).status, 400);
  assert.equal(decide({ ...base, op: "write", via: staff(true), data: { big: "x".repeat(300 * 1024) } }).status, 413);
  assert.equal(decide({ ...base, op: "write", via: staff(true), data: { token: "abc123" }, expect: "2026-09-28T12:00:00Z" }).status, 409,
    "a writer that read an older version is told, not allowed to overwrite");
});

/* ---- the endpoint, against rows in memory ---- */

function world() {
  const rows = new Map([["floor_public|dm:2026-09-28", row()], ["queue_public|dm:2026-09-28", row("line99")]]);
  const users = { "jwt-mgr": { id: "u1" }, "jwt-other": { id: "u2" }, "jwt-assoc": { id: "u3" } };
  const profiles = { u1: { role: "manager", stores: ["dm"], active: true, pending: false },
    u2: { role: "manager", stores: ["xx"], active: true, pending: false },
    u3: { role: "manager", stores: [], active: true, pending: true } };
  const links = { u3: ["dm"] };
  let clock = 0;
  const deps = {
    wallSecret: SECRET, now: () => NOON,
    userFor: async (jwt) => users[jwt] || null,
    profileOf: async (id) => profiles[id] || null,
    linkedStoresOf: async (id) => links[id] || [],
    getRow: async ({ table, id }) => rows.get(`${table}|${id}`) || null,
    putRow: async ({ table, id }, { data }, expect, create) => {
      const k = `${table}|${id}`, cur = rows.get(k);
      if (create && cur) return null;
      if (!create && expect && cur && cur.updated_at !== expect) return null;
      const next = { data, updated_at: `2026-09-28T14:00:0${++clock}Z` };
      rows.set(k, next); return next;
    },
    insertTicket: async (id, t, store, day) => { if (rows.has(`queue_public|${id}`)) return false; rows.set(`queue_public|${id}`, { data: t, store, qdate: day }); return true; },
  };
  return { rows, deps };
}

async function call(deps, body, headers = {}) {
  let status = 0, out = null;
  const res = { status(c) { status = c; return this; }, json(o) { out = o; return this; } };
  await handle({ method: "POST", headers, body }, res, deps);
  return { status, out };
}

test("the endpoint: code, TV key and session each get exactly their share", async () => {
  const { rows, deps } = world();
  const read = { op: "read", room: "floor", store: "dm", date: TODAY };
  assert.equal((await call(deps, read)).status, 401, "no headers at all");
  assert.equal((await call(deps, read, { [TOKEN_HEADER]: "abc123" })).out.row.token, "abc123");
  assert.equal((await call(deps, read, { [TOKEN_HEADER]: "line99" })).out.row.token, "abc123",
    "the line's code opens the floor at the same store today: a salesperson's own screen reads both rooms");
  assert.equal((await call(deps, read, { [TOKEN_HEADER]: "nope" })).status, 403);
  assert.equal((await call(deps, { ...read, room: "line" }, { [WALL_HEADER]: wallKey("dm", SECRET) })).out.row.token, "line99");
  assert.equal((await call(deps, read, { [WALL_HEADER]: wallKey("other", SECRET) })).status, 403);
  assert.equal((await call(deps, read, { authorization: "Bearer jwt-mgr" })).status, 200);
  assert.equal((await call(deps, read, { authorization: "Bearer jwt-other" })).status, 403);
  assert.equal((await call(deps, read, { authorization: "Bearer jwt-assoc" })).status, 200, "linked associate");
  assert.equal((await call(deps, read, { authorization: "Bearer nonsense" })).status, 403);
  const same = await call(deps, { ...read, stamp: rows.get("floor_public|dm:2026-09-28").updated_at }, { [TOKEN_HEADER]: "abc123" });
  assert.deepEqual(same.out, { same: true, stamp: "2026-09-28T13:00:00Z" }, "a poll that finds nothing new costs a stamp");
});

test("the endpoint: writes keep the code, refuse a stale version, and only staff open a room", async () => {
  const { rows, deps } = world();
  const w = { op: "write", room: "floor", store: "dm", date: TODAY };
  const ok = await call(deps, { ...w, data: { token: "abc123", line: ["x"] }, expect: "2026-09-28T13:00:00Z" }, { [TOKEN_HEADER]: "abc123" });
  assert.equal(ok.status, 200);
  assert.deepEqual(rows.get("floor_public|dm:2026-09-28").data.line, ["x"]);
  const stale = await call(deps, { ...w, data: { token: "abc123", line: ["y"] }, expect: "2026-09-28T13:00:00Z" }, { [TOKEN_HEADER]: "abc123" });
  assert.equal(stale.status, 409, "the version it read has been replaced");
  assert.deepEqual(rows.get("floor_public|dm:2026-09-28").data.line, ["x"], "and nothing was overwritten");
  const newDay = { ...w, room: "online", data: { token: "new1", line: [] } };
  assert.equal((await call(deps, newDay, { [TOKEN_HEADER]: "abc123" })).status, 404, "a code cannot open a room: it is not open today");
  assert.equal((await call(deps, newDay, { authorization: "Bearer jwt-mgr" })).status, 200, "the desk can");
  assert.equal(rows.get("queue_public|dm:2026-09-28:online").data.token, "new1");
});

test("the endpoint: tickets from a phone with any of today's codes, once each; the TV key only for staff", async () => {
  const { rows, deps } = world();
  const t = { op: "ticket", store: "dm", data: { id: "tk12345", kind: "problem", body: "the TV froze" } };
  assert.equal((await call(deps, t, { [TOKEN_HEADER]: "line99" })).status, 201);
  assert.equal(rows.get("queue_public|ticket:tk12345").data.store, "dm");
  assert.equal(rows.get("queue_public|ticket:tk12345").store, "dm", "the column, which is NOT NULL: the app's saveTicket never filled it (C98)");
  assert.equal(rows.get("queue_public|ticket:tk12345").qdate, TODAY);
  assert.equal((await call(deps, t, { [TOKEN_HEADER]: "line99" })).status, 409, "the same ticket twice is not a second ticket");
  assert.equal((await call(deps, { ...t, data: { ...t.data, id: "tk2" } }, { [TOKEN_HEADER]: "line99" })).status, 400, "an id too short to be one is refused");
  assert.equal((await call(deps, { ...t, data: { ...t.data, id: "tk99999" } }, { [TOKEN_HEADER]: "wrong" })).status, 403);
  assert.equal((await call(deps, { ...t, data: { ...t.data, id: "tk88888" } }, { [WALL_HEADER]: wallKey("dm", SECRET) })).status, 403);
  const key = await call(deps, { op: "wallkey", store: "dm" }, { authorization: "Bearer jwt-mgr" });
  assert.equal(key.out.key, wallKey("dm", SECRET));
  assert.equal((await call(deps, { op: "wallkey", store: "dm" }, { [TOKEN_HEADER]: "abc123" })).status, 403);
});

test("the lock and the endpoint name the same three ways in for staff", () => {
  const sql = fs.readFileSync(new URL("../supabase/pending/02-lock.sql", import.meta.url), "utf8");
  assert.match(sql, /role = 'admin'/);
  assert.match(sql, /not p\.pending and store = any\(p\.stores\)/);
  assert.match(sql, /from public\.floor_people/);
  assert.match(sql, /p\.active/);
  assert.ok(!/to (public|anon)\b/.test(sql.replace(/--.*$/gm, "")), "no policy in the lock is written for the public key");
});
