/* What a candidate-branch run of feel or shots says about its backend, and nothing else.
     toolchain DIR           records and checks the sandbox's versions
     ports-free PORT...      passes only when every port is positively free (taken, timed out and unknown errors all fail)
     listeners PID PORT...   passes only when each port has a loopback listener whose socket belongs to PID's own descriptors, and no other
     adapter-check DIR KIT   the strict adapter and kit must be the reviewed bytes, the hook off, and the browser pins the reviewed values
     pins DIR DISTDIR SHA    writes the seed and dist hashes BEFORE the fixture exists (the verdict's outside witnesses)
     verdict DIR ENGINE      judges the run and writes the receipt
   Output is enums, counts and hashes that passed a check. No bodies, headers, tokens or seed file. */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { validateFixtureReport } from "./shots-evidence.mjs";
import { buildManifest, createFixture } from "./shots-fixture.mjs";

const HEX = /^[0-9a-f]{64}$/;
const KEY = "realtime-handshake-unavailable";
/* The reviewed strict adapter (index.mjs of the FEEL_PLAYWRIGHT drop-in) and the reviewed hosted pins. A value here is a claim about reviewed bytes,
   not a default: anything else is refused. */
export const ADAPTER5_SHA256 = "c2894336ff929657276f0e5e517169fd4d446a4a07394489afdcb0d4f7a09415";   // reviewed; launches with expect: {} so it cannot take the hosted pins
export const ADAPTER_SHA256 = "f0f51b1ea161c2a156c0643260a8690bfff9c3f7e0eca21bcbdb597f1c36ee4d";   // adapter5 + delta 6 (pins at launch); PENDING REVIEW, the hosted path accepts only this
/* BASELINE only: sha256 of scripts/strict-browser-kit.mjs at git object 5558b42eaa9c043a402acf2908a960e95eacb978 (PR 501 head 47757af), checked with
   `git cat-file -p 5558b42e… | sha256sum` and equal to the reviewer's hash. That kit starts its server and then asserts Chrome/CDP pins with no catch or finally, so it can leak
   a browser on a version mismatch; a kit-only cleanup is under separate review. The hosted pin is NOT frozen at this baseline. */
export const KIT_BASELINE_SHA256 = "40ce6fad287f9dc056527f09c5dc4b7a4593e3896e943621ae8142eba1b72958";
/* The hosted pin: the sha256 of the reviewed, cleaned-up kit (final kit review pass for the non-root integration). Anything else is refused. The kit's bounded cleanup on a
   timeout is an attempt, not a guarantee that the process is gone: the real no-residue checks stay (adapter shutdown evidence, `stop`'s owned-PID wait, ports confirmed free). */
export const KIT_SHA256 = "1f0427d009b15b7771f939f75b88186cadf7b76b28116884c1b7533bbb92d9ff";
export const STRICT_PINS = Object.freeze({
  STRICT_EXPECT_PLAYWRIGHT: "1.63.0", STRICT_EXPECT_CHROME: "153.0.8010.12", STRICT_REQUIRE_PINS: "1",
  STRICT_EXPECT_CDP_SUFFIX: '["--noerrdialogs","--ozone-platform=headless","--ozone-override-screen-size=800,600","--use-angle=swiftshader-webgl","--flag-switches-begin","--flag-switches-end","--enable-unsafe-swiftshader"]',
});
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const hex = (v) => (typeof v === "string" && HEX.test(v) ? v : null);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= 1e9 ? v : null);

/* Pure. `pins` are what the verdict worked out for itself, outside the fixture process:
   { seedFileSha256, distSha256, actorManifestSha256, seedRowsSha256 }. A start line that disagrees, or a pin that is absent, is a problem. */
