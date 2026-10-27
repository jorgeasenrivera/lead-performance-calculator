// Pure tests for workflow-compose.mjs and for the fixed-vocabulary stage annotations in the three reviewed insertions.
// No network, no Git, no install, no files written. Shell scripts under test run in `bash -c` with a stubbed `node` function and fixed env values.
// Run: node --test scripts/pr501-contract/workflow-compose.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { composeWorkflow, ANCHOR_A, ANCHOR_B } from "./workflow-compose.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (n) => fs.readFileSync(path.join(here, n), "utf8");
const A = read("workflow-insert.template.yml"), B = read("workflow-insert-measure.yml"), C = read("workflow-insert-final.yml");
const PINS = { EXPECTED_CONTRACT_DIGEST: "d", EXPECTED_DELTA_SHA256: "e", EXPECTED_VALIDATOR_SHA256: "v", EXPECTED_TS_VERSION: "6.0.2", EXPECTED_TS_LIB_SHA256: "l" };
const OLD = `jobs:\n  spacing:\n    steps:\n      - run: npm ci\n${ANCHOR_A}      - name: Build fictional app\n        run: npm run build\n${ANCHOR_B}        run: node scripts/manager-spacing.mjs\n      - uses: actions/upload-artifact@v4\n        with:\n          name: x\n`;

// ---- composition ----
test("W01 composition places A for the guard step, B before the measure step (kept), C last, and nothing else changes", () => {
  const out = composeWorkflow({ oldText: OLD, tplA: A, tplB: B, tplC: C, pins: PINS });
  const [pre, post] = OLD.split(ANCHOR_A);
  assert.ok(out.startsWith(pre + A.replace(/@@EXPECTED_DELTA_SHA256@@/g, "e").replace(/@@EXPECTED_CONTRACT_DIGEST@@/g, "d").replace(/@@EXPECTED_VALIDATOR_SHA256@@/g, "v").replace(/@@EXPECTED_TS_VERSION@@/g, "6.0.2").replace(/@@EXPECTED_TS_LIB_SHA256@@/g, "l")));
  assert.ok(out.endsWith(C));
  assert.equal(out.split(ANCHOR_B).length, 2);
  assert.ok(out.includes(B + ANCHOR_B));
  assert.ok(out.includes(post.split(ANCHOR_B)[0] + B + ANCHOR_B + post.split(ANCHOR_B)[1]));
});
test("W02 anchors: missing or duplicated A or B, B before A, no trailing newline, and unfilled pins are all refused", () => {
  const bad = (oldText, tplA = A, pins = PINS) => assert.throws(() => composeWorkflow({ oldText, tplA, tplB: B, tplC: C, pins }));
  bad(OLD.replace(ANCHOR_A, ""));
  bad(OLD + ANCHOR_A);
  bad(OLD.replace(ANCHOR_B, ""));
  bad(OLD + ANCHOR_B);
  bad(`${ANCHOR_B}${OLD}`);
  bad(OLD.slice(0, -1));
  bad(OLD, A, { ...PINS, EXPECTED_DELTA_SHA256: undefined });
});
test("W03 B and C carry no pin placeholders; A carries exactly the five reviewed ones", () => {
  assert.ok(!/@@[A-Z0-9_]+@@/.test(B + C));
  assert.deepEqual([...new Set(A.match(/@@[A-Z0-9_]+@@/g))].sort(), ["@@EXPECTED_CONTRACT_DIGEST@@", "@@EXPECTED_DELTA_SHA256@@", "@@EXPECTED_TS_LIB_SHA256@@", "@@EXPECTED_TS_VERSION@@", "@@EXPECTED_VALIDATOR_SHA256@@"]);
});

