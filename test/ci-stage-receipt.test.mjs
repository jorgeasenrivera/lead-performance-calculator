/* The stage receipt and the workflow patch that uses it, on fabricated inputs only. No runner, no browser, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildStageReceipt, summaryLine, mapProblems, STAGES, PROBLEM_CODES } from "../scripts/ci-stage-receipt.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "scripts", "ci-stage-receipt.mjs");
const SHA = "8983739775a0311a4ed1f9645e7854a3c6ac6388", TREE = "5a7a3933303cb37e6f8217e04917406beb98a6d0";
const ALL = (v) => ({ checkout: v, preflight: v, dependencies: v, driver: v, toolchain: v, build: v, feel: v, verdict: v, stop: v });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("a complete run: the closed fields, in a fixed order, and one plain summary line", () => {
  const r = buildStageReceipt({ event: "push", sha: SHA, tree: TREE, outcomes: ALL("success"), upRc: "0", feelCode: "0", receiptState: "valid", problems: [] });
  assert.deepEqual(r, { schema: 1, kind: "stage-receipt", event: "push", sha: SHA, tree: TREE, stages: { checkout: "success", preflight: "success", dependencies: "success", driver: "success", toolchain: "success", build: "success", up: "ok", feel: "success", verdict: "success", stop: "success" }, feelCode: 0, receiptState: "valid", problems: [] });
  assert.deepEqual(Object.keys(r.stages), STAGES); assert.deepEqual(Object.keys(r), ["schema", "kind", "event", "sha", "tree", "stages", "feelCode", "receiptState", "problems"]);
  assert.equal(summaryLine(r), `stage-receipt event=push sha=${SHA} tree=${TREE} checkout=success preflight=success dependencies=success driver=success toolchain=success build=success up=ok feel=success verdict=success stop=success feel_code=0 receipt=valid problems=none`);
  assert.equal(buildStageReceipt({ event: "pull_request", sha: SHA, tree: TREE, outcomes: ALL("success"), upRc: "0" }).event, "pull_request");
});

test("event: only push and pull_request; anything else is 'other' and is not copied", () => {
  for (const e of ["workflow_dispatch", "", "push\nstop=success", "Push", " push", "push ", undefined, null, 5, "pull_request_target", "x".repeat(5000)]) {
    const r = buildStageReceipt({ event: e, sha: SHA, tree: TREE });
    assert.equal(r.event, "other"); assert.ok(!summaryLine(r).includes("x".repeat(20)));
  }
});

test("commit and tree: exactly 40 lower-case hex, else 'invalid'; the input never reaches the output", () => {
  const bad = [SHA.toUpperCase(), SHA.slice(1), SHA + "0", SHA.replace("8", "g"), "", undefined, null, 12, SHA + "\nfoo=bar", `${SHA}\r\n::set-output name=x::y`, "$(id)", `${"a".repeat(40)}\n${"b".repeat(40)}`, " " + SHA];
  for (const v of bad) {
    const r = buildStageReceipt({ event: "push", sha: v, tree: v });
    assert.equal(r.sha, "invalid"); assert.equal(r.tree, "invalid");
    const line = summaryLine(r); assert.ok(!line.includes("foo") && !line.includes("::") && !line.includes("$(") && !/[\r\n]/.test(line));
  }
});

test("outcomes: the runner's four words only; any other string, case, or injection is 'unknown'", () => {
  for (const v of ["success", "failure", "cancelled", "skipped"]) assert.equal(buildStageReceipt({ outcomes: ALL(v) }).stages.build, v);
  for (const v of ["Success", "SUCCESS", "", " success", "success ", "success\nverdict=success", "::error::x", "ok", undefined, null, 1, {}, [], "failure,success", "x".repeat(300)]) {
    const r = buildStageReceipt({ event: "push", sha: SHA, tree: TREE, outcomes: ALL(v) });
    for (const s of STAGES.filter((x) => x !== "up")) assert.equal(r.stages[s], "unknown", `${s} ${String(JSON.stringify(v)).slice(0, 30)}`);
    assert.ok(!/[\r\n]/.test(summaryLine(r)));
  }
});

test("an early failure reads as exactly what happened: stages after it are 'skipped', the start-up is 'not-reached', no feel code", () => {
  const o = { ...ALL("skipped"), checkout: "success", preflight: "failure", verdict: "success", stop: "success" };
  const r = buildStageReceipt({ event: "push", sha: SHA, tree: TREE, outcomes: o, upRc: undefined, feelCode: "", receiptState: "absent" });
  assert.equal(r.stages.preflight, "failure"); assert.equal(r.stages.dependencies, "skipped"); assert.equal(r.stages.up, "not-reached"); assert.equal(r.stages.feel, "skipped"); assert.equal(r.feelCode, null);
  assert.match(summaryLine(r), /preflight=failure dependencies=skipped .* up=not-reached feel=skipped .* feel_code=none receipt=absent problems=unknown$/);
});

test("the start-up exit code is mapped to a closed word; the original code is not echoed", () => {
  const map = { "0": "ok", "1": "startup-failed", "2": "usage", "5": "refused", "6": "port-unconfirmed", "3": "other", "7": "other", "127": "other", "255": "other", "000": "ok", "05": "refused" };
  for (const [k, v] of Object.entries(map)) assert.equal(buildStageReceipt({ upRc: k }).stages.up, v, k);
  for (const k of ["256", "999", "-1", "1x", "x1", "0\nfoo", "1 2", " 1", "1e1", "0x5", "٣", "9".repeat(50), 5, null]) assert.equal(buildStageReceipt({ upRc: k }).stages.up, "invalid", String(k));
  for (const k of [undefined, ""]) assert.equal(buildStageReceipt({ upRc: k }).stages.up, "not-reached");
});

test("feel exit code: a small integer or none", () => {
  for (const [k, v] of Object.entries({ "0": 0, "1": 1, "3": 3, "255": 255, "007": 7 })) assert.equal(buildStageReceipt({ feelCode: k }).feelCode, v, k);
  for (const k of ["256", "-1", "abc", "3\n4", "", undefined, null, 3, "1.5", "1000"]) assert.equal(buildStageReceipt({ feelCode: k }).feelCode, null, String(k));
});

test("problems: the verdict's strings map to a closed list; unknown, long, non-string and hostile entries become 'other' and are never copied", () => {
  const m = mapProblems(["unexpected requests: 3", "fixture start line missing", "room API was not on", "seed hash missing", "start.dist missing or malformed", "fixture report missing or invalid", "the report dropped counts",
    "dist pin differs between start and report", "outside seed pin missing", "seed hash differs from the outside pin", "the 503 rows and the expected counter disagree", "strict adapter is not the reviewed bytes", "adapter: the pins were not applied at launch"]);
  assert.deepEqual(m, ["adapter-bytes", "adapter-evidence", "dist-mismatch", "dist-missing", "expected-counter", "fixture-config", "hash-missing", "pin-mismatch", "pin-missing", "report-dropped", "report-invalid", "start-line-missing", "unexpected-requests"]);
  const hostile = ["unexpected requests: 3\nstop=success", "unexpected requests: abc", "::set-output name=x::y", "x".repeat(500), "adapter: " + "y".repeat(500), "adapter: a\nb", 5, null, {}, [], "", "$(id)", "unexpected requests: 12345678901"];
  const out = mapProblems(hostile);
  assert.deepEqual(out, ["other"]);
  for (const c of mapProblems([...hostile, "unexpected requests: 1"])) assert.ok(PROBLEM_CODES.includes(c));
  assert.deepEqual(mapProblems(undefined), []); assert.deepEqual(mapProblems("unexpected requests: 1"), []); assert.deepEqual(mapProblems({}), []);
  assert.equal(mapProblems(Array.from({ length: 5000 }, (_, i) => `unexpected requests: ${i}`)).length, 1, "bounded: at most one entry per code, and only the first 64 strings are read");
  const line = summaryLine(buildStageReceipt({ event: "push", sha: SHA, tree: TREE, receiptState: "valid", problems: ["unexpected requests: 3\nstop=success", "dist pin differs between start and report"] }));
  assert.ok(line.endsWith("problems=dist-mismatch,other") && !/[\r\n]/.test(line));
});

test("receiptState is closed: only a valid receipt gives a problems list; absent, invalid or missing state is unknown, never 'none'", () => {
  const mk = (receiptState, problems) => buildStageReceipt({ event: "push", sha: SHA, tree: TREE, receiptState, problems });
  assert.deepEqual(mk("valid", []).problems, []); assert.match(summaryLine(mk("valid", [])), /receipt=valid problems=none$/);
  assert.deepEqual(mk("valid", ["unexpected requests: 2"]).problems, ["unexpected-requests"]);
  for (const st of ["absent", "invalid"]) { const r = mk(st, ["unexpected requests: 2"]); assert.equal(r.receiptState, st); assert.equal(r.problems, null); assert.match(summaryLine(r), new RegExp(`receipt=${st} problems=unknown$`)); }
  for (const st of [undefined, null, "", "Valid", "valid ", "ok", "valid\nproblems=none", 1, {}]) { const r = mk(st, []); assert.equal(r.receiptState, "invalid", String(st)); assert.equal(r.problems, null); }
  for (const bad of [undefined, null, "none", {}, 0, "unexpected requests: 1"]) { const r = mk("valid", bad); assert.equal(r.receiptState, "invalid", "valid state without a problems list is invalid"); assert.equal(r.problems, null); }
  assert.ok(!summaryLine(mk("absent", [])).includes("problems=none"), "a missing receipt is not rendered as proven none");
});

test("the command reads the verdict receipt into the closed state: absent, invalid (not a file, too big, not JSON, no list) or valid", () => {
  const env = { PATH: process.env.PATH, EVENT: "push", SHA, TREE_SHA: TREE };
  const run = (setup) => { const d = tmp("rcpt-"); setup(d); const r = spawnSync(process.execPath, [BIN, d], { encoding: "utf8", env }); assert.equal(r.status, 0, r.stderr); return { out: r.stdout, doc: JSON.parse(fs.readFileSync(path.join(d, "stage-receipt.json"), "utf8")) }; };
  const w = (d, s) => fs.writeFileSync(path.join(d, "fixture-receipt.json"), s);
  const cases = [
    ["missing", () => {}, "absent", null], ["a directory", (d) => fs.mkdirSync(path.join(d, "fixture-receipt.json")), "invalid", null], ["not JSON", (d) => w(d, "{nope"), "invalid", null], ["empty file", (d) => w(d, ""), "invalid", null],
    ["no problems key", (d) => w(d, "{}"), "invalid", null], ["problems is a string", (d) => w(d, JSON.stringify({ problems: "x" })), "invalid", null], ["JSON null", (d) => w(d, "null"), "invalid", null], ["JSON array", (d) => w(d, "[]"), "invalid", null],
    ["over 64 KB", (d) => w(d, JSON.stringify({ problems: [] }) + " ".repeat(70000)), "invalid", null],
    ["valid and empty", (d) => w(d, JSON.stringify({ problems: [] })), "valid", []], ["valid with one", (d) => w(d, JSON.stringify({ problems: ["the report dropped counts"] })), "valid", ["report-dropped"]],
  ];
  for (const [name, setup, state, problems] of cases) { const { out, doc } = run(setup); assert.equal(doc.receiptState, state, name); assert.deepEqual(doc.problems, problems, name); assert.match(out, new RegExp(`receipt=${state} problems=${problems === null ? "unknown" : problems.length ? problems.join(",") : "none"}\\n$`), name); }
});

test("the command: writes one file and one line from fabricated env, reads two small files, never overwrites, and never touches GITHUB_OUTPUT", () => {
  const src = fs.readFileSync(BIN, "utf8");
  assert.ok(!/GITHUB_OUTPUT|GITHUB_ENV|::set-output|::add-mask|process\.env\.GITHUB/.test(src), "the module cannot write workflow outputs or commands");
  const dir = tmp("stage-"), env = { PATH: process.env.PATH, EVENT: "push", SHA, TREE_SHA: TREE, FEEL_CODE: "0", ...Object.fromEntries(["CHECKOUT", "PREFLIGHT", "DEPENDENCIES", "DRIVER", "TOOLCHAIN", "BUILD", "FEEL", "VERDICT", "STOP"].map((k) => ["O_" + k, "success"])) };
  fs.writeFileSync(path.join(dir, "up-rc.txt"), "0\n"); fs.writeFileSync(path.join(dir, "fixture-receipt.json"), JSON.stringify({ problems: ["unexpected requests: 2"] }));
  const r = spawnSync(process.execPath, [BIN, dir], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.split("\n").filter(Boolean).length, 1); assert.match(r.stdout, /up=ok .* receipt=valid problems=unexpected-requests\n$/);
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "stage-receipt.json"), "utf8")); assert.deepEqual(doc.problems, ["unexpected-requests"]); assert.equal(doc.stages.up, "ok");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["fixture-receipt.json", "stage-receipt.json", "up-rc.txt"]);
  assert.notEqual(spawnSync(process.execPath, [BIN, dir], { encoding: "utf8", env }).status, 0, "a second write is refused, not overwritten");
  /* hostile files: oversized or odd content cannot widen the output */
  const d2 = tmp("stage-"); fs.writeFileSync(path.join(d2, "up-rc.txt"), "5\n".repeat(100)); fs.writeFileSync(path.join(d2, "fixture-receipt.json"), JSON.stringify({ problems: ["x\nstop=success"] }) + " ".repeat(70000));
  const r2 = spawnSync(process.execPath, [BIN, d2], { encoding: "utf8", env: { PATH: process.env.PATH, EVENT: "evil\nx=1", SHA: "nope", TREE_SHA: "nope" } });
  assert.equal(r2.status, 0, r2.stderr); assert.equal(r2.stdout.split("\n").filter(Boolean).length, 1); assert.match(r2.stdout, /event=other sha=invalid tree=invalid .*up=invalid .*receipt=invalid problems=unknown\n$/);
  assert.equal(spawnSync(process.execPath, [BIN], { encoding: "utf8" }).status, 2);
});

