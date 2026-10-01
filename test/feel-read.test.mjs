import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { followAssessment, followDetail, sustainedFollowSpread, groundStep } from "../scripts/feel-read.mjs";

const feel = fs.readFileSync(new URL("../scripts/feel.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* C86. The swipe follow row went red at exactly one 10 px thumb step. A blank
   native scroller did too. Keep the raw sentence, but only a sustained gap
   can fail the row as an app regression. */

test("a one-reading blip is told apart from a lag that stays, by the reading after the widest", () => {
  const blip = followDetail([[10, 20, 5, 16.7], [13, 30, 15, 16.7], [16, 40, 15, 33.3], [19, 50, 35, 16.7]]);
  assert.match(blip, /widest frame 16 \(thumb 40, page 15, 25 px behind, 33 ms\), then 15 px behind on the reading after/);
  const stays = followDetail([[10, 20, 5, 16.7], [13, 30, 5, 16.7], [16, 40, 15, 16.7], [19, 50, 25, 16.7]]);
  assert.match(stays, /then 25 px behind on the reading after/, "a lag that persists reads as persisting");
});

test("a steady follow says nothing, so a green row stays one line", () => {
  assert.equal(followDetail([[10, 20, 5, 16.7], [13, 30, 15, 16.7], [16, 40, 25, 16.7]]), "");
  assert.equal(followDetail([]), "");
  assert.equal(followDetail(null), "");
});

test("the widest gap on the final reading says so rather than inventing a reading after", () => {
  assert.match(followDetail([[10, 20, 5, 16.7], [13, 30, 5, 16.7]]), /25 px behind, 17 ms\), the last reading;/);
});

test("a one-reading compositor gap recovers without hiding the raw reading", () => {
  const at = [[10, 20, 5, 16.7], [13, 30, 15, 16.7], [16, 40, 15, 16.7], [19, 50, 35, 16.7], [22, 60, 45, 16.7]];
  assert.equal(sustainedFollowSpread(at), 0);
  assert.match(followDetail(at), /25 px behind.*then 15 px behind/);
});

const readings = (gaps) => gaps.map((gap, i) => [i, i * 10, i * 10 - gap, 16.7]);

test("one enormous reading is not excused as compositor bookkeeping", () => {
  const result = followAssessment(readings([15, 15, 215, 15, 15]));
  assert.ok(result.spread > 2);
  assert.match(result.reason, /exceeds one thumb step/);
});

test("repeated one-step hitches in a swipe fail with their count", () => {
  const result = followAssessment(readings([15, 15, 25, 15, 25, 15, 25, 15, 15]));
  assert.ok(result.spread > 2);
  assert.match(result.reason, /3 one-reading gaps/);
});

test("an offset gained on reading two and then held is a hitch, not a recovered blip", () => {
  const result = followAssessment(readings([15, 25, 25, 25]));
  assert.ok(result.spread > 2);
  assert.match(result.reason, /offset gained/);
});

test("the final solitary sample belongs to snap and frame checks", () => {
  assert.equal(sustainedFollowSpread(readings([15, 15, 15, 25])), 0);
});

test("two consecutive readings behind still fail the unchanged two-pixel bar", () => {
  const at = [[10, 20, 5, 16.7], [13, 30, 15, 16.7], [16, 40, 15, 16.7], [19, 50, 25, 16.7], [22, 60, 35, 16.7], [25, 70, 55, 16.7]];
  assert.equal(sustainedFollowSpread(at), 10);
  assert.ok(sustainedFollowSpread(at) > 2);
});

test("gradual persistent drift is not smoothed away", () => {
  const at = [15, 16, 17, 18, 19, 20].map((gap, i) => [i, i * 10, i * 10 - gap, 16.7]);
  assert.equal(sustainedFollowSpread(at), 5);
});

test("no sustained readings fails closed", () => {
  assert.equal(sustainedFollowSpread([]), 999);
  assert.equal(sustainedFollowSpread([[1, 10, 5, 16.7]]), 999);
  assert.equal(sustainedFollowSpread([[1, 10, 5, 16.7], [2, 20, 5, 16.7]]), 999);
});

test("the harness measures sustained follow without changing its bar and prints raw evidence", () => {
  assert.ok(/import \{ followAssessment, followDetail, groundStep \} from "\.\/feel-read\.mjs";/.test(feel));
  assert.ok(/const detail = followDetail\(at\);\n\s*if \(detail\) console\.log\("       " \+ detail\);/.test(feel));
  assert.ok(/const assessment = followAssessment\(at\);/.test(feel));
  assert.ok(/const follow = assessment\.spread;/.test(feel));
  assert.ok(/follow: 2,/.test(feel), "the two-pixel bar is unchanged");
  assert.ok(/raw one-sample spread/.test(feel), "one-frame compositor gaps remain observable");
});


/* C88. The ground row read once in 72 runs at 28 against a bar of 24, the size
   of the step it exists to catch. A sample is [ms, r, g, b, paints, paintAt]. */
const BLEND = 13;                        // points of colour the ground moves per painted frame
const paintAt = (k) => 100 + k * 16.7;   // the app paints once a frame, from 100 ms
const colour = (k) => 40 + k * BLEND;
/* A read at `ms` that saw paint number k. */
const saw = (ms, k, bump = 0) => [ms, colour(k) + bump, 10, 10, k, paintAt(k)];
/* What the row did before: the change over the time between two READS. */
const oldStep = (gnd) => { let m = 0; for (let i = 1; i < gnd.length; i++) { if (gnd[i][0] < 80) continue; const d = Math.abs(gnd[i][1] - gnd[i - 1][1]) + Math.abs(gnd[i][2] - gnd[i - 1][2]) + Math.abs(gnd[i][3] - gnd[i - 1][3]); const f = Math.max(1, (gnd[i][0] - gnd[i - 1][0]) / 16.7); m = Math.max(m, Math.round(d / f)); } return m; };

test("a steady blend reads as its own pace", () => {
  const gnd = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => saw(100 + k * 16.7, k));
  assert.equal(groundStep(gnd), BLEND);
});

