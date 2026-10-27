/* The workflow annotations for the browser cases, tested with hostile input as well as honest input.
 *
 * What this protects. The annotations are only safe to turn on if nothing the harness handles (an error, a detail, a request, a URL, a token) can reach them, if they can never
 * change what the run decides, and if a failure of the writer cannot cost the run its cleanup or its exit code. Each rule is a pure function or a source check, so this runs
 * with no browser and no network, in node:test alone.
 * Limits. This proves the emitter and the hooks as written; it does not run Chromium and it does not claim the cases pass. A hosted run is the only evidence for that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAnnotator, coverageOf, EXPECTED_IDS, INTERNAL_IDS, GROUPS, PHASES, MAX_IDS_IN_LINE } from "../scripts/safe-annotations.mjs";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MODULE = read("scripts/safe-annotations.mjs"), RUNNER = read("scripts/browser-security-cases.mjs"), WORKFLOW = read(".github/workflows/browser-security-cases.yml");

/* One annotator that records every line it is asked to write. */
const make = (scope = "corrected") => { const lines = []; const note = createAnnotator({ scope, write: (l) => { lines.push(l); } }); return { note, lines }; };
const LINE = /^::(error|warning|notice) title=[A-Z_]+::[A-Za-z0-9 _,.=-]*\n$/;   // letters, digits, spaces, underscores (phase names), commas, full stops, equals and hyphens: nothing a workflow command could be broken by
const count = (lines, level) => lines.filter((l) => l.startsWith("::" + level + " ")).length;
const CANARY = "CANARY-9f3a-token-eyJhbGciOi-secret";
const HOSTILE = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "prototype", "A1\n::error::x", "A1\r\n::error::x", "A1%0A::error::x", "A1%0D%0A", "A1::", "%", "100%", "", " ", "a".repeat(5000), "../../etc/passwd", "http://127.0.0.1:5433/x?token=" + CANARY, CANARY, "A1,A2", "A1 phase=X", 42, NaN, Infinity, -0, null, undefined, true, {}, [], ["A1"], Symbol("A1"), () => "A1", 10n];

