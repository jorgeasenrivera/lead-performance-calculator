/* The strict browser kit's checks, tested with evidence that is wrong as well as evidence that is right.
 *
 * What this protects. The browser cases are only worth anything if the sandbox proof behind them cannot quietly go missing: a bypass flag in the real command line,
 * a renderer without seccomp or with capabilities, a network that lets a request leave loopback, a pin that was asked for and not met, a workflow that gained a secret
 * or a gating baseline. Each rule is a pure function or a source check, so this runs with no browser and no network, in node:test alone.
 * Limits. This proves the checks reject bad evidence; it does not run Chromium. The mounted cases (scripts/browser-security-cases.mjs) and the hosted workflow do that,
 * and nothing here claims they passed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeWritePolicy, createBackend } from "../scripts/synthetic-backend.mjs";
import { rejectBypass, parseProcStatus, checkRenderer, processEvidence, pinsFromEnv, checkSandboxText, guardContext } from "../scripts/strict-browser-kit.mjs";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const KIT = read("scripts/strict-browser-kit.mjs"), RUNNER = read("scripts/browser-security-cases.mjs"), WORKFLOW = read(".github/workflows/browser-security-cases.yml");

/* ---- command line ---- */
test("every sandbox bypass argument is refused, with or without a value", () => {
  for (const arg of ["--no-sandbox", "--no-sandbox=1", "--disable-setuid-sandbox", "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox", "--single-process", "--no-zygote"])
    assert.throws(() => rejectBypass(["/chrome", "--enable-automation", arg]), /bypass/, arg);
});
test("ordinary arguments pass, and no argv at all is no proof", () => {
  rejectBypass(["/chrome", "--enable-automation", "--headless=old", "--remote-debugging-pipe"]);
  assert.throws(() => rejectBypass([]), /No browser argv evidence/);
  assert.throws(() => rejectBypass(undefined), /No browser argv evidence/);
});

/* ---- /proc ---- */
const status = (o) => Object.entries({ Name: "chrome", NoNewPrivs: "1", Seccomp: "2", CapEff: "0000000000000000", NSpid: "6271\t11\t1", ...o }).map(([k, v]) => `${k}:\t${v}`).join("\n");
test("a status file is read field by field", () => {
  const f = parseProcStatus(status({}));
  assert.equal(f.Seccomp, "2"); assert.equal(f.NoNewPrivs, "1"); assert.equal(f.NSpid, "6271\t11\t1");
});
const good = { Seccomp: "2", NoNewPrivs: "1", CapEff: "0000000000000000", NSpid: ["6271", "11", "1"] };
test("a sandboxed renderer passes", () => { assert.equal(checkRenderer(good, ["6195"]), true); });
test("a renderer without seccomp, without no-new-privs, with capabilities, or in the browser's own namespace is refused", () => {
  assert.throws(() => checkRenderer({ ...good, Seccomp: "0" }, ["6195"]), /seccomp/);
  assert.throws(() => checkRenderer({ ...good, Seccomp: "1" }, ["6195"]), /seccomp/);
  assert.throws(() => checkRenderer({ ...good, NoNewPrivs: "0" }, ["6195"]), /privileges/);
  assert.throws(() => checkRenderer({ ...good, CapEff: "0000000000000400" }, ["6195"]), /capabilities/);
  assert.throws(() => checkRenderer({ ...good, CapEff: undefined }, ["6195"]), /capabilities/);
  assert.throws(() => checkRenderer({ ...good, NSpid: ["6271"] }, ["6195"]), /namespace/);
  assert.throws(() => checkRenderer({ ...good, NSpid: undefined }, ["6195"]), /namespace/);
  assert.throws(() => checkRenderer(good, undefined), /namespace/, "no browser namespace evidence is no proof");
});
test("process evidence reads status and argv, refuses a bypass in either place's argv, and fails when the evidence cannot be read", async () => {
  const reader = (cmd) => async (file) => file.endsWith("/status") ? status({}) : cmd;
  const ok = await processEvidence(1, reader("/chrome\0--type=renderer\0"));
  assert.equal(ok.Seccomp, "2"); assert.deepEqual(ok.argv, ["/chrome", "--type=renderer"]);
  await assert.rejects(() => processEvidence(1, reader("/chrome\0--no-sandbox\0")), /bypass/);
  await assert.rejects(() => processEvidence(1, async () => { throw new Error("ENOENT"); }), /ENOENT/);
  await assert.rejects(() => processEvidence(1, async (f) => f.endsWith("/status") ? status({}) : ""), /No browser argv evidence/);
});