// ---- static properties of the three insertions ----
const ALL = A + B + C;
const lines = ALL.split("\n");
function runBlocks(text) {                    // [{indent, body}] for every `run: |` block
  const out = []; const L = text.split("\n");
  for (let i = 0; i < L.length; i++) {
    const m = /^(\s*)run: \|\s*$/.exec(L[i]); if (!m) continue;
    const body = []; for (let j = i + 1; j < L.length && (L[j] === "" || L[j].startsWith(m[1] + "  ")); j++) body.push(L[j]);
    out.push(body.join("\n"));
  }
  return out;
}
test("W04 no `${{` expression appears inside any added run script (values arrive through env only)", () => {
  for (const b of runBlocks(ALL)) assert.ok(!b.includes("${{"), b);
  for (const l of lines) if (/^\s*run: [^|]/.test(l)) assert.ok(!l.includes("${{"), l);
});
test("W05 every annotation line is one of a closed set of fixed sentences", () => {
  const ok = [/^echo "::notice title=PR501_STAGE::Stage starting, (checkout|hash|install|verify|build|measurement)\."$/,
    /^echo "::(notice|error) title=PR501_RUNNER::Runner exit class\. exit=(0|1|2|3|other)\."$/,
    /^echo "::(notice|error) title=PR501_OUTCOMES::\$line"$/];
  const found = [];
  for (const raw of lines) {
    const t = raw.trim().replace(/^run: /, "").replace(/^[0-9*]\) /, "").replace(/ ;;$/, "").replace(/^\*failure\*\|\*cancelled\*\) /, "").replace(/^\*\) /, "");
    if (!t.includes("::notice") && !t.includes("::error") && !t.includes("::warning")) continue;
    found.push(t); assert.ok(ok.some((r) => r.test(t)), `unexpected annotation line: ${t}`);
  }
  assert.ok(found.length >= 6 + 5 + 2);
  assert.ok(!ALL.includes("::warning"));
});
test("W06 the six stage labels are exactly checkout, hash, install, verify, build, measurement, each once and in this order", () => {
  assert.deepEqual([...A.matchAll(/Stage starting, (\w+)\./g)].map((m) => m[1]), ["checkout", "hash", "install", "verify", "build"]);
  assert.deepEqual([...B.matchAll(/Stage starting, (\w+)\./g)].map((m) => m[1]), ["measurement"]);
});
test("W07 every added step is gated on the contract route (or, for the outcome step, the same route or an early route failure on this branch); nothing weakens a gate", () => {
  for (const [name, text] of [["A", A], ["B", B]]) {
    for (const step of text.split(/\n(?=      - )/)) {
      if (/id: route|Verify frozen preview runtime/.test(step.split("\n").slice(0, 2).join("\n"))) continue;
      assert.match(step, /steps\.route\.outputs\.contract == 'true'/, `${name}: ${step.split("\n")[0]}`);
    }
  }
  assert.match(C, /always\(\) && \(steps\.route\.outputs\.contract == 'true' \|\| \(steps\.route\.outcome != 'success' && github\.head_ref == 'codex\/nov1-security-recovery-integration'\)\)/);
});
test("W08 no continue-on-error, no permissions, no new framework, no threshold or timeout in any insertion", () => {
  for (const w of ["continue-on-error", "permissions", "timeout", "threshold", "uses: actions/github-script"]) assert.ok(!ALL.includes(w), w);
});
test("W09 markers and gated steps never use always(); only the existing result upload and the outcome step do", () => {
  const withAlways = ALL.split("\n").filter((l) => l.includes("always()"));
  assert.equal(withAlways.length, 2, withAlways.join(" | "));
});
test("W10 the contract steps keep their ids and the unchanged guard stays unchanged", () => {
  for (const id of ["ck_head", "ck_frozen", "ck_main", "ck_477", "hash", "ts_install", "verify"]) assert.equal(A.split(`        id: ${id}\n`).length, 2, id);
  assert.ok(A.includes("      - name: Verify frozen preview runtime\n        # The default guard, unchanged"));
  assert.ok(A.includes("        run: sha256sum --check scripts/search-runtime.sha256\n"));
  for (const id of ["ck_head", "ck_frozen", "ck_main", "ck_477", "hash", "ts_install", "verify"]) assert.ok(C.includes(`steps.${id}.outcome`), id);
});

