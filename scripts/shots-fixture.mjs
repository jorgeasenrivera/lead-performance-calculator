/**
 * A stand-in backend for the shots run: Supabase on 5433 and the app's own origin
 * on 5178, from one process, loopback only.
 * -------------------------------------------------------------------------
 * scripts/mock-supabase.mjs answers every path it does not know with 200 and
 * an empty array, which is the right answer for a mock and the wrong one for a
 * check: the app now reads its config and its store through two RPCs the mock
 * has never heard of, and an empty array is truthy, so it arrives looking like
 * a config with no value in it. Nothing says so. This fixture says so, by
 * answering only what is written down below and refusing the rest with a 501
 * that counts against the run.
 *
 * Two modes, identical in every way except two answers:
 *   legacy      sage_config_read and sage_store_read answer 200 [], as the
 *               ordinary mock does
 *   compatible  the same two answer the shapes the app is written for
 * Everything else, the static files, /api/floor-row, the table reads and the
 * refusals, is the same code in both, so a run in one mode against the other
 * moves exactly one thing.
 *
 * What it is not: a copy of the real API. It imports nothing from api/, holds
 * no credential, and the floor row it hands back is the seeded row as stored,
 * without the real endpoint's projection to the signed-in person. The shapes
 * and the stamps are real; the projection is not. So whatever a run against
 * this learns is about the two RPC reads and the arrival, and nothing here may
 * be read as a finding about how a room renders production data.
 *
 * Two runs are only comparable if they share a clock and a seed. The mode alone
 * does not make them identical: buildDemo() reads the system clock and draws
 * some ids from Math.random. So the seed can be built once (makeSeed) and handed
 * to both fixtures, and `now` can be fixed; the report says which was used.
 *
 * It reports on itself at GET /__fixture/report as fixed enums and counts. It
 * never exports a path, a header, a token or a body.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildDemo, DEMO_STORE_ID, storeDay as seedStoreDay } from "./demo-seed.mjs";
import { classifyRoute, shapeOf, MAX_REQUESTS } from "./shots-evidence.mjs";

const MAX_N = 1_000_000_000;
const MAX_URL = 2048;
/* new URL() resolves dot segments, so "/assets/../index.html" arrives as "/index.html" and
   "/../../x" as "/x", and a path with no extension then gets the app shell. A dot segment,
   raw or percent-encoded, is not something this fixture is ever asked for, so the raw
   target is refused before it is parsed. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;
const isPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;
/* ---- the six pure room modules: pinned, graph-checked, and only then imported ----
   The room API runs the app's own reducer and projection rather than a copy of them, so
   there is one source of truth. That means importing code from api/, which this file
   otherwise never does, so the exception is as narrow as it can be made: six named files,
   each pinned by sha256; their whole import graph must be exactly the one written down
   (relative imports among the six, nothing else, no Node built-in, no environment, no
   network, no database client); all of that is checked on the bytes BEFORE anything is
   imported, and a failure refuses to load rather than loads less. No handler (the files
   that talk to the database) is ever imported. The final _self-room-command is the type
   patch on the public 477 baseline d41af851..., and its pin is the patched file's. */
const ROOM_PINS = {
  "_self-room-command": "d28dcd873f6c8acb2832b8baf811848a4c9036d0afc95985e38db1fa0cae43a6",
  "_queue-action": "b2dfa5a00736eb486f7a8613d58bfd9b624437eae5405ab95b4508c2f0d9d3c1",
  "_phone-action": "786dcc5d81fdf984927551010f329229afcf0db20866864f343ed6790d255fd6",
  "_stations": "8a6ee08da0cb07ddf515791400af26b287535c5da2a4c069ec32ca43df318537",
  "_phone-rows": "959fabf15e9c1b0f0f3ae7d8acf4d908dcd771cb95aa3786a2d314e9bfc67a53",
  "_room-projection": "393aca98227233e8c87a56493376bb7f2c9d6d68893bd55ef3e66a3e77b412b6",
};
const ROOM_GRAPH = {
  "_self-room-command": ["_phone-action", "_phone-rows", "_queue-action", "_stations"],
  "_phone-action": ["_stations"], "_queue-action": [], "_stations": [], "_phone-rows": [], "_room-projection": [],
};
/* What code in a pure module would have no business doing. Specific on purpose: the words
   process or supabase may appear in a comment, but these shapes are calls and imports. */