/* ---- pins ---- */
const SUFFIX = JSON.stringify(["--noerrdialogs", "--flag-switches-begin"]);
test("pins are read from the environment, and asking for them makes each one required", () => {
  assert.deepEqual(pinsFromEnv({}), {});
  const all = { STRICT_EXPECT_PLAYWRIGHT: "1.63.0", STRICT_EXPECT_CHROME: "153.0.8010.12", STRICT_EXPECT_CDP_SUFFIX: SUFFIX };
  assert.deepEqual(pinsFromEnv({ ...all, STRICT_REQUIRE_PINS: "1" }), { playwright: "1.63.0", chrome: "153.0.8010.12", cdpSuffix: ["--noerrdialogs", "--flag-switches-begin"] });
  for (const gone of Object.keys(all)) { const e = { ...all, STRICT_REQUIRE_PINS: "1" }; delete e[gone]; assert.throws(() => pinsFromEnv(e), /Pin missing/, gone); }
  assert.throws(() => pinsFromEnv({ STRICT_EXPECT_CDP_SUFFIX: "{}" }), /JSON array/);
  assert.throws(() => pinsFromEnv({ STRICT_EXPECT_CDP_SUFFIX: "[]" }), /JSON array/);
  assert.throws(() => pinsFromEnv({ STRICT_EXPECT_CDP_SUFFIX: "[1]" }), /JSON array/);
});

/* ---- the browser's own sandbox page ---- */
const PAGE = "Layer 1 Sandbox\tNamespace\nPID namespaces\tYes\nNetwork namespaces\tYes\nSeccomp-BPF sandbox\tYes\n";
test("chrome://sandbox must say Namespace, PID and network namespaces and seccomp-BPF", () => {
  assert.equal(checkSandboxText(PAGE), true);
  assert.throws(() => checkSandboxText(PAGE.replace("Namespace\n", "Setuid\n")), /Namespace/);
  assert.throws(() => checkSandboxText(PAGE.replace("PID namespaces\tYes", "PID namespaces\tNo")), /PID namespaces/);
  assert.throws(() => checkSandboxText(PAGE.replace("Network namespaces\tYes", "Network namespaces\tNo")), /Network namespaces/);
  assert.throws(() => checkSandboxText(PAGE.replace("Seccomp-BPF sandbox\tYes", "Seccomp-BPF sandbox\tNo")), /Seccomp/);
  assert.throws(() => checkSandboxText(""), /Namespace/);
});

/* ---- the network ---- */
function fakeContext() {
  const calls = { route: null, ws: null };
  return { calls, route: async (_p, fn) => { calls.route = fn; }, routeWebSocket: async (_p, fn) => { calls.ws = fn; } };
}
const fakeRoute = (url, method = "GET") => { const r = { done: null, request: () => ({ url: () => url, method: () => method }), continue: () => { r.done = "continue"; }, abort: (why) => { r.done = "abort:" + why; } }; return r; };
test("only the allowed loopback origins pass; everything else is aborted and recorded", async () => {
  const ctx = fakeContext(), log = [];
  await guardContext(ctx, { allowedOrigins: ["http://127.0.0.1:5190", "http://127.0.0.1:5433"], log });
  for (const ok of ["http://127.0.0.1:5190/index.html", "http://127.0.0.1:5433/rest/v1/profiles?x=1", "data:text/plain,hi", "blob:http://127.0.0.1:5190/abc"]) { const r = fakeRoute(ok); ctx.calls.route(r); assert.equal(r.done, "continue", ok); }
  for (const no of ["https://example.com/", "http://127.0.0.1:9999/", "http://localhost:5190/", "http://127.0.0.1.evil.test:5190/", "http://[::1]:5190/", "file:///etc/passwd", "ftp://127.0.0.1:5190/"]) { const r = fakeRoute(no); ctx.calls.route(r); assert.equal(r.done, "abort:blockedbyclient", no); }
  assert.equal(log.length, 7); assert.ok(log.every((e) => e.kind === "refused-request"));
});
test("every WebSocket is closed and recorded", async () => {
  const ctx = fakeContext(), log = []; await guardContext(ctx, { allowedOrigins: ["http://127.0.0.1:5190"], log });
  let closed = null; ctx.calls.ws({ url: () => "ws://127.0.0.1:5433/realtime/v1/websocket?apikey=x", close: (c) => { closed = c; } });
  assert.equal(closed.code, 1008); assert.deepEqual(log.map((e) => e.kind), ["refused-websocket"]);
});
test("a non-loopback origin cannot be allowed", async () => {
  for (const bad of ["https://example.com", "http://localhost:5190", "http://127.0.0.1", "http://0.0.0.0:5190", "*", ""]) await assert.rejects(() => guardContext(fakeContext(), { allowedOrigins: [bad], log: [] }), /loopback/, bad);
  await assert.rejects(() => guardContext(fakeContext(), { allowedOrigins: "http://127.0.0.1:5190", log: [] }), /loopback/);
});

