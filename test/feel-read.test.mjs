import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { followDetail } from "../scripts/feel-read.mjs";

const feel = fs.readFileSync(new URL("../scripts/feel.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* C86. The swipe follow row went red four times on CI at exactly 10 px, one
   thumb step, and never said where. These pin the sentence that will say it,
   because the rule is not changed until a failure has actually been read. */

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

test("the harness prints it, and the rule is unchanged until a failure has been read", () => {
  assert.ok(/import \{ followDetail \} from "\.\/feel-read\.mjs";/.test(feel));
  assert.ok(/const detail = followDetail\(at\);\n\s*if \(detail\) console\.log\("       " \+ detail\);/.test(feel));
  assert.ok(/const follow = gaps\.length \? Math\.max\(\.\.\.gaps\) - Math\.min\(\.\.\.gaps\) : 999;/.test(feel),
    "the spread itself is still max minus min: nothing is being ignored on a guess");
  assert.ok(/16 of 17 were not/.test(feel), "the experiment that ruled the easy fix out is written down beside it");
});