const ROOM_FORBIDDEN = [/\bprocess\s*\.\s*(?:env|argv|exit|cwd|binding|kill)\b/, /\bfetch\s*\(/, /\bimport\s*\(/, /\brequire\s*\(/, /\beval\s*\(/, /\bnew\s+Function\s*\(/,
  /\bcreateClient\s*\(/, /["']node:/, /\bglobalThis\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bchild_process\b/];
export class RoomModulesError extends Error { constructor(code, message) { super(message); this.name = "RoomModulesError"; this.code = code; } }
/* Every module specifier a module's text imports or re-exports, sorted, and any dynamic or
   forbidden shape found in it. Pure text work: nothing here imports or runs anything. */
export function scanRoomModule(text) {
  const specs = new Set();
  for (const m of String(text).matchAll(/(?:^|[\s;}])import\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)) specs.add(m[1]);
  for (const m of String(text).matchAll(/\bexport\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g)) specs.add(m[1]);
  return { specs: [...specs].sort(), forbidden: ROOM_FORBIDDEN.filter((re) => re.test(text)).map(String) };
}
export function verifyRoomGraph(texts, graph = ROOM_GRAPH) {
  for (const name of Object.keys(graph)) {
    if (typeof texts[name] !== "string") throw new RoomModulesError("graph", `${name} is missing`);
    const { specs, forbidden } = scanRoomModule(texts[name]);
    if (forbidden.length) throw new RoomModulesError("forbidden", `${name} has a shape a pure module must not have`);
    const want = graph[name].map((n) => `./${n}.mjs`);
    if (specs.length !== want.length || specs.some((s, i) => s !== want[i])) throw new RoomModulesError("graph", `${name} imports something other than its written-down graph`);
  }
  return true;
}
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
export async function loadRoomModules(dir, { pins = ROOM_PINS } = {}) {
  if (typeof dir !== "string" || !dir) throw new RoomModulesError("absent", "no room module folder given");
  let root;
  try { root = fs.realpathSync(dir); } catch (e) { throw new RoomModulesError("absent", "room module folder not found"); }
  const texts = {};
  for (const name of Object.keys(pins)) {
    const file = path.join(root, name + ".mjs");
    let st;
    try { st = fs.lstatSync(file); } catch (e) { throw new RoomModulesError("absent", `${name} not found`); }
    if (!st.isFile() || st.isSymbolicLink()) throw new RoomModulesError("kind", `${name} is not a plain file`);
    const buf = fs.readFileSync(file);
    if (sha256(buf) !== pins[name]) throw new RoomModulesError("hash", `${name} does not match its pin`);
    texts[name] = buf.toString("utf8");
  }
  verifyRoomGraph(texts);
  const sel = await import(pathToFileURL(path.join(root, "_self-room-command.mjs")).href);
  const proj = await import(pathToFileURL(path.join(root, "_room-projection.mjs")).href);
  for (const name of Object.keys(pins)) {
    if (sha256(fs.readFileSync(path.join(root, name + ".mjs"))) !== pins[name]) throw new RoomModulesError("changed", `${name} changed while loading`);
  }
  if (typeof sel.selfRoomCommand !== "function" || typeof proj.roomProjection !== "function") throw new RoomModulesError("shape", "the modules do not export what the fixture needs");
  return Object.freeze({ selfRoomCommand: sel.selfRoomCommand, roomProjection: proj.roomProjection, dir: root, pins: Object.freeze({ ...pins }) });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const ROOM_ACTIONS = ["status", "assist", "cancel-assist"];
const SCHEDULE_ARGS = ["p_store", "p_month", "p_view"];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;   // what feel's Lunch/Here and FlyBy send; nothing else is answered
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const canon = (v) => JSON.stringify(sortKeys(v));

const MAX_BODY = 262144;      // bytes of request body, counted as read
const MAX_FILES = 5000;
const MAX_DIST_BYTES = 200 * 1024 * 1024;
const MAX_DEPTH = 16;
const MAX_ROWS = 8;
const LOOPBACK = "127.0.0.1";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STORE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FLOOR_ID = new RegExp(`^${DEMO_STORE_ID}:\\d{4}-\\d{2}-\\d{2}$`);
const QUEUE_ID = new RegExp(`^${DEMO_STORE_ID}:\\d{4}-\\d{2}-\\d{2}(:online)?$`);
const USER_ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "mock-token";
/* Two fictional actors. The associate is the one every earlier run used; the manager is a separate
   person with her own account, credential, token and refresh token, and exists only if the seed
   carries her (so her presence is part of the seed's hash, never added after it). Tokens are
   invented strings; nothing here is a real credential. */
export const MANAGER_ID = "00000000-0000-4000-8000-0000000000a1";
export const MANAGER_EMAIL = "manager.demo@sageonline.app";
const ACTORS = [
  { id: USER_ID, email: "demo@sageonline.app", token: TOKEN, refresh: "mock-refresh" },
  { id: MANAGER_ID, email: MANAGER_EMAIL, token: "mock-manager-token", refresh: "mock-manager-refresh" },
];
const actorByToken = (t) => (typeof t === "string" && t ? ACTORS.find((a) => a.token === t) : undefined);
const bearerActor = (header) => { const h = String(header || ""); return h.startsWith("Bearer ") ? actorByToken(h.slice(7)) : undefined; };
const IGNORED_PARAMS = ["select", "order", "limit", "offset", "apikey", "on_conflict", "columns"];
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile, prefer",
  "access-control-allow-methods": "*",
};
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".txt": "text/plain" };

/* ---- the pinned dist: contents, not names ----
   Two builds with the same file names and different bytes must hash differently,
   so the manifest hashes every file's content and folds the names in. Anything
   that is not a plain file, or looks like a secret, refuses to be pinned at all
   rather than being skipped, because a pin that quietly leaves things out is
   not a pin. */
const secretLike = (name) => /(^|\.)(env|pem|key|p12|pfx)$/i.test(name) || /secret|credential|id_rsa|npmrc|netrc/i.test(name);
export function buildManifest(distDir) {
  const root = fs.realpathSync(distDir);
  const files = new Map();
  let bytes = 0;
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) throw new Error("dist is nested too deep");
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".") || secretLike(ent.name)) throw new Error("dist holds a file that cannot be pinned");
      const abs = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) throw new Error("dist holds a symbolic link");
      if (ent.isDirectory()) { walk(abs, depth + 1); continue; }
      if (!ent.isFile()) throw new Error("dist holds something that is not a plain file");
      const buf = fs.readFileSync(abs);
      bytes += buf.length;
      if (files.size >= MAX_FILES || bytes > MAX_DIST_BYTES) throw new Error("dist is larger than the fixture will pin");
      files.set(path.relative(root, abs).split(path.sep).join("/"), { abs, sha: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length });
    }
  };
  walk(root, 0);
  if (!files.has("index.html")) throw new Error("dist has no index.html");
  const h = crypto.createHash("sha256");
  for (const rel of [...files.keys()].sort()) h.update(`${rel}\0${files.get(rel).sha}\n`);
  return { root, files, summary: { files: files.size, bytes, sha256: h.digest("hex") } };
}