/* ---- source rules: the kit never launches without the sandbox, the runner fails closed, the workflow stays read-only ---- */
const kitProblems = (text) => {
  const bad = [];
  if (/chromiumSandbox:\s*false/.test(text)) bad.push("chromiumSandbox false");
  if (/ignoreDefaultArgs/.test(text)) bad.push("ignoreDefaultArgs");
  if (/launchPersistentContext|chromium\.launch\(/.test(text)) bad.push("a launch route that is not launchServer");
  // line by line, because one launch sits inside the template that is run as the unprivileged user and has braces of its own
  for (const line of text.split("\n")) if (/launchServer\(/.test(line) && !/chromiumSandbox:\s*true/.test(line)) bad.push("launchServer without chromiumSandbox: true");
  if ((text.match(/launchServer\(/g) || []).length < 2) bad.push("expected the launch in the child script and the direct launch");
  if (!/launchServer\(/.test(text)) bad.push("no launchServer at all");
  if (/args:\s*\[[^\]]*(sandbox|single-process|zygote)/.test(text)) bad.push("a bypass in launch args");
  if (!/FAIL CLOSED: Chromium refuses its sandbox as root/.test(text)) bad.push("no refusal as root");
  return bad;
};
test("the kit only launches Chromium with its sandbox on and never falls back", () => { assert.deepEqual(kitProblems(KIT), []); });
/* A mutant is only a test if the replacement actually changed the text. */
const mut = (text, from, to) => { assert.ok(text.includes(from), "mutation anchor not found: " + from); return text.replace(from, to); };
test("MUTATION: kit variants that switch the sandbox off or add a fallback are caught", () => {
  assert.ok(kitProblems(mut(KIT, "headless: true, chromiumSandbox: true, timeout: 30_000 });", "headless: true, chromiumSandbox: false, timeout: 30_000 });")).includes("chromiumSandbox false"));
  assert.ok(kitProblems(mut(KIT, "headless: true, chromiumSandbox: true, timeout: ${Number(timeout)}", "headless: true, timeout: ${Number(timeout)}")).includes("launchServer without chromiumSandbox: true"), "the child-script launch is covered too");
  assert.ok(kitProblems(mut(KIT, 'args: ["--enable-automation"], headless: true, chromiumSandbox: true, timeout: 30_000 });', 'args: ["--enable-automation"], ignoreDefaultArgs: true, headless: true, chromiumSandbox: true, timeout: 30_000 });')).includes("ignoreDefaultArgs"));
  assert.ok(kitProblems(KIT + "\nawait chromium.launch({ chromiumSandbox: true });").includes("a launch route that is not launchServer"));
  assert.ok(kitProblems(mut(KIT, 'args: ["--enable-automation"], headless: true, chromiumSandbox: true, timeout: 30_000 });', 'args: ["--no-sandbox"], headless: true, chromiumSandbox: true, timeout: 30_000 });')).includes("a bypass in launch args"));
  assert.ok(kitProblems(mut(KIT, "FAIL CLOSED: Chromium refuses its sandbox as root", "x")).includes("no refusal as root"));
});

const runnerProblems = (text) => {
  const bad = [];
  for (const need of ["EXPECTED_IDS", "countsAsRepairResult", "DEADLINE_MS", "auditCalls", "expect: pinsFromEnv()", "NO RENDERER AUDIT RAN", "APP_ALLOWED", "appProblems(s)", "WRITE_RULES", "makePolicy", "qualifying: !WRITE_PROBE && PINS_COMPLETE", "refused on the hosted runner", "WRITE_PROBE || failed || skipped", "failed || skipped || exitCode || missing.length || !auditCalls ? 1 : 0", "never a repair result"])
    if (!text.includes(need)) bad.push("missing: " + need);
  if (/--no-sandbox|chromiumSandbox:\s*false/.test(text)) bad.push("runner mentions a sandbox bypass");
  return bad;
};
test("the runner fails closed: a deadline, every expected case, a renderer audit, pins, and a baseline that is never a repair result", () => { assert.deepEqual(runnerProblems(RUNNER), []); });
test("MUTATION: a runner that drops the exit enforcement, the audit requirement, the pins or the baseline label is caught", () => {
  assert.ok(runnerProblems(mut(RUNNER, "failed || skipped || exitCode || missing.length || !auditCalls ? 1 : 0", "failed ? 1 : 0")).length > 0);
  assert.ok(runnerProblems(RUNNER.replaceAll("auditCalls", "audited")).length > 0);
  assert.ok(runnerProblems(mut(RUNNER, "expect: pinsFromEnv()", "expect: {}")).length > 0);
  assert.ok(runnerProblems(mut(RUNNER, "never a repair result", "")).length > 0);
  assert.ok(runnerProblems(RUNNER.replaceAll("EXPECTED_IDS", "EXPECTED_IDX")).length > 0);
});

const workflowProblems = (text) => {
  const bad = [];
  const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  if (!uses.length || uses.some((u) => !/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(u))) bad.push("an action is not pinned to a full SHA");
  if (!/^permissions:\n  contents: read\n/m.test(text) || (text.match(/^\s*permissions:/gm) || []).length !== 1) bad.push("permissions are not exactly contents: read");
  if (/secrets\.|GITHUB_TOKEN|pull_request_target|workflow_dispatch|schedule:/.test(text)) bad.push("a secret, token or non-PR trigger");
  if (/\b(deploy|vercel|supabase\s|gh release|git push)\b/i.test(text.replace(/#.*$/gm, ""))) bad.push("a deployment or write step");
  const checkouts = (text.match(/actions\/checkout@/g) || []).length;
  if ((text.match(/persist-credentials: false/g) || []).length !== checkouts || !checkouts) bad.push("a checkout keeps credentials");
  for (const pin of ["playwright@1.63.0", "STRICT_EXPECT_PLAYWRIGHT: '1.63.0'", "STRICT_EXPECT_CHROME: '153.0.8010.12'", "STRICT_REQUIRE_PINS: '1'", "STRICT_REQUIRE_DIAGNOSTICS: '1'", "--no-shell chromium", "ubuntu-22.04", "retention-days: 3", "timeout-minutes: 12", "github.head_ref == 'codex/nov1-security-recovery-integration'", "ref: 82e59f924020e11148a6d07fe41ff75f6de7d6f7"])
    if (!text.includes(pin)) bad.push("missing: " + pin);
  const steps = text.split(/\n      - /);
  const corrected = steps.find((x) => x.includes("--expect corrected")), baseline = steps.find((x) => x.includes("--expect baseline"));
  if (!corrected || /continue-on-error/.test(corrected)) bad.push("the corrected step can be ignored");
  if (!baseline || !/continue-on-error: true/.test(baseline)) bad.push("the baseline step can gate or stand in for the corrected one");
  if (/--expect baseline/.test(corrected || "")) bad.push("corrected step runs the baseline");
  if (/sudo|--no-sandbox|chromiumSandbox/.test(text)) bad.push("sudo or a sandbox switch in the workflow");
  if (/STRICT_WRITE_PROBE/.test(text)) bad.push("the discovery bypass is enabled in the workflow");
  return bad;
};
test("the workflow is read-only, SHA-pinned, secret-free, bounded, and keeps the baseline out of the verdict", () => { assert.deepEqual(workflowProblems(WORKFLOW), []); });
test("MUTATION: each way of making the workflow less safe is caught", () => {
  const caught = (t) => assert.ok(workflowProblems(t).length > 0);
  assert.notEqual(WORKFLOW.replace("playwright@1.63.0", "playwright@latest"), WORKFLOW);
  caught(WORKFLOW.replace("@11bd71901bbe5b1630ceea73d27597364c9af683", "@v4"));
  caught(WORKFLOW.replace("contents: read", "contents: write"));
  caught(WORKFLOW.replace("persist-credentials: false", "persist-credentials: true"));
  caught(WORKFLOW + "\n      - run: echo ${{ secrets.X }}\n");
  caught(WORKFLOW.replace("pull_request:", "pull_request_target:"));
  caught(WORKFLOW.replace("continue-on-error: true", "continue-on-error: false"));
  caught(WORKFLOW.replace("--expect corrected", "--expect corrected\n        continue-on-error: true"));
  caught(WORKFLOW.replace("playwright@1.63.0", "playwright@latest"));
  caught(WORKFLOW.replace("STRICT_REQUIRE_PINS: '1'", "STRICT_REQUIRE_PINS: '0'"));
  caught(WORKFLOW.replace("timeout-minutes: 12", ""));
  caught(WORKFLOW.replace("STRICT_REQUIRE_PINS: '1'", "STRICT_REQUIRE_PINS: '1'\n      STRICT_WRITE_PROBE: '1'"));
  caught(WORKFLOW + "\n      - run: npx vercel deploy\n");
  caught(WORKFLOW.replace("github.head_ref == 'codex/nov1-security-recovery-integration'", "true"));
});

/* ---- the synthetic backend's writes ---- */
const w = (method, rows) => ({ method, body: JSON.stringify(rows) });
test("a write policy admits only a named table, method and key, up to its count", () => {
  const p = makeWritePolicy([{ table: "app_data", method: "POST", key: /^lpc:config:backups-index:v1$/, max: 2 }]);
  assert.equal(p(w("POST", [{ key: "lpc:config:backups-index:v1", value: {} }]), "app_data"), true);
  assert.equal(p(w("POST", { key: "lpc:config:backups-index:v1" }), "app_data"), true, "a single row object");
  assert.equal(p(w("POST", [{ key: "lpc:config:backups-index:v1" }]), "app_data"), false, "the third use is over the count");
  assert.deepEqual(p.counts().map((c) => c.seen), [2]);
});
test("a write outside the policy is refused: other table, other method, other key, a mixed batch, an empty or unreadable body", () => {
  const p = () => makeWritePolicy([{ table: "app_data", method: "POST", key: /^lpc:config:backups-index:v1$/, max: 9 }]);
  assert.equal(p()(w("POST", [{ key: "lpc:config:backups-index:v1" }]), "profiles"), false);
  assert.equal(p()(w("PATCH", [{ key: "lpc:config:backups-index:v1" }]), "app_data"), false);
  assert.equal(p()(w("POST", [{ key: "lpc:store:sage-demo:v2" }]), "app_data"), false);
  assert.equal(p()(w("POST", [{ key: "lpc:config:backups-index:v1" }, { key: "lpc:store:sage-demo:v2" }]), "app_data"), false, "one bad row refuses the batch");
  assert.equal(p()(w("POST", []), "app_data"), false);
  assert.equal(p()({ method: "POST", body: "not json" }, "app_data"), false);
  assert.equal(p()({ method: "POST", body: "" }, "app_data"), false);
  assert.equal(makeWritePolicy([])(w("POST", [{ key: "x" }]), "app_data"), false, "no rules allows nothing");
});
test("a write carrying anything from the invented files or the typed password is refused even on an allowed key", () => {
  const p = makeWritePolicy([{ table: "app_data", method: "POST", key: /^k$/, max: 9 }]);
  assert.equal(p(w("POST", [{ key: "k", value: "Quinn Zzfictional" }]), "app_data"), false);
  assert.equal(p(w("POST", [{ key: "k", value: "a-new-synthetic-password-1" }]), "app_data"), false);
  assert.equal(p(w("POST", [{ key: "k", value: "fine" }]), "app_data"), true);
});
test("the backend allows no table write unless the case gave it a policy, and says so as an unexpected request", async () => {
  assert.ok(/if \(!state\.writePolicy \|\| !state\.writePolicy\(entry, m\[1\], body\)\)/.test(read("scripts/synthetic-backend.mjs")), "the guard sits in front of every POST and PATCH to a table");
  assert.ok(/state\.unexpected\.push\(\{ \.\.\.entry, why: "table write not allowed/.test(read("scripts/synthetic-backend.mjs")));
  const b = createBackend({}); assert.equal(b.writePolicy, null);
});

test("the discovery bypass cannot run on the hosted runner: the runner refuses before it starts anything", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "strict-probe-refusal-"));
  const dist = path.join(tmp, "dist"); fs.mkdirSync(dist); fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html>");
  const out = path.join(tmp, "out");
  const run = (env) => spawnSync(process.execPath, [new URL("../scripts/browser-security-cases.mjs", import.meta.url).pathname, "--dist", dist, "--out", out, "--app-port", "0"], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 20000 });
  const hosted = run({ STRICT_WRITE_PROBE: "1", GITHUB_ACTIONS: "true" });
  assert.notEqual(hosted.status, 0); assert.match(hosted.stderr, /refused on the hosted runner/);
  assert.ok(!fs.existsSync(out), "nothing was created for a refused run");
  // and a probe run anywhere is marked so it can never count: result.json says nonqualifying and the exit is 1
  assert.ok(/qualifying: !WRITE_PROBE/.test(RUNNER) && /WRITE_PROBE \|\| failed \|\| skipped/.test(RUNNER));
});

test("a rule can name whose session may write, and a write by anyone else is refused", () => {
  const p = makeWritePolicy([{ table: "app_data", method: "POST", key: /^k$/, auth: /^synthetic-token-/, max: 3 }]);
  assert.equal(p({ method: "POST", auth: "token-rec", body: JSON.stringify([{ key: "k" }]) }, "app_data"), false, "a recovery or stale token");
  assert.equal(p({ method: "POST", auth: "", body: JSON.stringify([{ key: "k" }]) }, "app_data"), false, "no token");
  assert.equal(p({ method: "POST", auth: "synthetic-token-1", body: JSON.stringify([{ key: "k" }]) }, "app_data"), true);
});
test("a finding rule lets the write through, records it, and is never silent; unmet minimums are reported", () => {
  const p = makeWritePolicy([{ table: "app_data", method: "POST", key: /^k$/, min: 2, max: 2, finding: "not approved here" }]);
  assert.equal(p(w("POST", [{ key: "k" }]), "app_data"), true);
  assert.deepEqual(p.findings().map((f) => [f.key, f.finding]), [["k", "not approved here"]]);
  assert.equal(p.unmet().length, 1);
  p(w("POST", [{ key: "k" }]), "app_data"); assert.equal(p.unmet().length, 0);
  assert.equal(p(w("POST", [{ key: "k" }]), "app_data"), false, "a third write is over the count even for a finding");
  assert.equal(makeWritePolicy([{ table: "app_data", method: "POST", key: /^k$/, max: 1 }]).findings().length, 0);
});
test("the runner's approved writes are exactly the automatic backup: for admin sessions at sign-in, and for recovery sessions only AFTER the reset is saved or left", () => {
  assert.ok(/A1: backupRules\(\/\^synthetic-token-\/\)/.test(RUNNER) && /XC: backupRules\(\/\^synthetic-token-\/\)/.test(RUNNER));
  assert.ok(/REC: \[\],/.test(RUNNER), "a recovery session approves no table write by default");
  assert.ok(/const afterReset = \(phase\) => backupRules\(\/\^token-rec\\d\?\$\/\)\.map\(\(r\) => \(\{ \.\.\.r, phase \}\)\);/.test(RUNNER), "the recovery cases name a phase for the one backup they expect");
  assert.ok(/default: \[\]/.test(RUNNER), "no other session approves any table write");
  assert.ok(!/STRICT_WRITE_PROBE/.test(WORKFLOW));
});

test("the policy reads the whole body even when the recorded entry was cut short, and an unreadable cut body is refused", () => {
  const big = JSON.stringify([{ key: "k", value: "x".repeat(5000) }]);
  const p = makeWritePolicy([{ table: "app_data", method: "POST", key: /^k$/, max: 2 }]);
  assert.equal(p({ method: "POST", body: big.slice(0, 1500) }, "app_data", big), true, "the full body is what is judged");
  assert.equal(p({ method: "POST", body: big.slice(0, 1500) }, "app_data"), false, "a truncated body cannot be judged and is refused");
});