// ---- behaviour of the real scripts ----
const bash = (script, env = {}) => spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
function step(text, nameFrag) {
  const s = text.split(/\n(?=      - )/).find((x) => x.includes(nameFrag)); assert.ok(s, nameFrag);
  return runBlocks(s)[0];
}
const VERIFY = step(A, "PR501 contract, verify");
test("W11 the verify wrapper keeps the runner's exact exit status and annotates only a closed class", () => {
  for (const [rc, expect] of [[0, "::notice title=PR501_RUNNER::Runner exit class. exit=0."], [1, "::error title=PR501_RUNNER::Runner exit class. exit=1."], [2, "::error title=PR501_RUNNER::Runner exit class. exit=2."],
    [3, "::error title=PR501_RUNNER::Runner exit class. exit=3."], [7, "::error title=PR501_RUNNER::Runner exit class. exit=other."], [137, "::error title=PR501_RUNNER::Runner exit class. exit=other."]]) {
    const r = bash(`RUNNER_TEMP=/x; node() { echo "SECRET-RUNNER-OUTPUT" >&2; return ${rc}; }; ${VERIFY}`);
    assert.equal(r.status, rc, `status for ${rc}`);
    assert.equal(r.stdout.trim(), expect);
    assert.ok(!r.stdout.includes("SECRET"));
  }
});
const OUTCOME = runBlocks(C)[0];
const envOf = (o) => ({ O_ROUTE: "success", O_CK_HEAD: "success", O_CK_FROZEN: "success", O_CK_MAIN: "success", O_CK_477: "success", O_HASH: "success", O_TS: "success", O_VERIFY: "success", O_JOB: "success", ...o });
test("W12 the outcome step prints a fixed line, exits 0, is a notice when nothing failed and an error otherwise", () => {
  const ok = bash(OUTCOME, envOf({}));
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), "::notice title=PR501_OUTCOMES::Stage outcomes. route=success checkout_head=success checkout_frozen=success checkout_main=success checkout_477=success hash=success install=success verify=success job=success.");
  const f = bash(OUTCOME, envOf({ O_TS: "failure", O_VERIFY: "skipped", O_JOB: "failure" }));
  assert.equal(f.status, 0);
  assert.equal(f.stdout.trim(), "::error title=PR501_OUTCOMES::Stage outcomes. route=success checkout_head=success checkout_frozen=success checkout_main=success checkout_477=success hash=success install=failure verify=skipped job=failure.");
  const c = bash(OUTCOME, envOf({ O_JOB: "cancelled" }));
  assert.ok(c.stdout.startsWith("::error "));
});
test("W13 hostile, empty or unset outcome values can only become the word unknown; nothing is executed or echoed", () => {
  for (const v of ["$(touch /tmp/pr501-should-not-exist)", "`id`", "success; echo INJECTED", "", "failure\n::error::x", "SUCCESS", "::warning::x"]) {
    const r = bash(OUTCOME, envOf({ O_ROUTE: v, O_VERIFY: v }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.match(r.stdout.trim(), /^::notice title=PR501_OUTCOMES::Stage outcomes\. route=unknown checkout_head=success .* verify=unknown job=success\.$/);
    assert.ok(!r.stdout.includes("INJECTED") && !r.stdout.includes("uid="));
  }
  assert.ok(!fs.existsSync("/tmp/pr501-should-not-exist"));
  const unset = bash(OUTCOME, {});
  assert.equal(unset.status, 0);
  assert.match(unset.stdout, /route=unknown .* job=unknown\./);
});
test("W14 the markers are single fixed echo lines that exit 0", () => {
  for (const frag of ["mark the stage, checkout", "mark the stage, hash", "mark the stage, install", "mark the stage, verify", "mark the stage, build"]) {
    const s = A.split(/\n(?=      - )/).find((x) => x.includes(frag)); assert.ok(s, frag);
    const cmd = /run: (echo .*)$/m.exec(s)[1];
    const r = bash(cmd); assert.equal(r.status, 0); assert.match(r.stdout.trim(), /^::notice title=PR501_STAGE::Stage starting, \w+\.$/);
  }
});