/* ---- the seed: the same rows the ordinary mock holds, kept here so that file
   stays as it is ---- */
/* Built once and handed to any number of fixtures when runs must share state. */
export function makeSeed(now = Date.now(), { managerActor = false } = {}) {
  const demo = buildDemo(new Date(now));
  const t = { app_data: [], profiles: [], floor_people: [], deal_events: [], queue_public: [], floor_public: [] };
  for (const { table, row } of demo.rows) t[table].push(row);
  t.profiles.push({ id: USER_ID, email: "demo@sageonline.app", name: "Dev Okonjo", role: "associate", active: true, pending: false, stores: [DEMO_STORE_ID], wants: "associate" });
  if (managerActor) t.profiles.push({ id: MANAGER_ID, email: MANAGER_EMAIL, name: "Casey Manager", role: "manager", active: true, pending: false, stores: [DEMO_STORE_ID], wants: "manager", onboarded: true });
  const dev = demo.roster.find((r) => r.name === "Dev Okonjo");
  t.floor_people.push({ user_id: USER_ID, store: DEMO_STORE_ID, person_id: dev.id });
  const TIERS = [
    { cap: 60, requirements: [{ metric: "apptVideoDayPct", min: 50 }, { metric: "deliveredPct", min: 10 }, { metric: "engagedVideoPct", min: 40 }] },
    { cap: 80, requirements: [{ metric: "apptVideoDayPct", min: 55 }, { metric: "deliveredPct", min: 12 }, { metric: "engagedVideoPct", min: 45 }] },
    { cap: 100, requirements: [{ metric: "apptVideoDayPct", min: 60 }, { metric: "deliveredPct", min: 14 }, { metric: "engagedVideoPct", min: 50 }, { metric: "bhVideoPct", min: 40 }] },
  ];
  t.app_data.push({ key: "lpc:config:v2", updated_at: new Date(now).toISOString(), value: {
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
  return t;
}

function matchRows(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (IGNORED_PARAMS.includes(k)) continue;
    if (!/^[a-z_]+$/.test(k)) return null;
    if (v.startsWith("eq.")) { const want = v.slice(3); out = out.filter((r) => String(r[k]) === want); }
    else if (v === "is.null") out = out.filter((r) => r[k] == null);
    else if (v.startsWith("in.")) { const set = new Set(v.slice(3).replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""))); out = out.filter((r) => set.has(String(r[k]))); }
    else if (v.startsWith("like.")) { const re = new RegExp("^" + v.slice(5).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); out = out.filter((r) => re.test(String(r[k]))); }
    else return null;   // an operator nobody wrote down is not ignored, it is refused
  }
  return out;
}

/* A seed that two separate fixture processes can start from: written once, never overwritten,
   hashed, and optionally checked against a pin. */
export function loadOrCreateSeed(file, { now = Date.now(), sha256: expect, managerActor = false } = {}) {
  if (typeof file !== "string" || !file) throw new Error("a seed file path is needed");
  let created = false;
  if (!fs.existsSync(file)) {
    try { fs.writeFileSync(file, canon(makeSeed(now, { managerActor })), { flag: "wx" }); created = true; } catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 8 * 1024 * 1024) throw new Error("the seed file is not a plain file of a sensible size");
  const buf = fs.readFileSync(file);
  const digest = sha256(buf);
  if (expect && digest !== expect) throw new Error("the seed file does not match its pin");
  let seed;
  try { seed = JSON.parse(buf.toString("utf8")); } catch (e) { throw new Error("the seed file is not JSON"); }
  const tablesWanted = ["app_data", "profiles", "floor_people", "deal_events", "queue_public", "floor_public"];
  if (!seed || typeof seed !== "object" || Array.isArray(seed) || !tablesWanted.every((t) => Array.isArray(seed[t]))) throw new Error("the seed file does not hold the tables a fixture needs");
  if (managerActor && !seed.profiles.some((p) => p.id === MANAGER_ID)) throw new Error("the seed file does not carry the manager actor, and it cannot be added after the file was hashed");
  return { seed, sha256: digest, created };
}