export function judge({ start, report, expected, pins, engine, adapterEvidence, expectedKitSha = KIT_SHA256 }) {
  const bad = [];
  const valid = !!report && validateFixtureReport(report);
  if (!start || start.fixture !== true) bad.push("fixture start line missing");
  else {
    if (start.api !== "on") bad.push("room API was not on");
    if (start.mode !== "compatible") bad.push("fixture mode was not compatible");
    if (start.managerActor !== true) bad.push("manager actor was not on");
    if (start.normalizeSeedIdentity !== true) bad.push("seed identity was not normalised");
    for (const [k, label] of [["actorManifestSha256", "actor manifest hash"], ["seedFileSha256", "seed hash"], ["seedRowsSha256", "seed rows hash"]]) if (!hex(start[k])) bad.push(`${label} missing`);
    if (!start.dist || !hex(start.dist.sha256) || !count(start.dist.files) || !count(start.dist.bytes)) bad.push("start.dist missing or malformed");
  }
  if (!valid) bad.push("fixture report missing or invalid");
  else {
    if (report.mode !== "compatible") bad.push("report mode was not compatible");
    if (report.clock !== "system" && report.clock !== "fixed") bad.push("report clock unknown");
    if (report.seed !== "shared") bad.push("report seed was not the shared seed");
    if (report.unexpected !== 0) bad.push(`unexpected requests: ${report.unexpected}`);
    if (report.dropped || report.droppedShapes || report.droppedUnexpected) bad.push("the report dropped counts");
    if (start && start.dist && start.dist.sha256 !== report.dist.sha256) bad.push("dist pin differs between start and report");
  }
  const p = pins || {};
  for (const [k, label] of [["seedFileSha256", "seed"], ["distSha256", "dist"], ["actorManifestSha256", "actor manifest"], ["seedRowsSha256", "seed rows"]]) if (!hex(p[k])) bad.push(`outside ${label} pin missing`);
  if (start && start.fixture === true) {
    if (hex(p.seedFileSha256) && start.seedFileSha256 !== p.seedFileSha256) bad.push("seed hash differs from the outside pin");
    if (hex(p.distSha256) && start.dist && start.dist.sha256 !== p.distSha256) bad.push("dist hash differs from the outside pin");
    if (hex(p.actorManifestSha256) && start.actorManifestSha256 !== p.actorManifestSha256) bad.push("actor manifest differs from the outside pin");
    if (hex(p.seedRowsSha256) && start.seedRowsSha256 !== p.seedRowsSha256) bad.push("seed rows hash differs from the outside pin");
  }
  if (engine === "chromium") {
    if (!hex(p.adapterSha256) || p.adapterSha256 !== ADAPTER_SHA256) bad.push("strict adapter is not the reviewed bytes");
    for (const m of adapterEvidenceProblems(adapterEvidence, { expectedKitSha })) bad.push("adapter: " + m);
  }
  const c = expected && expected.kind === "fixture-expected" && expected.schema === 1 ? expected.counters : null;
  if (!c || Object.keys(c).join() !== KEY || count(c[KEY]) === null) bad.push("expected counters missing or unknown");
  else if (valid) {
    const seen = report.requests.filter((r) => r.m === "GET" && r.c === "static" && r.s === 503).reduce((n, r) => n + r.n, 0);
    if (seen !== c[KEY]) bad.push("the 503 rows and the expected counter disagree");
  }
  return bad;
}

