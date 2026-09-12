/* A stand-in for Supabase, just big enough to render the app locally.
   Serves the demo seed over the handful of PostgREST shapes the app uses.

   Run it:  node scripts/mock-supabase.mjs            the demo account is a manager
            SALESPERSON=1 node scripts/mock-supabase.mjs   ...is Dev Okonjo, an associate
   Point the app at it with a .env.local of
            VITE_SUPABASE_URL=http://127.0.0.1:5433
            VITE_SUPABASE_ANON_KEY=mock-anon-key
   Rows live in memory and go with the process; scripts/feel.mjs writes the
   ones it needs. The token it hands out expires an hour after each request,
   not an hour after the mock started: the older shape had every sign-in after
   the first hour arriving already expired, and the client's refresh loop then
   held every read for seconds. */
import http from "node:http";
import { buildDemo, DEMO_STORE_ID, DEMO_STORE_NAME } from "./demo-seed.mjs";

const demo = buildDemo();
/* queue_identity is what the sign-in page reads to know whether somebody has a
   PIN yet. Without it the PIN step can never complete and the salesperson's
   own screens are unreachable in this harness. */
const TABLES = { app_data: [], profiles: [], floor_people: [], deal_events: [], queue_public: [], floor_public: [], queue_identity: [] };
for (const { table, row } of demo.rows) TABLES[table].push(row);

const TIERS = [
  { cap: 60,  requirements: [ { metric: "apptVideoDayPct", min: 50 }, { metric: "deliveredPct", min: 10 }, { metric: "engagedVideoPct", min: 40 } ] },
  { cap: 80,  requirements: [ { metric: "apptVideoDayPct", min: 55 }, { metric: "deliveredPct", min: 12 }, { metric: "engagedVideoPct", min: 45 } ] },
  { cap: 100, requirements: [ { metric: "apptVideoDayPct", min: 60 }, { metric: "deliveredPct", min: 14 }, { metric: "engagedVideoPct", min: 50 }, { metric: "bhVideoPct", min: 40 } ] },
];
const USER_ID = "00000000-0000-4000-8000-000000000001";
/* SALESPERSON=1 turns the demo account into a linked associate, which is the
   only way to reach the phone's own corner in this harness. */
const AS_SALES = process.env.SALESPERSON === "1";
TABLES.profiles.push({
  id: USER_ID, email: "demo@sageonline.app", name: AS_SALES ? "Dev Okonjo" : "Alex Reyner",
  role: AS_SALES ? "associate" : "admin", active: true, pending: false,
  stores: [DEMO_STORE_ID], wants: AS_SALES ? "associate" : "manager",
});
if (AS_SALES) {
  const dev = demo.roster.find((r) => r.name === "Dev Okonjo");
  TABLES.floor_people.push({ user_id: USER_ID, store: DEMO_STORE_ID, person_id: dev.id });
}

/* The config the app boots from: one store, the demo one. */
TABLES.app_data.push({
  key: "lpc:config:v2",
  value: {
    stores: [demo.storeConfig],
    roles: [
      { id: "sales", name: "Sales Associate", color: "#C77800", onBoard: true, coaching: true },
      { id: "service", name: "Service to Sales", color: "#7E8B24", onBoard: true, coaching: true },
      { id: "bdc", name: "BDC Agent", color: "#A6402F", onBoard: false, coaching: false },
      { id: "manager", name: "Manager", color: "#8A7360", onBoard: false, coaching: false, tracked: false },
    ],
    standards: { [DEMO_STORE_ID]: { sales: { tiers: TIERS }, service: { tiers: TIERS } } }, approvedDomains: [], registrationOpen: true, holidays: [],
    support: { name: "Jorge Asencio Rivera", role: "Digital Sales Training", email: "", phone: "", note: "" },
  },
  updated_at: new Date().toISOString(),
});

const SESSION = {
  access_token: "mock-token", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "mock-refresh",
  user: { id: USER_ID, email: "demo@sageonline.app", aud: "authenticated", role: "authenticated",
    app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

/* PostgREST filters, only the two forms the app sends. */
function match(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "apikey"].includes(k)) continue;
    if (v.startsWith("eq.")) { const want = v.slice(3); out = out.filter((r) => String(r[k]) === want); }
    else if (v.startsWith("in.")) {
      const set = new Set(v.slice(3).replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")));
      out = out.filter((r) => set.has(String(r[k])));
    }
  }
  return out;
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let bodyText = "";
  req.on("data", (c) => { bodyText += c; });
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*",
      "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  if (req.method === "OPTIONS") return send(204);

  if (u.pathname.startsWith("/auth/v1/token")) return send(200, { ...SESSION, expires_at: Math.floor(Date.now() / 1000) + 3600 });
  if (u.pathname === "/auth/v1/user") return send(200, SESSION.user);
  if (u.pathname.startsWith("/auth/v1")) return send(200, {});

  /* Real Supabase is not instant, and the arrival is timed against it. LAT
     is a floor on every read; the store row gets STORE_LAT on top, because
     that is the big one the dashboard actually waits for. */
  const LAT = Number(process.env.MOCK_LAT || 0);
  const STORE_LAT = Number(process.env.MOCK_STORE_LAT || 0);
  const key = u.searchParams.get("key") || "";
  const extra = key.includes("lpc:store:") ? STORE_LAT : 0;
  const hold = LAT + extra;

  const m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (m && TABLES[m[1]] && (req.method === "POST" || req.method === "PATCH")) {
    /* Upsert, keyed the way each table is keyed. Without this a write returns
       200, changes nothing, and the next read hands back the old row — which
       looks exactly like a bug in the app. */
    req.on("end", () => {
      let rows = [];
      try { rows = JSON.parse(bodyText || "[]"); } catch (e) {}
      if (!Array.isArray(rows)) rows = [rows];
      const table = TABLES[m[1]];
      const idKey = m[1] === "app_data" ? "key" : "id";
      for (const r of rows) {
        const at = table.findIndex((x) => x[idKey] === r[idKey]);
        if (at >= 0) table[at] = { ...table[at], ...r }; else table.push(r);
        if (m[1] === "queue_public") console.log("WRITE queue", new Date().toISOString().slice(11,19));
      }
      send(201, rows);
    });
    return;
  }
  if (m && TABLES[m[1]]) {
    const rows = match(TABLES[m[1]], [...u.searchParams.entries()]);
    const single = (req.headers.accept || "").includes("pgrst.object");
    const reply = () => {
      if (single) {
        if (rows.length === 1) return send(200, rows[0]);
        return send(406, { code: "PGRST116", message: "not one row", details: "", hint: "" });
      }
      return send(200, rows);
    };
    if (hold > 0) { setTimeout(reply, hold); return; }
    return reply();
  }
  send(200, []);
}).listen(5433, "127.0.0.1", () => console.log("mock supabase on 5433"));
