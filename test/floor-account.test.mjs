/**
 * The account things a store manager may do for somebody on their floor.
 * -------------------------------------------------------------------------
 * Every check here is about who may NOT do what. The useful half of this
 * endpoint is one line long; the rest is the fence around it.
 *
 * Supabase is stubbed at the network layer rather than by replacing the client,
 * so the real query builder runs and a wrong filter still shows up here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://stub.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
process.env.SUPABASE_ANON_KEY = "anon";

let SESSION = "mgr-1", sessionOk = true;
let PROFILES = {};        // id -> { role, stores, active }
let LINKS = [];           // { user_id, store, person_id }
let updates = [];

const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, opt = {}) => {
  const u = decodeURIComponent(String(url)), m = (opt.method || "GET").toUpperCase();
  if (u.includes("/auth/v1/user")) return sessionOk ? j({ id: SESSION }) : j({ msg: "bad" }, 401);
  if (u.includes("/rest/v1/profiles")) {
    const id = (u.match(/id=eq\.([^&]+)/) || [])[1];
    if (m === "PATCH") { updates.push({ id, body: JSON.parse(opt.body) }); return j([]); }
    const p = PROFILES[id];
    return j(p ? [p] : []);
  }
  if (u.includes("/rest/v1/floor_people")) {
    const uid = (u.match(/user_id=eq\.([^&]+)/) || [])[1];
    const st = (u.match(/store=eq\.([^&]+)/) || [])[1];
    return j(LINKS.filter((l) => l.user_id === uid && l.store === st));
  }
  return j({});
};

const { default: acct } = await import("../api/floor-account.mjs");
const mkRes = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (x) => { r.body = x; return r; }; return r; };
const call = (body, jwt = "jwt") => {
  const res = mkRes();
  return acct({ method: "POST", headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body }, res).then(() => res);
};

const reset = () => {
  SESSION = "mgr-1"; sessionOk = true; updates = [];
  PROFILES = {
    "mgr-1": { role: "manager", stores: ["mazda"], active: true },
    "mgr-other": { role: "manager", stores: ["ford"], active: true },
    "admin-1": { role: "admin", stores: [], active: true },
    "sales-1": { role: "manager", stores: [], active: true },
    "overseer-1": { role: "overseer", stores: ["mazda"], active: true },
  };
  LINKS = [{ user_id: "sales-1", store: "mazda", person_id: "roster-luis" },
           { user_id: "overseer-1", store: "mazda", person_id: "roster-bdc" }];
};

test("a manager can switch off an account on their own floor", async () => {
  reset();
  const r = await call({ store: "mazda", user_id: "sales-1", action: "deactivate" });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(updates[0].body, { active: false });
  assert.equal(updates[0].id, "sales-1", "and only that account");
});

test("and switch it back on", async () => {
  reset();
  const r = await call({ store: "mazda", user_id: "sales-1", action: "activate" });
  assert.equal(r.code, 200);
  assert.deepEqual(updates[0].body, { active: true });
});

test("a manager of another store cannot", async () => {
  reset(); SESSION = "mgr-other";
  const r = await call({ store: "mazda", user_id: "sales-1", action: "deactivate" });
  assert.equal(r.code, 403);
  assert.equal(updates.length, 0, "and nothing was written");
});

test("an account that is not on this floor is out of reach", async () => {
  /* The link is what makes somebody this store's business. Without this the
     first use of the endpoint is reaching somebody at another rooftop. */
  reset();
  const r = await call({ store: "mazda", user_id: "admin-1", action: "deactivate" });
  assert.equal(r.code, 403);
  assert.match(r.body.error, /not linked/);
  assert.equal(updates.length, 0);
});

test("a linked account that outranks the floor is still out of reach", async () => {
  /* An administrator with a linked account is still an administrator, and the
     first thing this endpoint would otherwise be good for is switching off the
     person about to look at your numbers. */
  reset();
  const r = await call({ store: "mazda", user_id: "overseer-1", action: "deactivate" });
  assert.equal(r.code, 403);
  assert.match(r.body.error, /admin has to do this/);
  assert.equal(updates.length, 0);
});

test("an admin may act without a link", async () => {
  reset(); SESSION = "admin-1";
  const r = await call({ store: "mazda", user_id: "sales-1", action: "deactivate" });
  assert.equal(r.code, 200);
});

test("nobody can switch off their own account", async () => {
  /* It locks you out of the tool with no way back that does not involve
     somebody else. */
  reset(); SESSION = "sales-1";
  PROFILES["sales-1"] = { role: "manager", stores: ["mazda"], active: true };
  const r = await call({ store: "mazda", user_id: "sales-1", action: "deactivate" });
  assert.equal(r.code, 400);
  assert.equal(updates.length, 0);
});

test("no session is refused", async () => {
  reset();
  assert.equal((await call({ store: "mazda", user_id: "sales-1", action: "deactivate" }, null)).code, 401);
  sessionOk = false;
  assert.equal((await call({ store: "mazda", user_id: "sales-1", action: "deactivate" })).code, 401);
});

test("somebody with no profile at all is refused", async () => {
  reset(); SESSION = "ghost";
  const r = await call({ store: "mazda", user_id: "sales-1", action: "deactivate" });
  assert.equal(r.code, 403);
});

test("a made-up action is refused before anything is read", async () => {
  reset();
  for (const action of ["delete", "promote", "", undefined]) {
    const r = await call({ store: "mazda", user_id: "sales-1", action });
    assert.equal(r.code, 400, `action ${action}`);
  }
  assert.equal(updates.length, 0);
});

test("a request missing its store or its account is refused", async () => {
  reset();
  assert.equal((await call({ user_id: "sales-1", action: "deactivate" })).code, 400);
  assert.equal((await call({ store: "mazda", action: "deactivate" })).code, 400);
});

test("only POST", async () => {
  reset();
  const res = mkRes();
  await acct({ method: "GET", headers: {}, body: {} }, res);
  assert.equal(res.code, 405);
});