/* Only values that passed a check are copied; an invalid report contributes nothing. */
export function receipt({ start, report, expected, pins, engine, adapter, problems = [], env = process.env }) {
  const s = start && start.fixture === true ? start : {};
  const valid = !!report && validateFixtureReport(report);
  const c = expected && expected.kind === "fixture-expected" && expected.counters ? count(expected.counters[KEY]) : null;
  const p = pins || {};
  return {
    schema: 1, kind: "candidate-fixture-receipt", engine: ["chromium", "webkit"].includes(engine) ? engine : "unknown",
    commit: /^[0-9a-f]{40}$/.test(env.GITHUB_SHA || "") ? env.GITHUB_SHA : null,
    seed: { fileSha256: hex(s.seedFileSha256), rowsSha256: hex(s.seedRowsSha256), actorManifestSha256: hex(s.actorManifestSha256), normalizeSeedIdentity: s.normalizeSeedIdentity === true, managerActor: s.managerActor === true },
    outsidePins: { seedFileSha256: hex(p.seedFileSha256), distSha256: hex(p.distSha256), actorManifestSha256: hex(p.actorManifestSha256), seedRowsSha256: hex(p.seedRowsSha256), adapterSha256: hex(p.adapterSha256) },
    dist: s.dist ? { files: count(s.dist.files), bytes: count(s.dist.bytes), sha256: hex(s.dist.sha256) } : null,
    api: s.api === "on" || s.api === "off" ? s.api : null, mode: s.mode === "compatible" || s.mode === "legacy" ? s.mode : null,
    clock: valid ? report.clock : null,
    requests: valid ? report.requests.map((r) => ({ m: r.m, c: r.c, s: r.s, n: r.n })) : [], unexpected: valid ? report.unexpected : null,
    expected: c === null ? null : { [KEY]: c },
    caps: { bodyBytes: 262144, droppedAny: valid ? !!(report.dropped || report.droppedShapes || report.droppedUnexpected) : null },
    projection: "synthetic", privacyAcceptance: false, realtimeQualification: false, slowLinkAcceptance: false, performanceAcceptance: false, apiLagged: false,
    adapter: adapter && typeof adapter === "object" ? { hook: adapter.hook === false ? false : null, auditsOk: Array.isArray(adapter.audits) ? adapter.audits.filter((a) => a && a.ok === true).length : null,
      finalAudit: !!(adapter.closeInfo && adapter.closeInfo.finalAudit === true), closed: !!(adapter.closeInfo && adapter.closeInfo.closed === true),
      chrome: typeof adapter.evidence?.version === "string" && /^[0-9.]{1,24}$/.test(adapter.evidence.version) ? adapter.evidence.version : null,
      playwright: typeof adapter.evidence?.playwright === "string" && /^[0-9.]{1,24}$/.test(adapter.evidence.playwright) ? adapter.evidence.playwright : null,
      refused: Array.isArray(adapter.refused) ? adapter.refused.length : null, websockets: Array.isArray(adapter.websockets) ? adapter.websockets.length : null } : null,
    problems: problems.filter((x) => typeof x === "string").map((x) => x.slice(0, 120)),
  };
}

/* What the pull request is told. Pure. A candidate run is a functional check on a fast local link with the room API unlagged: it is never "the phone feels the same or better". */
export function headline({ candidate, feelOutcome, code, verdictOutcome, stopOutcome }) {
  if (candidate !== "1") return null;
  if (stopOutcome !== "success") return "The fixture could not be stopped cleanly, so what it reported cannot be trusted. Not a pass.";
  if (verdictOutcome !== "success") return "The fixture run left its contract, or its proof is missing. Not a pass. See the fixture receipt.";
  if (String(code || "") === "3") return "The browser was lost before the run finished. The fixture stayed inside its contract. Not a pass.";
  if (feelOutcome !== "success") return "A bar was missed on the synthetic fixture (functional check only; room API not lagged).";
  return "Functional check passed on the synthetic fixture: every assertion met, no unexpected request. The room API is not lagged here, so this is not the phone's performance reading and does not replace the 400 ms measurement.";
}

/* "taken", "free" or "unknown". Only a refused connection is free: a timeout, a permission error, or anything else says nothing about the port. */
export function portState(port, connect = net.connect) {
  return new Promise((resolve) => {
    let s;
    const done = (v) => { try { s && s.destroy(); } catch (e) {} resolve(v); };
    try { s = connect({ host: "127.0.0.1", port, timeout: 400 }); } catch (e) { return resolve("unknown"); }
    s.once("connect", () => done("taken")); s.once("timeout", () => done("unknown"));
    s.once("error", (e) => done(e && e.code === "ECONNREFUSED" ? "free" : "unknown"));
  });
}

/* Who is listening, from the kernel's tables: LISTEN sockets on the port, their inodes, and whether those inodes are open in the owned process. */
export function listenerProblems(ports, pid, proc = "/proc") {
  const bad = [];
  const rows = [];
  /* tcp must be readable. tcp6 may be absent (ENOENT, a kernel without IPv6) and nothing else: any other error is a table we cannot see. */
  for (const [file, loop, mayBeAbsent] of [["tcp", "0100007F", false], ["tcp6", "00000000000000000000000001000000", true]]) {
    let text;
    try { text = fs.readFileSync(path.join(proc, "net", file), "utf8"); }
    catch (e) { if (mayBeAbsent && e && e.code === "ENOENT") continue; return [`the kernel's ${file} table could not be read`]; }
    for (const line of text.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 10 || f[3] !== "0A") continue;
      const [addr, hp] = f[1].split(":");
      rows.push({ port: parseInt(hp, 16), addr, loop: addr.toUpperCase() === loop, inode: f[9] });
    }
  }
  let mine = new Set();
  try { for (const fd of fs.readdirSync(path.join(proc, String(pid), "fd"))) { const t = fs.readlinkSync(path.join(proc, String(pid), "fd", fd)); const m = /^socket:\[(\d+)\]$/.exec(t); if (m) mine.add(m[1]); } }
  catch (e) { return [`the descriptors of process ${pid} could not be read`]; }
  for (const port of ports) {
    const here = rows.filter((r) => r.port === port);
    if (!here.length) bad.push(`nothing is listening on ${port}`);
    for (const r of here) {
      if (!r.loop) bad.push(`port ${port} is listening beyond loopback`);
      if (!mine.has(r.inode)) bad.push(`port ${port} is held by a socket the fixture process does not own`);
    }
  }
  return bad;
}

