/* A synthetic backend for the browser cases: Auth, PostgREST, RPC and the app's own /api routes, by exact method and path.
 *
 * NEW work for PR 501 (27 October 2026), not a recovery of any earlier file. It is not scripts/mock-supabase.mjs: that mock answers every unknown path with 200 [],
 * which hides a request nobody expected. This one answers only the contract written below, answers anything else with 501, and records every request so a case
 * can assert exact counts and bodies. Everything is fictional: the data is the repository's own demo seed, the users are made up, the tokens are strings chosen here.
 * It listens on loopback only and is never given a credential, a real address or a live endpoint.
 *
 * The RPC shapes follow security-release/*.sql at the reviewed head:
 *   sage_config_read()                      -> { value: <config> }
 *   sage_store_read(p_store)                -> { value, updated_at, activity } or null when the store has no row
 *   sage_schedule_read(p_store,p_month,p_view) -> { state: "unpublished"|"published", store, month, subject, ... }
 */
import http from "node:http";
import { buildDemo, DEMO_STORE_ID } from "./demo-seed.mjs";

export const MOCK_PORT = 5433;   // the origin the app is built against (VITE_SUPABASE_URL=http://127.0.0.1:5433)
export const USER_A = "00000000-0000-4000-8000-000000000001";
export const USER_B = "00000000-0000-4000-8000-0000000000b2";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile, prefer, x-sage-wall-key",
  "access-control-allow-methods": "*",
};

/* A table-write policy from a list of rules { table, method, key: RegExp, max }. A write passes only if a rule names its table and method, EVERY written row's key (or id) matches the rule's pattern, the rule
   has not used up its count, and the body carries nothing from the invented files or the typed password. Returns the policy, with counts() to say what each rule took. */
export function makeWritePolicy(rules, forbidden = /Zzfictional|a-new-synthetic-password/) {
  const seen = rules.map(() => 0), flagged = [];
  const policy = (entry, table, fullBody) => {
    const text = fullBody !== undefined ? fullBody : entry.body;   // the recorded entry keeps only the first 1500 characters; the policy reads the whole body
    let rows; try { const b = JSON.parse(text || "null"); rows = Array.isArray(b) ? b : [b]; } catch (e) { return false; }
    if (forbidden.test(text || "")) return false;
    const i = rules.findIndex((r) => r.table === table && r.method === entry.method && (r.phase === undefined || r.phase === entry.phase) && (!r.auth || r.auth.test(entry.auth || "")) && rows.length > 0 && rows.every((row) => row && typeof row === "object" && r.key.test(String(row.key ?? row.id ?? ""))));
    if (i < 0 || seen[i] >= rules[i].max) return false;
    seen[i]++;
    /* A rule with a `finding` lets the write through so the flow under test is not disturbed, and records it: the case fails on it. It is a way of saying "the app does this, and it is not approved here". */
    if (rules[i].finding) for (const row of rows) flagged.push({ key: String(row.key ?? row.id ?? ""), method: entry.method, table, finding: rules[i].finding });
    return true;
  };
  policy.counts = () => rules.map((r, i) => ({ table: r.table, method: r.method, key: String(r.key), min: r.min || 0, max: r.max, seen: seen[i] }));
  policy.unmet = () => rules.map((r, i) => ({ r, n: seen[i] })).filter(({ r, n }) => n < (r.min || 0)).map(({ r, n }) => `${r.table} ${r.method} ${r.key} wanted at least ${r.min}, saw ${n}`);
  policy.findings = () => flagged.slice();
  return policy;
}

function match(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "apikey", "on_conflict", "columns"].includes(k)) continue;
    if (v.startsWith("eq.")) { const want = v.slice(3); out = out.filter((r) => String(r[k]) === want); }
    else if (v === "is.null") out = out.filter((r) => r[k] == null);
    else if (v.startsWith("like.")) { const re = new RegExp("^" + v.slice(5).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); out = out.filter((r) => re.test(String(r[k]))); }
    else if (v.startsWith("in.")) { const set = new Set(v.slice(3).replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""))); out = out.filter((r) => set.has(String(r[k]))); }
  }
  return out;
}

