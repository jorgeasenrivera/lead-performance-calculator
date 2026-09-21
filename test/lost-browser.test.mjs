import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lostBrowserWatch } from "../scripts/probe-kit.mjs";

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
