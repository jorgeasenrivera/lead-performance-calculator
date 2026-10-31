/* The shots fixture, asked questions directly. The handler is a plain function
   from a request to an answer, so none of this opens a socket, starts a server
   or touches a browser; the only files are throwaway ones in a temp folder. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFixture, MANAGER_ID, MANAGER_EMAIL, buildManifest, makeSeed, loadOrCreateSeed, loadRoomModules, scanRoomModule, verifyRoomGraph, RoomModulesError } from "../scripts/shots-fixture.mjs";
import { storeDay } from "../scripts/demo-seed.mjs";
import { validateFixtureReport } from "../scripts/shots-evidence.mjs";

const SUPA = "127.0.0.1:5433", APP = "127.0.0.1:5178";
const DAY = "2031-02-03";   // far from any day the seed holds rows for
const dirs = [];
function dist(files = { "index.html": "<!doctype html><title>shell</title>", "assets/app-abc.js": "console.log(1)", "favicon.svg": "<svg/>" }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "shots-fixture-"));
  dirs.push(d);
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); }
  return d;
}
// The directories this file creates are unique (mkdtemp) and are KEPT: nothing is deleted here.

const make = (mode = "compatible", d = dist()) => createFixture({ mode, distDir: d });
function ask(fx, origin, method, url, { body = "", headers = {}, host } = {}) {
  const out = fx.respond(origin, { method, url, headers: { host: host || (origin === "supabase" ? SUPA : APP), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const text = Buffer.isBuffer(out.body) ? out.body.toString("utf8") : String(out.body);
  return { ...out, text, json: () => JSON.parse(text) };
}
const supa = (fx, method, url, o) => ask(fx, "supabase", method, url, o);
const app = (fx, method, url, o) => ask(fx, "app", method, url, o);
const AUTH = { authorization: "Bearer mock-token" };

test("the pin is the bytes of every file, not their names", () => {
  const a = buildManifest(dist({ "index.html": "one", "x.js": "alpha" }));
  const same = buildManifest(dist({ "x.js": "alpha", "index.html": "one" }));
  const edited = buildManifest(dist({ "index.html": "one", "x.js": "alphb" }));
  const renamed = buildManifest(dist({ "index.html": "one", "y.js": "alpha" }));
  assert.equal(a.summary.sha256, same.summary.sha256, "creation order does not matter");
  assert.notEqual(a.summary.sha256, edited.summary.sha256, "same names, one changed byte");
  assert.notEqual(a.summary.sha256, renamed.summary.sha256, "same bytes, a changed name");
  assert.equal(a.summary.files, 2);
  assert.equal(a.summary.bytes, 8);
  assert.match(a.summary.sha256, /^[0-9a-f]{64}$/);
});

test("a dist that cannot be pinned cleanly is not pinned", () => {
  assert.throws(() => buildManifest(dist({ "x.js": "no shell" })), /index\.html/);
  assert.throws(() => buildManifest(dist({ "index.html": "a", ".env": "S=1" })), /cannot be pinned/);
  assert.throws(() => buildManifest(dist({ "index.html": "a", "server.pem": "-----" })), /cannot be pinned/);
  assert.throws(() => buildManifest(dist({ "index.html": "a", "client_secret.json": "{}" })), /cannot be pinned/);
  const d = dist({ "index.html": "a" });
  fs.symlinkSync("/etc/hostname", path.join(d, "link.txt"));
  assert.throws(() => buildManifest(d), /symbolic link/);
  assert.throws(() => createFixture({ mode: "other", distDir: dist() }), /legacy or compatible/);
});

test("the static server hands out pinned bytes and the shell for the app's own routes", () => {
  const fx = make();
  const home = app(fx, "GET", "/");
  assert.equal(home.status, 200); assert.match(home.text, /shell/); assert.equal(home.headers["content-type"], "text/html");
  assert.equal(app(fx, "GET", "/rooms/floor").text, home.text, "a route with no extension is the app, as a static host would serve it");
  const js = app(fx, "GET", "/assets/app-abc.js");
  assert.equal(js.status, 200); assert.equal(js.text, "console.log(1)"); assert.equal(js.headers["content-type"], "text/javascript");
  assert.equal(app(fx, "HEAD", "/assets/app-abc.js").text, "");
  assert.equal(fx.report().unexpected, 0);
});

test("traversal, dotfiles, secrets and unpinned files are refused and counted", () => {
  const d = dist({ "index.html": "a", "assets/a.js": "b" });
  const fx = make("compatible", d);
  fs.writeFileSync(path.join(d, "assets", "added-later.js"), "c");
  const bad = ["/../x.js", "/%2e%2e/x.js", "/assets/..%2f..%2fx.js", "/assets/%2e%2e/%2e%2e/x.js", "/a\\b.js", "/a%5Cb.js", "/%00.js", "/%ZZ", "/.env", "/assets/.hidden.js",
    "/server.pem", "/assets/added-later.js", "/assets/none.js"];
  /* A raw backslash is not a path character, so the request-target check refuses it (400) before the static server sees it; every other one is the static server's 404. */
  const dotSegment = (u) => u.split("?")[0].split("/").some((seg) => /^(?:\.|%2e){1,2}$/i.test(seg));
  for (const u of bad) assert.equal(app(fx, "GET", u).status, u.includes("\\") || dotSegment(u) ? 400 : 404, u);
  assert.equal(fx.report().unexpected, bad.length, "every one of them counted against the run");
});

test("a pinned file that changes or becomes a link after the pin is refused", () => {
  const d = dist({ "index.html": "a", "assets/a.js": "b", "assets/c.js": "c" });
  const fx = make("compatible", d);
  fs.writeFileSync(path.join(d, "assets", "a.js"), "changed");
  assert.equal(app(fx, "GET", "/assets/a.js").status, 500);
  /* SIMULATED filesystem transition: c.js stays the real, pinned regular file on disk (nothing is removed, renamed or linked); only lstat's answer
     for that one path is faked to "symbolic link", for the one request, and restored in finally. The refusal under test is the runtime post-pin
     symlink check, not a missing file, and the original bytes are still there afterwards. */
  const c = path.join(fs.realpathSync(d), "assets", "c.js"), realLstat = fs.lstatSync, before = fs.readFileSync(c, "utf8");
  fs.lstatSync = (f, ...rest) => { const st = realLstat(f, ...rest); return path.resolve(String(f)) === c ? Object.assign(Object.create(st), { isSymbolicLink: () => true }) : st; };
  try { assert.equal(app(fx, "GET", "/assets/c.js").status, 500, "a pinned file that now reads as a symbolic link is refused"); }
  finally { fs.lstatSync = realLstat; }
  assert.equal(fs.lstatSync(c).isSymbolicLink(), false, "the stand-in is gone");
  assert.equal(fs.readFileSync(c, "utf8"), before, "the original bytes are retained");
  assert.equal(before, "c");
  assert.equal(fx.report().unexpected, 2);
});

test("only the fixture's own loopback hosts are answered", () => {
  const fx = make();
  assert.equal(app(fx, "GET", "/", { host: "evil.example:5178" }).status, 421);
  assert.equal(app(fx, "GET", "/", { host: "127.0.0.1:5433" }).status, 421, "the other origin's port is not this origin");
  assert.equal(supa(fx, "GET", "/rest/v1/", { host: "localhost:5433" }).status, 200);
  assert.equal(app(fx, "GET", "/", { host: undefined, headers: {} }).status, 200, "the helper supplies the default host");
  assert.equal(fx.report().unexpected, 2);
});

test("legacy answers the two reads as the ordinary mock does, compatible as the app is written for", () => {
  const legacy = make("legacy"), compat = make("compatible");
  const cfgL = supa(legacy, "POST", "/rest/v1/rpc/sage_config_read", { body: "{}" });
  assert.equal(cfgL.status, 200); assert.equal(cfgL.text, "[]"); assert.equal(cfgL.shape, "array-empty");
  const cfgC = supa(compat, "POST", "/rest/v1/rpc/sage_config_read", { body: "{}" });
  assert.equal(cfgC.status, 200); assert.equal(cfgC.shape, "object-value-present");
  assert.ok(Array.isArray(cfgC.json().value.stores) && cfgC.json().value.stores.length === 1);
  const body = { p_store: "sage-demo" };
  const stL = supa(legacy, "POST", "/rest/v1/rpc/sage_store_read", { body });
  assert.equal(stL.text, "[]");
  const stC = supa(compat, "POST", "/rest/v1/rpc/sage_store_read", { body });
  assert.equal(stC.status, 200);
  assert.ok(["object-value-present", "null"].includes(stC.shape));
  if (stC.shape === "object-value-present") assert.deepEqual(Object.keys(stC.json()).sort(), ["activity", "updated_at", "value"]);
  const none = supa(compat, "POST", "/rest/v1/rpc/sage_store_read", { body: { p_store: "no-such-store" } });
  assert.equal(none.text, "null"); assert.equal(none.shape, "null");
  for (const fx of [legacy, compat]) {
    assert.equal(supa(fx, "POST", "/rest/v1/rpc/sage_store_read", { body: { p_store: "bad store!" } }).status, 400);
    assert.equal(supa(fx, "POST", "/rest/v1/rpc/sage_store_read", { body: "not json" }).status, 400);
  }
});

test("the two modes differ in those two answers and nowhere else", () => {
  const legacy = make("legacy"), compat = make("compatible");
  const same = [
    ["app", "GET", "/"], ["app", "GET", "/assets/app-abc.js"], ["app", "GET", "/missing.js"], ["app", "POST", "/api/vitals"], ["app", "POST", "/api/open-room"],
    ["app", "POST", "/api/other"], ["app", "GET", "/sw.js"], ["supabase", "GET", "/rest/v1/"], ["supabase", "GET", "/rest/v1/profiles?select=*"],
    ["supabase", "GET", "/rest/v1/floor_people?select=*"], ["supabase", "GET", "/rest/v1/nope"], ["supabase", "POST", "/rest/v1/rpc/sage_floor_days"],
    ["supabase", "POST", "/rest/v1/rpc/sage_schedule_read"], ["supabase", "GET", "/rest/v1/app_data?key=gte.a"], ["supabase", "OPTIONS", "/rest/v1/profiles"],
  ];
  for (const [o, m, u] of same) {
    const a = ask(legacy, o, m, u), b = ask(compat, o, m, u);
    assert.equal(a.status, b.status, `${m} ${u}`); assert.equal(a.shape, b.shape, `${m} ${u}`); assert.equal(a.headers["content-type"], b.headers["content-type"]);
    /* The seed's ids are random per fixture (buildDemo), so a 200 from the data origin differs by construction; everything else is compared whole. */
    if (!(o === "supabase" && a.status === 200)) assert.equal(a.text, b.text, `${m} ${u}`);
  }
  assert.equal(legacy.report().unexpected, compat.report().unexpected);
  assert.deepEqual(legacy.dist, compat.dist, "the same files, so the same pin");
});

test("two fixtures over the same dist report the same pinned hash", () => {
  const d = dist();
  assert.deepEqual(make("legacy", d).dist, make("compatible", d).dist);
});

