// Pure tests for workflow-compose.mjs and for the fixed-vocabulary stage annotations in the three reviewed insertions.
// No network, no Git, no install, no files written. Shell scripts under test run in `bash -c` with a stubbed `node` function and fixed env values.
// Run: node --test scripts/pr501-contract/workflow-compose.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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
    /^echo "::(notice|error) title=PR501_OUTCOMES::\$line"$/,
    /^refuse\(\) \{ echo "::error title=PR501_RUNNER::Trust precondition refused\. check=\$1\."; exit 1; \}$/];
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
const REPO = "jorgeasenrivera/lead-performance-calculator", ORIGIN = `https://github.com/${REPO}`;
const mkdir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function fakeCheckout(origin = ORIGIN, extra = "") {          // a directory shaped like an actions/checkout workspace: only .git/config matters to the precondition
  const d = fs.realpathSync(mkdir("pr501-co-")); fs.mkdirSync(path.join(d, ".git"));
  fs.writeFileSync(path.join(d, ".git", "config"), `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${origin}\n${extra}`);
  return d;
}
const envFor = (d, o = {}) => ({ GITHUB_WORKSPACE: d, CHECKOUT_MERGE: d, GITHUB_REPOSITORY: REPO, RUNNER_TEMP: "/x", ...o });
const STUB = (rc) => `node() { echo "GC=\${GIT_CONFIG_COUNT-} K0=\${GIT_CONFIG_KEY_0-} V0=\${GIT_CONFIG_VALUE_0-} SECRET-RUNNER-OUTPUT" >&2; return ${rc}; }; `;
test("W11 the verify wrapper keeps the runner's exact exit status and annotates only a closed class", () => {
  const d = fakeCheckout();
  for (const [rc, expect] of [[0, "::notice title=PR501_RUNNER::Runner exit class. exit=0."], [1, "::error title=PR501_RUNNER::Runner exit class. exit=1."], [2, "::error title=PR501_RUNNER::Runner exit class. exit=2."],
    [3, "::error title=PR501_RUNNER::Runner exit class. exit=3."], [7, "::error title=PR501_RUNNER::Runner exit class. exit=other."], [137, "::error title=PR501_RUNNER::Runner exit class. exit=other."]]) {
    const r = bash(STUB(rc) + VERIFY, envFor(d));
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

// ---- the scoped Git trust exception ----
const refused = (r, word) => { assert.equal(r.status, 1); assert.equal(r.stdout.trim(), `::error title=PR501_RUNNER::Trust precondition refused. check=${word}.`); assert.ok(!r.stderr.includes("GC="), "node must not have run"); };
// Every Git child of W15 and W27 gets a private, empty configuration: no system file (GIT_CONFIG_NOSYSTEM), a private empty global file (GIT_CONFIG_GLOBAL), a private HOME and XDG.
// An ambient protected safe.directory (a system or global file on a runner, say) would otherwise hide the very ownership refusal W15 asserts.
function isolatedGitEnv() {
  const home = fs.realpathSync(mkdir("pr501-home-")), xdg = path.join(home, "xdg"), empty = path.join(home, "empty.gitconfig");
  fs.mkdirSync(xdg); fs.writeFileSync(empty, "");
  return { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: xdg, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: empty };
}
test("W15 ownership reproduction: git refuses a differently owned checkout; exactly the three scoped variables let that one checkout through and no other", () => {
  const iso = isolatedGitEnv(), id = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
  const git = (cwd, args, env = {}) => spawnSync("git", args, { cwd, env: { ...iso, ...id, ...env }, encoding: "utf8" });
  const mk = () => { const d = fs.realpathSync(mkdir("pr501-repo-")); assert.equal(git(d, ["init", "-q"]).status, 0); assert.equal(git(d, ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x"]).status, 0); return d; };
  const [a, b] = [mk(), mk()];
  const other = { GIT_TEST_ASSUME_DIFFERENT_OWNER: "1" };       // git's own test hook: every repository looks owned by someone else (no chown, no permission change)
  const plain = git(a, ["rev-parse", "--verify", "HEAD^{commit}"], other);
  assert.equal(plain.status, 128); assert.match(plain.stderr, /dubious ownership/);
  const scoped = { ...other, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: a };
  const ok = git(a, ["rev-parse", "--verify", "HEAD^{commit}"], scoped);
  assert.equal(ok.status, 0); assert.match(ok.stdout.trim(), /^[0-9a-f]{40}$/);
  const leak = git(b, ["rev-parse", "--verify", "HEAD^{commit}"], scoped);
  assert.equal(leak.status, 128); assert.match(leak.stderr, /dubious ownership/);      // the exception does not extend to any other checkout
  const cfg = git(a, ["config", "--no-includes", "--file", path.join(a, ".git", "config"), "--get", "core.bare"], other);
  assert.equal(cfg.status, 0);                                   // reading the config file never needs the exception
});
test("W16 the exception is exactly three variables on the one node invocation, with the value being the checkout, and nothing else", () => {
  const d = fakeCheckout();
  const r = bash(STUB(0) + VERIFY, envFor(d));
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trim(), `GC=1 K0=safe.directory V0=${d} SECRET-RUNNER-OUTPUT`);
  assert.ok(/^ {10}GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe\.directory GIT_CONFIG_VALUE_0="\$CHECKOUT_MERGE" node \.pr501\/head\/scripts\/pr501-contract\/ci-verify\.mjs \|\| rc=\$\?$/m.test(VERIFY));
  assert.equal(VERIFY.split("GIT_CONFIG_COUNT").length - 1, 1);                // only the one invocation names it
  assert.equal(VERIFY.split("safe.directory").length - 1, 1);
  for (const bad of ["export GIT_CONFIG", "git config --global", "git config --system", "chown", "chmod", "/dev", "safe.directory=*", "safe.directory '*'", "sudo"]) assert.ok(!A.includes(bad), bad);
  assert.ok(!/GIT_CONFIG_VALUE_0="?\*/.test(A));
  assert.ok(VERIFY.includes('git config --no-includes --file "$CHECKOUT_MERGE/.git/config" --get-all remote.origin.url'));     // includes are never followed when the origin is read
});
test("W17 a CHECKOUT_MERGE that is not exactly GITHUB_WORKSPACE, or not canonical, is refused before node runs", () => {
  const d = fakeCheckout(), e = fakeCheckout();
  refused(bash(STUB(0) + VERIFY, envFor(d, { CHECKOUT_MERGE: e })), "path");
  refused(bash(STUB(0) + VERIFY, envFor(d, { CHECKOUT_MERGE: d + "/" })), "path");
  refused(bash(STUB(0) + VERIFY, envFor(d, { CHECKOUT_MERGE: d + "/../" + path.basename(d) })), "path");
  refused(bash(STUB(0) + VERIFY, envFor(d, { GITHUB_WORKSPACE: "" })), "path");
  refused(bash(STUB(0) + VERIFY, envFor(d, { GITHUB_WORKSPACE: undefined })), "path");
});
test("W18 a symlinked checkout, .git or .git/config is refused (no symlink escape)", () => {
  const real = fakeCheckout(), link = path.join(mkdir("pr501-ln-"), "ws");
  fs.symlinkSync(real, link);
  refused(bash(STUB(0) + VERIFY, envFor(link)), "symlink");
  const g = fakeCheckout(), outside = fakeCheckout();
  fs.renameSync(path.join(g, ".git"), path.join(g, ".git-real")); fs.symlinkSync(path.join(outside, ".git"), path.join(g, ".git"));
  refused(bash(STUB(0) + VERIFY, envFor(g)), "symlink");
  const c = fakeCheckout(); fs.renameSync(path.join(c, ".git", "config"), path.join(c, ".git", "config-real")); fs.symlinkSync(path.join(c, ".git", "config-real"), path.join(c, ".git", "config"));
  refused(bash(STUB(0) + VERIFY, envFor(c)), "symlink");
});
test("W19 the wrong repository, a wrong or doubled origin, a missing origin and an include section are refused", () => {
  refused(bash(STUB(0) + VERIFY, envFor(fakeCheckout(), { GITHUB_REPOSITORY: "someone-else/lead-performance-calculator" })), "repo");
  refused(bash(STUB(0) + VERIFY, envFor(fakeCheckout(), { GITHUB_REPOSITORY: "JorgeAsenRivera/Lead-Performance-Calculator" })), "repo");
  refused(bash(STUB(0) + VERIFY, envFor(fakeCheckout("https://github.com/someone-else/lead-performance-calculator"))), "origin");
  refused(bash(STUB(0) + VERIFY, envFor(fakeCheckout(ORIGIN + ".git"))), "origin");
  refused(bash(STUB(0) + VERIFY, envFor(fakeCheckout(ORIGIN, `\turl = ${ORIGIN}\n`))), "origin");                       // two values
  refused(bash(STUB(0) + VERIFY, envFor(fakeCheckout("")) ), "origin");
  const noOrigin = fakeCheckout(); fs.writeFileSync(path.join(noOrigin, ".git", "config"), "[core]\n\tbare = false\n");
  refused(bash(STUB(0) + VERIFY, envFor(noOrigin)), "origin");
  refused(bash(STUB(0) + VERIFY, envFor(fakeCheckout(ORIGIN, "[include]\n\tpath = /somewhere/else\n"))), "include");
  refused(bash(STUB(0) + VERIFY, envFor(fakeCheckout(ORIGIN, "[includeIf \"gitdir:/\"]\n\tpath = x\n"))), "include");
});
test("W20 any inherited Git configuration variable is refused, never overwritten", () => {
  const d = fakeCheckout();
  for (const o of [{ GIT_CONFIG_COUNT: "1" }, { GIT_CONFIG_COUNT: "0" }, { GIT_CONFIG_KEY_0: "safe.directory" }, { GIT_CONFIG_VALUE_0: "*" }, { GIT_CONFIG_KEY_3: "core.fsmonitor" },
    { GIT_CONFIG_PARAMETERS: "'safe.directory=*'" }, { GIT_CONFIG_GLOBAL: "/x" }, { GIT_CONFIG_SYSTEM: "/x" }, { GIT_CONFIG_NOSYSTEM: "1" }]) {
    refused(bash(STUB(0) + VERIFY, envFor(d, o)), "inherited");
  }
});
test("W21 the refusal words are a closed set and no value (path, origin, repository, variable) is ever echoed", () => {
  const words = new Set(["guard", "inherited", "repo", "path", "symlink", "include", "origin"]);
  const used = [...VERIFY.matchAll(/refuse (\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used)].sort(), [...words].sort());
  for (const w of used) assert.ok(words.has(w), w);
  const hostile = fakeCheckout("https://example.invalid/SECRET-ORIGIN-TEXT");
  const r = bash(STUB(0) + VERIFY, envFor(hostile, { GITHUB_REPOSITORY: REPO }));
  assert.equal(r.stdout.trim(), "::error title=PR501_RUNNER::Trust precondition refused. check=origin.");
  assert.ok(!r.stdout.includes("SECRET") && !r.stderr.includes("SECRET"));
});
const BASE_TEMPLATE = process.env.BASE_TEMPLATE;
const w22 = (name, fn) => (BASE_TEMPLATE ? test(name, fn) : test(name, { skip: "set BASE_TEMPLATE to the accepted c0fc52b workflow-insert.template.yml" }, fn));
w22("W22 the rest of the template is unchanged: only the verify step's run script differs from the accepted c0fc52b template", () => {
  const a = fs.readFileSync(BASE_TEMPLATE, "utf8").split("\n"), b = A.split("\n");
  const removed = a.filter((l) => !b.includes(l)), added = b.filter((l) => !a.includes(l));
  assert.deepEqual(removed, ["          node .pr501/head/scripts/pr501-contract/ci-verify.mjs || rc=$?"]);
  assert.ok(added.length > 0 && added.every((l) => l.startsWith("          ") || l === "        shell: bash"), "all additions are inside the verify run script, plus the one shell line");
  assert.equal(added.filter((l) => l === "        shell: bash").length, 1);
  assert.equal(a.length + added.length - removed.length, b.length);
});

// ---- the shell the step runs under, and the guard failing closed ----
const ghBash = (script, env = {}) => {                         // exactly how GitHub runs `shell: bash`: bash --noprofile --norc -eo pipefail {0}, with {0} a script file
  const f = path.join(mkdir("pr501-step-"), "step.sh"); fs.writeFileSync(f, script);
  return spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", f], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
};
test("W23 the verify step declares shell: bash at step level, once, immediately before run; no other added step declares a shell", () => {
  const withShell = A.split(/\n(?=      - )/).filter((x) => /^\s+shell:/m.test(x));
  assert.equal(withShell.length, 1);
  assert.ok(withShell[0].includes("        id: verify\n"));
  assert.ok(withShell[0].includes("\n        shell: bash\n        run: |\n"));
  assert.ok(!/^\s+shell:/m.test(B + C));
});
test("W24 under the exact invocation GitHub uses for shell: bash, an inherited Git variable is refused and a good checkout reaches node once", () => {
  const d = fakeCheckout();
  const bad = ghBash(STUB(0) + VERIFY, envFor(d, { GIT_CONFIG_COUNT: "1" }));
  assert.equal(bad.status, 1); assert.equal(bad.stdout.trim(), "::error title=PR501_RUNNER::Trust precondition refused. check=inherited."); assert.ok(!bad.stderr.includes("GC="));
  const good = ghBash(STUB(3) + VERIFY, envFor(d));
  assert.equal(good.status, 3); assert.equal(good.stderr.trim(), `GC=1 K0=safe.directory V0=${d} SECRET-RUNNER-OUTPUT`); assert.equal(good.stdout.trim(), "::error title=PR501_RUNNER::Runner exit class. exit=3.");
});
const sh = (script, env = {}) => spawnSync("sh", ["-e", "-c", script], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
const shHasCompgen = spawnSync("sh", ["-c", "command -v compgen"], { encoding: "utf8" }).status === 0;
test("W25 if a POSIX sh ran the step (no compgen), the guard fails closed: node never runs; the old guard form would have been skipped", () => {
  const d = fakeCheckout();
  for (const o of [{ GIT_CONFIG_COUNT: "1" }, { GIT_CONFIG_PARAMETERS: "'safe.directory=*'" }]) {
    const r = sh(STUB(0) + VERIFY, envFor(d, o));
    assert.equal(r.status, 1); assert.match(r.stdout.trim(), /^::error title=PR501_RUNNER::Trust precondition refused\. check=(guard|inherited)\.$/); assert.ok(!r.stderr.includes("GC="), "node must not run");
  }
  if (!shHasCompgen) {
    const clean = sh(STUB(0) + VERIFY, envFor(d));
    assert.equal(clean.status, 1); assert.equal(clean.stdout.trim(), "::error title=PR501_RUNNER::Trust precondition refused. check=guard.");       // cannot read the variable list: refuse
    const oldGuard = sh('for v in $(compgen -e); do case "$v" in GIT_CONFIG*) echo REFUSED; exit 1 ;; esac; done; echo PASSED', { GIT_CONFIG_COUNT: "1" });
    assert.equal(oldGuard.stdout.trim(), "PASSED");                // documents the hole the explicit shell and the checked assignment close
  }
});
test("W26 every command substitution in the verify script either feeds a comparison that refuses on mismatch or is a checked assignment", () => {
  const subs = VERIFY.split("\n").filter((l) => l.includes("$("));
  for (const l of subs) assert.ok(/\|\| refuse \w+$/.test(l.trim()) || /^\[ "\$\(cd "\$CHECKOUT_MERGE" && pwd -P\)" = "\$CHECKOUT_MERGE" \] \|\| refuse path$/.test(l.trim()), l);
  assert.equal(subs.length, 3);
});

test("W27 an ambient protected safe.directory (system, global or XDG) hides the ownership refusal in an unisolated Git child and cannot in the isolated one; W15 keeps its 128 / 0 / 128", () => {
  const iso = isolatedGitEnv(), id = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
  const run = (cwd, args, env) => spawnSync("git", args, { cwd, env, encoding: "utf8" });
  const repo = fs.realpathSync(mkdir("pr501-repo-"));
  assert.equal(run(repo, ["init", "-q"], { ...iso, ...id }).status, 0);
  assert.equal(run(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x"], { ...iso, ...id }).status, 0);
  const probe = ["rev-parse", "--verify", "HEAD^{commit}"], other = { GIT_TEST_ASSUME_DIFFERENT_OWNER: "1" };
  const contam = "[safe]\n\tdirectory = *\n";                       // what a runner's system or global file may carry; emulated with private files, nothing outside this test is touched
  const sysFile = path.join(fs.realpathSync(mkdir("pr501-cs-")), "system.gitconfig"); fs.writeFileSync(sysFile, contam);
  const badHome = fs.realpathSync(mkdir("pr501-ch-")); fs.writeFileSync(path.join(badHome, ".gitconfig"), contam);
  const badXdg = fs.realpathSync(mkdir("pr501-cx-")); fs.mkdirSync(path.join(badXdg, "git")); fs.writeFileSync(path.join(badXdg, "git", "config"), contam);
  const cleanHome = fs.realpathSync(mkdir("pr501-cl-"));
  const emptySys = path.join(fs.realpathSync(mkdir("pr501-es-")), "empty.system.gitconfig"); fs.writeFileSync(emptySys, "");      // the old shape must not inherit the real system config either
  // before isolation (the shape W15 used): the contamination wins and the refusal disappears (the "expected 128, actual 0" failure)
  const oldShape = (extra) => ({ PATH: process.env.PATH, HOME: cleanHome, GIT_CONFIG_SYSTEM: emptySys, ...other, ...extra });
  assert.equal(oldShape({}).GIT_CONFIG_SYSTEM, emptySys); assert.notEqual(emptySys, sysFile);
  assert.ok(fs.statSync(emptySys).isFile() && fs.statSync(emptySys).size === 0, "the default system file is a private empty regular file");
  assert.equal(run(repo, probe, oldShape({})).status, 128);                                              // control: with no contamination the refusal is there
  assert.equal(run(repo, probe, oldShape({ GIT_CONFIG_SYSTEM: sysFile })).status, 0);                     // an ambient system file
  assert.equal(run(repo, probe, oldShape({ HOME: badHome })).status, 0);                                 // an ambient global file
  assert.equal(run(repo, probe, oldShape({ XDG_CONFIG_HOME: badXdg })).status, 0);                       // an ambient XDG file
  // after isolation: the same contamination is ignored and the refusal stands, with the message W15 matches
  for (const extra of [{}, { GIT_CONFIG_SYSTEM: sysFile }, { HOME: badHome }, { XDG_CONFIG_HOME: badXdg }]) {
    const r = run(repo, probe, { ...iso, ...other, ...extra });
    assert.equal(r.status, 128); assert.match(r.stderr, /dubious ownership/);
  }
  // W15's own assertions are not loosened: the three ownership assertions and their codes are still present in its block
  const me = fs.readFileSync(fileURLToPath(import.meta.url), "utf8"), block = me.slice(me.indexOf('test("W15 '), me.indexOf('test("W16 '));
  for (const needle of ["assert.equal(plain.status, 128)", "assert.equal(ok.status, 0)", "assert.equal(leak.status, 128)"]) assert.ok(block.includes(needle), needle);
  assert.ok(!/skip|\[0, 128\]|status, 0 \|\||todo/i.test(block), "no skip or alternative accepted code in W15");
});