export function createBackend({ role = "admin", name = "Alex Reyner", userId = USER_A, extra = {} } = {}) {
  const demo = buildDemo();
  const tables = { app_data: [], profiles: [], floor_people: [], deal_events: [], queue_public: [], floor_public: [] };
  for (const { table, row } of demo.rows) tables[table].push(row);
  /* The settings row the app boots from, the same single-store shape scripts/mock-supabase.mjs serves. */
  const TIERS = [
    { cap: 60, requirements: [{ metric: "apptVideoDayPct", min: 50 }, { metric: "deliveredPct", min: 10 }, { metric: "engagedVideoPct", min: 40 }] },
    { cap: 80, requirements: [{ metric: "apptVideoDayPct", min: 55 }, { metric: "deliveredPct", min: 12 }, { metric: "engagedVideoPct", min: 45 }] },
    { cap: 100, requirements: [{ metric: "apptVideoDayPct", min: 60 }, { metric: "deliveredPct", min: 14 }, { metric: "engagedVideoPct", min: 50 }, { metric: "bhVideoPct", min: 40 }] },
  ];
  tables.app_data.push({ key: "lpc:config:v2", updated_at: new Date().toISOString(), value: {
    stores: [demo.storeConfig],
    roles: [
      { id: "sales", name: "Sales Associate", color: "#C77800", onBoard: true, coaching: true },
      { id: "service", name: "Service to Sales", color: "#7E8B24", onBoard: true, coaching: true },
      { id: "bdc", name: "BDC Agent", color: "#A6402F", onBoard: false, coaching: false },
      { id: "manager", name: "Manager", color: "#8A7360", onBoard: false, coaching: false, tracked: false },
    ],
    standards: { [DEMO_STORE_ID]: { sales: { tiers: TIERS }, service: { tiers: TIERS } } }, approvedDomains: [], registrationOpen: true, holidays: [],
    support: { name: "Jorge Asencio Rivera", role: "Digital Sales Training", email: "", phone: "", note: "" },
  } });
  /* The demo store carries a filed store roll-up ("stated") for the month. A case about a store with no aggregate on file takes it out of every row first. */
  if (extra.noStated) for (const r of tables.app_data) for (const m of Object.values((r.value && r.value.months) || {})) delete m.stated;
  const profile = { id: userId, email: "demo@sageonline.app", name, role, active: true, pending: false, stores: [DEMO_STORE_ID], wants: role === "admin" ? "manager" : "associate", ...(extra.profile || {}) };
  tables.profiles.push(profile);
  const state = {
    publications: {}, writePolicy: null, phase: "start", tables, profile, requests: [], unexpected: [], holds: [], rpc: { ...(extra.rpc || {}) }, passwordPuts: [], users: new Map([[userId, { id: userId, email: profile.email }]]),
    tokens: new Map([["synthetic-token-" + userId, userId]]),
  };
  /* More accounts and tokens for the cases that need a second person: addUser registers a token the Auth endpoints will vouch for, with an optional profile row and linked-staff row. */
  state.addUser = ({ id, token, email = `${id}@example.test`, profile = null, link = null }) => {
    state.users.set(id, { id, email }); state.tokens.set(token, id);
    if (profile) tables.profiles.push({ id, email, active: true, pending: false, stores: [DEMO_STORE_ID], ...profile });
    if (link) tables.floor_people.push({ user_id: id, store: DEMO_STORE_ID, person_id: link });
  };
  const configRow = () => tables.app_data.find((r) => r.key === "lpc:config:v2");
  const session = (id = state.profile.id) => ({
    access_token: "synthetic-token-" + id, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "synthetic-refresh-" + id,
    user: { id, email: (state.users.get(id) || {}).email || `${id}@example.test`, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" },
  });
  state.session = session;

  const rpcs = {
    sage_config_read: () => ({ value: configRow() ? configRow().value : null }),
    sage_store_read: (a) => { const row = tables.app_data.find((r) => r.key === `lpc:store:${a.p_store}:v2`); return row ? { value: row.value, updated_at: row.updated_at || null, activity: {} } : null; },
    /* Mirrors public.sage_schedule_read in security-release/coordinated-contracts.sql: approval first, then the link for the "own" view, then the publication, and an own read
       carries only that person's entry. state.publications is keyed "store:month" -> { revision, sourceRevision, publishedAt, people: { personId: { offDates } } }. */
    sage_schedule_read: (a, entry) => {
      const denied = (message, code = "42501") => ({ __error: true, status: code === "42501" ? 403 : 400, code, message });
      const uid = state.tokens.get(entry.auth); const p = tables.profiles.find((r) => r.id === uid);
      if (!p) return denied("not authenticated");
      if (p.pending !== false) return denied("approval required");
      if (!a.p_store || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(a.p_store) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(a.p_month || "")) return denied("store and month required", "22023");
      const view = a.p_view === undefined || a.p_view === null ? "own" : a.p_view;
      if (!["own", "manager"].includes(view)) return denied("invalid view", "22023");
      const manages = p.active !== false && ["admin", "manager"].includes(p.role) && (p.role === "admin" || (p.stores || []).includes(a.p_store));
      if (view === "manager" && !manages) return denied("approved store manager required");
      let person = null;
      if (view === "own") { const link = tables.floor_people.find((r) => r.user_id === p.id && r.store === a.p_store); if (!link) return denied("not linked to this store"); person = link.person_id; }
      const pub = state.publications[`${a.p_store}:${a.p_month}`];
      if (!pub || (person !== null && !Object.hasOwn(pub.people, person))) return { state: "unpublished", store: a.p_store, month: a.p_month, subject: person };
      return { state: "published", store: a.p_store, month: a.p_month, subject: person, revision: pub.revision, sourceRevision: pub.sourceRevision, publishedAt: pub.publishedAt, people: person === null ? pub.people : { [person]: pub.people[person] } };
    },
    ...state.rpc,
  };
  state.rpcs = rpcs;

  /* hold(predicate) -> { release(), released: Promise }: the next matching request waits until released. */
  state.hold = (predicate) => { const h = { predicate, hit: null }; h.gate = new Promise((r) => { h.release = r; }); h.seen = new Promise((r) => { h.markSeen = r; }); state.holds.push(h); return h; };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      const send = (code, payload, extraHeaders = {}) => { res.writeHead(code, { "content-type": "application/json", ...CORS, ...extraHeaders }); res.end(payload === undefined ? "" : JSON.stringify(payload)); };
      if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
      const entry = { method: req.method, path: u.pathname, query: u.search.slice(0, 200), body: body.slice(0, 1500), auth: String(req.headers.authorization || "").replace(/^Bearer /, "").slice(0, 60), phase: state.phase, at: Date.now() };
      state.requests.push(entry);
      for (const h of state.holds) if (!h.hit && h.predicate(entry)) { h.hit = entry; h.markSeen(entry); await h.gate; break; }
      const m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/), rpc = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      const userOf = (token) => state.tokens.get(token) || null;
      try {
        if (u.pathname === "/auth/v1/token" && req.method === "POST") { const g = u.searchParams.get("grant_type"); if (g === "password" || g === "refresh_token") return send(200, state.nextSession ? state.nextSession() : session()); }
        if (u.pathname === "/auth/v1/user" && req.method === "GET") { const id = userOf(entry.auth); return id ? send(200, session(id).user) : send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" }); }
        if (u.pathname === "/auth/v1/user" && req.method === "PUT") {
          state.passwordPuts.push(entry);
          const id = userOf(entry.auth); if (!id) return send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
          return send(200, session(id).user);
        }
        if (u.pathname === "/auth/v1/logout" && req.method === "POST") return send(204);
        if (rpc && req.method === "POST" && rpcs[rpc[1]]) {
          let args = {}; try { args = JSON.parse(body || "{}"); } catch (e) {}
          const out = await rpcs[rpc[1]](args, entry, state);
          if (out && out.__error) { entry.status = out.status || 403; entry.response = JSON.stringify({ status: entry.status, code: out.code || "42501", message: out.message || "denied" }); }
          if (out && out.__error) return send(out.status || 403, { code: out.code || "42501", message: out.message || "denied", details: "", hint: "" });
          entry.response = JSON.stringify(out === undefined ? null : out).slice(0, 4000);
          return send(200, out === undefined ? null : out);
        }
        if (m && tables[m[1]] && req.method === "GET") {
          const rows = match(tables[m[1]], [...u.searchParams.entries()]);
          if ((req.headers.accept || "").includes("pgrst.object")) return rows.length === 1 ? send(200, rows[0]) : send(406, { code: "PGRST116", message: "not one row", details: "", hint: "" });
          return send(200, rows);
        }
        if (m && tables[m[1]] && (req.method === "POST" || req.method === "PATCH")) {
          /* Every table write is checked against the case's own policy before anything changes. A case that names no policy allows no table write at all. A refused write is recorded as unexpected, so the case fails. */
          if (!state.writePolicy || !state.writePolicy(entry, m[1], body)) { state.unexpected.push({ ...entry, why: "table write not allowed by this case's policy" }); return send(403, { code: "42501", message: "write not allowed in this synthetic case", details: "", hint: "" }); }
          let data = {}; try { data = JSON.parse(body || "{}"); } catch (e) {}
          const list = Array.isArray(data) ? data : [data];
          const table = tables[m[1]], idKey = m[1] === "app_data" ? "key" : "id";
          if (req.method === "PATCH") { const hit = new Set(match(table, [...u.searchParams.entries()])); const out = []; for (let i = 0; i < table.length; i++) if (hit.has(table[i])) { table[i] = { ...table[i], ...data }; out.push(table[i]); } return send(200, out); }
          const upsert = /merge-duplicates/.test(String(req.headers.prefer || ""));
          if (!upsert && list.some((r) => table.some((x) => x[idKey] === r[idKey]))) return send(409, { code: "23505", message: "duplicate key value violates unique constraint", details: "", hint: "" });
          for (const r of list) { const at = table.findIndex((x) => x[idKey] === r[idKey]); if (at >= 0) table[at] = { ...table[at], ...r }; else table.push(r); }
          return send(201, list);
        }
      } catch (e) { state.unexpected.push({ ...entry, why: "handler threw: " + String(e).slice(0, 120) }); return send(500, { message: "synthetic backend error" }); }
      state.unexpected.push({ ...entry, why: "no such route in the synthetic contract" });
      return send(501, { message: "not in the synthetic contract" });
    });
  });
  state.listen = () => new Promise((resolve, reject) => { server.once("error", reject); server.listen(MOCK_PORT, "127.0.0.1", () => resolve(state)); });
  state.close = () => new Promise((resolve) => { for (const h of state.holds) h.release(); server.close(() => resolve()); server.closeAllConnections?.(); });
  return state;
}
