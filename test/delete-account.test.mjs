/**
 * Deleting an account (C91).
 * -------------------------------------------------------------------------
 * Most of this is about who may NOT delete what, and about the order: the
 * links go before the login, so a failure part way leaves a working account
 * rather than rows pointing at nobody. Supabase is stubbed at the network,
 * as in floor-account.test.mjs, so the real query builder runs and a wrong
 * filter shows up here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideDelete, CONFIRM_WORD } from "../api/_account-delete.mjs";

process.env.SUPABASE_URL = "https://stub.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
process.env.SUPABASE_ANON_KEY = "anon";

/* ---- the decision, with no database ---- */

const admin = { role: "admin", active: true }, manager = { role: "manager", active: true };

test("nothing is deleted without DELETE typed", () => {
  for (const confirm of [undefined, "", "delete", "yes", "DELET"]) {
    const d = decideDelete({ callerId: "u1", caller: manager, target: manager, confirm, otherAdmins: 1 });
    assert.equal(d.ok, false); assert.equal(d.code, 400);
  }
  assert.equal(CONFIRM_WORD, "DELETE");
  assert.equal(decideDelete({ callerId: "u1", caller: manager, target: manager, confirm: " DELETE ", otherAdmins: 1 }).ok, true,
    "a stray space from the keyboard is not a refusal");
});

test("anybody may delete their own account", () => {
  const d = decideDelete({ callerId: "u1", caller: manager, target: manager, confirm: "DELETE", otherAdmins: 1 });
  assert.deepEqual(d, { ok: true, targetId: "u1", self: true });
  const noProfile = decideDelete({ callerId: "u1", caller: null, target: null, confirm: "DELETE", otherAdmins: 1 });
  assert.equal(noProfile.ok, true, "a login with no profile can still delete itself");
});

test("only an active admin may delete somebody else's", () => {
  assert.equal(decideDelete({ callerId: "u1", caller: manager, targetId: "u2", target: manager, confirm: "DELETE", otherAdmins: 1 }).code, 403);
  assert.equal(decideDelete({ callerId: "u1", caller: { role: "admin", active: false }, targetId: "u2", target: manager, confirm: "DELETE", otherAdmins: 1 }).code, 403);
  assert.equal(decideDelete({ callerId: "u1", caller: null, targetId: "u2", target: manager, confirm: "DELETE", otherAdmins: 1 }).code, 403);
  assert.deepEqual(decideDelete({ callerId: "u1", caller: admin, targetId: "u2", target: manager, confirm: "DELETE", otherAdmins: 1 }),
    { ok: true, targetId: "u2", self: false });
});

test("the last admin is never deleted, by themselves or anybody", () => {
  const me = decideDelete({ callerId: "a1", caller: admin, target: admin, confirm: "DELETE", otherAdmins: 0 });
  assert.equal(me.code, 409); assert.match(me.error, /You are the last admin/);
  const them = decideDelete({ callerId: "a1", caller: admin, targetId: "a2", target: admin, confirm: "DELETE", otherAdmins: 0 });
  assert.equal(them.code, 409);
  assert.equal(decideDelete({ callerId: "a1", caller: admin, target: admin, confirm: "DELETE", otherAdmins: 1 }).ok, true);
});

/* ---- the endpoint, against a stubbed Supabase ---- */

