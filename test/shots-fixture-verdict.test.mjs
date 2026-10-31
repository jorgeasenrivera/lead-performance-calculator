/* The candidate-branch verdict, lifecycle script and workflow text, on fabricated and in-process documents.
   No listener, no browser. The only processes started are the script under test and a stand-in that sleeps. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFixture, makeSeed } from "../scripts/shots-fixture.mjs";
import { judge, receipt, headline, portState, listenerProblems, adapterProblems, adapterEvidenceProblems, toolchainProblems, outsidePins, ADAPTER_SHA256, ADAPTER5_SHA256, KIT_SHA256, KIT_BASELINE_SHA256, STRICT_PINS } from "../scripts/shots-fixture-verdict.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = path.join(ROOT, "scripts/shots-fixture-verdict.mjs"), SH = path.join(ROOT, "scripts/ci-fixture.sh");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dist = () => { const d = tmp("verdict-dist-"); fs.writeFileSync(path.join(d, "index.html"), "<title>x</title>"); return d; };
const H = (c) => c.repeat(64);

/* A run as the pipeline would see it: seed file on disk, pins worked out outside, fixture built from the same seed, a few requests made. */
function scene(over = {}) {
  const dir = tmp("verdict-run-"), d = dist(), seed = makeSeed(Date.now(), { managerActor: true });
  fs.writeFileSync(path.join(dir, "seed.json"), JSON.stringify(seed));
  const pins = outsidePins(dir, d);
  const fx = createFixture({ mode: "compatible", distDir: d, seed, requireManagerActor: true, normalizeSeedIdentity: true });
  for (let i = 0; i < 3; i++) fx.respond("supabase", { method: "GET", url: "/realtime/v1/websocket?x=1", headers: { host: "127.0.0.1:5433", upgrade: "websocket" }, body: "" });
  fx.respond("app", { method: "GET", url: "/", headers: { host: "127.0.0.1:5178" }, body: "" });
  over.after && over.after(fx);
  const report = fx.report();
  const start = { fixture: true, pid: 1, mode: "compatible", api: "on", normalizeSeedIdentity: true, managerActor: true, actorManifestSha256: fx.actorManifest.sha256,
    seedRowsSha256: fx.seedBinding.rowsSha256, seedFileSha256: pins.seedFileSha256, dist: fx.dist };
  return { dir, d, fx, pins, start, report, expected: fx.expected() };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

test("a clean run is judged clean, against pins the verdict worked out itself, and the receipt is only enums, counts and hashes", () => {
  const r = scene();
  assert.deepEqual(judge(r), []);
  const doc = receipt({ ...r, engine: "chromium", env: { GITHUB_SHA: "a".repeat(40) } });
  assert.equal(doc.unexpected, 0); assert.deepEqual(doc.expected, { "realtime-handshake-unavailable": 3 }); assert.equal(doc.clock, "system");
  for (const k of ["projection"]) assert.equal(doc[k], "synthetic");
  for (const k of ["privacyAcceptance", "realtimeQualification", "slowLinkAcceptance", "performanceAcceptance", "apiLagged"]) assert.equal(doc[k], false, k);
  const text = JSON.stringify(doc);
  for (const leak of ["mock-token", "mock-manager", "demo@", "manager.demo", "Bearer", "x=1"]) assert.ok(!text.includes(leak), leak);
});

test("every binding is required: a missing or malformed one is a named problem, and a start line cannot vouch for itself", () => {
  const ok = scene();
  const without = (k) => { const s = clone(ok.start); delete s[k]; return { ...ok, start: s }; };
  const cases = [
    ["no start", { ...ok, start: null }, /start line/], ["no start.dist", without("dist"), /start\.dist/],
    ["malformed start.dist", { ...ok, start: { ...ok.start, dist: { files: "1", bytes: 1, sha256: "x" } } }, /start\.dist/],
    ["no mode", without("mode"), /mode was not compatible/], ["legacy mode", { ...ok, start: { ...ok.start, mode: "legacy" } }, /mode was not compatible/],
    ["no seed rows hash", without("seedRowsSha256"), /seed rows hash missing/], ["no seed hash", without("seedFileSha256"), /seed hash missing/], ["no manifest", without("actorManifestSha256"), /actor manifest hash missing/],
    ["api off", { ...ok, start: { ...ok.start, api: "off" } }, /API was not on/], ["no manager", { ...ok, start: { ...ok.start, managerActor: false } }, /manager actor/],
    ["no normalising", { ...ok, start: { ...ok.start, normalizeSeedIdentity: false } }, /normalised/],
    ["no pins at all", { ...ok, pins: null }, /outside seed pin missing/], ["one pin missing", { ...ok, pins: { ...ok.pins, distSha256: undefined } }, /outside dist pin missing/],
    ["malformed pin", { ...ok, pins: { ...ok.pins, seedRowsSha256: "short" } }, /outside seed rows pin missing/],
    ["seed differs from pin", { ...ok, pins: { ...ok.pins, seedFileSha256: H("1") } }, /seed hash differs/], ["dist differs from pin", { ...ok, pins: { ...ok.pins, distSha256: H("2") } }, /dist hash differs/],
    ["actors differ from pin", { ...ok, pins: { ...ok.pins, actorManifestSha256: H("3") } }, /actor manifest differs/], ["rows differ from pin", { ...ok, pins: { ...ok.pins, seedRowsSha256: H("4") } }, /seed rows hash differs/],
    ["no report", { ...ok, report: null }, /report missing/], ["bad report", { ...ok, report: { schema: 1 } }, /invalid/],
    ["dropped", { ...ok, report: { ...clone(ok.report), dropped: 1 } }, /dropped/], ["start and report dist differ", { ...ok, report: { ...clone(ok.report), dist: { ...ok.report.dist, sha256: H("5") } } }, /dist pin differs/],
    ["fresh seed", { ...ok, report: { ...clone(ok.report), seed: "fresh" } }, /shared seed/],
    ["no counters", { ...ok, expected: null }, /expected counters/], ["unknown counter", { ...ok, expected: { schema: 1, kind: "fixture-expected", counters: { "realtime-handshake-unavailable": 3, other: 1 } } }, /expected counters/],
    ["counter and rows disagree", { ...ok, expected: { schema: 1, kind: "fixture-expected", counters: { "realtime-handshake-unavailable": 4 } } }, /disagree/],
    ["float counter", { ...ok, expected: { schema: 1, kind: "fixture-expected", counters: { "realtime-handshake-unavailable": 1.5 } } }, /expected counters/],
  ];
  for (const [name, input, re] of cases) assert.ok(judge(input).some((p) => re.test(p)), `${name}: ${judge(input)}`);
  const bad = scene({ after: (fx) => fx.respond("supabase", { method: "GET", url: "/somewhere", headers: { host: "127.0.0.1:5433" }, body: "" }) });
  assert.deepEqual(judge(bad), ["unexpected requests: 1"]);
});

test("the pins are recomputed from files: a changed seed file or dist changes them", () => {
  const r = scene();
  assert.deepEqual(outsidePins(r.dir, r.d), r.pins);
  fs.appendFileSync(path.join(r.d, "index.html"), " ");
  assert.notEqual(outsidePins(r.dir, r.d).distSha256, r.pins.distSha256);
  const seed = JSON.parse(fs.readFileSync(path.join(r.dir, "seed.json"), "utf8")); seed.profiles = seed.profiles.filter((p) => p.role !== "manager");
  fs.writeFileSync(path.join(r.dir, "seed.json"), JSON.stringify(seed));
  assert.throws(() => outsidePins(r.dir, r.d), /approved manager/, "a seed without the manager has no pins");
});

test("the receipt copies nothing that did not pass a check, even from a hostile start line or an invalid report", () => {
  const r = scene();
  const hostile = { ...r.start, seedFileSha256: "Bearer mock-token", actorManifestSha256: "demo@sageonline.app", dist: { files: "many", bytes: -1, sha256: "../../etc/passwd" }, mode: "x\ny", api: "Bearer z", extra: "mock-manager-token" };
  const doc = receipt({ start: hostile, report: { schema: 1, requests: [{ m: "GET", c: "static", s: 200, n: 1, body: "secret" }], leak: "mock-token" }, expected: { kind: "fixture-expected", counters: { "realtime-handshake-unavailable": "9" } }, pins: { seedFileSha256: "oops" }, engine: "chromium; rm", problems: ["a".repeat(500), 5, null] });
  const text = JSON.stringify(doc);
  for (const leak of ["Bearer", "mock-", "demo@", "etc/passwd", "secret", "chromium; rm", "x\\ny"]) assert.ok(!text.includes(leak), leak);
  assert.deepEqual(doc.requests, []); assert.equal(doc.unexpected, null); assert.equal(doc.expected, null); assert.equal(doc.dist.sha256, null); assert.equal(doc.engine, "unknown");
  assert.equal(doc.problems.length, 1); assert.equal(doc.problems[0].length, 120);
  const good = receipt({ ...r, engine: "webkit" });
  assert.ok(good.requests.every((q) => Object.keys(q).join() === "m,c,s,n"));
});

test("the pull request is never told the phone feels fine on a candidate run, and a failed verdict or stop is never a pass", () => {
  const base = { candidate: "1", feelOutcome: "success", code: "0", verdictOutcome: "success", stopOutcome: "success" };
  assert.equal(headline({ ...base, candidate: "0" }), null, "other branches keep their own text");
  const ok = headline(base);
  assert.match(ok, /Functional check passed/); assert.match(ok, /not the phone's performance reading/); assert.match(ok, /400 ms/);
  assert.ok(!/feels the same or better|every bar met/i.test(ok));
  for (const verdictOutcome of ["failure", "skipped", "cancelled", undefined, ""]) {
    const h = headline({ ...base, verdictOutcome });
    assert.match(h, /left its contract|proof is missing/); assert.match(h, /Not a pass/);
  }
  for (const stopOutcome of ["failure", "skipped", "cancelled", undefined, ""]) {
    const h = headline({ ...base, stopOutcome });
    assert.match(h, /could not be stopped cleanly/); assert.match(h, /Not a pass/); assert.ok(!/Functional check passed/.test(h), "a failed stop never announces a pass");
  }
  assert.match(headline({ ...base, feelOutcome: "failure", code: "3" }), /browser was lost/);
  assert.match(headline({ ...base, feelOutcome: "failure", code: "1" }), /bar was missed/);
});

test("ports: only a refused connection is free; a taken port, a timeout and any other error are not", async () => {
  const fake = (event, arg) => () => { const e = new EventEmitter(); e.destroy = () => {}; setImmediate(() => e.emit(event, arg)); return e; };
  assert.equal(await portState(1, fake("connect")), "taken");
  assert.equal(await portState(1, fake("error", Object.assign(new Error("x"), { code: "ECONNREFUSED" }))), "free");
  for (const code of ["EACCES", "EADDRNOTAVAIL", "ETIMEDOUT", "EHOSTUNREACH", undefined]) assert.equal(await portState(1, fake("error", Object.assign(new Error("x"), { code }))), "unknown", String(code));
  assert.equal(await portState(1, fake("timeout")), "unknown", "a hung connect is not a free port");
  assert.equal(await portState(1, () => { throw new Error("boom"); }), "unknown");
});
import { EventEmitter } from "node:events";
const require_events = () => ({ EventEmitter });

/* A made-up /proc: net/tcp lines and one process's descriptor table. Nothing is read from the real kernel. */
function fakeProc({ rows, fds, tcp6 = null, tcpAs = "file", tcp6As = null }) {
  const root = tmp("fakeproc-"), pid = 4242;
  fs.mkdirSync(path.join(root, "net"), { recursive: true }); fs.mkdirSync(path.join(root, String(pid), "fd"), { recursive: true });
  const line = (i, [addr, port, st, inode]) => `  ${i}: ${addr}:${port.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 ${st} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0`;
  const table = (rs) => ["  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode", ...rs.map((r, i) => line(i, r))].join("\n") + "\n";
  if (tcpAs === "file") fs.writeFileSync(path.join(root, "net", "tcp"), table(rows)); else if (tcpAs === "dir") fs.mkdirSync(path.join(root, "net", "tcp"));   // a directory reads as EISDIR; "absent" is ENOENT
  if (tcp6As === "dir") fs.mkdirSync(path.join(root, "net", "tcp6")); else if (tcp6) fs.writeFileSync(path.join(root, "net", "tcp6"), table(tcp6));
  fds.forEach((n, i) => fs.symlinkSync(`socket:[${n}]`, path.join(root, String(pid), "fd", String(i + 3))));
  return { root, pid };
}
test("listener ownership: the sockets on the two ports must be loopback and held by the owned process, from the kernel's tables", () => {
  const L = "0100007F";
  let p = fakeProc({ rows: [[L, 5433, "0A", 111], [L, 5178, "0A", 222]], fds: [111, 222, 999] });
  assert.deepEqual(listenerProblems([5433, 5178], p.pid, p.root), []);
  p = fakeProc({ rows: [[L, 5433, "0A", 111], [L, 5178, "0A", 222]], fds: [111] });
  assert.match(listenerProblems([5433, 5178], p.pid, p.root).join(), /5178 is held by a socket the fixture process does not own/);
  p = fakeProc({ rows: [[L, 5433, "0A", 111], [L, 5178, "0A", 222], [L, 5178, "0A", 333]], fds: [111, 222] });
  assert.match(listenerProblems([5433, 5178], p.pid, p.root).join(), /5178 is held by a socket/, "a second listener on the port, owned by someone else, is found");
  p = fakeProc({ rows: [[L, 5433, "0A", 111]], fds: [111] });
  assert.match(listenerProblems([5433, 5178], p.pid, p.root).join(), /nothing is listening on 5178/);
  p = fakeProc({ rows: [["00000000", 5433, "0A", 111], [L, 5178, "0A", 222]], fds: [111, 222] });
  assert.match(listenerProblems([5433, 5178], p.pid, p.root).join(), /5433 is listening beyond loopback/);
  p = fakeProc({ rows: [[L, 5433, "01", 111], [L, 5178, "0A", 222]], fds: [111, 222] });
  assert.match(listenerProblems([5433, 5178], p.pid, p.root).join(), /nothing is listening on 5433/, "an established connection is not a listener");
  p = fakeProc({ rows: [[L, 5433, "0A", 111]], fds: [111], tcp6: [["00000000000000000000000001000000", 5178, "0A", 222]] });
  assert.deepEqual(listenerProblems([5433, 5178], p.pid, p.root).filter((x) => /does not own/.test(x)), ["port 5178 is held by a socket the fixture process does not own"], "tcp6 is read");
  assert.deepEqual(listenerProblems([5433], 1, tmp("emptyproc-")), ["the kernel's tcp table could not be read"], "no tcp table at all");
  p = fakeProc({ rows: [[L, 5433, "0A", 111]], fds: [111] });
  assert.match(listenerProblems([5433], 999999, p.root).join(), /could not be read/, "a process whose descriptors cannot be read is not owned");
  /* tcp is required; tcp6 may be explicitly absent (ENOENT) and nothing else may be unreadable */
  p = fakeProc({ rows: [[L, 5433, "0A", 111], [L, 5178, "0A", 222]], fds: [111, 222] });
  assert.deepEqual(listenerProblems([5433, 5178], p.pid, p.root), [], "tcp6 absent is fine when tcp is readable");
  p = fakeProc({ rows: [[L, 5433, "0A", 111], [L, 5178, "0A", 222]], fds: [111, 222], tcp6As: "dir" });
  assert.deepEqual(listenerProblems([5433, 5178], p.pid, p.root), ["the kernel's tcp6 table could not be read"], "tcp6 present but unreadable (EISDIR here) fails closed");
  p = fakeProc({ rows: [[L, 5433, "0A", 111], [L, 5178, "0A", 222]], fds: [111, 222], tcp6: [], tcpAs: "dir" });
  assert.deepEqual(listenerProblems([5433, 5178], p.pid, p.root), ["the kernel's tcp table could not be read"], "tcp unreadable fails even when tcp6 is readable");
  p = fakeProc({ rows: [], fds: [111, 222], tcp6: [[L.replace("0100007F", "00000000000000000000000001000000"), 5433, "0A", 111], ["00000000000000000000000001000000", 5178, "0A", 222]], tcpAs: "absent" });
  assert.deepEqual(listenerProblems([5433, 5178], p.pid, p.root), ["the kernel's tcp table could not be read"], "tcp absent is not allowed, only tcp6");
});

/* The adapter's evidence as adapter5 writes it (field names read from its source), fabricated here. */
/* The adapter pushes { origin: new URL(url).origin, passedThrough: true } for each socket it lets through (index.mjs, the routeWebSocket handler). These are the URLs supabase-js's realtime client opens. */
const realWebsockets = () => ["ws://127.0.0.1:5433/realtime/v1/websocket?apikey=mock-anon-key&vsn=1.0.0", "ws://127.0.0.1:5433/realtime/v1/websocket?apikey=mock-anon-key&vsn=1.0.0"].map((url) => ({ origin: new URL(url).origin, passedThrough: true }));
const goodEvidence = (over = {}) => {
  const argv = ["/x/chrome", "--headless"], pins = STRICT_PINS;
  return { label: "candidate", kitSha256: H("c"), hook: false, pinsRequired: true, options: [], status: { bad: false, reasons: [], okAudits: 2 }, audits: [{ label: "first", ok: true }, { label: "final", ok: true }],
    evidence: { playwright: pins.STRICT_EXPECT_PLAYWRIGHT, version: pins.STRICT_EXPECT_CHROME, runAs: { user: "current", uid: 1001 }, browserProcess: { argv }, cdpArgv: [...argv, ...JSON.parse(pins.STRICT_EXPECT_CDP_SUFFIX)] },
    requests: { total: 5, byOrigin: { "http://127.0.0.1:5433": 3, "http://127.0.0.1:5178": 2 } }, refused: [], websockets: realWebsockets(),
    closeInfo: { ok: true, finalAudit: true, closed: true, shutdown: { browserPidGone: true, remainingChildren: [] } }, errors: [], ...over };
};
const KIT = H("c");
test("the adapter's own evidence is required and checked against the reviewed pins; any gap is a named problem", () => {
  assert.deepEqual(adapterEvidenceProblems(goodEvidence(), { expectedKitSha: KIT }), []);
  assert.equal(KIT_BASELINE_SHA256, "40ce6fad287f9dc056527f09c5dc4b7a4593e3896e943621ae8142eba1b72958");
  assert.equal(KIT_SHA256, "1f0427d009b15b7771f939f75b88186cadf7b76b28116884c1b7533bbb92d9ff", "the hosted pin is the reviewed cleaned-up kit");
  assert.notEqual(KIT_SHA256, KIT_BASELINE_SHA256);
  assert.deepEqual(adapterEvidenceProblems(goodEvidence({ kitSha256: KIT_SHA256 })), [], "evidence naming the pinned kit passes against the shipped constant");
  assert.ok(adapterEvidenceProblems(goodEvidence({ kitSha256: KIT_BASELINE_SHA256 })).includes("evidence names a different strict kit"), "evidence from the old baseline kit is no longer accepted on the hosted path");
  assert.deepEqual(adapterEvidenceProblems(goodEvidence({ kitSha256: KIT_BASELINE_SHA256 }), { expectedKitSha: KIT_BASELINE_SHA256 }), [], "the baseline can be used only when passed explicitly");
  assert.ok(adapterEvidenceProblems(goodEvidence(), { expectedKitSha: KIT_BASELINE_SHA256 }).includes("evidence names a different strict kit"));
  const ev = (k, v) => goodEvidence({ [k]: v });
  const deep = (f) => { const e = goodEvidence(); f(e); return e; };
  const cases = [
    ["null", null, /missing/], ["hook on", ev("hook", true), /hook/], ["hook unrecorded", deep((e) => delete e.hook), /hook/], ["other kit", ev("kitSha256", H("z")), /different strict kit/],
    ["status bad", ev("status", { bad: true, reasons: ["x"], okAudits: 2 }), /status is not clean/], ["no audits ok", ev("status", { bad: false, reasons: [], okAudits: 0 }), /status is not clean/],
    ["audit failed", ev("audits", [{ label: "first", ok: false }, { label: "final", ok: true }]), /audits/], ["no final audit", ev("audits", [{ label: "first", ok: true }]), /audits/], ["no audits", ev("audits", []), /audits/],
    ["refused", ev("refused", [{ kind: "x" }]), /refused/], ["errors", ev("errors", ["x"]), /errors/],
    ["close not ok", ev("closeInfo", { ok: false }), /close or shutdown/], ["children remain", ev("closeInfo", { ok: true, finalAudit: true, closed: true, shutdown: { browserPidGone: true, remainingChildren: [{ pid: 1 }] } }), /close or shutdown/],
    ["children unknown", ev("closeInfo", { ok: true, finalAudit: true, closed: true, shutdown: { browserPidGone: true, remainingChildren: null } }), /close or shutdown/],
    ["wrong playwright", deep((e) => { e.evidence.playwright = "1.56.1"; }), /Playwright is not the pinned/], ["wrong chrome", deep((e) => { e.evidence.version = "141.0.0.0"; }), /Chrome is not the pinned/],
    ["root", deep((e) => { e.evidence.runAs.uid = 0; }), /non-root/], ["no runAs", deep((e) => { delete e.evidence.runAs; }), /non-root/],
    ["kernel bypass", deep((e) => { e.evidence.browserProcess.argv.push("--no-sandbox"); e.evidence.cdpArgv.push("--no-sandbox"); }), /bypass/], ["cdp bypass", deep((e) => { e.evidence.cdpArgv.push("--single-process"); }), /bypass/],
    ["no kernel argv", deep((e) => { e.evidence.browserProcess = {}; }), /kernel argv/],
    ["suffix unpinned", deep((e) => { e.evidence.cdpArgvPinned = false; }), /pinned suffix/], ["suffix differs", deep((e) => { e.evidence.cdpArgv = [...e.evidence.browserProcess.argv, "--other"]; }), /pinned suffix/],
    ["other launch option", ev("options", ["args"]), /launch options/], ["other origin", ev("requests", { total: 1, byOrigin: { "http://evil.example": 1 } }), /allowlist/],
    ["pins not applied at launch", ev("pinsRequired", false), /not applied at launch/], ["pins field absent", deep((e) => delete e.pinsRequired), /not applied at launch/],
    ["http origin recorded for a socket", ev("websockets", [{ origin: "http://127.0.0.1:5433", passedThrough: true }]), /websocket/], ["wss", ev("websockets", [{ origin: "wss://127.0.0.1:5433", passedThrough: true }]), /websocket/],
    ["ws wrong port", ev("websockets", [{ origin: "ws://127.0.0.1:5434", passedThrough: true }]), /websocket/], ["ws localhost", ev("websockets", [{ origin: "ws://localhost:5433", passedThrough: true }]), /websocket/],
    ["ws not passed", ev("websockets", [{ origin: "http://127.0.0.1:5433", passedThrough: false }]), /websocket/], ["ws other origin", ev("websockets", [{ origin: "http://127.0.0.1:9", passedThrough: true }]), /websocket/],
  ];
  for (const [name, e, re] of cases) assert.ok(adapterEvidenceProblems(e, { expectedKitSha: KIT }).some((p) => re.test(p)), `${name}: ${adapterEvidenceProblems(e, { expectedKitSha: KIT })}`);
});

test("regression: the websockets the adapter really records are ws:// origins, they are not empty, and they pass; the http-only check that came before would have failed them", () => {
  const sockets = realWebsockets();
  assert.ok(sockets.length > 0); assert.ok(sockets.every((w) => /^ws:\/\/127\.0\.0\.1:(5433|5178)$/.test(w.origin)), JSON.stringify(sockets));
  assert.deepEqual(adapterEvidenceProblems(goodEvidence(), { expectedKitSha: KIT }), []);
  assert.deepEqual(adapterEvidenceProblems(goodEvidence({ websockets: [{ origin: "ws://127.0.0.1:5178", passedThrough: true }] }), { expectedKitSha: KIT }), []);
  assert.ok(sockets.every((w) => !["http://127.0.0.1:5433", "http://127.0.0.1:5178"].includes(w.origin)), "the old comparison would have rejected every real fallback");
});

test("before a hosted Chromium run: the adapter and kit are the reviewed bytes, the hook is off, the pins are the reviewed values; the real gate refuses stand-in bytes", () => {
  const dir = tmp("adapter-dir-"), kit = path.join(tmp("kit-dir-"), "strict-browser-kit.mjs");
  fs.writeFileSync(path.join(dir, "index.mjs"), "// stand-in adapter\n"); fs.writeFileSync(kit, "// stand-in kit\n");
  const sha = (p) => require_crypto().createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const env = { ...STRICT_PINS, STRICT_BROWSER_DRIVER: "/opt/driver", ADAPTER_KIT_SHA256: sha(kit), ADAPTER_REQUIRE_PINS: "1" };
  const mine = { dir, kit, env, expectedSha: sha(path.join(dir, "index.mjs")), expectedKitSha: sha(kit) };
  assert.deepEqual(adapterProblems(mine), []);
  assert.ok(adapterProblems({ ...mine, expectedSha: H("0") }).includes("the adapter is not the reviewed bytes"));
  assert.ok(adapterProblems({ ...mine, expectedKitSha: H("0"), env: { ...env, ADAPTER_KIT_SHA256: H("0") } }).includes("the strict kit is not the reviewed bytes"));
  assert.ok(adapterProblems({ ...mine, env: { ...env, ADAPTER_KIT_SHA256: H("1") } }).includes("ADAPTER_KIT_SHA256 is not the pinned kit hash"));
  assert.ok(adapterProblems({ ...mine, env: { ...env, ADAPTER_HOOK: "1" } }).includes("the observer hook must be off"));
  assert.ok(adapterProblems({ ...mine, env: { ...env, ADAPTER_REQUIRE_PINS: undefined } }).some((p) => /ADAPTER_REQUIRE_PINS/.test(p)));
  assert.ok(adapterProblems({ ...mine, env: { ...env, ADAPTER_REQUIRE_PINS: "0" } }).some((p) => /ADAPTER_REQUIRE_PINS/.test(p)));
  assert.deepEqual(adapterProblems({ ...mine, env: { ...env, ADAPTER_HOOK: "0" } }), []);
  assert.ok(adapterProblems({ ...mine, env: { ...env, STRICT_BROWSER_DRIVER: "relative" } }).some((p) => /absolute/.test(p)));
  for (const k of Object.keys(STRICT_PINS)) assert.ok(adapterProblems({ ...mine, env: { ...env, [k]: "other" } }).some((p) => p.includes(k)), k);
  assert.ok(adapterProblems({ ...mine, dir: tmp("nodir-") }).includes("the adapter file could not be read"));
  assert.ok(adapterProblems({ ...mine, kit: "/nonexistent/kit.mjs" }).includes("the strict kit could not be read"));
  assert.ok(adapterProblems({ dir, kit, env }).includes("the adapter is not the reviewed bytes") && adapterProblems({ dir, kit, env }).includes("the strict kit is not the reviewed bytes"), "with the shipped constants nothing passes: stand-in adapter and stand-in kit");
  assert.equal(ADAPTER5_SHA256, "c2894336ff929657276f0e5e517169fd4d446a4a07394489afdcb0d4f7a09415");
  assert.equal(ADAPTER_SHA256, "f0f51b1ea161c2a156c0643260a8690bfff9c3f7e0eca21bcbdb597f1c36ee4d");
  assert.notEqual(ADAPTER_SHA256, ADAPTER5_SHA256, "the hosted path no longer accepts the unpinned adapter5");
});
import crypto from "node:crypto";
const require_crypto = () => crypto;

test("delta 6 is exactly three small hunks on adapter5: remove them and the reviewed adapter5 bytes come back; the pins reach the kit at launch and the hook stays off", () => {
  const f5 = process.env.ADAPTER5_FILE, f6 = process.env.ADAPTER6_FILE;
  if (!f5 || !f6) return;
  const a5 = fs.readFileSync(f5, "utf8"), a6 = fs.readFileSync(f6, "utf8"), h = (t) => crypto.createHash("sha256").update(t).digest("hex");
  assert.equal(h(a5), ADAPTER5_SHA256); assert.equal(h(a6), ADAPTER_SHA256);
  let back = a6;
  const undo = (re, to) => { assert.equal((back.match(re) || []).length, 1, String(re)); back = back.replace(re, to); };
  undo(/  \/\* Hosted runs: the reviewed pins go to the kit AT LAUNCH[\s\S]*?  const s = await kit\.launchStrict\(\{ driver, expect \}\);/, "  const s = await kit.launchStrict({ driver, expect: {} });");
  undo(/ pinsRequired: state\.pinsRequired === true,/, "");
  undo(/ \*   ADAPTER_REQUIRE_PINS [^\n]*\n/, "");
  assert.equal(back, a5, "the three hunks account for every difference");
  assert.equal(h(back), ADAPTER5_SHA256);
  assert.ok(a6.includes("expect = kit.pinsFromEnv();") && a6.includes('process.env.STRICT_REQUIRE_PINS !== "1"'), "pins from the environment, with STRICT_REQUIRE_PINS required");
  assert.ok(!/ADAPTER_HOOK\s*=\s*["']1/.test(a6) && a6.split("ADAPTER_HOOK").length === a5.split("ADAPTER_HOOK").length, "no new observer-hook path");
  const lines = (t) => t.split("\n").length; assert.ok(lines(a6) - lines(a5) <= 12, "a small delta");
});

test("a Chromium verdict needs the adapter's evidence and bytes; without them it cannot be clean, and WebKit never gets adapter credit", () => {
  const r = scene();
  const withPins = { ...r, pins: { ...r.pins, adapterSha256: ADAPTER_SHA256 } };
  assert.ok(judge({ ...withPins, engine: "chromium", adapterEvidence: goodEvidence(), expectedKitSha: KIT_BASELINE_SHA256 }).some((p) => /different strict kit/.test(p)), "evidence naming another kit fails");
  assert.ok(judge({ ...withPins, engine: "chromium", adapterEvidence: goodEvidence({ kitSha256: KIT_BASELINE_SHA256 }) }).some((p) => /different strict kit/.test(p)), "baseline-kit evidence is not clean against the hosted pin");
  assert.deepEqual(judge({ ...withPins, engine: "chromium", adapterEvidence: goodEvidence({ kitSha256: KIT_SHA256 }) }), [], "with the hosted pin, adapter evidence and pins give a clean Chromium verdict");
  assert.deepEqual(judge({ ...withPins, engine: "chromium", adapterEvidence: goodEvidence({ kitSha256: KIT_BASELINE_SHA256 }), expectedKitSha: KIT_BASELINE_SHA256 }), [], "against an explicit kit hash, adapter evidence and pins give a clean Chromium verdict (baseline used only in this test)");
  assert.ok(judge({ ...r, engine: "chromium", adapterEvidence: goodEvidence() }).includes("strict adapter is not the reviewed bytes"));
  assert.ok(judge({ ...withPins, engine: "chromium", adapterEvidence: null }).includes("adapter: adapter evidence missing"));
  assert.deepEqual(judge(r), [], "no engine given: the fixture-side checks alone");
  const doc = receipt({ ...withPins, engine: "chromium", adapter: goodEvidence({ extra: "Bearer mock-token" }) });
  assert.equal(doc.adapter.auditsOk, 2); assert.equal(doc.adapter.chrome, STRICT_PINS.STRICT_EXPECT_CHROME); assert.ok(!JSON.stringify(doc).includes("mock-token"));
});

test("the command line: a failed run writes a receipt and exits 1, a clean one exits 0, usage errors exit 2", () => {
  const r = scene(), dir = r.dir;
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: "utf8", cwd: ROOT });
  const empty = tmp("verdict-empty-");
  const failed = run("verdict", empty, "webkit");
  assert.equal(failed.status, 1); assert.match(failed.stderr, /start line missing/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(empty, "fixture-receipt.json"), "utf8")).problems.length >= 3);
  fs.writeFileSync(path.join(dir, "pins.json"), JSON.stringify(r.pins));
  for (const [f, v] of [["fixture-start", r.start], ["fixture-report", r.report], ["fixture-expected", r.expected]]) fs.writeFileSync(path.join(dir, f + ".json"), JSON.stringify(v));
  const ok = run("verdict", dir, "none");
  assert.equal(ok.status, 0, ok.stderr);
  fs.writeFileSync(path.join(dir, "fixture-start.json"), JSON.stringify({ ...r.start, dist: undefined }));
  assert.equal(run("verdict", dir, "none").status, 1, "a missing start.dist no longer passes");
  assert.equal(run("nonsense", dir).status, 2); assert.equal(run().status, 2); assert.equal(run("ports-free").status, 2); assert.equal(run("ports-free", "x").status, 2);
  const pinsRun = run("pins", empty, dist(), H("0"));
  assert.equal(pinsRun.status !== 0, true, "no seed file, no pins");
});