/* What must be true BEFORE a hosted Chromium run starts: the reviewed adapter bytes, the reviewed kit bytes, no observer hook, an absolute driver, the reviewed pins. */
export function adapterProblems({ dir, kit, env = process.env, expectedSha = ADAPTER_SHA256, expectedKitSha = KIT_SHA256 }) {
  const bad = [];
  const fileSha = (p) => { try { return sha(fs.readFileSync(p)); } catch (e) { return null; } };
  const got = fileSha(path.join(dir || "/nonexistent", "index.mjs"));
  if (got === null) bad.push("the adapter file could not be read"); else if (got !== expectedSha) bad.push("the adapter is not the reviewed bytes");
  if (!hex(expectedKitSha)) bad.push("the strict kit hash is not pinned yet");
  else {
    const k = fileSha(kit || "/nonexistent");
    if (k === null) bad.push("the strict kit could not be read"); else if (k !== expectedKitSha) bad.push("the strict kit is not the reviewed bytes");
    if (env.ADAPTER_KIT_SHA256 !== expectedKitSha) bad.push("ADAPTER_KIT_SHA256 is not the pinned kit hash");
  }
  if (env.ADAPTER_HOOK !== undefined && env.ADAPTER_HOOK !== "0") bad.push("the observer hook must be off");
  if (env.ADAPTER_REQUIRE_PINS !== "1") bad.push("ADAPTER_REQUIRE_PINS must be 1 so the pins are applied at launch");
  if (!env.STRICT_BROWSER_DRIVER || !path.isAbsolute(env.STRICT_BROWSER_DRIVER)) bad.push("STRICT_BROWSER_DRIVER must be an absolute path");
  for (const [k, v] of Object.entries(STRICT_PINS)) if (env[k] !== v) bad.push(`pin ${k} is not the reviewed value`);
  return bad;
}

const BYPASS = /^--(?:no-sandbox|disable-.*sandbox|disable-seccomp-filter-sandbox|single-process|no-zygote)(?:=|$)/;
const PORTS = [5433, 5178];
const ORIGINS = PORTS.map((p) => `http://127.0.0.1:${p}`);
/* The adapter records a socket's origin as new URL(url).origin, which for ws://127.0.0.1:5433/... is ws://127.0.0.1:5433 (not the http origin). Same two ports. */
const WS_ORIGINS = PORTS.map((p) => `ws://127.0.0.1:${p}`);
/* What the adapter's own evidence file must show for a hosted run to count: read after the run, and checked against the reviewed pins here, since adapter5 launches with
   `expect: {}` and so does not itself refuse a different Playwright or Chrome. Fields are the ones adapter5 writes (adapter-evidence.json). */