/* ---- the vocabulary is the harness's own ---- */
test("the closed lists are exactly the harness's, so a drift fails here", () => {
  const m = RUNNER.match(/^const EXPECTED_IDS = \["A1", \.\.\.XC\.map\(\(c\) => c\.id\), ((?:"[^"]+", )*"[^"]+")\];$/m);
  assert.ok(m, "the harness EXPECTED_IDS line changed");
  const tail = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const xcBlock = RUNNER.slice(RUNNER.indexOf("\nconst XC = ["), RUNNER.indexOf("\n];", RUNNER.indexOf("\nconst XC = [")));
  const xcIds = [...xcBlock.matchAll(/^  \{ id: "([^"]+)", title:/gm)].map((x) => x[1]);
  assert.equal(xcIds.length, 20, "the cross-check table changed size");
  assert.deepEqual([...EXPECTED_IDS], ["A1", ...xcIds, ...tail]);
  assert.equal(EXPECTED_IDS.length, 35);
  assert.equal(new Set(EXPECTED_IDS).size, EXPECTED_IDS.length);
  const loop = RUNNER.match(/for \(const \[name, fn\] of \[((?:\["[a-z-]+", [A-Za-z0-9]+\](?:, )?)+)\]\)/);
  assert.ok(loop, "the group loop changed");
  assert.deepEqual([...GROUPS], [...loop[1].matchAll(/\["([a-z-]+)", /g)].map((x) => x[1]));
  for (const p of PHASES) assert.ok(RUNNER.includes(`note.phase("${p}")`), p);
  assert.deepEqual([...INTERNAL_IDS].sort(), ["RUNNER", "XC-suite"]);
  assert.ok(RUNNER.includes('id: "RUNNER"') && RUNNER.includes('id: "XC-suite"'));
});

test("the module is data-free and effect-free: no imports, no files, no environment, no clock, no await", () => {
  assert.ok(!/^\s*import\s/m.test(MODULE), "imports");
  for (const bad of [/\bawait\b/, /\bfs\b/, /process\.env/, /\bDate\b/, /performance\./, /setTimeout|setInterval/, /readFile|writeFile|result\.json/, /\bfetch\b|require\(/, /classif/i]) assert.ok(!bad.test(MODULE.replace(/\/\*[\s\S]*?\*\//g, "")), String(bad));
  assert.ok(!/LEVEL\[|CLASSES\[|\bin\b\s+[A-Z]/.test(MODULE.replace(/\/\*[\s\S]*?\*\//g, "")), "an object lookup on a closed list");
});

/* ---- enum attacks ---- */
test("inherited and hostile enum values are refused: only a closed Set or Map member is ever accepted", () => {
  for (const v of HOSTILE) {
    const { note, lines } = make();
    note.phase(v); note.group(v);
    note.caseRecord({ id: v, status: "FAIL" }); note.caseRecord({ id: "A1", status: v });
    note.groupDeadline(v);
    for (const l of lines) { assert.match(l, LINE); assert.ok(!l.includes(CANARY)); }
    // the only lines a hostile name may produce are fixed refusals or the name-free group deadline
    for (const l of lines) assert.ok(/title=(REJECTED|GROUP_DEADLINE)::/.test(l), l);
  }
  for (const v of ["toString", "__proto__", "constructor", "hasOwnProperty"]) {
    const { note, lines } = make();
    note.caseRecord({ id: "A1", status: v });
    assert.ok(lines.every((l) => l.startsWith("::warning title=REJECTED::")));
  }
});

test("an object that only inherits its fields, has accessors, symbols, holes or extra keys is refused and never read", () => {
  const inherited = Object.create({ id: "A1", status: "FAIL" });
  let getterRan = 0;
  const accessor = {}; Object.defineProperty(accessor, "id", { enumerable: true, get() { getterRan++; return "A1"; } }); accessor.status = "FAIL";
  const symbolic = { id: "A1", status: "FAIL", [Symbol("x")]: 1 };
  const extra = { id: "A1", status: "FAIL", message: CANARY };
  const nonEnumerable = {}; Object.defineProperty(nonEnumerable, "id", { value: "A1", enumerable: false }); nonEnumerable.status = "FAIL";
  class Fake { constructor() { this.id = "A1"; this.status = "FAIL"; } }
  const proxied = new Proxy({ id: "A1", status: "FAIL" }, { get() { throw new Error(CANARY); }, ownKeys() { throw new Error(CANARY); }, getPrototypeOf() { throw new Error(CANARY); } });
  for (const rec of [inherited, accessor, symbolic, extra, nonEnumerable, new Fake(), proxied, Object.freeze(Object.create(null, { id: { value: "A1", enumerable: true }, status: { value: "FAIL", enumerable: true }, evil: { value: 1, enumerable: true } }))]) {
    const { note, lines } = make();
    assert.doesNotThrow(() => note.caseRecord(rec));
    assert.equal(count(lines, "error"), 0, JSON.stringify(lines));
    for (const l of lines) { assert.match(l, LINE); assert.ok(!l.includes(CANARY)); }
  }
  assert.equal(getterRan, 0, "an accessor was invoked");
  const holes = ["A1", , "A2"]; // eslint-disable-line no-sparse-arrays
  const { note, lines } = make();
  note.terminal({ failed: false, skipped: false, missing: false, audit: true, deadline: false, exception: false, probe: false, only: false, results: holes });
  for (const l of lines) assert.match(l, LINE);
});

test("a caller cannot pick a class, a level or free text: no hook takes text, and the module exposes no emit", () => {
  const { note } = make();
  assert.deepEqual(Object.keys(note).sort(), ["caseRecord", "group", "groupDeadline", "groupDeadlineFired", "phase", "runDeadline", "runnerException", "terminal"]);
  assert.ok(Object.isFrozen(note));
  assert.throws(() => { "use strict"; note.emit = () => {}; });
  for (const key of ["emit", "write", "raw", "error"]) assert.equal(note[key], undefined);
});

/* ---- malformed and injected input ---- */
test("CRLF, percent, command and canary input never reaches the output, in any field", () => {
  const { note, lines } = make();
  for (const evil of [CANARY, "x\r\n::error title=PWNED::y", "%0A::error::z", "::stop-commands::tok", "A1 ::error::q"]) {
    note.caseRecord({ id: "A1", title: evil, status: "FAIL", detail: evil, evidence: { token: evil }, caught: true });
    note.caseRecord({ id: evil, status: "FAIL", detail: evil });
    note.caseRecord({ id: "A2", status: "NOT RUN", detail: evil });
    note.terminal({ failed: true, skipped: true, missing: true, audit: false, deadline: false, exception: true, probe: false, only: false, results: [{ id: evil, status: "FAIL", detail: evil }, { id: "A1", status: evil }] });
  }
  assert.ok(lines.length > 0);
  for (const l of lines) { assert.match(l, LINE); assert.equal((l.match(/\n/g) || []).length, 1); assert.ok(!/PWNED|stop-commands|%0A|CANARY|token/i.test(l), l); }
  assert.ok(!lines.join("").includes(CANARY));
});

test("the allowed fields hold: title, detail and evidence are accepted as present and never read; caught only counts when it is exactly true", () => {
  for (const caught of [1, "true", "yes", {}, [], null, undefined, false]) {
    const { note, lines } = make();
    note.caseRecord({ id: "A3", status: "FAIL", caught });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^::error title=CASE_FAILED::A case did not pass\. ids=A3\n$/);
  }
  const { note, lines } = make();
  note.caseRecord({ id: "A3", status: "FAIL", caught: true });
  assert.match(lines[0], /^::error title=CASE_EXCEPTION::A case ended with a caught exception\. ids=A3\n$/);
});

/* ---- case classes ---- */
test("PASS says nothing; FAIL is CASE_FAILED; NOT RUN is CASE_NOT_RUN; a fail is never an exception without the tag", () => {
  const { note, lines } = make();
  note.caseRecord({ id: "A1", status: "PASS" });
  assert.deepEqual(lines, []);
  note.caseRecord({ id: "A2", status: "FAIL", detail: "timeout after 480000 ms: group did not finish" });   // wording that sounds like a deadline is still only a failed case
  note.caseRecord({ id: "A3", status: "NOT RUN" });
  assert.match(lines[0], /title=CASE_FAILED::A case did not pass\. ids=A2/);
  assert.match(lines[1], /^::error title=CASE_NOT_RUN::A case did not run\. ids=A3\n$/);
  assert.ok(!lines.some((l) => /DEADLINE|EXCEPTION/.test(l)));
});

/* ---- known deadline versus unknown termination ---- */
test("a deadline is reported only when the harness's own timer hook fires; a missing summary is never turned into a timeout", () => {
  const unknown = make();
  unknown.note.phase("KIT_LAUNCHED"); unknown.note.group("login");
  unknown.note.caseRecord({ id: "A1", status: "FAIL" });
  assert.ok(!unknown.lines.some((l) => /DEADLINE/.test(l)), "no timer hook was called, so no deadline is named");
  assert.ok(!unknown.lines.some((l) => /RUN_SUMMARY/.test(l)), "no terminal was called, so no summary is invented");

  const g = make();
  g.note.group("recovery"); g.note.groupDeadline("recovery");
  assert.ok(g.lines.some((l) => /^::error title=GROUP_DEADLINE::A case group reached its internal deadline\. group=recovery\n$/.test(l)));
  assert.equal(g.note.groupDeadlineFired(), true);
  g.note.runnerException();
  assert.ok(!g.lines.some((l) => /RUNNER_EXCEPTION/.test(l)), "a group deadline is not also reported as an exception");

  const r = make();
  r.note.phase("KIT_LAUNCHED"); r.note.runDeadline();
  assert.ok(r.lines.some((l) => /^::error title=RUN_DEADLINE::The run reached its internal deadline\. phase=KIT_LAUNCHED\n$/.test(l)));

  const e = make();
  e.note.runnerException();
  assert.ok(e.lines.some((l) => /^::error title=RUNNER_EXCEPTION::The run ended with a caught exception\.\n$/.test(l)));
  assert.equal(e.note.groupDeadlineFired(), false);
});

/* ---- coverage ---- */
test("coverage is the trusted list minus the unique observed ids: missing, duplicate, unknown id and unknown status are all caught, and nothing the results claim about themselves is trusted", () => {
  const all = EXPECTED_IDS.map((id) => ({ id, status: "PASS" }));
  assert.deepEqual(coverageOf(all), { missing: [], duplicate: false, unknownStatus: false, unknownId: false, invalid: false });
  assert.deepEqual(coverageOf(all.slice(1)).missing, ["A1"]);
  assert.equal(coverageOf([...all, { id: "A1", status: "PASS" }]).duplicate, true);
  assert.equal(coverageOf([...all, { id: "ZZ-new", status: "PASS" }]).unknownId, true);
  assert.equal(coverageOf([...all.slice(1), { id: "A1", status: "MAYBE" }]).unknownStatus, true);
  assert.deepEqual(coverageOf([...all.slice(1), { id: "A1", status: "MAYBE" }]).missing, ["A1"]);
  for (const id of INTERNAL_IDS) assert.deepEqual(coverageOf([...all.slice(1), { id, status: "FAIL" }]).missing, ["A1"], "an internal id never counts as coverage");
  const lying = Object.assign(all.slice(2), { expectedIds: ["A1"], length: 35 });
  assert.ok(coverageOf(lying).missing.includes("A1") && coverageOf(lying).missing.includes("B-roll-blank"), "claimed expectedIds and counts are ignored");
  for (const bad of [null, undefined, "A1", 7, {}, { length: 35 }]) { const c = coverageOf(bad); assert.equal(c.invalid, true); assert.equal(c.missing.length, 35); }
  assert.equal(coverageOf([null, { id: "A1", status: "PASS" }]).invalid, true);
});

test("terminal: incomplete coverage names ids and flags; complete clean coverage is silent but for a notice summary; an unchecked --only run skips coverage", () => {
  const facts = (over) => ({ failed: false, skipped: false, missing: false, audit: true, deadline: false, exception: false, probe: false, only: false, results: EXPECTED_IDS.map((id) => ({ id, status: "PASS" })), ...over });
  const clean = make(); clean.note.terminal(facts({}));
  assert.equal(clean.lines.length, 1);
  assert.match(clean.lines[0], /^::notice title=RUN_SUMMARY::Run summary\. failed=N skipped=N missing=N audit=Y deadline=N exception=N probe=N only=N\n$/);

  const bad = make(); bad.note.terminal(facts({ failed: true, missing: true, results: EXPECTED_IDS.slice(3).map((id) => ({ id, status: "PASS" })) }));
  assert.ok(bad.lines.some((l) => /^::error title=COVERAGE::Case coverage is incomplete\. ids=A1,B-roll-blank,B-roll-spaces dup=N unknownstatus=N unknownid=N invalid=N\n$/.test(l)));
  assert.ok(bad.lines.some((l) => /^::error title=RUN_SUMMARY::/.test(l)));

  const dup = make(); dup.note.terminal(facts({ results: [...EXPECTED_IDS.map((id) => ({ id, status: "PASS" })), { id: "A1", status: "PASS" }] }));
  assert.ok(dup.lines.some((l) => /title=COVERAGE::.*dup=Y/.test(l)));

  const only = make(); only.note.terminal(facts({ only: true, results: [{ id: "A1", status: "PASS" }] }));
  assert.ok(!only.lines.some((l) => /COVERAGE/.test(l)));

  const noAudit = make(); noAudit.note.terminal(facts({ audit: false }));
  assert.ok(noAudit.lines.some((l) => /^::error title=AUDIT_MISSING::No renderer sandbox audit ran\.\n$/.test(l)));

  const wrong = make(); wrong.note.terminal(facts({ failed: "no" }));
  assert.ok(wrong.lines.every((l) => l.startsWith("::warning title=REJECTED::")), "a non-boolean fact is refused, never coerced");
});

/* ---- bounds ---- */
test("bounded output: case errors are capped, the terminal share survives them, and no level passes its total", () => {
  const { note, lines } = make();
  for (let i = 0; i < 200; i++) {
    note.caseRecord({ id: EXPECTED_IDS[i % EXPECTED_IDS.length], status: i % 3 ? "FAIL" : "NOT RUN", caught: i % 2 === 0 });
    note.caseRecord({ id: "nope" + i, status: "FAIL" });
    note.groupDeadline("login"); note.runDeadline(); note.runnerException(); note.phase("CASES_END"); note.group("backup");
  }
  note.terminal({ failed: true, skipped: true, missing: true, audit: false, deadline: true, exception: true, probe: false, only: false, results: [] });
  assert.ok(count(lines, "error") <= 10, "errors " + count(lines, "error"));
  assert.ok(count(lines, "notice") <= 10, "notices " + count(lines, "notice"));
  assert.ok(count(lines, "warning") <= 3, "warnings " + count(lines, "warning"));
  assert.ok(lines.some((l) => /title=COVERAGE/.test(l)) && lines.some((l) => /title=AUDIT_MISSING/.test(l)) && lines.some((l) => /title=RUN_SUMMARY/.test(l)), "the reserved terminal share was used up");
  const informative = lines.filter((l) => !/title=REJECTED/.test(l));   // a refusal is a fixed sentence, up to three times, and says nothing about the request
  assert.equal(new Set(informative).size, informative.length, "a line was written twice");
  assert.ok(lines.length - informative.length <= 3);
  for (const l of lines) assert.ok(l.length < 400, l.length);
  const ids = make(); ids.note.terminal({ failed: false, skipped: false, missing: true, audit: true, deadline: false, exception: false, probe: false, only: false, results: [] });
  const cov = ids.lines.find((l) => /title=COVERAGE/.test(l));
  assert.ok(cov.includes("more=Y") && cov.split("ids=")[1].split(" ")[0].split(",").length === MAX_IDS_IN_LINE, cov);
});

test("every phase and group notice fits in the notice share together with the corrected case notice", () => {
  const { note, lines } = make();
  for (const p of PHASES) note.phase(p);
  for (const g of GROUPS) note.group(g);
  assert.equal(count(lines, "notice"), PHASES.length + GROUPS.length);
  note.terminal({ failed: false, skipped: false, missing: false, audit: true, deadline: false, exception: false, probe: false, only: false, results: EXPECTED_IDS.map((id) => ({ id, status: "PASS" })) });
  assert.ok(lines.some((l) => /title=RUN_SUMMARY/.test(l)), "the summary notice was crowded out by phase notices");
  assert.ok(count(lines, "notice") <= 10);
});

/* ---- the writer ---- */
test("a throwing writer is swallowed, is not retried, and no fallback write is made", () => {
  let calls = 0;
  const note = createAnnotator({ scope: "corrected", write: () => { calls++; throw new Error(CANARY); } });
  assert.doesNotThrow(() => {
    note.phase("KIT_LAUNCHED"); note.caseRecord({ id: "A1", status: "FAIL" }); note.caseRecord({ id: "bad", status: "FAIL" });
    note.groupDeadline("login"); note.runDeadline(); note.runnerException();
    note.terminal({ failed: true, skipped: false, missing: true, audit: false, deadline: true, exception: false, probe: false, only: false, results: [] });
  });
  assert.equal(calls, 1, "exactly one attempt, then silence");
  let refusedCalls = 0;
  const n2 = createAnnotator({ scope: "corrected", write: () => { refusedCalls++; throw new Error("x"); } });
  n2.phase("not-a-phase");
  n2.phase("not-a-phase");
  assert.equal(refusedCalls, 1, "the refusal path does not write a second time after a failed write");
});

test("a writer that is not a function, an option bag with extra keys, and a bad scope leave an annotator that writes nothing and throws nothing", () => {
  for (const options of [undefined, null, 7, "corrected", { scope: "corrected", write: 5 }, { scope: "other" }, { scope: "corrected", extra: 1 }, { scope: "__proto__" }, { scope: "toString" }, Object.create({ scope: "corrected" })]) {
    const lines = [];
    const orig = process.stdout.write;
    process.stdout.write = (l) => { lines.push(String(l)); return true; };
    try {
      const note = createAnnotator(options);
      assert.doesNotThrow(() => { note.phase("KIT_LAUNCHED"); note.caseRecord({ id: "A1", status: "FAIL" }); note.terminal({}); });
    } finally { process.stdout.write = orig; }
    assert.deepEqual(lines, [], JSON.stringify(Object.keys(options || {})));
  }
});

test("baseline is characterization only: every line says so and none is an error", () => {
  const { note, lines } = make("baseline");
  note.phase("KIT_LAUNCHED"); note.group("login");
  note.caseRecord({ id: "A1", status: "FAIL", caught: true }); note.caseRecord({ id: "A2", status: "NOT RUN" });
  note.groupDeadline("login"); note.runDeadline(); note.runnerException(); note.phase("zzz");
  note.terminal({ failed: true, skipped: true, missing: true, audit: false, deadline: true, exception: true, probe: false, only: false, results: [] });
  assert.ok(lines.length > 5);
  assert.equal(count(lines, "error"), 0);
  for (const l of lines) { assert.match(l, LINE); assert.ok(/::Characterization only\. /.test(l), l); }
});

/* ---- the harness hooks ---- */
test("exit invariance: the exit expression, the deadline exit, the timeouts and every assertion are byte-for-byte what head 3738544 has", () => {
  assert.ok(RUNNER.endsWith('process.exit(WRITE_PROBE || failed || skipped || exitCode || missing.length || !auditCalls ? 1 : 0);\n'));
  assert.equal(RUNNER.split("process.exit(").length - 1, 2, "a new exit was added");
  assert.ok(RUNNER.includes("  process.exit(1);\n}, DEADLINE_MS);"));
  assert.ok(RUNNER.includes('Number(process.env.STRICT_GROUP_TIMEOUT_MS || 150_000), DEADLINE_MS = Number(process.env.STRICT_DEADLINE_MS || 480_000)'));
  // Strict cleanup delta: exactly ONE place was added on purpose, a cleanup that failed, timed out or never completed. The other two are the head's own.
  assert.equal((RUNNER.match(/exitCode = 1/g) || []).length, 3, "the places that set the exit code changed");
  assert.ok(RUNNER.includes('if (cleanupFailed(cleanup.outcome())) { exitCode = 1; console.error("CLEANUP FAILED: " + cleanup.outcome().reasons.join(", ")); }'));
  assert.ok(RUNNER.includes('if (WRITE_PROBE && process.env.GITHUB_ACTIONS === "true") throw new Error('));
  assert.ok(RUNNER.includes("const failed = results.filter((r) => r.status === \"FAIL\").length, skipped = results.filter((r) => r.status === \"NOT RUN\").length;"));
  assert.ok(RUNNER.includes('const missing = ONLY ? [] : EXPECTED_IDS.filter((id) => !passedIds.has(id));'));
  // the hook sits after every fact the exit reads and before the exit, and it is the only thing between them besides the unchanged logging
  const tail = RUNNER.slice(RUNNER.indexOf("const failed = results.filter"));
  assert.ok(tail.indexOf("annotateEnd(") > tail.indexOf("const missing") && tail.indexOf("annotateEnd(") < tail.indexOf("process.exit("));
});

test("every hook in the harness is guarded so an annotation can never skip a case, cleanup or the exit", () => {
  const code = RUNNER.replace(/\/\*[\s\S]*?\*\//g, "");
  // record(): the annotator call is inside its own try
  assert.match(code, /try \{ note\.caseRecord\(caught === true \? \{ id: r\.id, status: r\.status, caught: true \} : \{ id: r\.id, status: r\.status \}\); \} catch \(e\) \{\}/);
  // the end-of-run helper is a try, and the deadline path is a try
  assert.match(code, /const annotateEnd = \(exception\) => \{ try \{[^]*?\} catch \(e\) \{\} \};/);
  assert.ok(code.includes("try { note.runDeadline(); annotateEnd(false); } catch (e) {}"));
  assert.ok(code.includes("try { note.groupDeadline(name); } catch (e) {}"));
  assert.ok(code.includes("try { note.runnerException(); } catch (e2) {}"));
  // the stored record is not changed: only the id, the status and the caught flag reach the annotator, and no raw field is handed over
  const calls = [...code.matchAll(/note\.[A-Za-z]+\(([^)]*)\)/g)].map((m) => m[0]);
  for (const c of calls) assert.ok(!/detail|evidence|title|message|\be\b|String\(/.test(c.replace(/caught === true \? \{ id: r\.id, status: r\.status, caught: true \} : \{ id: r\.id, status: r\.status \}/, "")), c);
  // caught is set at three catch sites that record the failure directly, and the runner's own is conditional on no group deadline
  assert.equal((code.match(/\}, true\); \}/g) || []).length + (code.match(/\}, true\); try \{ await keepStopped/g) || []).length, 3);
  assert.ok(code.includes("}, !note.groupDeadlineFired());"));
  assert.equal((code.match(/note\.[a-zA-Z]+\(/g) || []).length, 11, "a hook was added or removed");   // caseRecord, terminal, runDeadline, groupDeadline, phase x3, group, runnerException, groupDeadlineFired x2
});

test("the group timer is not reported once the group has finished, and the original race, rejection and message are kept", () => {
  assert.ok(RUNNER.includes("if (!done) { try { note.groupDeadline(name); } catch (e) {} } reject(new Error(`group ${name} did not finish in ${GROUP_MS} ms`));"));
  assert.ok(RUNNER.includes("Promise.race([run, new Promise((_, reject) => setTimeout("));
});

/* ---- the workflow ---- */
const stepsOf = (y) => y.split(/\n(?=      - )/).slice(1);
test("the workflow keeps every protected field: pins, permissions, guard, timeout, env, commands, upload", () => {
  for (const must of [
    "permissions:\n  contents: read",
    "if: github.head_ref == 'codex/nov1-security-recovery-integration'",
    "runs-on: ubuntu-22.04",
    "timeout-minutes: 12",
    "STRICT_EXPECT_PLAYWRIGHT: '1.63.0'",
    "STRICT_EXPECT_CHROME: '153.0.8010.12'",
    `STRICT_EXPECT_CDP_SUFFIX: '["--noerrdialogs","--ozone-platform=headless","--ozone-override-screen-size=800,600","--use-angle=swiftshader-webgl","--flag-switches-begin","--flag-switches-end","--enable-unsafe-swiftshader"]'`,
    "STRICT_REQUIRE_PINS: '1'", "STRICT_REQUIRE_DIAGNOSTICS: '1'",
    "VITE_SUPABASE_URL: http://127.0.0.1:5433", "VITE_SUPABASE_ANON_KEY: mock-anon-key",
    "uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2",
    "ref: ${{ github.event.pull_request.head.sha }}", "ref: 82e59f924020e11148a6d07fe41ff75f6de7d6f7", "persist-credentials: false",
    "uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0", "node-version: '22'",
    "run: npm ci --no-audit --no-fund",
    'npm install --prefix "$RUNNER_TEMP/sandbox-driver" --ignore-scripts --no-audit --no-fund --package-lock=false playwright@1.63.0',
    '"$RUNNER_TEMP/sandbox-driver/node_modules/.bin/playwright" install --no-shell chromium',
    'npx vite build --outDir "$RUNNER_TEMP/dist-corrected" --emptyOutDir',
    'ln -s "$PWD/node_modules" baseline-tree/node_modules',
    '(cd baseline-tree && npx vite build --outDir "$RUNNER_TEMP/dist-baseline" --emptyOutDir)',
    'run: node scripts/browser-security-cases.mjs --dist "$RUNNER_TEMP/dist-corrected" --out browser-cases-evidence/corrected --expect corrected',
    'run: node scripts/browser-security-cases.mjs --dist "$RUNNER_TEMP/dist-baseline" --out browser-cases-evidence/baseline --expect baseline',
    "uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2", "retention-days: 3", "if-no-files-found: warn",
    "STRICT_BROWSER_DRIVER: ${{ runner.temp }}/sandbox-driver/node_modules/playwright",
  ]) assert.ok(WORKFLOW.includes(must), must);
  assert.equal((WORKFLOW.match(/STRICT_BROWSER_DRIVER:/g) || []).length, 2);
  assert.ok(!/secrets\.|pull_request_target|GITHUB_TOKEN|id-token|write-all|contents: write|deploy|hosting/i.test(WORKFLOW.replace(/^#.*$/gm, "")), "a secret, a write token or a deployment appeared");
  assert.equal((WORKFLOW.match(/uses: /g) || []).length, 4);
});

test("the corrected step still gates: it has an id and no continue-on-error, only the baseline has it, and the outcome annotation sits between them", () => {
  const steps = stepsOf(WORKFLOW);
  const corrected = steps.findIndex((s) => /name: Corrected head, every case \(this step gates the job\)/.test(s));
  const outcome = steps.findIndex((s) => /name: Annotate the corrected outcome/.test(s));
  const baseline = steps.findIndex((s) => /name: Baseline head, characterization only/.test(s));
  assert.ok(corrected > 0 && corrected < outcome && outcome < baseline, "order");
  assert.equal(outcome, corrected + 1, "the corrected outcome is annotated immediately after the corrected step");
  assert.ok(/^\s+id: corrected$/m.test(steps[corrected]));
  assert.ok(!/continue-on-error/.test(steps[corrected]) && !/^\s+if:/m.test(steps[corrected]), "the corrected step gained a condition");
  assert.equal(steps.filter((s) => /^\s+continue-on-error:/m.test(s)).length, 1);
  assert.ok(/^\s+continue-on-error: true$/m.test(steps[baseline]) && /^\s+if: always\(\)$/m.test(steps[baseline]));
  assert.equal((WORKFLOW.match(/^\s+continue-on-error:/gm) || []).length, 1);
  assert.ok(/^\s+if: always\(\)$/m.test(steps[outcome]));
  assert.ok(!/continue-on-error/.test(steps[outcome]));
});

test("workflow annotations are static text: stage steps interpolate nothing, and the one expression goes through env into a case on a fixed set", () => {
  const steps = stepsOf(WORKFLOW);
  const stage = steps.filter((s) => /name: Mark the stage/.test(s));
  assert.equal(stage.length, 5);
  for (const s of stage) { assert.ok(!/\$\{\{|\$[A-Za-z_{(]/.test(s), s); assert.match(s, /run: echo "::notice title=STAGE::[A-Za-z0-9 ,.]+"\n?$/); }
  const outcome = steps.find((s) => /Annotate the corrected outcome/.test(s));
  assert.equal((WORKFLOW.match(/steps\.corrected\.outcome/g) || []).length, 1);
  assert.ok(/env:\n\s+CORRECTED_OUTCOME: \$\{\{ steps\.corrected\.outcome \}\}/.test(outcome));
  const script = outcome.slice(outcome.indexOf("run: |"));
  assert.ok(!script.includes("${{"), "an expression inside the script");
  const arms = [...script.matchAll(/^\s+(success|failure|cancelled|skipped|\*)\) echo "::(notice|error|warning) title=CORRECTED_OUTCOME::Corrected step outcome\. outcome=(success|failure|cancelled|skipped|unknown)" ;;$/gm)];
  assert.equal(arms.length, 5);
  assert.ok(script.includes('case "$CORRECTED_OUTCOME" in'));
  assert.ok(WORKFLOW.includes("- scripts/safe-annotations.mjs") && WORKFLOW.includes("- test/safe-annotations.test.mjs"));
  assert.ok(WORKFLOW.indexOf("Mark the stage, baseline") < WORKFLOW.indexOf("name: Baseline head, characterization only"));
});

/* ---- baseline budget (reviewer reproduction): a baseline event and the terminal lines are notices with their own shares ---- */
test("baseline: a group deadline, a failing terminal and its coverage, audit and summary are all written as notices, none of them called rejected", () => {
  const { note, lines } = make("baseline");
  note.groupDeadline("recovery");
  note.terminal({ failed: true, skipped: false, missing: true, audit: false, deadline: false, exception: false, probe: false, only: false, results: [] });
  const titles = lines.map((l) => l.match(/title=([A-Z_]+)::/)[1]);
  assert.deepEqual(titles, ["GROUP_DEADLINE", "COVERAGE", "AUDIT_MISSING", "RUN_SUMMARY"]);
  assert.equal(count(lines, "notice"), 4);
  assert.equal(count(lines, "error") + count(lines, "warning"), 0);
  for (const l of lines) { assert.match(l, LINE); assert.ok(l.includes("Characterization only. "), l); }
  assert.match(lines[0], /group=recovery/);
  assert.match(lines[3], /failed=Y .*audit=N/);
});

test("baseline: run deadline and runner exception are notices; flooding cannot take the terminal share or pass ten notices", () => {
  const a = make("baseline"); a.note.phase("KIT_LAUNCHED"); a.note.runDeadline(); a.note.runnerException();
  assert.deepEqual(a.lines.map((l) => l.match(/title=([A-Z_]+)::/)[1]), ["PHASE", "RUN_DEADLINE", "RUNNER_EXCEPTION"]);
  const { note, lines } = make("baseline");
  for (let i = 0; i < 100; i++) {
    note.phase(PHASES[i % PHASES.length]); note.group(GROUPS[i % GROUPS.length]);
    note.caseRecord({ id: EXPECTED_IDS[i % EXPECTED_IDS.length], status: "FAIL", caught: i % 2 === 0 });
    note.groupDeadline(GROUPS[i % GROUPS.length]); note.runDeadline(); note.runnerException();
  }
  note.terminal({ failed: true, skipped: true, missing: true, audit: false, deadline: true, exception: true, probe: false, only: false, results: [] });
  assert.ok(count(lines, "notice") <= 10, "notices " + count(lines, "notice"));
  assert.equal(count(lines, "error"), 0);
  assert.equal(count(lines, "warning"), 0, "legitimate baseline data was reported as rejected");
  for (const t of ["COVERAGE", "AUDIT_MISSING", "RUN_SUMMARY"]) assert.ok(lines.some((l) => l.includes("title=" + t + "::")), t);
  assert.ok(lines.some((l) => /title=(GROUP|RUN)_DEADLINE/.test(l)));
});

test("baseline characterization is unchanged by the budget: the corrected run still reports the same facts as errors, and the exit-affecting source is untouched", () => {
  const c = make("corrected");
  c.note.groupDeadline("recovery");
  c.note.terminal({ failed: true, skipped: false, missing: true, audit: false, deadline: false, exception: false, probe: false, only: false, results: [] });
  assert.deepEqual(c.lines.map((l) => l.match(/title=([A-Z_]+)::/)[1]), ["GROUP_DEADLINE", "COVERAGE", "AUDIT_MISSING", "RUN_SUMMARY"]);
  assert.equal(count(c.lines, "error"), 4);
  assert.ok(RUNNER.endsWith('process.exit(WRITE_PROBE || failed || skipped || exitCode || missing.length || !auditCalls ? 1 : 0);\n'));
});