/* ---- lifecycle script ---- */
const sh = (args, env = {}, cwd = ROOT) => spawnSync("bash", [SH, ...args], { encoding: "utf8", cwd, env: { ...process.env, ...env } });

/* `id` stand-ins, used only through CI_FIXTURE_ID_CMD, which the workflow never sets. */
function idStandIn(out) { const d = tmp("id-bin-"), f = path.join(d, "id"); fs.writeFileSync(f, `#!/usr/bin/env bash\n${out}\n`, { mode: 0o755 }); return f; }
const ID_USER = idStandIn("echo 1001"), ID_ROOT = idStandIn("echo 0"), ID_JUNK = idStandIn("echo notanumber"), ID_FAILS = idStandIn("exit 1"), ID_OUT_THEN_FAIL = idStandIn("echo 1000; exit 1");

test("uid preflight: root, an unreadable uid, or the root-helper route is refused BEFORE the adapter check or any launch; a non-root uid goes on to the adapter check", () => {
  const dir = path.join(tmp("lifecycle-"), "uid");
  const adapter = tmp("uid-adapter-"), kit = path.join(tmp("uid-kit-"), "k.mjs");
  fs.writeFileSync(path.join(adapter, "index.mjs"), "x"); fs.writeFileSync(kit, "y");
  const base = { CI_FIXTURE_DIR: dir, CI_ENGINE: "chromium", FEEL_PLAYWRIGHT: adapter, ADAPTER_KIT: kit, ...STRICT_PINS };
  /* a node stand-in that would record if the adapter check were reached */
  const marker = path.join(tmp("marker-"), "reached"), node = path.join(tmp("marker-bin-"), "node");
  fs.writeFileSync(node, `#!/usr/bin/env bash\ncase "$*" in *adapter-check*) touch ${marker}; exit 1;; esac; exit 0\n`, { mode: 0o755 });
  for (const [name, env] of [["root", { CI_FIXTURE_ID_CMD: ID_ROOT }], ["junk uid", { CI_FIXTURE_ID_CMD: ID_JUNK }], ["id fails", { CI_FIXTURE_ID_CMD: ID_FAILS }], ["prints a good uid, then exits 1", { CI_FIXTURE_ID_CMD: ID_OUT_THEN_FAIL }], ["root helper set", { CI_FIXTURE_ID_CMD: ID_USER, STRICT_BROWSER_RUN_AS: "pwuser" }]]) {
    const r = sh(["up"], { ...base, CI_FIXTURE_NODE: node, ...env });
    assert.equal(r.status, 5, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /id fails|prints a good uid/.test(name) ? /could not read the uid/ : /non-root user and no STRICT_BROWSER_RUN_AS/, name);
    assert.ok(!fs.existsSync(marker), `${name}: the adapter check was not reached`); assert.ok(!fs.existsSync(dir), `${name}: nothing created`);
  }
  const ok = sh(["up"], { ...base, CI_FIXTURE_NODE: node, CI_FIXTURE_ID_CMD: ID_USER });
  assert.equal(ok.status, 5); assert.match(ok.stderr, /not the reviewed ones/); assert.ok(fs.existsSync(marker), "uid 1001 reaches the adapter check, which then refuses these stand-in bytes");
});

