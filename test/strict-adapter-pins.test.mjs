/* Adapter delta 6, with a FAKE kit and no browser: the pins reach the kit's launch exactly, a missing or malformed pin stops the launch before the kit is called,
   and a failed launch leaves no evidence file and no exit hook behind. The kit's own pinsFromEnv is the REAL one (its bytes are read from the FINAL kit file and checked
   against the pinned final-kit hash first); only launchStrict and the browser are fakes. Needs ADAPTER6_FILE (the adapter6 index.mjs); skips with a reason otherwise.
   Each scenario runs in its own process because the adapter allows one launch per process. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { KIT_SHA256, ADAPTER_SHA256, STRICT_PINS } from "../scripts/shots-fixture-verdict.mjs";

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const ADAPTER = process.env.ADAPTER6_FILE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
// The real pinsFromEnv comes from the FINAL kit file (the composed scripts/strict-browser-kit.mjs, or ADAPTER_PINS_KIT_FILE), not from a git object of the baseline kit.
const KIT_FILE = process.env.ADAPTER_PINS_KIT_FILE || path.join(HERE, "..", "scripts", "strict-browser-kit.mjs");
let kitBytes = null;
try { kitBytes = fs.readFileSync(KIT_FILE); } catch (e) {}
const skip = !ADAPTER ? "set ADAPTER6_FILE to the adapter6 index.mjs" : !kitBytes ? `the kit file ${KIT_FILE} is not readable here` : null;
const t = (name, fn) => (skip ? test(name, { skip }, fn) : test(name, fn));

const work = fs.mkdtempSync(path.join(os.tmpdir(), "adapter-pins-"));
const realKit = path.join(work, "strict-browser-kit.real.mjs");
if (kitBytes) fs.writeFileSync(realKit, kitBytes);
const fakeKit = path.join(work, "fake-kit.mjs");
fs.writeFileSync(fakeKit, `
import { pinsFromEnv as realPins } from ${JSON.stringify(pathToFileURL(realKit).href)};
globalThis.__pinsCalls = 0; globalThis.__launchCalls = 0; globalThis.__launchArgs = null;
export function pinsFromEnv(...a) { globalThis.__pinsCalls++; return realPins(...a); }
export async function launchStrict(arg) {
  globalThis.__launchCalls++; globalThis.__launchArgs = JSON.parse(JSON.stringify(arg));
  if (process.env.FAKE_LAUNCH === "throw") throw new Error("Chrome version is not the pinned one");   // what the real kit does after it has started its server
  const browser = { marker: 1, newContext: async () => ({ route: async () => {}, routeWebSocket: async () => {}, exposeBinding: async () => {}, addInitScript: async () => {}, on() {}, newPage: async () => ({ once() {}, route() {}, routeWebSocket() {} }) }),
    newPage: async () => ({}), on() { return browser; }, close: async () => {} };
  return { browser, evidence: { runAs: { user: "x", uid: 1000 }, cdpArgv: [], browserProcess: { pid: 2147483646, argv: [] }, executable: "x" },
    auditRenderers: async () => [{ pid: 1, Seccomp: "2", NoNewPrivs: "1", CapEff: "0", NSpid: ["1"] }], close: async () => { await browser.close(); } };
}`);
const child = path.join(work, "child.mjs");
fs.writeFileSync(child, `
import path from "node:path"; import fs from "node:fs"; import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.ADAPTER_UNDER_TEST).href);
const exitBefore = process.listeners("exit").length, out = {};
const attempt = async () => { try { await chromium.launch({}); return { launched: true }; } catch (e) { return { launched: false, err: String(e.message).slice(0, 160) }; } };
out.first = await attempt();
if (process.env.TWICE === "1") out.second = await attempt();
out.pinsCalls = globalThis.__pinsCalls || 0; out.launchCalls = globalThis.__launchCalls || 0; out.launchArgs = globalThis.__launchArgs;
out.exitHooksAdded = process.listeners("exit").length - exitBefore;
const ev = path.join(process.env.ADAPTER_OUT, "adapter-evidence.json");
out.evidenceFile = fs.existsSync(ev); if (out.evidenceFile) { const j = JSON.parse(fs.readFileSync(ev, "utf8")); out.pinsRequired = j.pinsRequired; out.status = j.status; }
console.log(JSON.stringify(out));
process.exit(0);`);
let n = 0;
const PINS = { ...STRICT_PINS };
function run(env = {}, { twice = false } = {}) {
  const out = path.join(work, "out-" + ++n);
  const base = { PATH: process.env.PATH, ADAPTER_UNDER_TEST: ADAPTER, ADAPTER_KIT: fakeKit, ADAPTER_KIT_SHA256: sha(fs.readFileSync(fakeKit)), ADAPTER_OUT: out, ADAPTER_LABEL: "pins", ADAPTER_REGISTER_EXIT: "0", STRICT_BROWSER_DRIVER: "/nonexistent-driver", TWICE: twice ? "1" : "0" };
  const r = spawnSync(process.execPath, [child], { encoding: "utf8", env: { ...base, ...env } });
  assert.equal(r.status, 0, r.stderr.slice(0, 400));
  return JSON.parse(r.stdout.trim().split("\n").pop());
}
const FULL = { ADAPTER_REQUIRE_PINS: "1", ...PINS };
const without = (env, k) => { const e = { ...env }; delete e[k]; return e; };

t("the inputs are the reviewed ones: the kit bytes are the FINAL kit (the hosted pin), and the adapter is adapter6", () => {
  assert.equal(sha(kitBytes), KIT_SHA256); assert.equal(sha(fs.readFileSync(ADAPTER)), ADAPTER_SHA256);
});

t("with ADAPTER_REQUIRE_PINS=1 and all pins, launchStrict receives exactly the object the kit's own pinsFromEnv returns", () => {
  const r = run(FULL);
  assert.equal(r.first.launched, true); assert.equal(r.pinsCalls, 1); assert.equal(r.launchCalls, 1);
  assert.deepEqual(r.launchArgs, { driver: "/nonexistent-driver", expect: { playwright: "1.63.0", chrome: "153.0.8010.12", cdpSuffix: JSON.parse(STRICT_PINS.STRICT_EXPECT_CDP_SUFFIX) } });
  assert.equal(r.pinsRequired, true, "the evidence says the pins were applied at launch");
});

t("unset or any value other than the string 1: nothing changes from adapter5 (expect {}, the kit's pinsFromEnv is not called); the verdict side demands 1 and pinsRequired true", () => {
  for (const v of [undefined, "0", "true", "", "yes"]) {
    const r = run({ ...PINS, ...(v === undefined ? {} : { ADAPTER_REQUIRE_PINS: v }) });
    assert.equal(r.first.launched, true, String(v)); assert.equal(r.pinsCalls, 0, String(v)); assert.deepEqual(r.launchArgs.expect, {}, String(v)); assert.equal(r.pinsRequired, false, String(v));
  }
});

t("STRICT_REQUIRE_PINS missing or not 1: the adapter refuses before the kit's pinsFromEnv or launchStrict is called", () => {
  for (const v of [undefined, "0", "true", ""]) {
    const env = v === undefined ? without(FULL, "STRICT_REQUIRE_PINS") : { ...FULL, STRICT_REQUIRE_PINS: v };
    const r = run(env);
    assert.equal(r.first.launched, false, String(v)); assert.match(r.first.err, /ADAPTER_REQUIRE_PINS=1 needs STRICT_REQUIRE_PINS=1/);
    assert.equal(r.pinsCalls, 0); assert.equal(r.launchCalls, 0);
  }
});

t("each missing pin (absent or empty) fails in the kit's pinsFromEnv and the launch is NOT called", () => {
  for (const k of ["STRICT_EXPECT_PLAYWRIGHT", "STRICT_EXPECT_CHROME", "STRICT_EXPECT_CDP_SUFFIX"]) {
    for (const mode of ["absent", "empty"]) {
      const env = mode === "absent" ? without(FULL, k) : { ...FULL, [k]: "" };
      const r = run(env);
      assert.equal(r.first.launched, false, `${k} ${mode}`); assert.match(r.first.err, new RegExp(`Pin missing while STRICT_REQUIRE_PINS=1: ${{ STRICT_EXPECT_PLAYWRIGHT: "playwright", STRICT_EXPECT_CHROME: "chrome", STRICT_EXPECT_CDP_SUFFIX: "cdpSuffix" }[k]}`));
      assert.equal(r.pinsCalls, 1); assert.equal(r.launchCalls, 0, `${k} ${mode}: launchStrict must not be called`);
    }
  }
});

t("a malformed CDP suffix (not JSON, not an array, empty, non-strings) stops the launch before launchStrict", () => {
  for (const bad of ["not json", "{\"a\":1}", "[]", "[1,2]", "[\"ok\",3]", "\"--x\"", "null"]) {
    const r = run({ ...FULL, STRICT_EXPECT_CDP_SUFFIX: bad });
    assert.equal(r.first.launched, false, bad); assert.equal(r.launchCalls, 0, bad);
    assert.ok(r.first.err.length > 0, bad);
  }
});

t("any failure before launch leaves no evidence file and registers no exit hook, so the caller sees a thrown error and the verdict sees missing evidence", () => {
  for (const env of [without(FULL, "STRICT_REQUIRE_PINS"), without(FULL, "STRICT_EXPECT_CHROME"), { ...FULL, STRICT_EXPECT_CDP_SUFFIX: "[]" }]) {
    const r = run(env);
    assert.equal(r.first.launched, false); assert.equal(r.evidenceFile, false); assert.equal(r.exitHooksAdded, 0);
  }
});

t("a launchStrict that throws after the kit has started its server (a Chrome version mismatch): the error reaches the caller, nothing is claimed launched, no evidence, no exit hook", () => {
  const r = run({ ...FULL, FAKE_LAUNCH: "throw" });
  assert.equal(r.first.launched, false); assert.match(r.first.err, /Chrome version is not the pinned one/);
  assert.equal(r.launchCalls, 1); assert.equal(r.evidenceFile, false); assert.equal(r.exitHooksAdded, 0);
});

t("KNOWN RESIDUAL, not endorsed: after a failed launch the adapter does not latch, so a second launch() calls the kit again (with the leaking kit, a second server). The pin failure itself repeats; a latch would be a further adapter delta", () => {
  const r = run({ ...FULL, FAKE_LAUNCH: "throw" }, { twice: true });
  assert.equal(r.first.launched, false); assert.equal(r.second.launched, false);
  assert.equal(r.launchCalls, 2, "two kit launches for two attempts");
});