const U1 = "11111111-1111-4111-8111-111111111111", A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let SESSION, PROFILES, LINKS, calls, authFails;
function reset() {
  SESSION = U1; authFails = false; calls = [];
  PROFILES = { [U1]: { id: U1, ...manager }, [A1]: { id: A1, ...admin } };
  LINKS = [{ user_id: U1, store: "s1", person_id: "p1" }, { user_id: U1, store: "s2", person_id: "p9" }];
}
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const q = (u, k) => (u.match(new RegExp(k + "=eq\\.([^&]+)")) || [])[1];
globalThis.fetch = async (url, opt = {}) => {
  const u = decodeURIComponent(String(url)), m = (opt.method || "GET").toUpperCase();
  if (u.includes("/auth/v1/admin/users/")) {
    calls.push(["auth.delete", u.split("/auth/v1/admin/users/")[1]]);
    return authFails ? j({ msg: "auth is down" }, 500) : j({});
  }
  if (u.includes("/auth/v1/user")) return SESSION ? j({ id: SESSION }) : j({ msg: "bad" }, 401);
  const table = (u.match(/\/rest\/v1\/(\w+)/) || [])[1];
  if (m === "DELETE") { calls.push([table + ".delete", u.split("?")[1]]); return j([]); }
  if (table === "profiles") {
    if (q(u, "role") === "admin") return j(Object.values(PROFILES).filter((p) => p.role === "admin" && p.active));
    const p = PROFILES[q(u, "id")]; return j(p ? [p] : []);
  }
  if (table === "floor_people") return j(LINKS.filter((l) => l.user_id === q(u, "user_id")));
  return j([]);
};
const { default: del } = await import("../api/delete-account.mjs");

async function call(body, { jwt = "t" } = {}) {
  let status = 0, out = null;
  const res = { status(c) { status = c; return this; }, json(o) { out = o; return this; } };
  await del({ method: "POST", headers: jwt ? { authorization: "Bearer " + jwt } : {}, body }, res);
  return { status, out };
}

test("my own account: links, phones and errors go first, the login last", async () => {
  reset();
  const r = await call({ confirm: "DELETE" });
  assert.equal(r.status, 200); assert.deepEqual(r.out, { ok: true, self: true });
  const names = calls.map((c) => c[0]);
  assert.deepEqual(names, ["device_tokens.delete", "device_tokens.delete", "floor_people.delete", "app_errors.delete", "auth.delete"]);
  assert.match(calls[0][1], /store=eq\.s1/); assert.match(calls[0][1], /person_id=eq\.p1/);
  assert.match(calls[1][1], /store=eq\.s2/); assert.match(calls[1][1], /person_id=eq\.p9/);
  assert.ok(calls[2][1].includes("user_id=eq." + U1)); assert.ok(calls[3][1].includes("user_id=eq." + U1));
  assert.equal(calls[4][1], U1);
  assert.ok(!names.includes("profiles.delete"), "the profile goes with the login, by the database's cascade");
});

test("who is asking comes from the session, never the body", async () => {
  reset();
  const r = await call({ confirm: "DELETE", user_id: A1 });   // a manager naming the admin
  assert.equal(r.status, 403); assert.equal(calls.length, 0);
  assert.equal((await call({ confirm: "DELETE" }, { jwt: "" })).status, 401);
  SESSION = null; assert.equal((await call({ confirm: "DELETE" })).status, 401);
  assert.equal(calls.length, 0, "nothing was touched by any of them");
});

test("an admin deleting somebody else reaches that account and no other", async () => {
  reset(); SESSION = A1;
  const r = await call({ confirm: "DELETE", user_id: U1 });
  assert.equal(r.status, 200); assert.deepEqual(r.out, { ok: true, self: false });
  assert.deepEqual(calls[calls.length - 1], ["auth.delete", U1]);
});

test("the last admin cannot delete themselves", async () => {
  reset(); SESSION = A1;
  const r = await call({ confirm: "DELETE" });
  assert.equal(r.status, 409); assert.equal(calls.length, 0);
});

test("unconfirmed, nothing is touched", async () => {
  reset();
  const r = await call({ confirm: "delete" });
  assert.equal(r.status, 400); assert.equal(calls.length, 0);
});

test("if the login cannot be deleted, it says so plainly, and the account still works", async () => {
  reset(); authFails = true;
  const r = await call({ confirm: "DELETE" });
  assert.equal(r.status, 500); assert.match(r.out.error, /the login could not be deleted/);
  assert.deepEqual(calls[calls.length - 1][0], "auth.delete", "the login was the last thing tried");
});