test("toolchain: uid 0, a non-integer uid, a missing uid, or STRICT_BROWSER_RUN_AS fail; node and Playwright versions are still checked", () => {
  const ok = { node: "v22.1.0", playwright: "1.63.0", uid: 1001, env: {} };
  assert.deepEqual(toolchainProblems(ok), []);
  for (const [name, over, re] of [["root", { uid: 0 }, /non-root/], ["negative", { uid: -1 }, /non-root/], ["string uid", { uid: "1001" }, /non-root/], ["null uid", { uid: null }, /non-root/], ["undefined uid", { uid: undefined }, /non-root/],
    ["root helper", { env: { STRICT_BROWSER_RUN_AS: "pwuser" } }, /root-helper/], ["empty root helper", { env: { STRICT_BROWSER_RUN_AS: "" } }, /root-helper/],
    ["node 20", { node: "v20.1.0" }, /node is/], ["playwright", { playwright: "1.56.1" }, /playwright is/]]) assert.ok(toolchainProblems({ ...ok, ...over }).some((p) => re.test(p)), name);
  /* the CLI reads its own uid: this machine's answer decides, and either way the record carries it */
  const dir = tmp("toolchain-cli-"), r = spawnSync(process.execPath, [BIN, "toolchain", dir], { encoding: "utf8", cwd: ROOT, env: { ...process.env, STRICT_BROWSER_RUN_AS: "" } });
  const rec = JSON.parse(fs.readFileSync(path.join(dir, "toolchain.json"), "utf8"));
  assert.equal(rec.uid, process.getuid()); assert.notEqual(r.status, 0, "an env that names the root helper always fails");
  assert.match(r.stderr, /root-helper/);
});