export function adapterEvidenceProblems(e, { expectedKitSha = KIT_SHA256, pins = STRICT_PINS } = {}) {
  const bad = [];
  if (!e || typeof e !== "object" || Array.isArray(e)) return ["adapter evidence missing"];
  const arr = Array.isArray;
  if (e.hook !== false) bad.push("the observer hook was on or unrecorded");
  if (e.pinsRequired !== true) bad.push("the pins were not applied at launch");
  if (!hex(expectedKitSha)) bad.push("the strict kit hash is not pinned yet"); else if (e.kitSha256 !== expectedKitSha) bad.push("evidence names a different strict kit");
  const st = e.status;
  if (!st || st.bad !== false || !arr(st.reasons) || st.reasons.length || !(st.okAudits >= 1)) bad.push("the adapter's own status is not clean");
  if (!arr(e.audits) || !e.audits.length || !e.audits.every((a) => a && a.ok === true) || e.audits[e.audits.length - 1].label !== "final") bad.push("renderer audits are missing, failed, or lack a final one");
  if (!arr(e.refused) || e.refused.length) bad.push("a request or socket was refused");
  if (!arr(e.errors) || e.errors.length) bad.push("the adapter recorded errors");
  const ci = e.closeInfo;
  if (!ci || ci.ok !== true || ci.finalAudit !== true || ci.closed !== true || !ci.shutdown || ci.shutdown.browserPidGone !== true || !arr(ci.shutdown.remainingChildren) || ci.shutdown.remainingChildren.length) bad.push("close or shutdown was not verified clean");
  const ev = e.evidence;
  if (!ev || typeof ev !== "object") bad.push("kit evidence missing");
  else {
    if (ev.playwright !== pins.STRICT_EXPECT_PLAYWRIGHT) bad.push("Playwright is not the pinned version");
    if (ev.version !== pins.STRICT_EXPECT_CHROME) bad.push("Chrome is not the pinned version");
    if (!ev.runAs || !(ev.runAs.uid > 0)) bad.push("the browser did not run as a non-root user");
    const bargv = ev.browserProcess && ev.browserProcess.argv;
    if (!arr(bargv) || !bargv.length || bargv.some((x) => typeof x !== "string" || BYPASS.test(x))) bad.push("kernel argv missing or carries a sandbox bypass");
    else if (!arr(ev.cdpArgv) || ev.cdpArgv.some((x) => typeof x !== "string" || BYPASS.test(x))) bad.push("browser argv missing or carries a sandbox bypass");
    else if (ev.cdpArgvPinned === false || JSON.stringify(ev.cdpArgv) !== JSON.stringify([...bargv, ...JSON.parse(pins.STRICT_EXPECT_CDP_SUFFIX)])) bad.push("browser argv is not the kernel argv plus the pinned suffix");
  }
  if (e.options !== null && !(arr(e.options) && e.options.every((x) => x === "executablePath"))) bad.push("unexpected launch options");
  const by = e.requests && e.requests.byOrigin;
  if (!by || typeof by !== "object" || !Object.keys(by).every((k) => ORIGINS.includes(k))) bad.push("requests to an origin outside the allowlist");
  if (!arr(e.websockets) || !e.websockets.every((w) => w && w.passedThrough === true && WS_ORIGINS.includes(w.origin))) bad.push("a websocket was not an allowed loopback pass-through");
  return bad;
}

/* Pure. The hosted Chromium path runs as the VM's own non-root user. Root is refused here rather than inferred from the VM, and the root-helper route (STRICT_BROWSER_RUN_AS) is
   not used by this path, so it must be absent: then the kit's root branch cannot be reached. */
export function toolchainProblems({ node, playwright, uid, env = {} }) {
  const bad = [];
  if (!/^v22\./.test(String(node))) bad.push(`node is ${node}, expected 22.x`);
  if (playwright !== "1.63.0") bad.push(`playwright is ${playwright}, expected 1.63.0`);
  if (!Number.isInteger(uid) || uid <= 0) bad.push(`the run is uid ${uid}; the strict path needs a non-root user`);
  if (env.STRICT_BROWSER_RUN_AS !== undefined) bad.push("STRICT_BROWSER_RUN_AS is set; the root-helper route is not used by this path");
  return bad;
}

function toolchain(dir) {
  /* The driver the browser is launched from (STRICT_BROWSER_DRIVER) when there is one, else the project's own. */
  const driver = process.env.STRICT_BROWSER_DRIVER;
  const req = createRequire(path.join(driver && path.isAbsolute(driver) ? driver : process.cwd(), "package.json"));
  let pw = null;
  try { pw = driver && path.isAbsolute(driver) ? JSON.parse(fs.readFileSync(path.join(driver, "package.json"), "utf8")).version : req("playwright/package.json").version; } catch (e) {}
  let osName = null;
  try { osName = (fs.readFileSync("/etc/os-release", "utf8").match(/^PRETTY_NAME="?([^"\n]*)/m) || [])[1] || null; } catch (e) {}
  const t = { schema: 1, kind: "toolchain", node: process.version, playwright: pw, uid: typeof process.getuid === "function" ? process.getuid() : null, os: osName, kernel: os.release(), arch: process.arch,
    image: process.env.CI_IMAGE_TAG || null, browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || null };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "toolchain.json"), JSON.stringify(t, null, 2) + "\n");
  return toolchainProblems({ node: t.node, playwright: t.playwright, uid: t.uid, env: process.env });
}