export function createFixture({ mode, distDir, supabasePort = 5433, appPort = 5178, now, seed, room, apiOff = false, normalizeSeedIdentity = false, requireManagerActor = false }) {
  if (mode !== "legacy" && mode !== "compatible") throw new Error("mode is legacy or compatible");
  if (!isPort(supabasePort) || !isPort(appPort) || supabasePort === appPort) throw new Error("two different loopback ports are needed");
  if (now !== undefined && !Number.isFinite(now)) throw new Error("now is a number of milliseconds, or absent");
  if (room !== undefined && (!room || typeof room.selfRoomCommand !== "function" || typeof room.roomProjection !== "function")) throw new Error("room is what loadRoomModules returns");
  if (room && apiOff) throw new Error("the room API cannot be both on and off");
  const dist = buildManifest(distDir);
  const clock = now === undefined ? () => Date.now() : () => now;
  const tables = seed ? structuredClone(seed) : makeSeed(clock());
  /* A room row's own store and date. The real commit refuses a row that does not carry them
     (sage_room_commit: "row identity mismatch"), and the demo seed and the feel harness write
     rows that do not. Off by default, so that refusal is what a run sees. On, it is a fixture
     correction to the SEED and nothing wider:
       - at creation, a seeded floor or queue row that has NO store or NO date key in its data
         gets it from the row's own columns, once; a key that is present must already agree,
         and a wrong, null or undefined value is refused (the fixture will not be built), never
         overwritten;
       - after that, every write to those tables must itself carry a store and date that agree
         with the row's id and columns, or it is refused (501, counted). Nothing is filled in
         again on a later write: a row that arrives without them, or with the wrong ones, is
         the same fault the real commit would refuse, and it is shown, not repaired;
       - the normalised rows are hashed and the identity each one was given is listed
         (seedBinding), so two runs can be shown to have started from the same bytes. */
  const fillAbsentIdentity = (m, r) => {
    const colDate = m === "floor_public" ? r.fdate : r.qdate;
    const idDate = String(r.id).split(":")[1];
    if (typeof r.store !== "string" || typeof colDate !== "string" || colDate !== idDate || String(r.id).split(":")[0] !== r.store) throw new Error(`seed row ${m} ${r.id}: its id and columns disagree, so no identity can be derived`);
    if (!r.data || typeof r.data !== "object" || Array.isArray(r.data)) throw new Error(`seed row ${m} ${r.id}: its data is not an object`);
    const data = { ...r.data };
    for (const [k, want] of [["store", r.store], ["date", colDate]]) {
      if (!Object.hasOwn(data, k)) data[k] = want;
      else if (data[k] !== want) throw new Error(`seed row ${m} ${r.id}: its data names a different ${k}; it is not rewritten`);
    }
    return { ...r, data };
  };
  const identityHolds = (m, r) => {   // a later write: no filling in, only agreement
    const [s0, d0] = String(r.id).split(":");
    const colDate = m === "floor_public" ? r.fdate : r.qdate;
    return r.store === s0 && colDate === d0 && !!r.data && typeof r.data === "object" && !Array.isArray(r.data) && r.data.store === s0 && r.data.date === d0;
  };
  if (normalizeSeedIdentity) for (const m of ["floor_public", "queue_public"]) tables[m] = tables[m].map((r) => fillAbsentIdentity(m, r));
  const seedBinding = Object.freeze({
    identity: !!normalizeSeedIdentity,
    rowsSha256: sha256(canon(["floor_public", "queue_public"].map((m) => [m, [...tables[m]].sort((x, y) => String(x.id).localeCompare(String(y.id)))]))),
    rows: normalizeSeedIdentity ? ["floor_public", "queue_public"].flatMap((m) => tables[m].map((r) => ({ table: m, id: r.id, store: r.data.store, date: r.data.date }))) : [],
  });
  if (requireManagerActor && !tables.profiles.some((p) => p.id === MANAGER_ID && p.role === "manager" && p.active === true && p.pending === false && (p.stores || []).includes(DEMO_STORE_ID))) {
    throw new Error("the seed does not carry an approved manager for the demo store");
  }
  /* Who is in the seed, by what the policy looks at; no token is part of it. Hashed here so that two
     cells can be shown to have started with the same people. */
  const actorManifest = (() => {
    const actors = tables.profiles.map((p) => ({ id: p.id, email: p.email, role: p.role, active: p.active, pending: p.pending, stores: p.stores, linked: tables.floor_people.filter((r) => r.user_id === p.id).map((r) => r.store) }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return Object.freeze({ actors, sha256: sha256(canon(actors)) });
  })();
  /* Counters for things the fixture answers on purpose and does not call unexpected. Named, bounded,
     and served separately from the report, whose schema is frozen. */
  const expected = { "realtime-handshake-unavailable": 0 };
  const expectedDoc = () => ({ schema: 1, kind: "fixture-expected", counters: { ...expected } });
  const receipts = new Map();   // `${actor}|${operationId}` -> { request, result }: the room receipt, in memory
  const session = (actor = ACTORS[0]) => ({
    access_token: actor.token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(clock() / 1000) + 3600, refresh_token: actor.refresh,
    user: { id: actor.id, email: actor.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date(clock()).toISOString() },
  });
  let lastStamp = 0;
  const stampNow = () => { lastStamp = Math.max(clock(), lastStamp + 1); return new Date(lastStamp).toISOString(); };

  /* ---- what is counted ---- */
  const counts = new Map(), shapes = new Map(), unexpectedBy = new Map();
  let unexpected = 0, dropped = 0, droppedShapes = 0, droppedUnexpected = 0;
  const bump = (m, k) => m.set(k, Math.min((m.get(k) || 0) + 1, MAX_N));
  const more = (n) => Math.min(n + 1, MAX_N);
  /* A method outside the allowlist has no entry to land in, so it is counted as
     dropped; the class and the unexpected count still record that it happened. */
  const note = (method, cls, status, shape, bad) => {
    const k = `${method}|${cls}|${status}`;
    if (!method) dropped = more(dropped);
    else if (counts.has(k) || counts.size < MAX_REQUESTS) bump(counts, k);
    else dropped = more(dropped);
    if (shape) { if (shapes.has(cls) || shapes.size < 16) { const h = shapes.get(cls) || new Map(); bump(h, shape); shapes.set(cls, h); } else droppedShapes = more(droppedShapes); }
    if (bad) { unexpected = more(unexpected); if (unexpectedBy.has(cls) || unexpectedBy.size < 16) bump(unexpectedBy, cls); else droppedUnexpected = more(droppedUnexpected); }
  };
  const report = () => ({
    schema: 1, mode, clock: now === undefined ? "system" : "fixed", seed: seed ? "shared" : "fresh", dist: dist.summary,
    requests: [...counts].map(([k, n]) => { const [m, c, s] = k.split("|"); return { m, c, s: Number(s), n }; }),
    shapes: [...shapes].map(([c, h]) => ({ c, h: Object.fromEntries(h) })),
    unexpectedByClass: [...unexpectedBy].map(([c, n]) => ({ c, n })), unexpected, dropped, droppedShapes, droppedUnexpected,
  });

  /* ---- answers ---- */
  const json = (status, value, extra = {}) => ({ status, type: "application/json", body: JSON.stringify(value), shape: shapeOf(value), ...extra });
  const empty = (status) => ({ status, type: "application/json", body: "", shape: "empty-body" });
  /* Anything not written down. 501, and it counts against the run. */
  const refuse = () => ({ status: 501, type: "application/json", body: JSON.stringify({ message: "not in the fixture contract" }), shape: "object-no-value-key", bad: true });
  const parse = (text) => { try { return JSON.parse(text || "null"); } catch (e) { return undefined; } };

  /* sage_schedule_read, the salesperson's own view only. The order of the checks and the
     messages are those of the SQL (security-release/coordinated-contracts.sql, blob 55113a7a…):
     sage_private.actor() (a missing profile, or active that is not true, is "active account
     required"; with no signed-in user there is no profile, so it is the same refusal), approval
     (pending must be exactly false), the arguments, the view (omitted means own; an explicit null
     or anything but own or manager is "invalid view"), the link, then the publication. This fixture has no way to publish, so the answer for a linked
     associate is always "unpublished", which the app turns into "no schedule known", never
     into days off. There is no manager grant and no publication here: p_view "manager" is
     not implemented and stays a counted 501, as does anything outside the three arguments. */
  const denied = (status, code, message) => ({ ...json(status, { code, message, details: "", hint: "" }), bad: true });
  const scheduleRead = (req, args) => {
    if (!args || typeof args !== "object" || Array.isArray(args) || !Object.keys(args).every((k) => SCHEDULE_ARGS.includes(k))) return refuse();
    if (args.p_view === "manager") return refuse();
    /* The scheme is required, as for the room command. (The synthetic backend this was read from
       strips an optional prefix, so a bare token would pass there; a real gateway would not.) */
    const who = bearerActor(req.headers.authorization);
    const profile = who ? tables.profiles.find((p) => p.id === who.id) : undefined;
    if (!profile || profile.active !== true) return denied(403, "42501", "active account required");
    if (profile.pending !== false) return denied(403, "42501", "approval required");
    if (typeof args.p_store !== "string" || !STORE_RE.test(args.p_store) || typeof args.p_month !== "string" || !MONTH_RE.test(args.p_month)) return denied(400, "22023", "store and month required");
    const view = Object.hasOwn(args, "p_view") ? args.p_view : "own";   // only an OMITTED parameter takes the default
    if (view !== "own" && view !== "manager") return denied(400, "22023", "invalid view");
    const link = tables.floor_people.find((r) => r.user_id === profile.id && r.store === args.p_store);
    if (!link) return denied(403, "42501", "not linked to this store");
    return json(200, { state: "unpublished", store: args.p_store, month: args.p_month, subject: link.person_id });
  };

  const supabase = (req, u) => {
    const p = u.pathname;
    if (req.method === "OPTIONS") return empty(204);
    /* The probe the harness uses to see whether a backend is up. Answering it is
       readiness only: it says nothing about any shape below. */
    if (p === "/rest/v1/" && req.method === "GET") return json(200, {});
    if (p === "/realtime/v1/websocket" && req.method === "GET" && String(req.headers.upgrade || "").toLowerCase() === "websocket") {
      /* The client opens a socket and falls back to its poll when it cannot. This is the one request
         that is answered "not available" on purpose: exact method, exact path, an upgrade header.
         No 101, no protocol, and anything else under /realtime/ is still a counted refusal. */
      expected["realtime-handshake-unavailable"] = Math.min(expected["realtime-handshake-unavailable"] + 1, MAX_N);
      return json(503, { message: "realtime is not available in this fixture" });
    }
    if (p === "/auth/v1/token" && req.method === "POST" && ["password", "refresh_token"].includes(u.searchParams.get("grant_type"))) {
      /* Who signs in is chosen by the fictional credential the client sends: the email of a
         password grant, or the refresh token of a refresh grant. Anything else is the associate, as
         before. An actor with no profile in this seed gets no session. */
      const b = parse(req.body);
      const pick = u.searchParams.get("grant_type") === "password"
        ? ACTORS.find((a) => b && typeof b === "object" && typeof b.email === "string" && b.email.toLowerCase() === a.email)
        : ACTORS.find((a) => b && typeof b === "object" && b.refresh_token === a.refresh);
      const actor = pick || ACTORS[0];
      if (!tables.profiles.some((x) => x.id === actor.id)) return { ...json(400, { error: "invalid_grant", error_description: "Invalid login credentials" }), bad: true };
      return json(200, session(actor));
    }
    if (p === "/auth/v1/user" && req.method === "GET") {
      const actor = bearerActor(req.headers.authorization) || ACTORS[0];
      return json(200, session(actor).user);
    }
    if (p === "/auth/v1/logout" && req.method === "POST") return empty(204);
    const rpc = p.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpc && req.method === "POST") {
      const args = parse(req.body);
      if (rpc[1] === "sage_config_read") {
        if (mode === "legacy") return json(200, []);
        const row = tables.app_data.find((r) => r.key === "lpc:config:v2");
        return json(200, { value: row ? row.value : null });
      }
      if (rpc[1] === "sage_schedule_read") return scheduleRead(req, args);
      if (rpc[1] === "sage_store_read") {
        if (args === undefined || !args || typeof args.p_store !== "string" || !STORE_ID.test(args.p_store)) return { ...json(400, { code: "22023", message: "store required", details: "", hint: "" }), bad: true };
        if (mode === "legacy") return json(200, []);
        const row = tables.app_data.find((r) => r.key === `lpc:store:${args.p_store}:v2`);
        return json(200, row ? { value: row.value, updated_at: row.updated_at || null, activity: {} } : null);
      }
      return refuse();
    }
    const m = p.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m || !Object.hasOwn(tables, m[1])) return refuse();
    const table = tables[m[1]];
    if (req.method === "GET") {
      const rows = matchRows(table, [...u.searchParams.entries()]);
      if (!rows) return refuse();
      if ((req.headers.accept || "").includes("pgrst.object")) return rows.length === 1 ? json(200, rows[0]) : json(406, { code: "PGRST116", message: "not one row", details: "", hint: "" });
      return json(200, rows);
    }
    if (req.method === "POST") {
      /* The writes the shots harness makes to seed a day, and no others. */
      const body = req.body.length > MAX_BODY ? undefined : parse(req.body);
      const rows = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : null;
      const idOf = (r) => (m[1] === "app_data" ? r.key : r.id);
      const allowed = (r) => r && typeof r === "object" && typeof idOf(r) === "string"
        && ((m[1] === "floor_public" && FLOOR_ID.test(idOf(r))) || (m[1] === "queue_public" && QUEUE_ID.test(idOf(r))) || (m[1] === "app_data" && idOf(r) === "lpc:config:v2"));
      if (!rows || !rows.length || rows.length > MAX_ROWS || !rows.every(allowed)) return refuse();
      const idKey = m[1] === "app_data" ? "key" : "id";
      const upsert = /merge-duplicates/.test(String(req.headers.prefer || ""));
      if (!upsert && rows.some((r) => table.some((x) => x[idKey] === r[idKey]))) return { ...json(409, { code: "23505", message: "duplicate key value violates unique constraint", details: "", hint: "" }) };
      if (normalizeSeedIdentity && (m[1] === "floor_public" || m[1] === "queue_public") && !rows.every((r) => identityHolds(m[1], r))) return refuse();
      const stamped = rows.map((r) => ({ ...r, updated_at: stampNow() }));
      for (const r of stamped) { const at = table.findIndex((x) => x[idKey] === r[idKey]); if (at >= 0) table[at] = { ...table[at], ...r }; else table.push(r); }
      return json(201, stamped);
    }
    return refuse();
  };

  /* The real endpoint answers { row, stamp } or { same: true, stamp }, and the
     stamp names who is asking and which version they saw. Shape and stamp are
     reproduced; the projection to the signed-in person is not. */
  const floorRow = (req) => {
    if (apiOff) return refuse();
    const who = bearerActor(req.headers.authorization);
    if (!who) return { ...json(401, { error: "You are not signed in." }), bad: true };
    const b = req.body.length > MAX_BODY ? undefined : parse(req.body);
    const KEYS = ["op", "store", "date", "room", "view", "stamp"];
    if (!b || typeof b !== "object" || Array.isArray(b) || !Object.keys(b).every((k) => KEYS.includes(k))) return refuse();
    if (b.op !== "read" || b.store !== DEMO_STORE_ID || !["floor", "line", "online"].includes(b.room) || typeof b.date !== "string" || !DATE.test(b.date)) return refuse();
    if (b.view !== undefined && b.view !== "own" && b.view !== "manager") return { ...json(400, { error: "Unknown room view" }), bad: true };
    if (b.stamp !== undefined && b.stamp !== null && (typeof b.stamp !== "string" || b.stamp.length > 200)) return refuse();
    const profile = tables.profiles.find((p) => p.id === who.id);
    const linked = tables.floor_people.filter((r) => r.user_id === who.id).map((r) => r.store);
    if (room) {   // staffMayUse: an inactive account is out; otherwise an assigned store or a link to it
      const may = profile && profile.active === true && (profile.role === "admin" || (!profile.pending && Array.isArray(profile.stores) && profile.stores.includes(b.store)) || linked.includes(b.store));
      if (!may) return { ...json(403, { error: "not one of your stores" }), bad: true };
    }
    /* mayManageAccounts: active, approved, and an admin or a manager assigned to this store. */
    const manages = !!profile && profile.active === true && profile.pending === false
      && (profile.role === "admin" || (profile.role === "manager" && Array.isArray(profile.stores) && profile.stores.includes(b.store)));
    if (b.view === "manager" && !manages) return { ...json(403, { error: "Approved store management required" }), bad: true };
    const table = b.room === "floor" ? tables.floor_public : tables.queue_public;
    const id = b.room === "online" ? `${b.store}:${b.date}:online` : `${b.store}:${b.date}`;
    const row = table.find((r) => r.id === id);
    if (!row) return json(200, { row: null, stamp: null });
    const link = tables.floor_people.find((r) => r.user_id === who.id && r.store === b.store);
    const scope = b.view === "manager" ? "manager" : "own";
    const stamp = `${scope}:${who.id}:${link ? link.person_id : "none"}:${row.updated_at || "none"}`;
    if (b.stamp === stamp) return json(200, { same: true, stamp });
    /* A manager sees the row as it is; a salesperson sees it projected to themselves. */
    if (scope === "manager") return json(200, { row: row.data, stamp });
    return json(200, { row: room ? room.roomProjection(row.data, link ? link.person_id : null) : row.data, stamp });
  };


  /* /api/room-command, in the order the real handler decides things: shape, bearer, account,
     link, then (here) the fixture's own scope, the receipt, today, setup, the row, the
     reducer, the commit. Only floor-room status, assist and cancel-assist are answered;
     everything else is a 501 that counts, never a quiet success. The reducer and the
     projection are the real ones, run on a copy of the row; the commit writes the same
     seeded row every other reader sees. In-memory and one request at a time, which is
     ordering and no lost update here, not a proof of the database's compare-and-set. */
  const roomCommand = (req) => {
    const bad = (status, error) => ({ ...json(status, { error }), bad: true });
    if (apiOff) return refuse();
    if (req.method !== "POST") return refuse();
    let b;
    try { b = JSON.parse(req.body || "null"); } catch (e) { return bad(400, "Bad JSON"); }
    const { store, room: rm, date, action, input = {}, operationId } = b || {};
    const addr = typeof store === "string" && STORE_RE.test(store) && typeof date === "string" && DATE.test(date) && ["floor", "line", "online"].includes(rm)
      ? { table: rm === "floor" ? "floor_public" : "queue_public", id: rm === "floor" ? `${store}:${date}` : rm === "line" ? `${store}:${date}` : `${store}:${date}:online` } : null;
    const real = typeof date === "string" && Number.isFinite(Date.parse(date + "T12:00:00Z")) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
    if (typeof store !== "string" || typeof date !== "string" || !addr || !real || typeof operationId !== "string" || typeof action !== "string" || !UUID.test(operationId) || !input || typeof input !== "object" || Array.isArray(input)) {
      return bad(400, "A supported command, date and operation ID are required");
    }
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer ")) return bad(401, "Sign in first");
    const who = actorByToken(auth.slice(7));
    if (!who) return bad(401, "Sign in again");
    const profile = tables.profiles.find((p) => p.id === who.id);
    if (!(profile && profile.active === true)) return bad(403, "Account inactive");
    const link = tables.floor_people.find((r) => r.store === store && r.user_id === who.id);
    if (!link) return bad(403, "Not linked to this store");
    const personId = link.person_id;
    if (rm !== "floor" || !ROOM_ACTIONS.includes(action)) return refuse();
    const request = canon({ person: personId, store, room: rm, date, command: { action, input } });
    const key = `${who.id}|${operationId.toLowerCase()}`;
    const seen = receipts.get(key);
    const answer = (result) => json(200, { ...structuredClone(result), row: room.roomProjection(result.row, personId) });
    if (seen) return seen.request === request ? answer(seen.result) : bad(409, "Room receipt unavailable");
    if (date !== seedStoreDay(new Date(clock()))) return bad(400, "New room commands require today’s date");
    const cfg = tables.app_data.find((r) => r.key === "lpc:config:v2");
    if (!cfg || !cfg.value) return bad(500, "Room command unavailable");
    const st = (cfg.value.stores || []).find((s) => s.id === store);
    if (!st) return bad(403, "Store unavailable");
    const allowedTables = Array.isArray(st.floorPlan && st.floorPlan.tables) && st.floorPlan.tables.length ? st.floorPlan.tables.map((t) => t.n)
      : [...Array.from({ length: 14 }, (_, i) => String(i + 1)), "O1", "O2", "O3"];
    const at = tables.floor_public.findIndex((r) => r.id === addr.id && r.store === store && r.fdate === date);
    if (at < 0) return bad(404, "Room unavailable");
    const current = tables.floor_public[at];
    let out;
    try {
      out = room.selfRoomCommand({ room: rm, row: structuredClone(current.data), personId, action, input: structuredClone(input), now: new Date(clock()).toISOString(),
        config: structuredClone(cfg.value), store, figures: null, standards: { minCalls: 16, minVideos: 2, ...st.activityStandards }, allowedTables });
    } catch (e) { return e && e.status === 400 ? bad(400, e.message) : bad(500, "Room command unavailable"); }
    if (!out || !out.row || out.row.store !== store || out.row.date !== date) return bad(500, "Room command refused");
    tables.floor_public[at] = { ...current, data: out.row, updated_at: stampNow() };
    const { presence, ...visible } = out.row;
    const result = { ok: true, row: visible };
    receipts.set(key, { request, result: structuredClone(result) });
    return answer(result);
  };

  /* Only bytes that were pinned, and only while they still are. */
  const serveStatic = (req, u) => {
    let rel;
    try { rel = decodeURIComponent(u.pathname); } catch (e) { return { status: 404, type: "text/plain", body: "", shape: "empty-body", bad: true }; }
    const miss = () => ({ status: 404, type: "text/plain", body: "", shape: "empty-body", bad: true });
    if (rel.includes("\0") || rel.includes("\\") || rel.split("/").some((s) => s === "..")) return miss();
    rel = rel.replace(/^\/+/, "");
    if (rel === "") rel = "index.html";
    const segments = rel.split("/");
    if (segments.some((s) => s.startsWith(".") || secretLike(s))) return miss();
    /* A route with no extension is the app's own page and gets the shell, as a
       static host would; a file with one that is not pinned is a real miss. */
    if (!dist.files.has(rel) && !/\.[A-Za-z0-9]+$/.test(segments[segments.length - 1])) rel = "index.html";
    const ent = dist.files.get(rel);
    if (!ent) return miss();
    try {
      if (fs.lstatSync(ent.abs).isSymbolicLink() || fs.realpathSync(ent.abs) !== ent.abs) throw new Error("moved");
      const buf = fs.readFileSync(ent.abs);
      if (crypto.createHash("sha256").update(buf).digest("hex") !== ent.sha) throw new Error("changed");
      return { status: 200, type: TYPES[path.extname(rel).toLowerCase()] || "application/octet-stream", body: req.method === "HEAD" ? "" : buf, shape: "non-json", length: buf.length };
    } catch (e) { return { status: 500, type: "text/plain", body: "", shape: "empty-body", bad: true }; }
  };

  const app = (req, u) => {
    const p = u.pathname;
    if (p === "/__fixture/report" && req.method === "GET") return json(200, report());
    if (req.method === "POST" && (p === "/api/vitals" || p === "/api/client-error")) return empty(204);   // telemetry, accepted and thrown away
    if (req.method === "POST" && p === "/api/floor-row") return floorRow(req);
    if (p === "/api/room-command") return room ? roomCommand(req) : refuse();   // without the room modules this stays the 501 it was
    if (p.startsWith("/api/")) return refuse();   // open-room included: a failure there must show, not be absorbed by a seed
    if ((req.method === "GET" || req.method === "HEAD") && (p === "/sw.js" || p.startsWith("/_vercel/"))) return { status: 404, type: "text/plain", body: "", shape: "empty-body" };
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, u);
    return refuse();
  };

  /* req: { method, url, headers (lower-case), body (string) }. origin is
     "supabase" or "app". The Host header must name this fixture's own loopback
     port for that origin. */
  const plain = (status) => ({ status, type: "text/plain", body: "", shape: "empty-body", bad: true });
  const wrap = (origin, res) => ({ ...res, headers: { "content-type": res.type, ...(origin === "supabase" ? CORS : {}), ...(res.length !== undefined ? { "content-length": String(res.length) } : {}) } });
  function respond(origin, req) {
    /* This is the one function a listener calls with whatever arrived, so it
       answers anything at all and throws on nothing: an unknown origin, a
       request that is not an object, a URL that is not a path. */
    let res = null, u = null, method = null;
    try {
      const port = origin === "supabase" ? supabasePort : origin === "app" ? appPort : null;
      const ok = req && typeof req === "object" && typeof req.method === "string" && typeof req.url === "string" && req.headers && typeof req.headers === "object" && !Array.isArray(req.headers);
      if (port === null || !ok) res = plain(400);
      else if (req.url.length > MAX_URL || !/^\/(?!\/)[^\s\\]*$/.test(req.url)) res = plain(400);
      else if (req.url.split("?")[0].split("/").some((seg) => DOT_SEGMENT.test(seg))) res = plain(400);
      else {
        u = new URL(req.url, `http://${LOOPBACK}`);
        const body = typeof req.body === "string" ? req.body : "";
        const hostOk = new RegExp(`^(${LOOPBACK.replace(/\./g, "\\.")}|localhost):${port}$`).test(String(req.headers.host || ""));
        if (!hostOk) res = plain(421);
        else if (Buffer.byteLength(body, "utf8") > MAX_BODY) res = plain(413);
        else if (origin === "app" && req.method === "GET" && u.pathname === "/__fixture/expected") return wrap(origin, json(200, expectedDoc()));   // not counted: it is how the counters are read
        else res = origin === "supabase" ? supabase({ method: req.method, headers: req.headers, body }, u) : app({ method: req.method, headers: req.headers, body }, u);
        const r = classifyRoute(req.method, u.pathname);
        method = r ? r.m : null;
        note(method, r ? r.c : "other", res.status, res.shape, res.bad);
        return wrap(origin, res);
      }
    } catch (e) { res = plain(500); }
    note(null, "other", res.status, res.shape, true);
    return wrap(origin === "app" ? "app" : "supabase", res);
  }

  /* ---- the listeners: loopback, and nothing else ---- */
  const servers = [];
  const make = (origin, port) => http.createServer((rq, rs) => {
    const chunks = []; let total = 0, over = false;
    rq.on("data", (c) => { total += c.length; if (total > MAX_BODY) { over = true; } else chunks.push(c); });
    rq.on("end", () => {
      /* respond cannot throw; the guard is for the write, which can, on a socket that has gone. */
      try {
        const out = respond(origin, { method: rq.method, url: rq.url, headers: rq.headers, body: over ? "x".repeat(MAX_BODY + 1) : Buffer.concat(chunks).toString("utf8") });
        rs.writeHead(out.status, out.headers);
        rs.end(out.body === "" ? undefined : out.body);
      } catch (e) { try { rs.destroy(); } catch (e2) {} }
    });
  }).listen(port, LOOPBACK);
  return {
    respond, report, dist: dist.summary, seedBinding, actorManifest, expected: expectedDoc,
    listen() { servers.push(make("supabase", supabasePort), make("app", appPort)); return Promise.all(servers.map((s) => new Promise((ok, no) => { s.once("listening", ok); s.once("error", no); }))); },
    close() { return Promise.all(servers.map((s) => new Promise((ok) => { s.close(() => ok()); s.closeAllConnections && s.closeAllConnections(); }))); },
  };
}