test("up refuses without the reviewed strict adapter, kit and pins, and for WebKit always, before touching anything", () => {
  const dir = path.join(tmp("lifecycle-"), "run");
  const adapter = tmp("up-adapter-"), kit = path.join(tmp("up-kit-"), "strict-browser-kit.mjs");
  fs.writeFileSync(path.join(adapter, "index.mjs"), "// not the reviewed adapter\n"); fs.writeFileSync(kit, "// not the reviewed kit\n");
  const real = { ...STRICT_PINS, FEEL_PLAYWRIGHT: adapter, ADAPTER_KIT: kit, STRICT_BROWSER_DRIVER: "/opt/driver", CI_FIXTURE_ID_CMD: ID_USER };
  for (const [engine, extra] of [["chromium", {}], ["chromium", { FEEL_PLAYWRIGHT: adapter }], ["chromium", { ADAPTER_KIT: kit }], ["chromium", real], ["webkit", {}], ["webkit", real]]) {
    const r = sh(["up"], { CI_FIXTURE_DIR: dir, CI_ENGINE: engine, CI_FIXTURE_ID_CMD: ID_USER, ...extra });
    assert.equal(r.status, 5, `${engine} ${Object.keys(extra)}: ${r.stderr}`);
    assert.ok(!fs.existsSync(dir), "nothing was created");
  }
  assert.match(sh(["up"], { CI_FIXTURE_DIR: dir, CI_ENGINE: "webkit" }).stderr, /not a pass and not a skip/);
  assert.match(sh(["up"], { CI_FIXTURE_DIR: dir, CI_ENGINE: "chromium", CI_FIXTURE_ID_CMD: ID_USER }).stderr, /Root with the sandbox off is not accepted/);
  assert.match(sh(["up"], { CI_FIXTURE_DIR: dir, CI_ENGINE: "chromium", ...real }).stderr, /not the reviewed ones/, "the real check refuses a wrong adapter and an unpinned kit");
  assert.equal(sh(["up"], { CI_FIXTURE_DIR: dir, CI_ENGINE: "" }).status, 2);
  assert.equal(sh(["nonsense"]).status, 2);
});

