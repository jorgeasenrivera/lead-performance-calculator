import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { lostBrowserWatch, signIn } from "../scripts/probe-kit.mjs";

const feel = fs.readFileSync(new URL("../scripts/feel.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const shots = fs.readFileSync(new URL("../scripts/shots.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const flow = fs.readFileSync(new URL("../.github/workflows/checks.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* A stand-in for Playwright's browser: the two things the watch reads. */
function fakeBrowser() {
  const on = {};
  return {
    connected: true,
    on(name, fn) { (on[name] = on[name] || []).push(fn); },
    emit(name) { for (const fn of on[name] || []) fn(); },
    isConnected() { return this.connected; },
  };
}
const fakePage = () => { const on = {}; return { on(n, f) { (on[n] = on[n] || []).push(f); }, emit(n) { for (const f of on[n] || []) f(); } }; };

test("a browser that goes away mid-run is named, and a missed bar is not", () => {
  const b = fakeBrowser();
  const w = lostBrowserWatch(b);
  /* The case this is all for: a run that failed on its own merits, with the
     browser still there. Calling this a lost browser would hide a real
     regression behind "run it again", which is worse than the noise it fixes. */
  assert.equal(w.why(new Error("tap Lunch to shown: expected 9 ms, got 210")), null);
  b.connected = false; b.emit("disconnected");
  assert.match(w.why(new Error("anything")), /went away mid-run/);
});

test("a page that crashes says so, because memory is the suspicion", () => {
  const b = fakeBrowser(), p = fakePage();
  const w = lostBrowserWatch(b);
  w.watchPage(p);
  p.emit("crash");
  assert.match(w.why(null), /crashed/);
});

test("Playwright's own sentence is the fallback, for a throw that beats its event", () => {
  const w = lostBrowserWatch(fakeBrowser());
  /* Both 21 September failures arrived as exactly this, one waiting for
     .ar-bar.up and one for .ar-bar, both during sign-in. */
  assert.match(w.why(new Error("Target page, context or browser has been closed")), /closed under the run/);
  assert.equal(w.why(new Error("Timeout 30000ms exceeded waiting for .ar-bar")), null,
    "a bar that never arrived is a missed bar, not a lost browser");
});

test("both harnesses ask before they close, and stay red when the answer is yes", () => {
  /* The order is the whole trap: closing the browser fires the same disconnect
     the watch listens for, so a watch read inside or after the finally calls
     every failure a lost browser. Each script asks in a catch that runs first
     and hangs the answer on the error. */
  assert.ok(/catch \(e\) \{ if \(e && typeof e === "object"\) e\.lostBrowser = lost\.why\(e\); throw e; \}\n\s*finally \{ await b\.close\(\)/.test(feel),
    "feel asks before the close");
  assert.ok(/catch \(e\) \{ if \(e && typeof e === "object"\) e\.lostBrowser = lost\.why\(e\); throw e; \}\n\s*finally \{\n\s*await b\.close\(\)/.test(shots),
    "shots asks before the close");
  assert.ok(/process\.exitCode = 3;/.test(feel) && /process\.exit\(3\);/.test(shots),
    "a run that could not measure still fails: C83 asked for a legible check, not an advisory one");
  assert.ok(/Nothing here says the phone got worse, because nothing here measured it/.test(feel),
    "and the log says which of the two it was");
});

test("the pull request comment tells a lost browser from a missed bar", () => {
  assert.ok(/echo "code=\$code"/.test(flow), "the harness's exit code reaches the comment step");
  assert.ok(/const lost = String\(process\.env\.CODE \|\| ""\) === "3";/.test(flow), "which reads 3 as the lost browser");
  assert.ok(/The browser was lost before the phone was measured\./.test(flow)
    && /The phone feels worse: a bar was missed\./.test(flow),
    "two different headings, because one comment that says both is the thing C83 was filed about");
});

/* ---- C83's second half: the next crash has to carry evidence ---- */
import { machineNow, machineLine, watchMachine } from "../scripts/probe-kit.mjs";
const kit = fs.readFileSync(new URL("../scripts/probe-kit.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the machine reading never throws, whatever the runner's cgroup looks like", () => {
  /* The two layouts are the reason this exists: a harness that died reading
     /sys would be a worse bug than the one it is here to diagnose. */
  const m = machineNow();
  assert.equal(typeof m, "object");
  for (const k of ["used", "limit", "oomKill", "failcnt", "free"]) {
    assert.ok(m[k] === null || typeof m[k] === "number", `${k} is a number or null, never a guess`);
  }
});

test("an OOM kill during the run is stated as one, and its absence just as plainly", () => {
  const before = { used: 1e9, limit: 2e9, oomKill: 0, failcnt: 0, free: 5e8 };
  const after = { used: 19e8, limit: 2e9, oomKill: 1, failcnt: 0, free: 1e8 };
  assert.match(machineLine(after, 19e8, before), /killed 1 process\(es\) for memory/);
  /* And the case that matters just as much: memory was fine, so whoever
     reads this stops suspecting it and looks somewhere else. */
  assert.match(machineLine({ ...after, oomKill: 0 }, 19e8, before), /no process was killed for memory/);
});

test("a fact the kernel will not give is left out rather than guessed", () => {
  const line = machineLine({ used: null, limit: null, oomKill: null, failcnt: null, free: null });
  assert.equal(line, null, "nothing readable prints nothing at all");
  assert.doesNotMatch(machineLine({ used: 1e9, limit: null, oomKill: null, failcnt: null, free: null }) || "", /allowed|free on the box|oom/,
    "and a partial reading prints only the part it has");
});

test("a cgroup with no limit set is read as no limit, not as eight exabytes", () => {
  /* Both layouts write a sentinel there. Printing it would have said the
     container was allowed 8589934592 GB, which is the kind of number that
     teaches a reader to skip the line. */
  assert.ok(/const CG_NOLIMIT = 9223372036854771712;/.test(kit));
  assert.ok(/limit === CG_NOLIMIT \|\| limit === Infinity \? null : limit/.test(kit));
});

test("the peak is sampled while the run is alive, not read after the browser has gone", () => {
  const w = watchMachine(5);
  assert.equal(typeof w.peak(), "number");
  assert.ok(typeof w.line === "function" && typeof w.stop === "function");
  w.stop();
  assert.ok(/dead browser has already given its memory back/.test(kit),
    "the why is written down, on one line, because a guard that spans a wrap breaks the next time the comment is reflowed");
});

test("both harnesses print the machine on a good run too, which is what a crash reads against", () => {
  assert.ok(/feel: the machine: /.test(feel) && /feel: the machine when it went: /.test(feel));
  assert.ok(/shots: the machine: /.test(shots) && /shots: the machine when it went: /.test(shots));
});

test("sign-in reports its failing stage without swallowing the original failure", async () => {
  const stages = [], calls = [];
  const failure = new Error("Target crashed");
  const page = Object.fromEntries(["goto", "waitForTimeout", "fill", "click", "evaluate"].map((name) =>
    [name, async () => { calls.push(name); }]));
  page.waitForSelector = async () => { calls.push("waitForSelector"); throw failure; };
  await assert.rejects(signIn(page, "http://127.0.0.1:5178/", (s) => stages.push(s)), (e) => e === failure);
  assert.deepEqual(stages, ["open sign-in", "fill demo sign-in", "submit sign-in", "wait for room bar"]);
  assert.equal(calls.at(-1), "waitForSelector");
  assert.ok(!calls.includes("evaluate"), "a crash does not continue into welcome dismissal");
});

test("stage reporting leaves sign-in's operations and waits unchanged", async () => {
  const calls = [], stages = [];
  const page = Object.fromEntries(["goto", "waitForTimeout", "fill", "click", "waitForSelector", "evaluate"].map((name) =>
    [name, async (...args) => { calls.push([name, ...args]); }]));
  await signIn(page, "http://127.0.0.1:5178/", (s) => stages.push(s));
  assert.deepEqual(calls.filter(([n]) => n === "waitForTimeout").map(([, ms]) => ms), [2400, 3500, 1000]);
  assert.deepEqual(calls.find(([n]) => n === "waitForSelector"), ["waitForSelector", ".ar-bar.up", { timeout: 40000 }]);
  assert.equal(stages.at(-1), "dismiss welcome");
  calls.length = 0;
  await signIn(page, "http://127.0.0.1:5178/");
  assert.equal(calls.filter(([n]) => n === "click").length, 1, "existing callers still submit once");
});

test("partial screenshot artifacts survive failure and are not described as complete", () => {
  assert.match(flow, /uses: actions\/upload-artifact@v4\n\s+if: \$\{\{ !cancelled\(\) \}\}\n\s+id: keep/);
  assert.match(flow, /PICTURE_OUTCOME: \$\{\{ steps\.picture\.outcome \}\}/);
  assert.match(flow, /const complete = process\.env\.PICTURE_OUTCOME === "success";/);
  assert.match(flow, /Incomplete phone pictures/);
  assert.match(flow, /This is not a passing check/);
  assert.doesNotMatch(flow, /continue-on-error: true/);
});

test("WebKit diagnostics retain browser stderr and the last screenshot stage", () => {
  assert.match(flow, /name: Measure in WebKit\n\s+env:\n\s+DEBUG: pw:browser/);
  assert.match(flow, /name: Picture the phone in WebKit\n\s+id: picture\n\s+env:\n\s+DEBUG: pw:browser/);
  assert.match(feel, /row\("tap Lunch to shown", mid\(lunch\), BAR\.tap\)/);
  assert.match(shots, /shots: failed during \$\{currentStage\}/);
  assert.match(shots, /await signIn\(page, undefined, \(name\) => stage\(`normal-up: \$\{name\}`\)\)/);
});

test("the actual artifact comment distinguishes complete, partial and missing pictures", () => {
  const start = flow.indexOf('const complete = process.env.PICTURE_OUTCOME');
  const end = flow.indexOf('const { data: comments }', start);
  const comment = (outcome, url) => vm.runInNewContext(flow.slice(start, end) + '\nbody;', {
    process: { env: { PICTURE_OUTCOME: outcome } }, url, mark: 'shots', context: { sha: '123456789' },
  });
  assert.match(comment('success', 'https://example.com/artifact'), /The phone, pictured in WebKit/);
  for (const outcome of ['failure', 'cancelled', 'skipped']) {
    const body = comment(outcome, 'https://example.com/artifact');
    assert.match(body, /Incomplete phone pictures/);
    assert.match(body, /not a passing check/);
    assert.doesNotMatch(body, /The phone, pictured in WebKit/);
  }
  assert.match(comment('success', ''), /No phone pictures are available/);
});