test("floor-row answers from the seeded rows, so a status change shows up with a new stamp", () => {
  const fx = make();
  const call = (b, headers = AUTH) => app(fx, "POST", "/api/floor-row", { body: b, headers });
  const read = (extra = {}) => call({ op: "read", store: "sage-demo", date: DAY, room: "floor", view: "own", ...extra });
  assert.equal(call({ op: "read", store: "sage-demo", date: DAY, room: "floor" }, {}).status, 401, "no session, no row");
  assert.equal(read().json().row, null);
  assert.equal(read().json().stamp, null);
  const put = (data) => supa(fx, "POST", "/rest/v1/floor_public", { body: { id: `sage-demo:${DAY}`, store: "sage-demo", fdate: DAY, data }, headers: { prefer: "resolution=merge-duplicates" } });
  assert.equal(put({ line: [{ id: "a", status: "waiting" }] }).status, 201);
  const first = read();
  assert.deepEqual(first.json().row, { line: [{ id: "a", status: "waiting" }] });
  const stamp = first.json().stamp;
  assert.match(stamp, /^own:00000000-0000-4000-8000-000000000001:.+:\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(read({ stamp }).json(), { same: true, stamp }, "the stamp it was shown comes back as same");
  assert.equal(put({ line: [{ id: "a", status: "customer" }] }).status, 201);
  const second = read({ stamp });
  assert.equal(second.json().same, undefined, "an old stamp is not the current one");
  assert.deepEqual(second.json().row, { line: [{ id: "a", status: "customer" }] });
  assert.notEqual(second.json().stamp, stamp);
  assert.equal(supa(fx, "POST", "/rest/v1/queue_public", { body: { id: `sage-demo:${DAY}:online`, store: "sage-demo", qdate: DAY, data: { q: 1 } }, headers: { prefer: "resolution=merge-duplicates" } }).status, 201);
  assert.deepEqual(call({ op: "read", store: "sage-demo", date: DAY, room: "online" }).json().row, { q: 1 });
  assert.equal(call({ op: "read", store: "sage-demo", date: DAY, room: "line" }).json().row, null, "line and online are different rows");
});

test("floor-row refuses anything outside its exact contract", () => {
  const fx = make();
  const call = (b, headers = AUTH) => app(fx, "POST", "/api/floor-row", { body: b, headers });
  const ok = { op: "read", store: "sage-demo", date: DAY, room: "floor" };
  let expected = 0;
  for (const bad of [{ ...ok, op: "wallkey" }, { ...ok, store: "other-store" }, { ...ok, room: "garage" }, { ...ok, date: "tomorrow" }, { ...ok, view: "own", extra: 1 },
    { ...ok, extra: 1 }, { ...ok, stamp: 5 }, { ...ok, stamp: "x".repeat(201) }, [ok], "not json", null]) {
    assert.equal(call(bad).status, 501, JSON.stringify(bad)); expected++;
  }
  assert.equal(call(ok, { authorization: "Bearer wrong" }).status, 401); expected++;
  assert.equal(call(ok, {}).status, 401); expected++;
  assert.equal(app(fx, "POST", "/api/floor-row", { body: "x".repeat(262145), headers: AUTH }).status, 413); expected++;
  assert.equal(app(fx, "GET", "/api/floor-row").status, 501); expected++;
  assert.equal(fx.report().unexpected, expected);
  assert.equal(call(ok).status, 200);
  assert.equal(call({ ...ok, stamp: null, view: "own" }).status, 200);
});

test("table writes are only the seeding the harness does, and nothing else changes anything", () => {
  const fx = make();
  const post = (table, body, prefer = "resolution=merge-duplicates") => supa(fx, "POST", `/rest/v1/${table}`, { body, headers: { prefer } });
  let expected = 0;
  assert.equal(post("floor_public", { id: `sage-demo:${DAY}`, data: { a: 1 } }).status, 201);
  assert.equal(post("queue_public", [{ id: `sage-demo:${DAY}`, data: {} }, { id: `sage-demo:${DAY}:online`, data: {} }]).status, 201);
  assert.equal(post("app_data", { key: "lpc:config:v2", value: { stores: [] } }).status, 201);
  for (const [table, body] of [["floor_public", { id: `other:${DAY}`, data: {} }], ["floor_public", { id: "sage-demo:2026-10-27:extra", data: {} }], ["queue_public", { id: `sage-demo:${DAY}:lunch`, data: {} }],
    ["app_data", { key: "lpc:store:sage-demo:v2", value: {} }], ["profiles", { id: "x", role: "admin" }], ["floor_people", { user_id: "x" }], ["deal_events", { id: "x" }],
    ["floor_public", Array.from({ length: 9 }, () => ({ id: `sage-demo:${DAY}`, data: {} }))], ["floor_public", []], ["floor_public", "not json"], ["floor_public", { data: {} }]]) {
    assert.equal(post(table, body).status, 501, `${table} ${JSON.stringify(body).slice(0, 40)}`); expected++;
  }
  assert.equal(supa(fx, "PATCH", "/rest/v1/profiles?id=eq.1", { body: { role: "admin" } }).status, 501); expected++;
  assert.equal(supa(fx, "DELETE", "/rest/v1/profiles?id=eq.1").status, 501); expected++;
  assert.equal(post("floor_public", { id: `sage-demo:${DAY}`, data: {} }, "return=representation").status, 409, "a plain insert of an existing row is refused as the database refuses it");
  assert.equal(supa(fx, "POST", "/rest/v1/floor_public", { body: "x".repeat(262145) }).status, 413); expected++;
  const profiles = supa(fx, "GET", "/rest/v1/profiles?select=*").json();
  assert.equal(profiles.length, 1); assert.equal(profiles[0].role, "associate", "the account was not elevated");   // a seed without the manager actor holds one person
  assert.equal(fx.report().unexpected, expected);
});

test("what is not written down is a 501 and counts against the run", () => {
  const fx = make();
  const refused = [
    supa(fx, "POST", "/rest/v1/rpc/sage_floor_days", { body: {} }), supa(fx, "POST", "/rest/v1/rpc/sage_config_save", { body: {} }), supa(fx, "POST", "/rest/v1/rpc/not_a_function", { body: {} }),
    supa(fx, "GET", "/rest/v1/not_a_table"), supa(fx, "GET", "/rest/v1/app_data?updated_at=gte.2026"), supa(fx, "GET", "/rest/v1/app_data?Bad-Column=eq.1"), supa(fx, "POST", "/auth/v1/signup"),
    supa(fx, "POST", "/auth/v1/token?grant_type=magiclink"), supa(fx, "GET", "/somewhere/else"),
    app(fx, "POST", "/api/open-room", { body: { store: "sage-demo", room: "floor" } }), app(fx, "POST", "/api/room-command", { body: {} }), app(fx, "POST", "/api/unknown"), app(fx, "PUT", "/"),
  ];
  for (const r of refused) assert.ok(r.status === 501, String(r.status));
  assert.equal(fx.report().unexpected, refused.length);
  const before = fx.report().unexpected;
  assert.equal(app(fx, "POST", "/api/vitals", { body: {} }).status, 204);
  assert.equal(app(fx, "POST", "/api/client-error", { body: {} }).status, 204);
  assert.equal(app(fx, "GET", "/sw.js").status, 404);
  assert.equal(app(fx, "GET", "/_vercel/speed-insights/script.js").status, 404);
  assert.equal(supa(fx, "OPTIONS", "/rest/v1/rpc/sage_config_read").status, 204);
  assert.equal(supa(fx, "GET", "/rest/v1/").status, 200, "readiness answers without vouching for any shape");
  assert.equal(supa(fx, "POST", "/auth/v1/token?grant_type=password").status, 200);
  assert.equal(supa(fx, "GET", "/auth/v1/user").json().email, "demo@sageonline.app");
  assert.equal(fx.report().unexpected, before, "telemetry, the shell's own misses and readiness are not unexpected");
});

test("the supabase origin carries CORS and the app origin does not need it", () => {
  const fx = make();
  assert.equal(supa(fx, "OPTIONS", "/rest/v1/profiles").headers["access-control-allow-origin"], "*");
  assert.match(supa(fx, "OPTIONS", "/rest/v1/profiles").headers["access-control-allow-headers"], /authorization/);
  assert.equal(app(fx, "GET", "/").headers["access-control-allow-origin"], undefined);
});

test("the report is enums and counts, with no path, token, address or body in it", () => {
  const fx = make();
  supa(fx, "POST", "/rest/v1/rpc/sage_config_read", { body: "{}" });
  app(fx, "POST", "/api/floor-row", { body: { op: "read", store: "sage-demo", date: DAY, room: "floor" }, headers: AUTH });
  app(fx, "POST", "/api/open-room", { body: { secret: "do-not-export" } });
  app(fx, "GET", "/assets/app-abc.js");
  const r = fx.report();
  assert.ok(validateFixtureReport(r));
  assert.ok(r.requests.some((e) => e.c === "rpc:sage_config_read" && e.s === 200 && e.n === 1));
  assert.ok(r.shapes.some((e) => e.c === "rpc:sage_config_read" && e.h["object-value-present"] === 1));
  assert.deepEqual(r.unexpectedByClass, [{ c: "api:open-room", n: 1 }]);
  const text = JSON.stringify(r);
  for (const leak of ["mock-token", "Bearer", "demo@sageonline", "do-not-export", "/", "sage-demo", "app-abc", "Dev Okonjo"]) assert.ok(!text.includes(leak), leak);
  const served = app(fx, "GET", "/__fixture/report");
  assert.equal(served.status, 200); assert.ok(validateFixtureReport(served.json()));
});

test("the fixture binds to loopback, imports nothing real and takes nothing from the environment but its own two settings", () => {
  const src = fs.readFileSync(new URL("../scripts/shots-fixture.mjs", import.meta.url), "utf8");
  assert.ok(/const LOOPBACK = "127\.0\.0\.1"/.test(src));
  assert.equal((src.match(/createServer\(/g) || []).length, 1, "one place opens a socket");
  assert.ok(/\.listen\(port, LOOPBACK\)/.test(src));
  assert.ok(!/0\.0\.0\.0|"::"/.test(src), "no wildcard address");
  const checked = src.replace(/const ROOM_FORBIDDEN = \[[\s\S]*?\];\n/, "");   // the list of refused shapes is not a use of them
  assert.ok(!/from "\.\.\/(api|src)|from "\.\/(?!demo-seed|shots-evidence)|require\(/.test(checked), "no static import from the real API or the app");
  assert.ok(!/fetch\(|http\.request|https|child_process|net\./.test(checked), "it makes no outbound call");
  /* The one exception to "imports nothing from api/": two dynamic imports inside loadRoomModules,
     of files that were hashed against their pins and graph-checked first. */
  assert.equal((src.match(/\bimport\(/g) || []).length, 2, "two dynamic imports, both in the loader");
  const loader = src.slice(src.indexOf("export async function loadRoomModules"), src.indexOf("const UUID"));
  assert.equal((loader.match(/\bimport\(/g) || []).length, 2);
  assert.ok(loader.indexOf("verifyRoomGraph(texts)") > 0 && loader.indexOf("verifyRoomGraph(texts)") < loader.indexOf("await import("), "graph and hashes are checked before the first import");
  assert.ok(!/(?<![\w-])room-command\.mjs|(?<![\w-])floor-row\.mjs|_env\.mjs|_floor-access\.mjs|supabase-js/.test(checked), "no handler, no environment module, no database client is named (the pinned _self-room-command is not the handler)");
  const env = [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(env)].sort(), ["SHOTS_DIST", "SHOTS_FIXTURE_API", "SHOTS_FIXTURE_MANAGER_ACTOR", "SHOTS_FIXTURE_MODE", "SHOTS_FIXTURE_NORMALIZE_SEED_IDENTITY", "SHOTS_FIXTURE_SEED_FILE", "SHOTS_FIXTURE_SEED_SHA256", "SHOTS_ROOM_MODULES_DIR"]);
  assert.ok(!/SERVICE_ROLE|SUPABASE_URL|WALL_KEY|process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/.test(src));
});

test("respond answers anything at all and throws on nothing", () => {
  const fx = make();
  const good = { method: "GET", url: "/", headers: { host: APP }, body: "" };
  const cases = [
    ["evil", good], ["", good], [undefined, good], [null, good], ["APP", good], ["app", null], ["app", undefined], ["app", "GET /"], ["app", 7], ["app", []],
    ["app", { ...good, url: "http://[bad" }], ["app", { ...good, url: "http://evil.example/" }], ["app", { ...good, url: "//evil.example/x" }], ["app", { ...good, url: "relative" }],
    ["app", { ...good, url: "" }], ["app", { ...good, url: "/" + "a".repeat(3000) }], ["app", { ...good, url: "/a b" }], ["app", { ...good, url: "/a\\b" }], ["app", { ...good, url: "/a\nb" }],
    ["app", { ...good, url: undefined }], ["app", { ...good, url: 5 }], ["app", { ...good, method: undefined }], ["app", { ...good, method: 5 }], ["app", { ...good, headers: undefined }],
    ["app", { ...good, headers: null }], ["app", { ...good, headers: [] }], ["app", { ...good, headers: "host: x" }], ["app", { ...good, body: 5 }],
    ["supabase", { ...good, method: "TRACE", headers: { host: SUPA } }], ["supabase", { ...good, method: "get", url: "/rest/v1/", headers: { host: SUPA } }],
  ];
  for (const [origin, req] of cases) {
    let out;
    assert.doesNotThrow(() => { out = fx.respond(origin, req); }, JSON.stringify(req) + " at " + origin);
    assert.ok(Number.isInteger(out.status) && out.status >= 200 && out.status <= 599 && out.headers && typeof out.headers["content-type"] === "string");
  }
  assert.equal(fx.respond("evil", good).status, 400);
  assert.equal(fx.respond("app", { ...good, url: "http://[bad" }).status, 400);
  assert.equal(fx.respond("app", { ...good, url: "//evil.example/x" }).status, 400, "an absolute-form or scheme-relative target is not a path");
  assert.equal(fx.respond("app", { ...good, url: "/" + "a".repeat(3000) }).status, 400);
  assert.equal(fx.respond("app", { ...good, method: 5 }).status, 400);
  assert.equal(fx.respond("app", { ...good, headers: [] }).status, 400);
  assert.equal(fx.respond("supabase", { ...good, method: "TRACE", headers: { host: SUPA } }).status, 501);
  const r = fx.report();
  assert.ok(validateFixtureReport(r), "and what it counted is still a valid report");
  assert.ok(r.unexpected >= cases.length - 2, "all of that counts against a run");
  assert.ok(r.dropped > 0, "a method outside the allowlist is counted as dropped");
});

test("ports are validated when the fixture is made", () => {
  const d = dist();
  for (const bad of [0, -1, 65536, 1.5, "5433", null, NaN]) assert.throws(() => createFixture({ mode: "legacy", distDir: d, supabasePort: bad }), /loopback ports/, String(bad));
  assert.throws(() => createFixture({ mode: "legacy", distDir: d, supabasePort: 6000, appPort: 6000 }), /different/);
  assert.throws(() => createFixture({ mode: "legacy", distDir: d, now: "yesterday" }), /milliseconds/);
  assert.throws(() => createFixture({ mode: "legacy", distDir: d, now: NaN }), /milliseconds/);
  assert.doesNotThrow(() => createFixture({ mode: "legacy", distDir: d, supabasePort: 6001, appPort: 6002 }));
  const odd = createFixture({ mode: "legacy", distDir: d, supabasePort: 6001, appPort: 6002 });
  assert.equal(odd.respond("app", { method: "GET", url: "/", headers: { host: "127.0.0.1:6002" }, body: "" }).status, 200);
  assert.equal(odd.respond("app", { method: "GET", url: "/", headers: { host: APP }, body: "" }).status, 421, "the default port is not this fixture's");
});

test("the request aggregate keeps the method, so a GET and a POST to one class are two entries", () => {
  const fx = make();
  supa(fx, "GET", "/rest/v1/profiles?select=*"); supa(fx, "GET", "/rest/v1/profiles?select=*"); supa(fx, "POST", "/rest/v1/profiles", { body: "{}" }); supa(fx, "OPTIONS", "/rest/v1/profiles");
  const got = fx.report().requests.filter((e) => e.c === "rest:profiles");
  assert.deepEqual(got.sort((a, b) => a.m.localeCompare(b.m)), [
    { m: "GET", c: "rest:profiles", s: 200, n: 2 }, { m: "OPTIONS", c: "rest:profiles", s: 204, n: 1 }, { m: "POST", c: "rest:profiles", s: 501, n: 1 }]);
});

test("every cap is counted when it is hit: requests, shape classes and unexpected classes", () => {
  const fx = make();
  const methods = ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS", "HEAD"];
  const names = ["sage_audit_append", "sage_audit_read", "sage_config_read", "sage_config_save", "sage_deal_events", "sage_dealer_links", "sage_dealer_map", "sage_dealer_unmap",
    "sage_floor_days", "sage_schedule_publish", "sage_schedule_read", "sage_store_read", "sage_ticket_status", "sage_ticket_submit"];
  const tables = ["app_data", "profiles", "floor_people", "deal_events", "queue_public", "floor_public"];
  const routes = ["client-error", "delete-account", "floor-row", "open-room", "register-device", "room-command", "vitals"];
  for (const m of methods) {
    for (const t of tables) supa(fx, m, `/rest/v1/${t}`, { body: "{}" });
    for (const n of names) supa(fx, m, `/rest/v1/rpc/${n}`, { body: "{}" });
    for (const r of routes) app(fx, m, `/api/${r}`, { body: "{}" });
  }
  const r = fx.report();
  assert.ok(validateFixtureReport(r));
  assert.equal(r.requests.length, 64, "the request table is full");
  assert.ok(r.dropped > 0, "and what did not fit is counted");
  assert.equal(r.shapes.length, 16, "the shape table is full");
  assert.ok(r.droppedShapes > 0, "and the classes that did not fit are counted");
  assert.equal(r.unexpectedByClass.length, 16);
  assert.ok(r.droppedUnexpected > 0, "and so are unexpected classes");
  assert.ok(r.unexpected > r.unexpectedByClass.reduce((a, e) => a + e.n, 0) - 1, "the total still counts every one");
});

test("two fixtures that share a seed and a clock answer the same, and say that they did", () => {
  const d = dist(), NOW = Date.UTC(2031, 1, 3, 12, 0, 0);
  const seed = makeSeed(NOW);
  const a = createFixture({ mode: "legacy", distDir: d, now: NOW, seed }), b = createFixture({ mode: "compatible", distDir: d, now: NOW, seed });
  for (const u of ["/rest/v1/profiles?select=*", "/rest/v1/floor_people?select=*", "/rest/v1/app_data?select=key,value", "/rest/v1/app_data?select=*&key=eq.lpc:config:v2"]) {
    assert.equal(supa(a, "GET", u).text, supa(b, "GET", u).text, u);
  }
  assert.equal(supa(a, "POST", "/auth/v1/token?grant_type=password").text, supa(b, "POST", "/auth/v1/token?grant_type=password").text, "the session carries the clock, not the wall");
  const w = (fx) => supa(fx, "POST", "/rest/v1/floor_public", { body: { id: `sage-demo:${DAY}`, data: { a: 1 } }, headers: { prefer: "resolution=merge-duplicates" } }).text;
  assert.equal(w(a), w(b), "a write is stamped by the shared clock, so the stamps match");
  const stamp = (fx) => app(fx, "POST", "/api/floor-row", { body: { op: "read", store: "sage-demo", date: DAY, room: "floor" }, headers: AUTH }).json().stamp;
  assert.equal(stamp(a), stamp(b));
  assert.deepEqual([a.report().clock, a.report().seed, b.report().clock, b.report().seed], ["fixed", "shared", "fixed", "shared"]);
  const fresh = make("legacy");
  assert.deepEqual([fresh.report().clock, fresh.report().seed], ["system", "fresh"]);
  assert.notEqual(supa(fresh, "GET", "/rest/v1/floor_people?select=*").text, supa(make("legacy"), "GET", "/rest/v1/floor_people?select=*").text,
    "without a shared seed two fixtures differ, because the demo draws some ids at random");
  seed.profiles.find((p) => p.id === "00000000-0000-4000-8000-000000000001").role = "admin";
  assert.equal(supa(a, "GET", "/rest/v1/profiles?select=*").json()[0].role, "associate", "the seed is copied in, so changing it later changes nothing");
});

test("a dot segment is refused before the URL parser can resolve it onto something real", () => {
  const fx = make();
  const shell = app(fx, "GET", "/").text;
  // What the parser alone would have done with these, and why the raw target is checked first.
  assert.equal(new URL("/../../etc/passwd", "http://127.0.0.1").pathname, "/etc/passwd");
  assert.equal(new URL("/assets/../index.html", "http://127.0.0.1").pathname, "/index.html");
  const refused = ["/../../etc/passwd", "/..", "/.", "/./", "/a/./b", "/assets/../index.html", "/assets/../assets/app-abc.js", "/%2e%2e/%2e%2e/etc/passwd", "/%2E%2E/x", "/.%2e/x",
    "/%2e/x", "/assets/%2e%2e/index.html", "/../", "/..?x=1", "/assets/../index.html?x=1"];
  for (const u of refused) {
    const r = app(fx, "GET", u);
    assert.equal(r.status, 400, u);
    assert.notEqual(r.text, shell, u + " did not get the shell");
  }
  for (const m of ["HEAD", "POST"]) assert.equal(app(fx, m, "/assets/../index.html").status, 400, m);
  assert.equal(supa(fx, "GET", "/rest/v1/../v1/profiles").status, 400, "and on the data origin");
  assert.equal(fx.report().unexpected, refused.length + 3, "every one counted against the run");
  // Names that merely contain dots are not dot segments.
  for (const u of ["/assets/app-abc.js", "/favicon.svg", "/assets/a..b.js", "/assets/.hidden", "/a.b/c"]) assert.notEqual(app(fx, "GET", u).status, 400, u);
  assert.equal(app(fx, "GET", "/assets/app-abc.js").status, 200);
  assert.equal(app(fx, "GET", "/assets/a..b.js").status, 404, "a name with two dots in it goes to the static server, which does not have it");
});

/* ================= the room API: pinned pure modules, the real reducer and projection ================= */
const ROOM_DIR = process.env.SHOTS_ROOM_MODULES_DIR || fileURLToPath(new URL("../api/", import.meta.url));
let ROOM = null, ROOM_WHY = "";
try { ROOM = await loadRoomModules(ROOM_DIR); } catch (e) { ROOM_WHY = `${e.code || "error"}: ${e.message}`; }
/* If the six verified modules cannot be loaded here the room tests are skipped, loudly, with the reason
   in the TAP output; they are not passed. */
const roomTest = (name, fn) => (ROOM ? test(name, fn) : test(name, { skip: `room modules not loadable (${ROOM_WHY}); set SHOTS_ROOM_MODULES_DIR to the verified final folder` }, fn));
const kept = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));   // not registered for cleanup

const NOW = Date.UTC(2031, 1, 3, 15, 0, 0);   // 10:00 in New York
const TODAY = storeDay(new Date(NOW));
const USER = "00000000-0000-4000-8000-000000000001";
const OP = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function roomFx({ edit, over = {} } = {}) {
  const seed = makeSeed(NOW);
  if (edit) edit(seed);
  const fx = createFixture({ mode: "compatible", distDir: dist(), room: ROOM, now: NOW, seed, ...over });
  return { fx, seed, me: seed.floor_people[0] && seed.floor_people[0].person_id };
}
const baseRow = (me, extra = {}) => ({
  store: "sage-demo", date: TODAY, secretField: "not-for-staff",
  roster: [{ id: me, name: "Dev Okonjo", label: "Dev O.", role: "sales", langs: ["en"], hidden: "x" }, { id: "p-two", name: "Pat Two", label: "Pat T." }],
  line: [{ id: "p-two", label: "Pat T.", status: "waiting", statusAt: "2031-02-03T14:00:00.000Z", joinedAt: "2031-02-03T13:00:00.000Z", private: "p" },
    { id: me, label: "Dev O.", status: "waiting", statusAt: "2031-02-03T14:10:00.000Z", joinedAt: "2031-02-03T13:10:00.000Z" }],
  assists: [{ id: "p-two:a", byId: "p-two", byName: "Pat Two", kind: "to", t: "2031-02-03T14:00:00.000Z" }], checkouts: [],
  history: [{ id: "p-two", t: "2031-02-03T14:00:00.000Z", action: "lunch", who: "Pat T.", by: "self" }], ...extra });
const putFloor = (fx, data) => supa(fx, "POST", "/rest/v1/floor_public", { body: { id: `sage-demo:${TODAY}`, store: "sage-demo", fdate: TODAY, data }, headers: { prefer: "resolution=merge-duplicates" } });
const tableRow = (fx) => supa(fx, "GET", `/rest/v1/floor_public?id=eq.sage-demo:${TODAY}&select=data`).json()[0];
const mine = (fx, me) => tableRow(fx).data.line.find((x) => x.id === me);
const cmd = (fx, body, headers = AUTH) => app(fx, "POST", "/api/room-command", { body: { store: "sage-demo", date: TODAY, room: "floor", operationId: OP(1), ...body }, headers });
const floorRead = (fx, extra = {}) => app(fx, "POST", "/api/floor-row", { body: { op: "read", store: "sage-demo", date: TODAY, room: "floor", view: "own", ...extra }, headers: AUTH });
const unexpected = (fx) => fx.report().unexpected;

test("the room modules are refused unless the bytes match their pins, and nothing runs first", () => {
  const dir = kept("room-fab-");
  const marker = path.join(dir, "ran.txt");
  const names = ["_self-room-command", "_queue-action", "_phone-action", "_stations", "_phone-rows", "_room-projection"];
  for (const n of names) fs.writeFileSync(path.join(dir, n + ".mjs"), n === "_stations" ? `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "ran");\n` : `export const x = 1;\n`);
  return assert.rejects(loadRoomModules(dir), (e) => e instanceof RoomModulesError && e.code === "hash").then(() => {
    assert.equal(fs.existsSync(marker), false, "a module that would have written a file was never imported");
  });
});

test("a missing folder, a missing file, a link and a non-file are refused with a reason", async () => {
  await assert.rejects(loadRoomModules(path.join(os.tmpdir(), "no-such-room-folder-xyz")), (e) => e.code === "absent");
  await assert.rejects(loadRoomModules(""), (e) => e.code === "absent");
  await assert.rejects(loadRoomModules(undefined), (e) => e.code === "absent");
  const empty = kept("room-empty-");
  await assert.rejects(loadRoomModules(empty), (e) => e.code === "absent");
  const linked = kept("room-link-");
  fs.symlinkSync("/etc/hostname", path.join(linked, "_self-room-command.mjs"));
  await assert.rejects(loadRoomModules(linked), (e) => e.code === "kind", "a link is refused before it is read");
  const dirAsFile = kept("room-dir-");
  fs.mkdirSync(path.join(dirAsFile, "_self-room-command.mjs"));
  await assert.rejects(loadRoomModules(dirAsFile), (e) => e.code === "kind");
});

test("the import graph is exactly the written-down one: any other import, built-in, call or re-export is refused", () => {
  const good = () => ({
    "_self-room-command": "import { a } from './_queue-action.mjs';\nimport { b } from './_phone-action.mjs';\nimport { c } from './_stations.mjs';\nimport { d } from './_phone-rows.mjs';\nexport const x = 1;\n/* process and supabase may be named in a comment */",
    "_phone-action": "import {\n  one,\n  two } from \"./_stations.mjs\";\nexport const y = 1;", "_queue-action": "export const z = 1;", "_stations": "export const z = 1;", "_phone-rows": "export const z = 1;", "_room-projection": "export const z = 1;" });
  assert.equal(verifyRoomGraph(good()), true);
  const refuse = (mutate, code) => { const t = good(); mutate(t); assert.throws(() => verifyRoomGraph(t), (e) => e instanceof RoomModulesError && (!code || e.code === code)); };
  refuse((t) => { t["_stations"] = "import fs from 'node:fs';"; });
  refuse((t) => { t["_queue-action"] = "import x from './_stations.mjs';"; }, "graph");
  refuse((t) => { t["_room-projection"] = "import './_elsewhere.mjs';"; }, "graph");
  refuse((t) => { t["_phone-rows"] = "export * from './_stations.mjs';"; }, "graph");
  refuse((t) => { t["_stations"] = "export { a } from './_queue-action.mjs';"; }, "graph");
  refuse((t) => { t["_self-room-command"] = t["_self-room-command"].replace("import { d } from './_phone-rows.mjs';\n", ""); }, "graph");
  refuse((t) => { delete t["_stations"]; }, "graph");
  refuse((t) => { t["_stations"] = "const m = await import('./_x.mjs');"; }, "forbidden");
  refuse((t) => { t["_stations"] = "const fs = require('fs');"; }, "forbidden");
  refuse((t) => { t["_stations"] = "const e = process.env.SECRET;"; }, "forbidden");
  refuse((t) => { t["_stations"] = "fetch('http://example.test');"; }, "forbidden");
  refuse((t) => { t["_stations"] = "eval('1');"; }, "forbidden");
  refuse((t) => { t["_stations"] = "const f = new Function('return 1');"; }, "forbidden");
  refuse((t) => { t["_stations"] = "const c = createClient('u','k');"; }, "forbidden");
  refuse((t) => { t["_stations"] = "globalThis.x = 1;"; }, "forbidden");
  assert.deepEqual(scanRoomModule("import a from './x.mjs'; import './y.mjs'; export { b } from './z.mjs';").specs, ["./x.mjs", "./y.mjs", "./z.mjs"]);
});

test("the room option is checked, and on and off cannot both be asked for", () => {
  const d = dist();
  assert.throws(() => createFixture({ mode: "legacy", distDir: d, room: {} }), /loadRoomModules returns/);
  assert.throws(() => createFixture({ mode: "legacy", distDir: d, room: null }), /loadRoomModules returns/);
  assert.throws(() => createFixture({ mode: "legacy", distDir: d, room: { selfRoomCommand() {}, roomProjection() {} }, apiOff: true }), /both on and off/);
});

test("API off is the control: floor-row and room-command are refused and counted, nothing else changes", () => {
  const fx = createFixture({ mode: "compatible", distDir: dist(), now: NOW, seed: makeSeed(NOW), apiOff: true });
  assert.equal(floorRead(fx).status, 501);
  assert.equal(cmd(fx, { action: "status", input: { status: "lunch" } }).status, 501);
  assert.equal(unexpected(fx), 2);
  assert.equal(supa(fx, "POST", "/rest/v1/rpc/sage_config_read", { body: "{}" }).status, 200, "the data origin is the same one");
  assert.equal(app(fx, "GET", "/").status, 200, "so is the static server");
});

roomTest("lunch alone stays lunch, lunch then waiting persists, read the way feel reads it", () => {
  const { fx, me } = roomFx();
  putFloor(fx, baseRow(me));
  const t0 = tableRow(fx);
  const a = cmd(fx, { action: "status", input: { status: "lunch" }, operationId: OP(1) });
  assert.equal(a.status, 200); assert.equal(a.json().ok, true); assert.ok(a.json().row, "the app needs ok and a row");
  assert.equal(mine(fx, me).status, "lunch"); assert.equal(mine(fx, me).awayReason, "lunch");
  assert.equal(mine(fx, me).statusAt, new Date(NOW).toISOString(), "deterministic: the fixed clock, passed in, no patched Date");
  const afterLunch = supa(fx, "GET", `/rest/v1/floor_public?id=eq.sage-demo:${TODAY}&select=data`).json();
  assert.equal(afterLunch.length, 1);
  const stamp1 = supa(fx, "GET", `/rest/v1/floor_public?id=eq.sage-demo:${TODAY}`).json()[0].updated_at;
  const b = cmd(fx, { action: "status", input: { status: "waiting" }, operationId: OP(2) });
  assert.equal(b.status, 200);
  assert.equal(mine(fx, me).status, "waiting"); assert.equal(mine(fx, me).awayReason, null);
  const stamp2 = supa(fx, "GET", `/rest/v1/floor_public?id=eq.sage-demo:${TODAY}`).json()[0].updated_at;
  assert.ok(stamp2 > stamp1, "the stamp moves forward with each commit");
  assert.ok(tableRow(fx).data.history.some((h) => h.action === "lunch" && h.id === me) && tableRow(fx).data.history.some((h) => h.action === "back" && h.id === me), "both taps are in the row's own history, in order");
  const hist = tableRow(fx).data.history.map((h) => h.action);
  assert.ok(hist.indexOf("lunch") < hist.lastIndexOf("back"));
  assert.equal(t0.data.line.find((x) => x.id === me).status, "waiting", "and the row started where the seed put it");
  assert.equal(unexpected(fx), 0);
});

roomTest("a direct seed write between two commands is kept: each command reads the current row", () => {
  const { fx, me } = roomFx();
  putFloor(fx, baseRow(me));
  cmd(fx, { action: "status", input: { status: "lunch" }, operationId: OP(1) });
  const row = tableRow(fx).data;
  row.marker = "written-directly"; row.line.find((x) => x.id === "p-two").status = "away";
  assert.equal(putFloor(fx, row).status, 201);
  cmd(fx, { action: "status", input: { status: "waiting" }, operationId: OP(2) });
  const end = tableRow(fx).data;
  assert.equal(end.marker, "written-directly"); assert.equal(end.line.find((x) => x.id === "p-two").status, "away");
  assert.equal(end.line.find((x) => x.id === me).status, "waiting");
});

roomTest("an assist gets a real id, a cancel marks that one, and a made-up id changes nothing", () => {
  const { fx, me } = roomFx();
  putFloor(fx, baseRow(me));
  const a = cmd(fx, { action: "assist", input: { kind: "fly", table: "3", note: "hi" }, operationId: OP(1) });
  assert.equal(a.status, 200);
  const id = `${me}:${new Date(NOW).toISOString()}`;
  const mineNow = tableRow(fx).data.assists.find((x) => x.byId === me);
  assert.equal(mineNow.id, id); assert.equal(mineNow.kind, "fly"); assert.equal(mineNow.table, "3"); assert.equal(mineNow.spot, "floor");
  assert.deepEqual(a.json().row.assists.map((x) => x.id), [id], "the response shows only the caller's assists");
  const before = JSON.stringify(tableRow(fx).data);
  assert.equal(cmd(fx, { action: "cancel-assist", input: { assistId: "nope" }, operationId: OP(2) }).status, 200);
  assert.equal(JSON.stringify(tableRow(fx).data), before, "an id that is not theirs is a no-op");
  assert.equal(cmd(fx, { action: "cancel-assist", input: { assistId: "p-two:a" }, operationId: OP(3) }).status, 200);
  assert.equal(tableRow(fx).data.assists.find((x) => x.id === "p-two:a").doneAt, undefined, "somebody else's assist cannot be cancelled");
  assert.equal(cmd(fx, { action: "cancel-assist", input: { assistId: id }, operationId: OP(4) }).status, 200);
  const done = tableRow(fx).data.assists.find((x) => x.id === id);
  assert.equal(done.cancelled, true); assert.equal(done.doneAt, new Date(NOW).toISOString());
});

roomTest("the final type patch is in force: a table that only stringifies to a real one is refused", () => {
  const { fx, me } = roomFx();
  putFloor(fx, baseRow(me));
  const before = JSON.stringify(tableRow(fx));
  for (const table of [["3"], { toString: "3" }, {}, true]) {
    const r = cmd(fx, { action: "assist", input: { kind: "to", table }, operationId: OP(9) });
    assert.equal(r.status, 400, JSON.stringify(table));
  }
  assert.equal(JSON.stringify(tableRow(fx)), before);
  assert.equal(cmd(fx, { action: "assist", input: { kind: "to", table: 3 }, operationId: OP(10) }).status, 200, "a number is a table value");
});

roomTest("every refusal leaves the row, the stamp and the receipts alone", () => {
  const cases = [
    ["unknown action", { action: "nope", input: {} }, 501], ["a real command outside the census", { action: "join", input: {} }, 501], ["a room outside the census", { action: "status", input: { status: "lunch" }, room: "line" }, 501],
    ["invalid status", { action: "status", input: { status: "busy" } }, 400], ["no status", { action: "status", input: {} }, 400], ["bad assist kind", { action: "assist", input: { kind: "x" } }, 400],
    ["unknown table", { action: "assist", input: { kind: "to", table: "99" } }, 400], ["long note", { action: "assist", input: { kind: "to", note: "x".repeat(501) } }, 400],
    ["a past day", { action: "status", input: { status: "lunch" }, date: "2031-02-02" }, 400], ["an impossible day", { action: "status", input: { status: "lunch" }, date: "2031-02-30" }, 400],
    ["a bad operation id", { action: "status", input: { status: "lunch" }, operationId: "not-a-uuid" }, 400], ["no operation id", { action: "status", input: { status: "lunch" }, operationId: undefined }, 400],
    ["input an array", { action: "status", input: [] }, 400], ["input null", { action: "status", input: null }, 400], ["a bad store", { action: "status", input: { status: "lunch" }, store: "bad store!" }, 400],
  ];
  for (const [name, over, want] of cases) {
    const { fx, me } = roomFx();
    putFloor(fx, baseRow(me));
    const before = JSON.stringify(supa(fx, "GET", "/rest/v1/floor_public?select=*").json()), u0 = unexpected(fx);
    const r = cmd(fx, over);
    assert.equal(r.status, want, name);
    assert.equal(JSON.stringify(supa(fx, "GET", "/rest/v1/floor_public?select=*").json()), before, name + ": no mutation");
    assert.equal(unexpected(fx), u0 + 1, name + ": counted against the run");
    // and no receipt was kept: the same operation id still works for a good command
    assert.equal(cmd(fx, { action: "status", input: { status: "lunch" }, operationId: over.operationId && UUID_OK(over.operationId) ? over.operationId : OP(1) }).status, 200, name + ": the id was not used up");
  }
});
const UUID_OK = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

roomTest("who may ask: bearer, active account, link; a pending but linked account proceeds, as the real handler allows", () => {
  const unchanged = (fx) => JSON.stringify(supa(fx, "GET", "/rest/v1/floor_public?select=*").json());
  const attempt = (name, setup, headers, want) => {
    const { fx, me } = roomFx(setup ? { edit: setup } : {});
    putFloor(fx, baseRow(me));
    const before = unchanged(fx);
    const r = cmd(fx, { action: "status", input: { status: "lunch" } }, headers);
    assert.equal(r.status, want, name);
    if (want !== 200) assert.equal(unchanged(fx), before, name + ": no mutation");
    else assert.notEqual(unchanged(fx), before);
  };
  attempt("no bearer", null, {}, 401);
  attempt("a wrong token", null, { authorization: "Bearer someone-else" }, 401);
  attempt("a token without the scheme", null, { authorization: "mock-token" }, 401);
  attempt("inactive", (s) => { s.profiles.find((p) => p.id === USER).active = false; }, AUTH, 403);
  attempt("active missing", (s) => { delete s.profiles.find((p) => p.id === USER).active; }, AUTH, 403);
  attempt("no profile", (s) => { s.profiles.length = 0; }, AUTH, 403);
  attempt("not linked", (s) => { s.floor_people.length = 0; }, AUTH, 403);
  attempt("pending and not linked", (s) => { s.profiles.find((p) => p.id === USER).pending = true; s.floor_people.length = 0; }, AUTH, 403);
  attempt("pending but linked (the real handler checks active and the link, not pending)", (s) => { s.profiles.find((p) => p.id === USER).pending = true; }, AUTH, 200);
  attempt("a good associate", null, AUTH, 200);
});

roomTest("a missing room is 404 and is not created; a row without its own store and date is refused as the commit refuses it", () => {
  const { fx, me } = roomFx({ edit: (s) => { s.floor_public.length = 0; } });   // the seed holds a row for this day; take it out
  const rows0 = JSON.stringify(supa(fx, "GET", "/rest/v1/floor_public?select=*").json());
  assert.equal(cmd(fx, { action: "status", input: { status: "lunch" } }).status, 404);
  assert.equal(JSON.stringify(supa(fx, "GET", "/rest/v1/floor_public?select=*").json()), rows0, "nothing was created");
  const bare = baseRow(me); delete bare.store; delete bare.date;
  putFloor(fx, bare);
  const before = JSON.stringify(tableRow(fx));
  const r = cmd(fx, { action: "status", input: { status: "lunch" } });
  assert.equal(r.status, 500); assert.equal(r.json().error, "Room command refused");
  assert.equal(JSON.stringify(tableRow(fx)), before);
  assert.equal(unexpected(fx), 2);
});

roomTest("a replay of the same actor and operation id returns the stored answer and adds nothing", () => {
  const { fx, me } = roomFx();
  putFloor(fx, baseRow(me));
  const OPA = "abcdef01-0000-4000-8000-0000000000aa";
  const first = cmd(fx, { action: "status", input: { status: "lunch" }, operationId: OPA });
  const afterFirst = JSON.stringify(supa(fx, "GET", "/rest/v1/floor_public?select=*").json());
  const histLen = tableRow(fx).data.history.length;
  const replay = cmd(fx, { action: "status", input: { status: "lunch" }, operationId: OPA });
  assert.equal(replay.status, 200); assert.equal(replay.text, first.text);
  assert.equal(JSON.stringify(supa(fx, "GET", "/rest/v1/floor_public?select=*").json()), afterFirst, "the row and its stamp did not move");
  assert.equal(tableRow(fx).data.history.length, histLen, "no duplicate history");
  cmd(fx, { action: "status", input: { status: "waiting" }, operationId: OP(2) });
  const later = cmd(fx, { action: "status", input: { status: "lunch" }, operationId: OPA.toUpperCase() });
  assert.equal(later.text, first.text, "still the first answer, whatever has happened since, and the id is case-insensitive");
  assert.equal(mine(fx, me).status, "waiting", "and the replay did not re-apply");
  assert.equal(unexpected(fx), 0);
});

roomTest("the same operation id with a different request is 409 and changes nothing", () => {
  const { fx, me } = roomFx();
  putFloor(fx, baseRow(me));
  const original = cmd(fx, { action: "status", input: { status: "lunch", tag: "t" }, operationId: OP(1) });
  const before = JSON.stringify(supa(fx, "GET", "/rest/v1/floor_public?select=*").json());
  for (const other of [{ action: "status", input: { status: "away" } }, { action: "status", input: { status: "lunch", extra: 1 } }, { action: "assist", input: { kind: "to" } }]) {
    const r = cmd(fx, { ...other, operationId: OP(1) });
    assert.equal(r.status, 409);
  }
  assert.equal(JSON.stringify(supa(fx, "GET", "/rest/v1/floor_public?select=*").json()), before);
  assert.equal(cmd(fx, { action: "status", input: { status: "lunch" }, operationId: OP(1) }).status, 409, "a missing key is a difference");
  const reordered = cmd(fx, { action: "status", input: { tag: "t", status: "lunch" }, operationId: OP(1) });
  assert.equal(reordered.status, 200, "key order alone is not a difference");
  assert.equal(reordered.text, original.text);
});

roomTest("distinct commands arriving together each build on the latest row; none is lost, in either order", () => {
  for (const order of [["status", "assist"], ["assist", "status"]]) {
    const { fx, me } = roomFx();
    putFloor(fx, baseRow(me));
    const make = { status: () => cmd(fx, { action: "status", input: { status: "lunch" }, operationId: OP(1) }), assist: () => cmd(fx, { action: "assist", input: { kind: "fly" }, operationId: OP(2) }) };
    const first = make[order[0]](), second = make[order[1]]();
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal(mine(fx, me).status, "lunch");
    assert.equal(tableRow(fx).data.assists.filter((x) => x.byId === me).length, 1);
    const last = second.json().row;
    assert.equal(last.line.find((x) => x.id === me).status, "lunch", "the second answer already contains the first command");
    assert.equal(last.assists.filter((x) => x.byId === me).length, 1);
  }
});

roomTest("reads and commands both go through the real projection, and the stamp follows the row", () => {
  const { fx, me } = roomFx();
  putFloor(fx, baseRow(me));
  const first = floorRead(fx).json();
  assert.deepEqual(first.row, ROOM.roomProjection(tableRow(fx).data, me), "a read is the real projection of the seeded row");
  assert.equal(first.row.secretField, undefined); assert.equal(first.row.roster[0].hidden, undefined);
  assert.equal(first.row.line.find((x) => x.id === "p-two").private, undefined);
  assert.deepEqual(first.row.assists, [], "another person's assist is not in the caller's view");
  assert.deepEqual(first.row.history, [], "nor their history");
  assert.deepEqual(floorRead(fx, { stamp: first.stamp }).json(), { same: true, stamp: first.stamp });
  const c = cmd(fx, { action: "status", input: { status: "lunch" }, operationId: OP(1) });
  const { presence, ...visible } = tableRow(fx).data;
  assert.deepEqual(c.json().row, ROOM.roomProjection(visible, me), "a command's answer is the real projection too");
  assert.ok(c.json().row.history.some((h) => h.id === me && h.action === "lunch"), "the caller's own history is there");
  const second = floorRead(fx, { stamp: first.stamp }).json();
  assert.equal(second.same, undefined, "the old stamp is stale after a command");
  assert.deepEqual(second.row, c.json().row);
  assert.deepEqual(floorRead(fx, { stamp: second.stamp }).json(), { same: true, stamp: second.stamp });
});

roomTest("floor-row asks the same staff question as the real endpoint: inactive is out, an assigned store or a link is in", () => {
  const ask = (edit) => { const { fx, me } = roomFx({ edit }); putFloor(fx, baseRow(me)); return floorRead(fx).status; };
  assert.equal(ask(), 200);
  assert.equal(ask((s) => { s.profiles.find((p) => p.id === USER).active = false; }), 403);
  assert.equal(ask((s) => { const p = s.profiles.find((x) => x.id === USER); p.pending = true; p.stores = []; s.floor_people.length = 0; }), 403);
  assert.equal(ask((s) => { const p = s.profiles.find((x) => x.id === USER); p.pending = true; p.stores = []; }), 200, "a link is enough");
  assert.equal(ask((s) => { const p = s.profiles.find((x) => x.id === USER); p.stores = []; s.floor_people.length = 0; }), 403, "not assigned and not linked");
});

roomTest("body caps: exactly 262,144 bytes passes the size rule, one more is 413", () => {
  const { fx, me } = roomFx();
  putFloor(fx, baseRow(me));
  const base = JSON.stringify({ store: "sage-demo", date: TODAY, room: "floor", action: "status", input: { status: "lunch", pad: "" }, operationId: OP(1) });
  const exact = base.replace('"pad":""', `"pad":"${"x".repeat(262144 - base.length + 0)}"`);
  assert.equal(Buffer.byteLength(exact), 262144);
  const r = app(fx, "POST", "/api/room-command", { body: exact, headers: AUTH });
  assert.notEqual(r.status, 413, "the size rule lets it through (the reducer then decides)");
  const over = app(fx, "POST", "/api/room-command", { body: exact + " ", headers: AUTH });
  assert.equal(over.status, 413);
  assert.equal(app(fx, "POST", "/api/room-command", { body: "x".repeat(1_000_000), headers: AUTH }).status, 413);
});

roomTest("the room API does not widen the write allowlist or the other routes", () => {
  const { fx, me } = roomFx();
  putFloor(fx, baseRow(me));
  assert.equal(supa(fx, "POST", "/rest/v1/profiles", { body: { id: "x" } }).status, 501);
  assert.equal(app(fx, "GET", "/api/room-command").status, 501);
  assert.equal(app(fx, "POST", "/api/open-room", { body: {}, headers: AUTH }).status, 501);
  assert.equal(app(fx, "POST", "/api/queue-action", { body: {}, headers: AUTH }).status, 501);
  assert.equal(supa(fx, "POST", "/rest/v1/rpc/sage_floor_days", { body: {} }).status, 501);
  assert.equal(fx.report().unexpected, 5);
});

/* ================= seed identity: fill ABSENT only, refuse the wrong, never re-enrich a write ================= */
const normFx = ({ edit, over = {} } = {}) => {
  const seed = makeSeed(NOW);
  if (edit) edit(seed);
  return { seed, fx: createFixture({ mode: "compatible", distDir: dist(), now: NOW, seed, normalizeSeedIdentity: true, ...over }) };
};
const rowsOf = (fx, table) => supa(fx, "GET", `/rest/v1/${table}?select=*`).json();
const everything = (fx) => JSON.stringify([rowsOf(fx, "floor_public"), rowsOf(fx, "queue_public")]);
const FLOOR_ID = `sage-demo:${TODAY}`;

test("normalising the seed fills only keys that are absent, once, from the row's own columns, and records what it gave", () => {
  const seed = makeSeed(NOW);
  assert.equal(seed.floor_public[0].data.store, undefined, "the seed as generated has no identity");
  assert.equal(seed.floor_public[0].data.date, undefined);
  const { fx } = normFx();
  const f = rowsOf(fx, "floor_public").find((r) => r.id === FLOOR_ID), q = rowsOf(fx, "queue_public").find((r) => r.id === FLOOR_ID);
  assert.equal(f.data.store, "sage-demo"); assert.equal(f.data.date, TODAY);
  assert.equal(q.data.store, "sage-demo"); assert.equal(q.data.date, TODAY);
  assert.equal(fx.seedBinding.identity, true);
  assert.match(fx.seedBinding.rowsSha256, /^[0-9a-f]{64}$/);
  assert.ok(fx.seedBinding.rows.some((r) => r.table === "floor_public" && r.id === FLOOR_ID && r.store === "sage-demo" && r.date === TODAY), "the identity actually given is listed");
  assert.ok(fx.seedBinding.rows.some((r) => r.table === "queue_public" && r.id === FLOOR_ID && r.store === "sage-demo" && r.date === TODAY));
  assert.equal(Object.isFrozen(fx.seedBinding), true);
  assert.equal(seed.floor_public[0].data.store, undefined, "and the seed that was passed in is not touched");
});

test("the seed binding hashes the normalised bytes: same inputs give the same hash, any change gives another", () => {
  const seed = makeSeed(NOW), d = dist();
  const make1 = (o = {}) => createFixture({ mode: "legacy", distDir: d, now: NOW, seed, normalizeSeedIdentity: true, ...o });
  assert.deepEqual(make1().seedBinding, make1().seedBinding);
  const plain = createFixture({ mode: "legacy", distDir: d, now: NOW, seed });
  assert.equal(plain.seedBinding.identity, false); assert.deepEqual(plain.seedBinding.rows, []);
  assert.notEqual(plain.seedBinding.rowsSha256, make1().seedBinding.rowsSha256, "normalising changes the bytes, and the hash says so");
  const other = structuredClone(seed); other.floor_public[0].data.line[0].status = "away";
  assert.notEqual(make1({ seed: other }).seedBinding.rowsSha256, make1().seedBinding.rowsSha256);
  const reordered = structuredClone(seed); reordered.floor_public.reverse(); reordered.queue_public.reverse();
  assert.equal(make1({ seed: reordered }).seedBinding.rowsSha256, make1().seedBinding.rowsSha256, "row order is not content");
  assert.equal(createFixture({ mode: "compatible", distDir: d, now: NOW, seed, normalizeSeedIdentity: true }).seedBinding.rowsSha256, make1().seedBinding.rowsSha256, "and the RPC mode is not part of it");
});

test("an explicit wrong, null or undefined identity in the seed is refused and never overwritten; so is a row whose id and columns disagree", () => {
  const bad = {
    "store null": (s) => { s.floor_public[0].data.store = null; }, "store wrong": (s) => { s.floor_public[0].data.store = "elsewhere"; }, "store explicitly undefined": (s) => { s.floor_public[0].data.store = undefined; },
    "date null": (s) => { s.floor_public[0].data.date = null; }, "date wrong": (s) => { s.floor_public[0].data.date = "2000-01-01"; },
    "store null with date absent": (s) => { s.floor_public[0].data.store = null; delete s.floor_public[0].data.date; },
    "date null with store absent": (s) => { s.floor_public[0].data.date = null; },
    "queue date wrong": (s) => { s.queue_public[0].data.date = "2000-01-01"; }, "queue store null": (s) => { s.queue_public[0].data.store = null; },
    "store column missing": (s) => { delete s.floor_public[0].store; }, "date column missing": (s) => { delete s.floor_public[0].fdate; },
    "date column differs from the id": (s) => { s.floor_public[0].fdate = "2000-01-01"; }, "id names another store": (s) => { s.floor_public[0].id = `other:${TODAY}`; },
    "data not an object": (s) => { s.floor_public[0].data = null; }, "data an array": (s) => { s.floor_public[0].data = []; },
  };
  for (const [name, edit] of Object.entries(bad)) {
    assert.throws(() => normFx({ edit }), /not rewritten|disagree|not an object/, name);
    assert.doesNotThrow(() => createFixture({ mode: "compatible", distDir: dist(), now: NOW, seed: (() => { const s = makeSeed(NOW); edit(s); return s; })() }), name + ": with normalisation off the old malformed-seed behaviour is unchanged");
  }
});

test("a later write must carry the same identity: missing, null, wrong or mismatched is refused, and nothing is filled in again", () => {
  const { fx } = normFx();
  const post = (table, row) => supa(fx, "POST", `/rest/v1/${table}`, { body: row, headers: { prefer: "resolution=merge-duplicates" } });
  const cur = rowsOf(fx, "floor_public").find((r) => r.id === FLOOR_ID);
  const withData = (data, over = {}) => ({ id: FLOOR_ID, store: "sage-demo", fdate: TODAY, data, ...over });
  const before = everything(fx);
  let u = fx.report().unexpected;
  const refused = (name, row, table = "floor_public") => {
    assert.equal(post(table, row).status, 501, name); u += 1;
    assert.equal(everything(fx), before, name + ": nothing changed");
    assert.equal(fx.report().unexpected, u, name + ": counted");
  };
  const { store, date, ...bare } = cur.data;
  refused("no identity at all", withData(bare));
  refused("store missing", withData({ ...bare, date }));
  refused("date missing", withData({ ...bare, store }));
  refused("store null", withData({ ...cur.data, store: null }));
  refused("date null", withData({ ...cur.data, date: null }));
  refused("store wrong", withData({ ...cur.data, store: "elsewhere" }));
  refused("date wrong", withData({ ...cur.data, date: "2000-01-01" }));
  refused("store column wrong", withData(cur.data, { store: "elsewhere" }));
  refused("date column wrong", withData(cur.data, { fdate: "2000-01-01" }));
  refused("store column missing", { id: FLOOR_ID, fdate: TODAY, data: cur.data });
  refused("no data", { id: FLOOR_ID, store: "sage-demo", fdate: TODAY });
  refused("data an array", withData([]));
  refused("a new day, bare", withData(bare, { id: "sage-demo:2031-02-04", fdate: "2031-02-04" }));
  refused("a copied row that kept the old day in its data (the phone-line copy)", { id: "sage-demo:2031-02-04", store: "sage-demo", qdate: "2031-02-04", data: { ...cur.data, date: TODAY } }, "queue_public");
  refused("queue, bare", { id: FLOOR_ID, store: "sage-demo", qdate: TODAY, data: bare }, "queue_public");
  assert.equal(post("floor_public", withData({ ...cur.data, marker: "kept" })).status, 201, "a write that carries its identity is accepted");
  assert.equal(rowsOf(fx, "floor_public").find((r) => r.id === FLOOR_ID).data.marker, "kept");
  assert.equal(post("floor_public", withData({ ...cur.data }, { id: "sage-demo:2031-02-04", fdate: "2031-02-04", data: { ...cur.data, date: "2031-02-04" } })).status, 201, "a new day is fine when it names itself correctly");
  assert.equal(post("app_data", { key: "lpc:config:v2", value: { stores: [] } }).status, 201, "rows that have no identity are not affected");
  const plain = createFixture({ mode: "compatible", distDir: dist(), now: NOW, seed: makeSeed(NOW) });
  const bareOld = { id: FLOOR_ID, store: "sage-demo", fdate: TODAY, data: bare };
  assert.equal(supa(plain, "POST", "/rest/v1/floor_public", { body: bareOld, headers: { prefer: "resolution=merge-duplicates" } }).status, 201, "default off: a bare write is accepted");
  assert.equal(rowsOf(plain, "floor_public").find((r) => r.id === FLOOR_ID).data.store, undefined, "and stays bare, as before");
});

roomTest("feel's own seeding sequence works unmodified against a bound seed, and the first Lunch then succeeds; with normalisation off it is refused as before", () => {
  const sequence = (over) => {
    const { fx, me } = roomFx({ over });
    const cur = rowsOf(fx, "floor_public")[0];
    const R = [{ id: me, name: "Dev Okonjo", label: "Dev O." }, { id: "r1", name: "Ann Bee", label: "Ann B." }, { id: "r2", name: "Cal Dee", label: "Cal D." }];
    const mins = (m) => new Date(NOW - m * 60000).toISOString();
    const at = (p, m) => ({ id: p.id, label: p.label, name: p.label, status: "waiting", statusAt: mins(m), joinedAt: mins(m + 40), movedAt: mins(m), awayReason: null, table: null });
    const d = { ...(cur.data || {}) };   // exactly what prepFloor does: start from the row it read
    d.roster = [...R, { id: "__lpc_test__", label: "Test", role: "Test", test: true }];
    d.line = [at(R[1], 52), at(R[2], 31), at(R[0], 18)];
    d.assists = []; d.checkouts = d.checkouts || []; d.history = d.history || [];
    const w = supa(fx, "POST", "/rest/v1/floor_public", { body: [{ ...cur, id: FLOOR_ID, store: "sage-demo", fdate: TODAY, data: d, updated_at: new Date(NOW).toISOString() }], headers: { prefer: "resolution=merge-duplicates" } });
    return { fx, me, w, cur };
  };
  const on = sequence({ normalizeSeedIdentity: true });
  assert.equal(on.w.status, 201);
  const lunch = cmd(on.fx, { action: "status", input: { status: "lunch" }, operationId: OP(1) });
  assert.equal(lunch.status, 200);
  const sm = (fx, me) => tableRow(fx).data.line.find((x) => x.id === me);
  assert.equal(sm(on.fx, on.me).status, "lunch");
  // feel's setMine: read the row, change it, write it back
  const row = rowsOf(on.fx, "floor_public")[0], d2 = { ...row.data, line: row.data.line.map((x) => (x.id === on.me ? { ...x, status: "customer", table: 3 } : x)) };
  assert.equal(supa(on.fx, "POST", "/rest/v1/floor_public", { body: [{ ...row, data: d2, updated_at: new Date(NOW).toISOString() }], headers: { prefer: "resolution=merge-duplicates" } }).status, 201);
  assert.equal(cmd(on.fx, { action: "assist", input: { kind: "fly", table: 3 }, operationId: OP(2) }).status, 200);
  assert.equal(tableRow(on.fx).data.store, "sage-demo"); assert.equal(tableRow(on.fx).data.date, TODAY);
  assert.equal(on.fx.report().unexpected, 0, "nothing was refused anywhere in the sequence");
  const off = sequence({});
  assert.equal(off.w.status, 201, "the writes are accepted when normalisation is off");
  const refused = cmd(off.fx, { action: "status", input: { status: "lunch" }, operationId: OP(1) });
  assert.equal(refused.status, 500); assert.equal(refused.json().error, "Room command refused");
});

roomTest("both control cells start from the same bytes: API off and API on, same seed, clock, dist and normalisation", () => {
  const seed = makeSeed(NOW), d = dist();
  const base = { mode: "compatible", distDir: d, now: NOW, seed, normalizeSeedIdentity: true };
  const off = createFixture({ ...base, apiOff: true }), on = createFixture({ ...base, room: ROOM });
  assert.deepEqual(off.seedBinding, on.seedBinding);
  assert.deepEqual(off.dist, on.dist);
  for (const u of ["/rest/v1/floor_public?select=*", "/rest/v1/queue_public?select=*", "/rest/v1/profiles?select=*", "/rest/v1/floor_people?select=*", "/rest/v1/app_data?select=key,value"]) {
    assert.equal(supa(off, "GET", u).text, supa(on, "GET", u).text, u);
  }
  assert.equal(app(off, "GET", "/").text, app(on, "GET", "/").text);
  assert.equal(floorRead(off).status, 501); assert.equal(cmd(off, { action: "status", input: { status: "lunch" } }).status, 501);
  assert.equal(floorRead(on).status, 200);
  assert.equal(off.report().unexpected, 2); assert.equal(on.report().unexpected, 0);
});

test("a seed file is written once, never overwritten, hashed and pinned, so two processes can start from the same bytes", () => {
  const dir = kept("seed-file-"), file = path.join(dir, "seed.json");
  const first = loadOrCreateSeed(file, { now: NOW });
  assert.equal(first.created, true); assert.match(first.sha256, /^[0-9a-f]{64}$/);
  const bytes = fs.readFileSync(file, "utf8");
  const second = loadOrCreateSeed(file, { now: NOW + 86400000 });
  assert.equal(second.created, false); assert.equal(second.sha256, first.sha256);
  assert.equal(fs.readFileSync(file, "utf8"), bytes, "an existing file is never rewritten, whatever the clock says");
  assert.equal(loadOrCreateSeed(file, { sha256: first.sha256 }).sha256, first.sha256);
  assert.throws(() => loadOrCreateSeed(file, { sha256: "0".repeat(64) }), /pin/);
  assert.throws(() => loadOrCreateSeed(""), /path/);
  const link = path.join(dir, "link.json"); fs.symlinkSync(file, link);
  assert.throws(() => loadOrCreateSeed(link), /plain file/);
  const junk = path.join(dir, "junk.json"); fs.writeFileSync(junk, "not json"); assert.throws(() => loadOrCreateSeed(junk), /not JSON/);
  const thin = path.join(dir, "thin.json"); fs.writeFileSync(thin, "{}"); assert.throws(() => loadOrCreateSeed(thin), /tables/);
  const d = dist(), mk = (mode) => createFixture({ mode, distDir: d, seed: first.seed, normalizeSeedIdentity: true });
  const a = mk("legacy"), b = mk("compatible");
  assert.deepEqual(a.seedBinding, b.seedBinding, "two fixtures built from the same file have the same binding");
  assert.equal(supa(a, "GET", "/rest/v1/floor_people?select=*").text, supa(b, "GET", "/rest/v1/floor_people?select=*").text, "and the same ids, which a fresh seed would not give");
  assert.equal(first.seed.floor_public[0].data.store, undefined, "the file holds the seed as generated; normalisation happens at creation, from its bytes");
});

/* ================= sage_schedule_read: the salesperson's own view, unpublished only ================= */
const MONTH = TODAY.slice(0, 7);
const sched = (fx, body, headers = AUTH) => supa(fx, "POST", "/rest/v1/rpc/sage_schedule_read", { body, headers });
const schedFx = ({ edit, mode = "compatible", over = {} } = {}) => {
  const seed = over.seed || makeSeed(NOW);
  if (edit) edit(seed);
  return { seed, me: seed.floor_people[0] && seed.floor_people[0].person_id, fx: createFixture({ mode, distDir: dist(), now: NOW, ...over, seed }) };
};
const allTables = (fx) => JSON.stringify(["app_data", "profiles", "floor_people", "deal_events", "queue_public", "floor_public"].map((t) => supa(fx, "GET", `/rest/v1/${t}?select=*`).json()));
const ERR = (code, message) => ({ code, message, details: "", hint: "" });
/* A FABRICATED expectation, not the consumer. It restates, from reading private-schedule.mjs by eye, which fields an
   answer must carry for the app to take it as the person's own: store, month and subject must match; "published" needs an
   explicit people entry; anything else well-formed is "unpublished"; a mismatch is "unavailable". Nothing here runs or
   imports the app's code, so a pass says the answer has the expected shape, not that the app accepted it. */
const appReads = (result, { store, month, person }) => {
  if (!result || result.store !== store || result.month !== month || result.subject !== person) return "unavailable";
  return result.state !== "published" ? "unpublished" : "published";
};

test("the own view answers unpublished for the linked person, the same in both modes, and nothing else", () => {
  const answers = [], shared = makeSeed(NOW);   // one seed for both modes: a fresh one would draw different person ids
  for (const mode of ["legacy", "compatible"]) {
    const { fx, me } = schedFx({ mode, over: { seed: shared } });
    const r = sched(fx, { p_store: "sage-demo", p_month: MONTH });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { state: "unpublished", store: "sage-demo", month: MONTH, subject: me });
    assert.deepEqual(Object.keys(r.json()), ["state", "store", "month", "subject"], "no publication fields, no people, no revision");
    assert.equal(r.headers["content-type"], "application/json"); assert.equal(r.headers["access-control-allow-origin"], "*");
    assert.equal(r.shape, "object-no-value-key");
    assert.deepEqual(sched(fx, { p_store: "sage-demo", p_month: MONTH, p_view: "own" }).json(), r.json());
    assert.deepEqual(JSON.parse(`{"p_store":"sage-demo","p_month":"${MONTH}"}`), { p_store: "sage-demo", p_month: MONTH }, "omitted means own");
    const explicitNull = sched(fx, { p_store: "sage-demo", p_month: MONTH, p_view: null });
    assert.equal(explicitNull.status, 400); assert.deepEqual(explicitNull.json(), ERR("22023", "invalid view"), "an explicit null is not the default");
    assert.equal(fx.report().unexpected, 1);
    for (let i = 0; i < 30; i++) assert.equal(sched(fx, { p_store: "sage-demo", p_month: MONTH }).text, r.text);   // the app polls every two seconds
    assert.equal(fx.report().unexpected, 1, "polling an answered contract is not unexpected (the one is the explicit-null refusal above)");
    assert.ok(fx.report().requests.some((e) => e.m === "POST" && e.c === "rpc:sage_schedule_read" && e.s === 200 && e.n === 32));
    answers.push(r.text);
  }
  assert.equal(answers[0], answers[1], "legacy and compatible differ only in the config and store reads");
});

test("the answer has the shape the app is expected to need (a fabricated expectation; the consumer is not run)", () => {
  const { fx, me } = schedFx();
  const body = sched(fx, { p_store: "sage-demo", p_month: MONTH }).json();
  assert.equal(appReads(body, { store: "sage-demo", month: MONTH, person: me }), "unpublished", "never published, never days off");
  assert.equal(appReads(body, { store: "sage-demo", month: MONTH, person: "someone-else" }), "unavailable", "a different subject would not be accepted");
  assert.equal(appReads(body, { store: "other", month: MONTH, person: me }), "unavailable");
  assert.equal(appReads(body, { store: "sage-demo", month: "2000-01", person: me }), "unavailable");
  assert.equal(appReads([], { store: "sage-demo", month: MONTH, person: me }), "unavailable", "the ordinary mock's empty array is not an answer");
});

test("who is asking, approval, the arguments, the view and the link are checked in the source's order, with its messages", () => {
  const good = { p_store: "sage-demo", p_month: MONTH };
  const unp = (s) => { s.profiles.find((p) => p.id === USER).pending = true; };
  const cases = [
    ["no authorization (no signed-in user, so no profile)", {}, null, good, 403, ERR("42501", "active account required")],
    ["a wrong token", { authorization: "Bearer someone-else" }, null, good, 403, ERR("42501", "active account required")],
    ["a token without the scheme", { authorization: "mock-token" }, null, good, 403, ERR("42501", "active account required")],
    ["no profile", AUTH, (s) => { s.profiles.length = 0; }, good, 403, ERR("42501", "active account required")],
    ["active false", AUTH, (s) => { s.profiles.find((p) => p.id === USER).active = false; }, good, 403, ERR("42501", "active account required")],
    ["active null", AUTH, (s) => { s.profiles.find((p) => p.id === USER).active = null; }, good, 403, ERR("42501", "active account required")],
    ["active key missing", AUTH, (s) => { delete s.profiles.find((p) => p.id === USER).active; }, good, 403, ERR("42501", "active account required")],
    ["active the string true (it must be exactly true)", AUTH, (s) => { s.profiles.find((p) => p.id === USER).active = "true"; }, good, 403, ERR("42501", "active account required")],
    ["active the number 1", AUTH, (s) => { s.profiles.find((p) => p.id === USER).active = 1; }, good, 403, ERR("42501", "active account required")],
    ["pending", AUTH, unp, good, 403, ERR("42501", "approval required")],
    ["pending key absent (approval needs an explicit false)", AUTH, (s) => { delete s.profiles.find((p) => p.id === USER).pending; }, good, 403, ERR("42501", "approval required")],
    ["pending null", AUTH, (s) => { s.profiles.find((p) => p.id === USER).pending = null; }, good, 403, ERR("42501", "approval required")],
    ["unlinked", AUTH, (s) => { s.floor_people.length = 0; }, good, 403, ERR("42501", "not linked to this store")],
    ["linked to another store only", AUTH, (s) => { s.floor_people[0].store = "elsewhere"; }, good, 403, ERR("42501", "not linked to this store")],
    ["linked to someone else's account only", AUTH, (s) => { s.floor_people[0].user_id = "00000000-0000-4000-8000-0000000000b2"; }, good, 403, ERR("42501", "not linked to this store")],
    ["a store the link is not for", AUTH, null, { p_store: "other-store", p_month: MONTH }, 403, ERR("42501", "not linked to this store")],
    ["store missing", AUTH, null, { p_month: MONTH }, 400, ERR("22023", "store and month required")],
    ["store not a string", AUTH, null, { p_store: 5, p_month: MONTH }, 400, ERR("22023", "store and month required")],
    ["store with a bad character", AUTH, null, { p_store: "bad store!", p_month: MONTH }, 400, ERR("22023", "store and month required")],
    ["store of 65 characters", AUTH, null, { p_store: "a".repeat(65), p_month: MONTH }, 400, ERR("22023", "store and month required")],
    ["store empty", AUTH, null, { p_store: "", p_month: MONTH }, 400, ERR("22023", "store and month required")],
    ["month missing", AUTH, null, { p_store: "sage-demo" }, 400, ERR("22023", "store and month required")],
    ["month 13", AUTH, null, { p_store: "sage-demo", p_month: "2031-13" }, 400, ERR("22023", "store and month required")],
    ["month 00", AUTH, null, { p_store: "sage-demo", p_month: "2031-00" }, 400, ERR("22023", "store and month required")],
    ["month one digit", AUTH, null, { p_store: "sage-demo", p_month: "2031-2" }, 400, ERR("22023", "store and month required")],
    ["month with a day", AUTH, null, { p_store: "sage-demo", p_month: "2031-02-01" }, 400, ERR("22023", "store and month required")],
    ["month a number", AUTH, null, { p_store: "sage-demo", p_month: 203102 }, 400, ERR("22023", "store and month required")],
    ["an unknown view", AUTH, null, { ...good, p_view: "all" }, 400, ERR("22023", "invalid view")],
    ["an empty view", AUTH, null, { ...good, p_view: "" }, 400, ERR("22023", "invalid view")],
    ["an explicit null view", AUTH, null, { ...good, p_view: null }, 400, ERR("22023", "invalid view")],
    ["a view that is a number", AUTH, null, { ...good, p_view: 5 }, 400, ERR("22023", "invalid view")],
    ["an uppercase view", AUTH, null, { ...good, p_view: "OWN" }, 400, ERR("22023", "invalid view")],
    // order: the earlier check wins
    ["unauthenticated with bad arguments", {}, null, { p_store: "bad store!" }, 403, ERR("42501", "active account required")],
    ["inactive beats pending", AUTH, (s) => { const p = s.profiles.find((x) => x.id === USER); p.active = false; p.pending = true; }, good, 403, ERR("42501", "active account required")],
    ["inactive beats bad arguments", AUTH, (s) => { s.profiles.find((p) => p.id === USER).active = false; }, { p_store: "bad store!" }, 403, ERR("42501", "active account required")],
    ["inactive beats an invalid view", AUTH, (s) => { s.profiles.find((p) => p.id === USER).active = false; }, { ...good, p_view: null }, 403, ERR("42501", "active account required")],
    ["pending beats an invalid view", AUTH, unp, { ...good, p_view: null }, 403, ERR("42501", "approval required")],
    ["an explicit null view with no link (the view is checked before the link)", AUTH, (s) => { s.floor_people.length = 0; }, { ...good, p_view: null }, 400, ERR("22023", "invalid view")],
    ["pending with bad arguments", AUTH, unp, { p_store: "bad store!" }, 403, ERR("42501", "approval required")],
    ["bad view with no link", AUTH, (s) => { s.floor_people.length = 0; }, { ...good, p_view: "all" }, 400, ERR("22023", "invalid view")],
    ["bad arguments with no link", AUTH, (s) => { s.floor_people.length = 0; }, { p_store: "sage-demo" }, 400, ERR("22023", "store and month required")],
  ];
  for (const [name, headers, edit, body, status, error] of cases) {
    const { fx } = schedFx({ edit });
    const before = allTables(fx), u = fx.report().unexpected;
    const r = sched(fx, body, headers);
    assert.equal(r.status, status, name); assert.deepEqual(r.json(), error, name);
    assert.equal(r.headers["content-type"], "application/json", name);
    assert.equal(allTables(fx), before, name + ": no mutation");
    assert.equal(fx.report().unexpected, u + 1, name + ": counted against the run");
  }
});

test("a store id in any case is accepted by the source's pattern, and so is an uppercase view-free call", () => {
  const { fx } = schedFx({ edit: (s) => { s.floor_people[0].store = "Sage-Demo"; } });
  const r = sched(fx, { p_store: "Sage-Demo", p_month: MONTH });
  assert.equal(r.status, 200); assert.equal(r.json().store, "Sage-Demo");
});

test("no manager grant and no publication: the manager view and everything outside the three arguments stay counted 501", () => {
  for (const role of ["associate", "manager", "admin"]) {
    const { fx, me } = schedFx({ edit: (s) => { s.profiles.find((p) => p.id === USER).role = role; } });
    assert.equal(sched(fx, { p_store: "sage-demo", p_month: MONTH, p_view: "manager" }).status, 501, role + " does not get a manager view");
    assert.equal(sched(fx, { p_store: "sage-demo", p_month: MONTH }).json().subject, me, role + " still gets its own, unpublished");
    assert.equal(sched(fx, { p_store: "sage-demo", p_month: MONTH }).json().state, "unpublished");
    assert.equal(fx.report().unexpected, 1);
  }
  const { fx } = schedFx();
  const before = allTables(fx);
  let n = 0;
  for (const body of [{ p_store: "sage-demo", p_month: MONTH, p_extra: 1 }, { p_store: "sage-demo", p_month: MONTH, p_person: "x" }, [], "text", 7, null, true]) {
    assert.equal(sched(fx, body).status, 501, JSON.stringify(body)); n++;
  }
  assert.equal(supa(fx, "POST", "/rest/v1/rpc/sage_schedule_read", { body: "not json", headers: AUTH }).status, 501); n++;
  assert.equal(supa(fx, "POST", "/rest/v1/rpc/sage_schedule_read", { body: "", headers: AUTH }).status, 501); n++;
  assert.equal(supa(fx, "GET", "/rest/v1/rpc/sage_schedule_read", { headers: AUTH }).status, 501); n++;
  assert.equal(supa(fx, "POST", "/rest/v1/rpc/sage_schedule_read", { body: "x".repeat(262145), headers: AUTH }).status, 413); n++;
  assert.equal(supa(fx, "POST", "/rest/v1/rpc/sage_schedule_publish", { body: { p_store: "sage-demo" }, headers: AUTH }).status, 501); n++;
  assert.equal(fx.report().unexpected, n);
  assert.equal(allTables(fx), before);
});

test("the schedule read works whatever the room API and seed settings are, and a bound seed does not change it", () => {
  const seed = makeSeed(NOW), d = dist();
  const cells = [{ apiOff: true }, { apiOff: true, normalizeSeedIdentity: true }, { normalizeSeedIdentity: true }, {}];
  const texts = cells.map((over) => sched(createFixture({ mode: "compatible", distDir: d, now: NOW, seed, ...over }), { p_store: "sage-demo", p_month: MONTH }).text);
  assert.equal(new Set(texts).size, 1, "API off, API on, normalised or not: the same bytes");
  assert.equal(JSON.parse(texts[0]).state, "unpublished");
});

test("the report names the schedule read as its own class and the refused ones as unexpected", () => {
  const { fx } = schedFx();
  sched(fx, { p_store: "sage-demo", p_month: MONTH }); sched(fx, { p_store: "bad store!", p_month: MONTH }); sched(fx, {}, {});
  const r = fx.report();
  assert.ok(r.requests.some((e) => e.c === "rpc:sage_schedule_read" && e.s === 200 && e.n === 1));
  assert.ok(r.requests.some((e) => e.c === "rpc:sage_schedule_read" && e.s === 400 && e.n === 1));
  assert.ok(r.requests.some((e) => e.c === "rpc:sage_schedule_read" && e.s === 403 && e.n === 1));
  assert.deepEqual(r.unexpectedByClass, [{ c: "rpc:sage_schedule_read", n: 2 }]);
  assert.ok(validateFixtureReport(r));
  const text = JSON.stringify(r);
  for (const leak of ["bad store", "mock-token", "someone", MONTH, "sage-demo"]) assert.ok(!text.includes(leak), leak);
});


/* ---- the separate manager actor ---- */
const MGR = { authorization: "Bearer mock-manager-token" };
const mgrFx = (over = {}, edit) => {
  const seed = makeSeed(NOW, { managerActor: true });
  if (edit) edit(seed);
  return { seed, fx: createFixture({ mode: "compatible", distDir: dist(), now: NOW, seed, requireManagerActor: true, ...over }) };
};
const grant = (fx, body, qs = "password") => supa(fx, "POST", `/auth/v1/token?grant_type=${qs}`, { body });
const row = (fx, headers, extra = {}) => app(fx, "POST", "/api/floor-row", { body: { op: "read", store: "sage-demo", date: DAY, room: "floor", ...extra }, headers });
const seedDay = (fx, data) => supa(fx, "POST", "/rest/v1/floor_public", { body: { id: `sage-demo:${DAY}`, store: "sage-demo", fdate: DAY, data }, headers: { prefer: "resolution=merge-duplicates" } });

test("both cells start from one seed that holds both actors, and the manifest says so before anything starts", () => {
  const seed = makeSeed(NOW, { managerActor: true }), d = dist();
  const a = createFixture({ mode: "legacy", distDir: d, now: NOW, seed, requireManagerActor: true });
  const b = createFixture({ mode: "compatible", distDir: d, now: NOW, seed, requireManagerActor: true, apiOff: true });
  assert.equal(a.actorManifest.sha256, b.actorManifest.sha256);
  assert.match(a.actorManifest.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(a.actorManifest.actors.map((x) => x.role).sort(), ["associate", "manager"]);
  const mgr = a.actorManifest.actors.find((x) => x.id === MANAGER_ID);
  assert.equal(mgr.email, MANAGER_EMAIL); assert.equal(mgr.active, true); assert.equal(mgr.pending, false); assert.deepEqual(mgr.stores, ["sage-demo"]); assert.deepEqual(mgr.linked, [], "a distinct subject, linked to no person");
  assert.ok(!JSON.stringify(a.actorManifest).includes("mock-"), "no token is in the manifest");
  const plain = createFixture({ mode: "compatible", distDir: d, now: NOW, seed: makeSeed(NOW) });
  assert.notEqual(plain.actorManifest.sha256, a.actorManifest.sha256, "a seed without the manager is a different manifest");
  assert.throws(() => createFixture({ mode: "compatible", distDir: d, now: NOW, seed: makeSeed(NOW), requireManagerActor: true }), /approved manager/);
  for (const edit of [(s) => { s.profiles.find((p) => p.id === MANAGER_ID).pending = true; }, (s) => { s.profiles.find((p) => p.id === MANAGER_ID).active = false; },
    (s) => { s.profiles.find((p) => p.id === MANAGER_ID).stores = []; }, (s) => { s.profiles.find((p) => p.id === MANAGER_ID).role = "associate"; }]) {
    assert.throws(() => mgrFx({}, edit), /approved manager/);
  }
});

test("the seed file carries both actors from the start, is hashed once, and is never amended", () => {
  const dir = kept("seed-mgr-"), file = path.join(dir, "seed.json");
  const first = loadOrCreateSeed(file, { now: NOW, managerActor: true });
  assert.equal(first.created, true);
  assert.ok(first.seed.profiles.some((p) => p.id === MANAGER_ID && p.role === "manager"));
  const bytes = fs.readFileSync(file, "utf8");
  assert.equal(loadOrCreateSeed(file, { sha256: first.sha256, managerActor: true }).sha256, first.sha256);
  const other = path.join(dir, "assoc.json"); loadOrCreateSeed(other, { now: NOW });
  assert.throws(() => loadOrCreateSeed(other, { managerActor: true }), /manager/, "an existing file without the manager is refused, not appended to");
  assert.equal(fs.readFileSync(file, "utf8"), bytes);
  assert.ok(!fs.readFileSync(other, "utf8").includes(MANAGER_ID), "and the other file was not amended");
});

test("sign-in picks the actor by the fictional credential it is given, and the session is that actor's", () => {
  const { fx } = mgrFx();
  const m = grant(fx, { email: MANAGER_EMAIL, password: "x" }).json();
  assert.equal(m.user.id, MANAGER_ID); assert.equal(m.access_token, "mock-manager-token"); assert.equal(m.refresh_token, "mock-manager-refresh");
  const a = grant(fx, { email: "demo@sageonline.app", password: "x" }).json();
  assert.equal(a.user.id, USER); assert.equal(a.access_token, "mock-token");
  assert.equal(grant(fx, { email: "Manager.Demo@SageOnline.app", password: "x" }).json().user.id, MANAGER_ID, "email case does not matter");
  assert.equal(grant(fx, { email: "someone@else.test", password: "x" }).json().user.id, USER, "an unknown email is the associate, as before");
  assert.equal(grant(fx, "not json").json().user.id, USER);
  assert.equal(grant(fx, { refresh_token: "mock-manager-refresh" }, "refresh_token").json().user.id, MANAGER_ID);
  assert.equal(grant(fx, { refresh_token: "mock-refresh" }, "refresh_token").json().user.id, USER);
  assert.equal(supa(fx, "GET", "/auth/v1/user", { headers: MGR }).json().id, MANAGER_ID);
  assert.equal(supa(fx, "GET", "/auth/v1/user", { headers: AUTH }).json().id, USER);
  assert.equal(supa(fx, "GET", "/auth/v1/user").json().id, USER, "no bearer is the associate, as before");
  assert.equal(fx.report().unexpected, 0);
  /* a seed whose manager profile is gone gives the manager no session, and it counts */
  const edited = mgrFx({ requireManagerActor: false }, (s) => { s.profiles = s.profiles.filter((p) => p.id !== MANAGER_ID); });
  const none = grant(edited.fx, { email: MANAGER_EMAIL, password: "x" });
  assert.equal(none.status, 400); assert.equal(none.json().error, "invalid_grant");
  assert.equal(edited.fx.report().unexpected, 1);
});

test("a manager's profile read is the backend's own: approved, active, assigned, and not the associate's", () => {
  const { fx } = mgrFx();
  const mine = supa(fx, "GET", `/rest/v1/profiles?id=eq.${MANAGER_ID}&select=*`, { headers: MGR }).json();
  assert.equal(mine.length, 1);
  assert.deepEqual([mine[0].role, mine[0].active, mine[0].pending, mine[0].stores], ["manager", true, false, ["sage-demo"]]);
  const theirs = supa(fx, "GET", `/rest/v1/profiles?id=eq.${USER}&select=*`, { headers: AUTH }).json();
  assert.equal(theirs[0].role, "associate", "the associate was not elevated");
  assert.equal(supa(fx, "GET", "/rest/v1/profiles?select=*").json().filter((p) => p.role === "manager").length, 1);
  assert.equal(fx.report().unexpected, 0);
});

test("floor-row: the associate's manager view is the real 403 and stays counted; the manager's is the unprojected row with its own stamp", () => {
  const { fx } = mgrFx();
  assert.equal(seedDay(fx, { line: [{ id: "a", status: "waiting", private: "p" }] }).status, 201);
  const denied = row(fx, AUTH, { view: "manager" });
  assert.equal(denied.status, 403); assert.deepEqual(denied.json(), { error: "Approved store management required" });
  assert.equal(fx.report().unexpected, 1, "the associate's denial is a counted refusal");
  assert.ok(fx.report().requests.some((r) => r.c === "api:floor-row" && r.s === 403 && r.n === 1));
  const own = row(fx, AUTH, { view: "own" }).json();
  assert.match(own.stamp, new RegExp(`^own:${USER}:`));
  const ok = row(fx, MGR, { view: "manager" });
  assert.equal(ok.status, 200);
  const doc = ok.json();
  assert.deepEqual(doc.row, { line: [{ id: "a", status: "waiting", private: "p" }] }, "the manager sees the row as it is");
  assert.match(doc.stamp, new RegExp(`^manager:${MANAGER_ID}:none:\\d{4}-`));
  assert.deepEqual(row(fx, MGR, { view: "manager", stamp: doc.stamp }).json(), { same: true, stamp: doc.stamp });
  assert.notEqual(row(fx, MGR, { view: "own" }).json().stamp, doc.stamp, "own and manager stamps are different things");
  assert.equal(fx.report().unexpected, 1, "the manager's reads add nothing");
  assert.equal(row(fx, MGR, { view: "all" }).status, 400);
  assert.deepEqual(row(fx, MGR, { view: "all" }).json(), { error: "Unknown room view" });
  assert.equal(row(fx, MGR, { view: null }).status, 400);
  assert.equal(fx.report().unexpected, 4, "the denial, the unknown view asked twice, and null");
  assert.equal(row(fx, { authorization: "Bearer mock-manager-tokenX" }, { view: "manager" }).status, 401);
  assert.equal(row(fx, { authorization: "mock-manager-token" }, { view: "manager" }).status, 401, "the scheme is required");
  assert.equal(row(fx, MGR, { view: "manager", op: "wallkey" }).status, 501, "no wall key for anyone");
  assert.equal(row(fx, MGR, { view: "manager", store: "other-store" }).status, 501);
});

test("floor-row: only an approved manager of this store, or an admin, gets the manager view", () => {
  const cases = [
    ["approved manager", (p) => p, 200], ["admin", (p) => { p.role = "admin"; p.stores = []; }, 200],
    ["pending manager", (p) => { p.pending = true; }, 403], ["inactive manager", (p) => { p.active = false; }, 403],
    ["manager of another store", (p) => { p.stores = ["elsewhere"]; }, 403], ["manager with no store", (p) => { p.stores = []; }, 403], ["associate role", (p) => { p.role = "associate"; }, 403],
  ];
  for (const [name, edit, status] of cases) {
    const { fx } = mgrFx({ requireManagerActor: false }, (s) => edit(s.profiles.find((p) => p.id === MANAGER_ID)));
    seedDay(fx, { line: [] });
    assert.equal(row(fx, MGR, { view: "manager" }).status, status, name);
    assert.equal(fx.report().unexpected, status === 200 ? 0 : 1, name);
  }
});

test("the manager has no line of their own: the schedule own view and the room command are refused, and the associate's still work", () => {
  const { fx } = mgrFx();
  const call = (headers, args) => supa(fx, "POST", "/rest/v1/rpc/sage_schedule_read", { body: args, headers });
  const r = call(MGR, { p_store: "sage-demo", p_month: "2031-02" });
  assert.equal(r.status, 403); assert.equal(r.json().message, "not linked to this store");
  assert.equal(call(AUTH, { p_store: "sage-demo", p_month: "2031-02" }).status, 200);
  assert.equal(call(MGR, { p_store: "sage-demo", p_month: "2031-02", p_view: "manager" }).status, 501, "no manager schedule, as before");
  assert.equal(fx.report().unexpected, 2);
});

roomTest("the manager cannot command the floor as a salesperson, a replay is per actor, and an inactive manager is out at the staff gate", () => {
  const { fx, me } = roomFx({ edit: (s) => { const m = makeSeed(NOW, { managerActor: true }).profiles.find((p) => p.id === MANAGER_ID); s.profiles.push(m); } });
  putFloor(fx, baseRow(me));
  const denied = cmd(fx, { action: "status", input: { status: "lunch" } }, MGR);
  assert.equal(denied.status, 403); assert.deepEqual(denied.json(), { error: "Not linked to this store" });
  assert.equal(mine(fx, me).status, "waiting", "nothing changed");
  assert.equal(cmd(fx, { action: "status", input: { status: "lunch" } }).status, 200, "the associate's own command is unaffected");
  const edited = roomFx({ edit: (s) => { const m = makeSeed(NOW, { managerActor: true }).profiles.find((p) => p.id === MANAGER_ID); m.active = false; s.profiles.push(m); } });
  putFloor(edited.fx, baseRow(edited.me));
  const gone = floorRow(edited.fx, MGR, { view: "own" });
  assert.equal(gone.status, 403); assert.deepEqual(gone.json(), { error: "not one of your stores" });
});
const floorRow = (fx, headers, extra = {}) => app(fx, "POST", "/api/floor-row", { body: { op: "read", store: "sage-demo", date: TODAY, room: "floor", ...extra }, headers });

roomTest("the manager's own view is projected like anyone's; the manager view is not", () => {
  const { fx, me } = roomFx({ edit: (s) => { s.profiles.push(makeSeed(NOW, { managerActor: true }).profiles.find((p) => p.id === MANAGER_ID)); } });
  putFloor(fx, baseRow(me));
  const own = floorRow(fx, MGR, { view: "own" }).json();
  assert.ok(!JSON.stringify(own.row).includes("not-for-staff"), "own view hides what staff may not see");
  assert.equal(floorRow(fx, MGR, { view: "manager" }).json().row.secretField, "not-for-staff");
  assert.equal(floorRow(fx, AUTH, { view: "manager" }).status, 403);
  assert.equal(fx.report().unexpected, 1);
});

test("realtime: the exact handshake is answered unavailable, counted as expected, and visible", () => {
  const { fx } = mgrFx();
  const hs = (extra = {}) => supa(fx, "GET", "/realtime/v1/websocket?apikey=SECRETKEY&vsn=1.0.0", { headers: { upgrade: "websocket", connection: "Upgrade", ...extra } });
  const r = hs();
  assert.equal(r.status, 503); assert.deepEqual(r.json(), { message: "realtime is not available in this fixture" });
  assert.ok(!r.text.includes("SECRETKEY"), "the query is not echoed");
  assert.equal(hs({ upgrade: "WebSocket" }).status, 503, "the value is compared without case");
  const rep = fx.report();
  assert.equal(rep.unexpected, 0);
  assert.ok(rep.requests.some((e) => e.m === "GET" && e.c === "static" && e.s === 503 && e.n === 2), "it stays in the requests table");
  assert.ok(validateFixtureReport(rep));
  assert.ok(!JSON.stringify(rep).includes("SECRETKEY"));
  const doc = app(fx, "GET", "/__fixture/expected").json();
  assert.deepEqual(doc, { schema: 1, kind: "fixture-expected", counters: { "realtime-handshake-unavailable": 2 } });
  assert.deepEqual(fx.expected().counters, doc.counters);
  assert.deepEqual(fx.report(), rep, "reading the counters is not itself counted");
});

test("realtime: nothing but the exact handshake is excused", () => {
  const { fx } = mgrFx();
  const U = { upgrade: "websocket" };
  const cases = [
    ["no upgrade header", supa(fx, "GET", "/realtime/v1/websocket?vsn=1")], ["upgrade h2c", supa(fx, "GET", "/realtime/v1/websocket", { headers: { upgrade: "h2c" } })],
    ["empty upgrade", supa(fx, "GET", "/realtime/v1/websocket", { headers: { upgrade: "" } })],
    ["POST", supa(fx, "POST", "/realtime/v1/websocket", { headers: U, body: "{}" })], ["HEAD", supa(fx, "HEAD", "/realtime/v1/websocket", { headers: U })],
    ["PUT", supa(fx, "PUT", "/realtime/v1/websocket", { headers: U })],
    ["sub path", supa(fx, "GET", "/realtime/v1/websocket/x", { headers: U })], ["trailing slash", supa(fx, "GET", "/realtime/v1/websocket/", { headers: U })],
    ["other realtime path", supa(fx, "GET", "/realtime/v1/", { headers: U })], ["api path", supa(fx, "GET", "/realtime/v1/api/broadcast", { headers: U })],
    ["upper-case path", supa(fx, "GET", "/Realtime/v1/websocket", { headers: U })], ["version 2", supa(fx, "GET", "/realtime/v2/websocket", { headers: U })],
  ];
  for (const [name, c] of cases) assert.equal(c.status, 501, name);
  assert.equal(fx.report().unexpected, cases.length, "each one counts against the run");
  assert.equal(supa(fx, "GET", "/realtime/v1/websocket", { headers: U, host: "127.0.0.1:5999" }).status, 421);
  assert.equal(supa(fx, "GET", "/realtime/v1/websocket", { headers: U, host: "evil.example:5433" }).status, 421);
  assert.deepEqual(app(fx, "GET", "/__fixture/expected").json().counters, { "realtime-handshake-unavailable": 0 }, "none of those was counted as expected");
  /* the app origin never answers it: a route with no extension is the app's own page */
  const onApp = app(fx, "GET", "/realtime/v1/websocket", { headers: U });
  assert.notEqual(onApp.status, 503); assert.ok(!onApp.text.includes("realtime is not available"));
  assert.equal(app(fx, "GET", "/__fixture/expected").json().counters["realtime-handshake-unavailable"], 0);
  /* the counter on the supabase origin does not exist as an endpoint */
  assert.equal(supa(fx, "GET", "/__fixture/expected").status, 501);
});

test("the 43-request scenario ends clean with the expected rows visible, and one unrelated refusal still makes it fail", () => {
  const { fx } = mgrFx();
  const U = { upgrade: "websocket" };
  seedDay(fx, { line: [] });
  for (let i = 0; i < 16; i++) assert.equal(supa(fx, "GET", "/realtime/v1/websocket?vsn=1.0.0", { headers: U }).status, 503);
  for (let i = 0; i < 26; i++) assert.equal(supa(fx, "POST", "/rest/v1/rpc/sage_schedule_read", { body: { p_store: "sage-demo", p_month: "2031-02" }, headers: AUTH }).status, 200);
  assert.equal(row(fx, MGR, { view: "manager" }).status, 200);
  const rep = fx.report();
  assert.equal(rep.unexpected, 0);
  assert.ok(rep.requests.some((e) => e.c === "static" && e.s === 503 && e.n === 16));
  assert.ok(rep.requests.some((e) => e.c === "rpc:sage_schedule_read" && e.s === 200 && e.n === 26));
  assert.ok(rep.requests.some((e) => e.c === "api:floor-row" && e.s === 200));
  assert.equal(supa(fx, "GET", "/somewhere/else").status, 501);
  assert.equal(fx.report().unexpected, 1);
  assert.equal(app(fx, "GET", "/__fixture/expected").json().counters["realtime-handshake-unavailable"], 16);
});

test("the manager phone-search helper: genuine login in fixture mode, no role rewrite, every check kept, the old path kept for the ordinary mock", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../scripts/manager-phone-search.mjs", import.meta.url)), "utf8");
  const fixturePart = src.slice(src.indexOf("if (genuine) {"));
  assert.ok(src.includes('process.env.FEEL_MANAGER_ACTOR === "fixture"'));
  assert.equal((src.match(/route\.fulfill/g) || []).length, 1, "the one rewrite is in the legacy branch");
  const legacy = src.slice(src.indexOf("if (!genuine) {"), src.indexOf("page = await context.newPage();"));
  assert.ok(legacy.includes("route.fulfill") && legacy.includes('role: "manager"'), "the ordinary-mock path is unchanged");
  assert.ok(!src.slice(src.indexOf("page = await context.newPage();")).includes("route.fulfill"), "nothing after the legacy branch rewrites a response");
  assert.ok(src.includes('FIXTURE_MANAGER_EMAIL = "manager.demo@sageonline.app"') && MANAGER_EMAIL === "manager.demo@sageonline.app", "the helper and the fixture name the same fictional account");
  assert.ok(/genuine \? FIXTURE_MANAGER_EMAIL : "demo@sageonline\.app"/.test(src));
  assert.ok(src.includes('p.role === "manager" && p.active === true && p.pending === false') && src.includes("managerReads > 0"), "a genuine read of an approved manager is asserted");
  for (const kept of ['for (const width of [390, 720, 760])', 'assert.equal(await page.locator(".bp-stand .fr-empty").textContent(), "Nobody here.")', 'assert.deepEqual(errors, [], "manager page has no uncaught errors")',
    'assert.equal(await field.isVisible(), false, "print still hides search")', 'assert.deepEqual(await names.allTextContents(), baseline, "clear restores the same ordered rows")',
    'assert.ok(display.tabs.every((value) => value === "none"), "no duplicate desktop tabs")', 'assert.ok(baseline.length > 1, "fixture must contain multiple people")', 'serviceWorkers: "block"']) assert.ok(src.includes(kept), kept);
  assert.ok(!/localStorage|setExtraHTTPHeaders|addInitScript|page\.route|setRole/.test(src), "no other way to impersonate");
});