/* A stand-in for node: argument-dependent, so the real script's own sequencing is what is under test. */
function standIn(mode) {
  const bin = tmp("standin-bin-"), file = path.join(bin, "node");
  const common = `case "$*" in *ports-free*) %PORTS%;; *adapter-check*) exit 0;; *"--input-type=module"*) printf '%s' "$(printf 'a%.0s' $(seq 1 64))"; exit 0;; *"verdict.mjs pins"*) exit 0;; %FIXTURE% esac; exit 0`;
  const body = {
    seedFails: `case "$*" in *ports-free*|*adapter-check*) exit 0;; esac; exit 1`,
    portsTaken: common.replace("%PORTS%", "exit 1").replace("%FIXTURE%", ""),
    neverStarts: common.replace("%PORTS%", "exit 0").replace("%FIXTURE%", `*shots-fixture.mjs) exec -a "node scripts/shots-fixture.mjs" sleep 30;;`),
    addrInUse: common.replace("%PORTS%", "exit 0").replace("%FIXTURE%", `*shots-fixture.mjs) echo "Error: listen EADDRINUSE: address already in use 127.0.0.1:5433 SECRETISH"; exit 1;;`),
    portsFree: `exit 0`,
  }[mode];
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return file;
}
const FAST = { CI_ENGINE: "chromium", CI_FIXTURE_ID_CMD: ID_USER, FEEL_PLAYWRIGHT: "/x", ADAPTER_KIT: "/y", CI_FIXTURE_TICK: "0.05", CI_FIXTURE_WAIT_TICKS: "4" };
const alive = (pid) => { try { process.kill(pid, 0); return !/^State:\s*Z/m.test(fs.readFileSync(`/proc/${pid}/status`, "utf8")); } catch (e) { return false; } };
const startOf = (pid) => fs.readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /, "").split(" ")[19];
const pidFile = (dir, pid, over = {}) => fs.writeFileSync(path.join(dir, "fixture.pid"), [pid, over.start ?? startOf(pid), over.cwd ?? fs.readlinkSync(`/proc/${pid}/cwd`)].join("\n") + "\n");