/* ---- the workflow patch, against the public file ---- */
const ORIG = process.env.ORIG_YML && fs.readFileSync(process.env.ORIG_YML, "utf8"), NEW = process.env.NEW_YML && fs.readFileSync(process.env.NEW_YML, "utf8");
const wf = (name, fn) => (ORIG && NEW ? test(name, fn) : test(name, { skip: "set ORIG_YML and NEW_YML" }, fn));

wf("the patch is additions plus one replaced line: undoing exactly the listed additions gives the public file back byte for byte", () => {
  let back = NEW;
  const undo = (chunk, to = "", n = 1) => { assert.equal(back.split(chunk).length - 1, n, chunk.slice(0, 60)); back = back.split(chunk).join(to); };
  for (const id of ["co", "pre", "deps", "drv", "tc", "bld"]) undo(`        id: ${id}\n`);
  undo(`          # Same command and same exit; the code is also kept in a one-number file for the stage receipt.\n          mkdir -p fixture-run\n          up_rc=0; scripts/ci-fixture.sh up || up_rc=$?\n          echo "$up_rc" > fixture-run/up-rc.txt\n          if [ "$up_rc" != 0 ]; then exit "$up_rc"; fi\n`, "          scripts/ci-fixture.sh up\n");
  const a = back.indexOf("      - name: Stage receipt (fixed fields only"), b = back.indexOf("      - name: Keep bounded evidence", a);
  assert.ok(a > 0 && b > a); back = back.slice(0, a) + back.slice(b);
  undo("            fixture-run/stage-receipt.json\n");
  undo(`      - name: WebKit has no reviewed strict path (candidate branch only)\n        if: env.CANDIDATE == '1'\n        env:\n          CI_ENGINE: webkit\n        run: scripts/ci-fixture.sh up\n`, "", 2);
  assert.equal(back, ORIG);
});

