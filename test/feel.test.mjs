/**
 * The feel, held in the source.
 * -------------------------------------------------------------------------
 * scripts/feel.mjs measures the phone in a browser and needs one running. This
 * is the part of that bar that can be read off the code in forty milliseconds,
 * so `npm test` catches the easy ways of losing it: a control greyed out for a
 * round trip, a curtain that grew back, a waiting screen that shows late and
 * stays, a tap that waits for the server, a rail that springs on `left`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const core = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
const mgr = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8");
const fn = (src, name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, name + " exists"); return src.slice(i, src.indexOf("\n}\n", i)); };

test("the status controls are never greyed out for a round trip", () => {
  for (const name of ["SfStatusSelect", "SfTiles"]) assert.ok(!/disabled=\{/.test(fn(core, name)), name + " has no disabled");
  for (const name of ["AssistBlock", "SeatBlock"]) assert.ok(!/useState\(false\);\s*$/m.test(fn(core, name).split("\n").filter((l) => /busy/.test(l)).join("\n")), name + " has no busy state");
});

test("both rooms commit a tap before the server answers", () => {
  assert.equal(core.split("useCommit(setRow, mutateRow, refetch, writes)").length - 1, 2, "the line and the floor both use the commit");
  assert.ok(/if \(writes\.current > 0\) return;/.test(core), "the poll holds off while a write is in flight");
  for (const name of ["setFlag", "leave"]) assert.ok(!new RegExp(`async function ${name}\\(`).test(core), name + " does not await the row");
});

/* The motion tokens: one set of numbers in the stylesheet, the same set in the
   script, read from the source here so they cannot drift apart. */
function motion() {
  const css = {}; const t = /--t-(\w+): (\d+)ms/g; let m;
  const block = /--t-press:[^\n]*/.exec(core); assert.ok(block, "the --t-* tokens exist");
  while ((m = t.exec(block[0]))) css[m[1]] = Number(m[2]);
  const js = /const MOTION = \{([^}]*)\};/.exec(core); assert.ok(js, "MOTION exists");
  const script = {}; for (const [, k, v] of js[1].matchAll(/(\w+): (\d+)/g)) script[k] = Number(v);
  return { css, script };
}

test("the motion tokens agree, in the stylesheet and in the script", () => {
  const { css, script } = motion();
  assert.deepEqual(css, script, "--t-* and MOTION hold the same numbers");
  for (const k of ["press", "release", "exit", "swap", "settle", "wipe"]) assert.ok(k in css, "token " + k);
});

test("the curtain is one quick sweep and every change gets one", () => {
  const { css } = motion();
  assert.ok(/\.q-curtain\.q-wipe\{animation:qcurtain var\(--t-wipe\)/.test(core), "the wipe reads its token"); assert.ok(css.wipe <= 400, "sweep at most 400 ms");
  assert.ok(/\.q-curtain\.q-out\{animation:qcurtainOut var\(--t-settle\)/.test(core), "the exit reads its token"); assert.ok(css.settle <= 350, "exit at most 350 ms");
  assert.equal(core.split("wipeT.current.end = setTimeout(() => setWiping(false), MOTION.wipe);").length - 1, 2, "the wipe's end timer lives outside the effect, in both rooms");
  assert.equal(core.split("}, MOTION.swap);").length - 1, 2, "the swap is paced by its token in both rooms");
});

test("waiting screens show soon and leave the moment the wait is over", () => {
  const m = /function useHeld\(active, \{ delay = (\d+), hold = (\d+) \}/.exec(core); assert.ok(m, "useHeld defaults");
  assert.ok(Number(m[1]) <= 500, "shown within half a second"); assert.ok(Number(m[2]) <= 300, "held no longer than 300 ms");
});

test("the jump is once a day; a return the same day lands short", () => {
  assert.ok(/jumpShort = arrivalShort\(\);/.test(core) && /arrivalTaken\(\);/.test(core), "decided at the press");
  assert.ok(/reduce \? 320 : ARRIVAL\.assemble/.test(core) && /const reduce = jumpShort;/.test(core), "the landing reads the same decision");
});

test("every control gives under the finger, and the tick is at touch-down", () => {
  assert.ok(/window\.addEventListener\("pointerdown", pressDown/.test(core), "the press listens at the window");
  assert.ok(/-webkit-tap-highlight-color: transparent/.test(core), "no grey flash");
  assert.ok(/if \(tick\) buzzTickAt = Date\.now\(\);/.test(core), "the click's short buzz stands down after a tick");
  assert.ok(/duration: MOTION\.press, easing/.test(core) && /duration: MOTION\.release, easing/.test(core), "the press and the release are paced by their tokens");
  for (const c of ["sf-seg-btn", "sft", "sf-link", "sf-go", "mc-tab", "fba-btn", "ar-tab", "botnav-btn", "sect-chip"])
    assert.ok(!new RegExp("\\." + c + ":active[^{]*\\{[^}]*scale\\(").test(core + mgr), c + " has no :active scale of its own to compound with the press");
});

test("the bar at the foot rises once the first room is there, and the boot is under the curtain", () => {
  assert.ok(/className=\{"ar-bar" \+ \(ready \? " up" : ""\)\}/.test(core), "the bar waits for ready");
  assert.equal(core.split("onReady={onReady}").length - 1, 2, "both rooms report when their curtain lets go");
  assert.ok(/\.ar-bar\.up\{ transform:translateX\(-50%\); \}/.test(core) && /\.ar-bar\{[^}]*transition:transform var\(--t-settle\) var\(--spring\)/.test(core), "it rises on the settle token");
  assert.ok(/bootHeld \|\| \(phoneBoot && bootRooms\) \? <LoadingScreen \/>/.test(core), "a phone that lives in the rooms boots under the curtain");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(/lpcf:boot"\) === "rooms"/.test(html), "index.html paints the curtain's green first");
});

test("the rails spring on transform, not left", () => {
  assert.ok(!/style=\{\{ left: (headL|behindL|youL|leftOf)/.test(core + mgr), "no pip placed by an inline left");
  assert.ok(/\.mc-pip, \.mcf-pip, \.mcf-you \{ left:0; transform:translate\(calc\(100cqw/.test(core), "the phone's pips ride on transform");
  assert.ok(/\.fr-pip \{ left:0; transform:translate\(calc\(100cqw/.test(mgr), "the manager's pips ride on transform");
  assert.ok(/querySelectorAll\(":scope > s\.lt"\)/.test(core), "the light takes the rail's own dots only");
});