test("up does not start when a port is not confirmed free or the seed cannot be made, and a failed start-up leaves no process behind and prints only a fixed reason", () => {
  let dir = path.join(tmp("lifecycle-"), "a");
  let r = sh(["up"], { ...FAST, CI_FIXTURE_DIR: dir, CI_FIXTURE_NODE: standIn("portsTaken") });
  assert.equal(r.status, 6); assert.match(r.stderr, /not confirmed free/); assert.ok(!fs.existsSync(path.join(dir, "fixture.pid")));
  dir = path.join(tmp("lifecycle-"), "b");
  r = sh(["up"], { ...FAST, CI_FIXTURE_DIR: dir, CI_FIXTURE_NODE: standIn("seedFails") });
  assert.notEqual(r.status, 0); assert.ok(!fs.existsSync(path.join(dir, "fixture.pid")), "no process was started");
  dir = path.join(tmp("lifecycle-"), "c");
  r = sh(["up"], { ...FAST, CI_FIXTURE_DIR: dir, CI_FIXTURE_NODE: standIn("neverStarts") });
  assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, /start-up failed \(did-not-come-up\); the log is not printed/);
  const [pid] = fs.readFileSync(path.join(dir, "fixture.pid"), "utf8").split("\n").map(Number);
  assert.ok(pid > 1); assert.equal(alive(pid), false, "the process up started was stopped before up returned");
  dir = path.join(tmp("lifecycle-"), "d");
  r = sh(["up"], { ...FAST, CI_FIXTURE_DIR: dir, CI_FIXTURE_NODE: standIn("addrInUse") });
  assert.equal(r.status, 1); assert.match(r.stderr, /start-up failed \((port-in-use|no-output)\)/);
  assert.ok(!/EADDRINUSE|SECRETISH|address already in use/.test(r.stderr), "the raw log never reaches the output");
});