wf("what the patch adds cannot widen the channel or leak: no outputs written, no comment or lookup, no runner census, and a receipt step with no continue-on-error", () => {
  const added = NEW.split("\n").filter((l) => !ORIG.split("\n").includes(l)).join("\n");
  for (const bad of ["GITHUB_OUTPUT", "listPullRequestsAssociatedWithCommit", "createComment", "updateComment", "github-script", "nproc", "meminfo", "df -", "ImageVersion", "uname", "toJSON", "needs.", "::"]) assert.ok(!added.includes(bad), bad);
  assert.equal((NEW.match(/continue-on-error/g) || []).length, (ORIG.match(/continue-on-error/g) || []).length, "no advisory exception: a failing receipt step stays red");
  assert.equal((NEW.match(/GITHUB_OUTPUT/g) || []).length, (ORIG.match(/GITHUB_OUTPUT/g) || []).length, "the existing outputs are the only ones");
  const step = NEW.slice(NEW.indexOf("      - name: Stage receipt (fixed fields only"), NEW.indexOf("      - name: Keep bounded evidence"));
  assert.match(step, /if: always\(\)\n        env:/); assert.ok(!/continue-on-error/.test(step)); assert.match(step, />> "\$GITHUB_STEP_SUMMARY"/);
  for (const k of ["checkout:co", "preflight:pre", "dependencies:deps", "driver:drv", "toolchain:tc", "build:bld", "feel:feel", "verdict:verdict", "stop:stop"]) { const [s, id] = k.split(":"); assert.ok(step.includes(`O_${s.toUpperCase()}: \${{ steps.${id}.outcome }}`), k); }
  assert.ok(step.includes("EVENT: ${{ github.event_name }}") && step.includes("SHA: ${{ github.sha }}"));
});

wf("WebKit: the refusal is the first step after checkout in both jobs, before install and toolchain, for the candidate only; the red result and the other steps are unchanged", () => {
  for (const job of ["feel-webkit", "shots"]) {
    const i = NEW.indexOf(`\n  ${job}:\n`), seg = NEW.slice(i, NEW.indexOf("\n  # ", i + 10) > 0 ? NEW.indexOf("\n  # ", i + 10) : undefined);
    const refuse = seg.indexOf("name: WebKit has no reviewed strict path"), co = seg.indexOf("actions/checkout@v4"), ci = seg.indexOf("- run: npm ci"), tc = seg.indexOf("Record the toolchain");
    assert.ok(co > 0 && co < refuse && refuse < ci && ci < tc, job);
    assert.ok(/name: WebKit has no reviewed strict path \(candidate branch only\)\n        if: env\.CANDIDATE == '1'\n        env:\n          CI_ENGINE: webkit\n        run: scripts\/ci-fixture\.sh up\n/.test(seg), job);
  }
});
