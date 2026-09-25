import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { followDetail, sustainedFollowSpread } from "../scripts/feel-read.mjs";

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
  assert.ok(/import \{ followDetail, sustainedFollowSpread \} from "\.\/feel-read\.mjs";/.test(feel));
  assert.ok(/const detail = followDetail\(at\);\n\s*if \(detail\) console\.log\("       " \+ detail\);/.test(feel));
  assert.ok(/const follow = sustainedFollowSpread\(at\);/.test(feel));
  assert.ok(/follow: 2,/.test(feel), "the two-pixel bar is unchanged");
  assert.ok(/raw one-sample spread/.test(feel), "one-frame compositor gaps remain observable");
});