test("stop is idempotent, waits for the process, and touches only the process that was started: same start time, same directory, the fixture's command line", async () => {
  const dir = path.join(tmp("lifecycle-"), "s"); fs.mkdirSync(dir, { recursive: true });
  const env = { CI_FIXTURE_DIR: dir, CI_FIXTURE_TICK: "0.05", CI_FIXTURE_NODE: standIn("portsFree") };
  assert.equal(sh(["stop"], env).status, 0, "nothing started is not an error");
  const mine = () => spawn("bash", ["-c", 'exec -a "node scripts/shots-fixture.mjs" sleep 30'], { stdio: "ignore" });
  /* a bystander: its command line is not the fixture's */
  const by = spawn("sleep", ["30"], { stdio: "ignore" });
  pidFile(dir, by.pid);
  let r = sh(["stop"], env); assert.equal(r.status, 3); assert.match(r.stderr, /not the process that was started/); assert.equal(alive(by.pid), true, "the bystander is untouched");
  by.kill("SIGKILL");
  /* the fixture's own command line but another start time (a recycled pid), or another directory */
  const a = mine(); await new Promise((x) => setTimeout(x, 100));
  pidFile(dir, a.pid, { start: "1" });
  r = sh(["stop"], env); assert.equal(r.status, 3, r.stderr); assert.equal(alive(a.pid), true, "a different start time is not ours");
  pidFile(dir, a.pid, { cwd: "/" });
  r = sh(["stop"], env); assert.equal(r.status, 3, r.stderr); assert.equal(alive(a.pid), true, "a different directory is not ours");
  /* the real thing: stopped, waited for, and a second stop is fine */
  pidFile(dir, a.pid);
  r = sh(["stop"], env); assert.equal(r.status, 0, r.stderr); assert.equal(alive(a.pid), false);
  assert.equal(sh(["stop"], env).status, 0, "a second stop finds it gone and succeeds");
  /* a port not confirmed free after the process is gone fails the stop */
  assert.equal(sh(["stop"], { ...env, CI_FIXTURE_NODE: standIn("portsTaken") }).status, 4);
  fs.writeFileSync(path.join(dir, "fixture.pid"), "not a pid\n");
  assert.equal(sh(["stop"], env).status, 3);
  fs.writeFileSync(path.join(dir, "fixture.pid"), "12\n");
  assert.equal(sh(["stop"], env).status, 3, "a pid file without its identity is refused");
});