/* node scripts/shots-fixture.mjs, with SHOTS_FIXTURE_MODE and SHOTS_DIST set. Optional:
   SHOTS_FIXTURE_API=on|off (room API; SHOTS_ROOM_MODULES_DIR names the verified module folder),
   SHOTS_FIXTURE_NORMALIZE_SEED_IDENTITY=1, SHOTS_FIXTURE_MANAGER_ACTOR=1 (a seed with a second, approved manager), and SHOTS_FIXTURE_SEED_FILE (+ SHOTS_FIXTURE_SEED_SHA256)
   so that an API-off and an API-on process start from the very same seed bytes. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const api = process.env.SHOTS_FIXTURE_API;
  const managerActor = process.env.SHOTS_FIXTURE_MANAGER_ACTOR === "1";
  const room = api === "on" ? await loadRoomModules(process.env.SHOTS_ROOM_MODULES_DIR) : undefined;
  const loaded = process.env.SHOTS_FIXTURE_SEED_FILE ? loadOrCreateSeed(process.env.SHOTS_FIXTURE_SEED_FILE, { sha256: process.env.SHOTS_FIXTURE_SEED_SHA256 || undefined, managerActor: managerActor }) : null;
  const fx = createFixture({ mode: process.env.SHOTS_FIXTURE_MODE, distDir: process.env.SHOTS_DIST || "dist", room, apiOff: api === "off",
    seed: loaded ? loaded.seed : undefined, normalizeSeedIdentity: process.env.SHOTS_FIXTURE_NORMALIZE_SEED_IDENTITY === "1", requireManagerActor: managerActor });
  await fx.listen();
  console.log(JSON.stringify({ fixture: true, pid: process.pid, mode: process.env.SHOTS_FIXTURE_MODE, api: api || "default", normalizeSeedIdentity: fx.seedBinding.identity,
    managerActor, actorManifestSha256: fx.actorManifest.sha256, seedFileSha256: loaded ? loaded.sha256 : null, seedRowsSha256: fx.seedBinding.rowsSha256, dist: fx.dist }));
}