/* The witnesses that do not come from the fixture process: the dist as built, the seed file as written, and the actors and rows that seed makes (worked out in-process, nothing listens). */
export function outsidePins(dir, distDir, adapterDir) {
  const seedBytes = fs.readFileSync(path.join(dir, "seed.json"));
  const fx = createFixture({ mode: "compatible", distDir, seed: JSON.parse(seedBytes.toString("utf8")), requireManagerActor: true, normalizeSeedIdentity: true });
  return { seedFileSha256: sha(seedBytes), distSha256: buildManifest(distDir).summary.sha256, actorManifestSha256: fx.actorManifest.sha256, seedRowsSha256: fx.seedBinding.rowsSha256,
    adapterSha256: adapterDir ? (() => { try { return sha(fs.readFileSync(path.join(adapterDir, "index.mjs"))); } catch (e) { return null; } })() : null };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const usage = (m) => { console.error(m); process.exit(2); };
  const portList = (xs) => (xs.length && xs.every((n) => /^\d{1,5}$/.test(n) && Number(n) > 0 && Number(n) < 65536) ? xs.map(Number) : null);
  if (cmd === "ports-free") {
    const ports = portList(rest) || usage("usage: ports-free PORT...");
    let notFree = 0;
    for (const p of ports) { const st = await portState(p); if (st !== "free") { notFree++; console.error(`port ${p}: ${st}`); } }
    process.exit(notFree ? 1 : 0);
  }
  if (cmd === "listeners") {
    const [pid, ...ps] = rest;
    const ports = portList(ps);
    if (!/^\d+$/.test(pid || "") || !ports) usage("usage: listeners PID PORT...");
    const bad = listenerProblems(ports, Number(pid));
    for (const b of bad) console.error("listeners: " + b);
    process.exit(bad.length ? 1 : 0);
  }
  if (cmd === "adapter-check") {
    if (!rest[0] || !path.isAbsolute(rest[0]) || !rest[1] || !path.isAbsolute(rest[1])) usage("usage: adapter-check ABSOLUTE_ADAPTER_DIR ABSOLUTE_KIT_FILE");
    const bad = adapterProblems({ dir: rest[0], kit: rest[1] });
    for (const b of bad) console.error("adapter: " + b);
    process.exit(bad.length ? 1 : 0);
  }
  const [dir, a2, a3] = rest;
  if (!dir) { console.error("usage: toolchain DIR | pins DIR DISTDIR SEEDSHA | verdict DIR ENGINE"); process.exit(2); }
  if (cmd === "toolchain") {
    const bad = toolchain(dir);
    for (const b of bad) console.error("toolchain: " + b);
    process.exit(bad.length ? 1 : 0);
  } else if (cmd === "pins") {
    const pins = outsidePins(dir, a2, process.env.FEEL_PLAYWRIGHT && path.isAbsolute(process.env.FEEL_PLAYWRIGHT) ? process.env.FEEL_PLAYWRIGHT : undefined);
    if (a3 && a3 !== pins.seedFileSha256) { console.error("seed hash given does not match the seed file"); process.exit(1); }
    fs.writeFileSync(path.join(dir, "pins.json"), JSON.stringify(pins, null, 2) + "\n", { flag: "wx" });
  } else if (cmd === "verdict") {
    const input = { start: read(path.join(dir, "fixture-start.json")), report: read(path.join(dir, "fixture-report.json")), expected: read(path.join(dir, "fixture-expected.json")), pins: read(path.join(dir, "pins.json")) };
    const adapterEvidence = a2 === "chromium" ? read(path.join(dir, "adapter", "adapter-evidence.json")) : null;
    const bad = judge({ ...input, engine: a2, adapterEvidence });
    fs.writeFileSync(path.join(dir, "fixture-receipt.json"), JSON.stringify(receipt({ ...input, engine: a2, adapter: adapterEvidence, problems: bad }), null, 2) + "\n");
    for (const b of bad) console.error("fixture: " + b);
    console.log(bad.length ? "fixture verdict: FAILED" : "fixture verdict: the run stayed inside the contract");
    process.exit(bad.length ? 1 : 0);
  } else { console.error("unknown command"); process.exit(2); }
}