test("the workflow: one literal branch, other branches' steps untouched, the strict Chromium job executable and pinned, WebKit still failing closed, no sandbox or user change", () => {
  const yml = process.env.CANDIDATE_CI_YML ? fs.readFileSync(process.env.CANDIDATE_CI_YML, "utf8") : null;
  if (!yml) return;
  const job = (name) => { const i = yml.indexOf(`\n  ${name}:\n`); assert.ok(i > 0, name); const rest = yml.slice(i + 1); const m = /\n  [a-z][a-z-]*:\n/.exec(rest.slice(5)); return m ? rest.slice(0, m.index + 5) : rest; };
  assert.ok(!/REPLACE-WITH/.test(yml), "no placeholder is left");
  assert.equal((yml.match(/codex\/nov1-security-recovery-integration/g) || []).length, 12, "sanity: the known branch, in all twelve places (4 in the test job's two gates, 2 each in feel, feel-strict, feel-webkit, shots)");
  /* what matters is WHERE each literal sits, so each is checked as an exact expression in its own job */
  const BR = "codex/nov1-security-recovery-integration";
  const STRICT_IF = `(github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.head_ref == '${BR}') || (github.event_name == 'push' && github.ref_name == '${BR}')`;   // the feel-strict job's own condition, unwrapped
  const CAND = `(${STRICT_IF})`;   // the CANDIDATE env expression wraps the same two arms once more
  for (const j of ["feel", "feel-webkit", "shots"]) {
    const body = job(j), defs = body.split("\n").filter((l) => /^ {6}CANDIDATE: /.test(l));   // the job-level env block only (six spaces), not the step env that forwards it
    assert.deepEqual(defs.map((l) => l.trim()), [`CANDIDATE: \${{ ${CAND} && '1' || '0' }}`], `${j}: exactly one CANDIDATE, the exact expression`);
  }
  const strictBody = job("feel-strict");
  assert.ok(strictBody.split("\n").includes(`    if: \${{ ${STRICT_IF} }}`), "feel-strict runs only on the candidate, by the exact expression");
  assert.deepEqual(strictBody.split("\n").filter((l) => /^ {6}CANDIDATE: /.test(l)).map((l) => l.trim()), ["CANDIDATE: '1'"]);
  const testJob = job("test").split("\n");
  const at = (name) => testJob.findIndex((l) => l.includes(name));
  const sel = at("node scripts/security-integration-selected-tests.mjs"), ord = at("run: npm test");
  assert.ok(sel > 1 && ord > 1, "both unit steps exist, once each");
  assert.equal(testJob.filter((l) => l.includes("security-integration-selected-tests.mjs")).length, 1); assert.equal(testJob.filter((l) => /run: npm test$/.test(l)).length, 1);
  assert.equal(testJob[sel - 1].trim(), `if: github.ref == 'refs/heads/${BR}' || github.head_ref == '${BR}'`, "the selected suite runs on the candidate branch only");
  assert.equal(testJob[ord - 1].trim(), `if: github.ref != 'refs/heads/${BR}' && github.head_ref != '${BR}'`, "the ordinary suite runs everywhere else");
  assert.ok(!/secrets\./.test(yml.replace(/secrets\.GITHUB_TOKEN/g, "")));
  assert.ok(!/--no-sandbox|--user|options:|ADAPTER_HOOK/.test(yml), "no sandbox or user change, and the observer hook is never set");
  assert.ok(!/^\s+STRICT_BROWSER_RUN_AS:|CI_FIXTURE_ID_CMD|CI_FIXTURE_NODE/m.test(yml), "the root helper and the test stand-ins are never set in the workflow (the preflight only reads the variable)");
  assert.match(job("feel-strict"), /ADAPTER_REQUIRE_PINS: '1'/, "pins are applied at launch");
  /* the strict job */
  const strict = job("feel-strict");
  const pre = strict.indexOf("name: Preflight, not root"), drv = strict.indexOf("name: Install the pinned driver"), ad = strict.indexOf("FEEL_PLAYWRIGHT:");
  assert.ok(pre > 0 && pre < drv && drv < ad, "the uid preflight comes before the driver install and before any adapter use");
  assert.match(strict, /name: Preflight, not root\n        run: \|\n          if ! uid=\$\(id -u\); then echo "could not read the uid" >&2; exit 1; fi\n          test "\$uid" -gt 0 && test -z "\$\{STRICT_BROWSER_RUN_AS:-\}"\n/);
  /* and the step's own shell text, run as GitHub runs it (bash -e) with stand-in `id` commands: output from a failed command is not a uid */
  const script = /name: Preflight, not root\n        run: \|\n((?:          .*\n)+)/.exec(strict)[1].replace(/^          /gm, "");
  const runStep = (idBody, extra = {}) => { const d = tmp("wf-id-"); fs.writeFileSync(path.join(d, "id"), `#!/usr/bin/env bash\n${idBody}\n`, { mode: 0o755 }); return spawnSync("bash", ["-e", "-c", script], { encoding: "utf8", env: { PATH: `${d}:${process.env.PATH}`, ...extra } }); };
  assert.equal(runStep("echo 1001").status, 0, "a non-root uid with a zero exit passes");
  for (const [name, body, extra] of [["root", "echo 0"], ["prints 1000 then exits 1", "echo 1000; exit 1"], ["prints 1000 then exits 2", "echo 1000; exit 2"], ["not a number", "echo abc"], ["empty", "true"], ["helper set", "echo 1001", { STRICT_BROWSER_RUN_AS: "pwuser" }], ["helper set empty", "echo 1001", { STRICT_BROWSER_RUN_AS: "x" }]]) assert.notEqual(runStep(body, extra || {}).status, 0, name);
  assert.match(strict, /runs-on: ubuntu-22\.04/); assert.ok(!/container:/.test(strict), "the VM, not the container");
  const uses = [...strict.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.equal(uses.length, 3); for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, "actions are pinned by SHA: " + u);
  for (const [k, v] of Object.entries(STRICT_PINS)) assert.ok(strict.includes(`${k}: '${v}'`), k);
  assert.match(strict, /npm install --prefix "\$RUNNER_TEMP\/sandbox-driver" --ignore-scripts [^\n]*playwright@1\.63\.0/);
  assert.match(strict, /playwright" install --no-shell chromium/);
  assert.match(strict, /FEEL_PLAYWRIGHT: \$\{\{ github\.workspace \}\}\/scripts\/diagnostics\/strict-adapter\n/); assert.ok(strict.includes(`ADAPTER_KIT_SHA256: '${KIT_SHA256}'`), "the workflow binds the same kit hash as the verdict");
  assert.ok(!/PENDING|REPLACE-WITH/.test(yml)); assert.ok(!yml.includes(KIT_BASELINE_SHA256), "the old baseline is not in the workflow");
  assert.equal((yml.match(new RegExp(KIT_SHA256, "g")) || []).length, 1);
  assert.match(strict, /npm run feel 2>&1 \| tee feel\.txt/); assert.match(strict, /FEEL_MANAGER_ACTOR=fixture/);
  assert.match(strict, /code=\$\{PIPESTATUS\[0\]\}[\s\S]*exit \$code/, "the run's own exit is the step's");
  assert.match(strict, /id: stop\n        if: always\(\)\n        run: scripts\/ci-fixture\.sh stop/); assert.match(strict, /id: verdict\n        if: always\(\)\n        run: node scripts\/shots-fixture-verdict\.mjs verdict fixture-run chromium/);
  /* the existing feel job: same name, a gate on the candidate, every measuring step skipped there, the comment kept */
  const feel = job("feel");
  assert.match(feel, /needs: feel-strict\n    if: \$\{\{ !cancelled\(\) \}\}/); assert.match(feel, /test "\$STRICT_RESULT" = success/);
  const steps = feel.split(/\n(?=      - )/).slice(1);
  for (const st of steps) {
    const name = (/name: (.*)/.exec(st) || /uses: (\S+)/.exec(st) || /run: (.*)/.exec(st))[1];
    const guarded = /if: env\.CANDIDATE != '1'/.test(st);
    const exempt = /^Candidate gate|^Tell the pull request|actions\/checkout@v4/.test(name);
    assert.ok(guarded || exempt, "unguarded step in feel: " + name);
  }
  assert.match(feel, /needs\.feel-strict\.outputs\.table \|\| steps\.feel\.outputs\.table/);
  for (const keep of ["SALESPERSON=1 node scripts/mock-supabase.mjs", "npx vite preview --port 5178", "The phone feels the same or better: every bar met."]) assert.ok(feel.includes(keep), keep + " is still there for other branches");
  /* WebKit: the fixture branch fails closed at `up`, and a failed stop or verdict is never a pass */
  for (const name of ["feel-webkit", "shots"]) {
    const j = job(name);
    assert.match(j, /CI_ENGINE: webkit/); assert.match(j, /scripts\/ci-fixture\.sh up/); assert.match(j, /scripts\/ci-fixture\.sh collect \|\| echo/);
    assert.match(j, /id: stop\n        if: always\(\) && env\.CANDIDATE == '1'/); assert.match(j, /id: verdict/);
    assert.match(j, /image: mcr\.microsoft\.com\/playwright:v1\.63\.0-noble/);
  }
  assert.match(job("shots"), /STOP_OUTCOME/); assert.ok(!/feels the same or better/.test(yml.slice(yml.indexOf("headline"))));
});
