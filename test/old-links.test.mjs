/* C99: the QR sign-in is retired, and a code, poster or table tag printed
   before 28 September opens the sign-in screen (Jorge chose this, A2 a).
   Recognising one must not swallow any link that still means something. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isOldCodeLink } from "../src/old-links.mjs";

test("every old code link is recognised", () => {
  for (const s of ["?q=dm&d=2026-09-28&t=abc123", "?o=dm&d=2026-09-28&t=abc123", "?f=dm&d=2026-09-28&t=abc123", "?f=dm&tbl=4", "f=dm&tbl=T2"]) {
    assert.equal(isOldCodeLink(s), true, s);
  }
});

test("the links that still work are left alone", () => {
  for (const s of ["", null, undefined, "?qboard=dm&k=line&key=abc", "?qboard=dm&k=floor", "?f=dm", "?q=dm", "?d=2026-09-28&t=abc", "?view=rooms", "?tbl=4"]) {
    assert.equal(isOldCodeLink(s), false, String(s));
  }
});

test("the app drops an old link before anything reads it", () => {
  const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
  assert.match(app, /if \(isOldCodeLink\(window\.location\.search\)\) window\.history\.replaceState\(null, "", window\.location\.pathname \+ window\.location\.hash\);/);
  assert.ok(!/const queueParams =|const floorParams =/.test(app), "the code pages' intercepts are gone");
});

test("the TV is never under the sign-in's curtain: nobody is ever signed in on it", () => {
  const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
  assert.match(app, /const WALL_SCREEN = \(\(\) => \{ try \{ return new URLSearchParams\(window\.location\.search\)\.has\("qboard"\);/);
  assert.match(app, /const under = !WALL_SCREEN && \(!session \|\| (recovering \|\| )?\(jumpHold && !jumpLanded\)\);/,
    "jump-under hid the whole board from 11 September, the same way it hid the QR pages");
});