test("a read that lands a frame late against the app's paint is not a step (the once in 72)", () => {
  /* Reads at 16.7 ms spacing. Paints 3 and 4 fall between read 3 and read 4:
     read 3 saw paint 2 (it ran before the app's paint in its frame), read 4 saw
     paint 4 (after). Two frames of blend in one sample at one frame's length. */
  const gnd = [saw(100, 0), saw(116.7, 1), saw(133.4, 2), saw(150.1, 2), saw(166.8, 4), saw(183.5, 5), saw(200.2, 6)];
  assert.equal(oldStep(gnd), 2 * BLEND, "the old row read it as double: 26 against a bar of 24");
  assert.equal(groundStep(gnd), BLEND, "and the blend's own clock says it moved at its pace");
});

test("a real step is still caught: 30 in one painted frame", () => {
  const gnd = [0, 1, 2, 3].map((k) => saw(100 + k * 16.7, k));
  gnd.push(saw(150.1, 4, 30));            // the frame that jumped by 30 on top of the blend
  gnd.push(saw(166.8, 5, 30));
  assert.ok(groundStep(gnd) >= 30, `${groundStep(gnd)} reads the step`);
  assert.ok(groundStep(gnd) > 24, "over the bar");
});

test("a loaded runner that drops frames reads at the blend's pace, as the WebKit fix intended", () => {
  /* Two reads 150 ms apart; the app painted at each, nine frames of blend apart. */
  const a = [0, 1, 2].map((k) => saw(100 + k * 16.7, k));
  const slow = [a[0], a[1], a[2], [233.4, colour(2) + 9 * BLEND, 10, 10, 3, paintAt(2) + 9 * 16.7]];
  assert.equal(groundStep(slow), BLEND);
});

test("the same paint read twice saw no blend, and the first 80 ms are the tap's", () => {
  const same = [saw(100, 3), saw(116.7, 3), saw(133.4, 3)];
  assert.equal(groundStep(same), 0);
  const tap = [[0, 40, 10, 10, 0, 0], [16.7, 200, 10, 10, 1, 16.7], [33.4, 200, 10, 10, 1, 16.7],
    [100, 213, 10, 10, 2, paintAt(2)], [116.7, 226, 10, 10, 3, paintAt(3)]];
  assert.equal(groundStep(tap), BLEND, "a jump inside the first 80 ms is the tap, not the blend");
  assert.equal(groundStep([]), 0);
  assert.equal(groundStep(null), 0);
});

test("the harness counts the app's paints and puts the row back the way it found it", () => {
  assert.match(feel, /const stepMax = paints >= 5 \? groundStep\(gnd\) : 999;/, "and a row that saw too few paints fails instead of reading 0");
  assert.match(feel, /if \(paints < 5 && WEBKIT\) \{/, "except in WebKit, where the ground is not painted on a tab tap and the row read 0 and passed before (C108)");
  assert.match(feel, /--   ground: not measured in WebKit: the runner gave \$\{gnd\.length\} frame\(s\)/, "which it says, with the frame count, as the swipe row says it cannot run");
  assert.match(feel, /proto\.setTransform = function \(\.\.\.a\) \{ if \(this\.canvas === c\) \{ seen\.n\+\+; seen\.at = performance\.now\(\); \} return was\.apply\(this, a\); \};/);
  assert.match(feel, /else proto\.setTransform = was; \}; requestAnimationFrame\(tick\); \}\);/, "the patch comes off when the reading ends");
  assert.match(feel, /window\.__gnd\.push\(\[performance\.now\(\) - t0, d\[0\], d\[1\], d\[2\], seen\.n, seen\.at\]\)/);
});
