/**
 * The store's video rings, and why they say what they say.
 * -------------------------------------------------------------------------
 * The ring used to show the average of everyone's progress toward target,
 * capped at 100. A manager read it as the store's video rate, which it was not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { videoStandard } from "../api/_video-standard.mjs";

const near = (a, b) => Math.abs(a - b) < 1e-9;

test("the ring is the floor's rate, not progress toward target", () => {
  /* Three people against a 50% bar sending 40, 40 and 40. The old ring read
     80% (each at 80% of target). The floor's rate is 40%. */
  const v = videoStandard([{ got: 0.4, min: 50 }, { got: 0.4, min: 50 }, { got: 0.4, min: 50 }]);
  assert.ok(near(v.rate, 0.4));
  assert.equal(v.target, 50);
  assert.ok(near(v.ratio, 0.8), "the fill still shows how close the floor is");
  assert.equal(v.below, 3);
  assert.equal(v.total, 3);
});

test("one strong sender lifts the rate past the target, no cap", () => {
  const v = videoStandard([{ got: 1, min: 50 }, { got: 0.5, min: 50 }]);
  assert.ok(near(v.rate, 0.75));
  assert.ok(v.ratio > 1);
  assert.equal(v.below, 0);
});

test("someone with no figure counts as nothing sent", () => {
  const v = videoStandard([{ got: null, min: 60 }, { got: 0.6, min: 60 }]);
  assert.ok(near(v.rate, 0.3));
  assert.equal(v.below, 1);
});

test("the target is the bar most of the floor is held to", () => {
  const v = videoStandard([{ got: 0.5, min: 70 }, { got: 0.5, min: 70 }, { got: 0.5, min: 50 }]);
  assert.equal(v.target, 70);
});

test("a tie between two bars reads the gentler one", () => {
  const v = videoStandard([{ got: 0.5, min: 70 }, { got: 0.5, min: 50 }]);
  assert.equal(v.target, 50);
});

test("no standard set means no ring", () => {
  assert.equal(videoStandard([]), null);
  assert.equal(videoStandard([{ got: 0.5, min: 0 }]), null);
  assert.equal(videoStandard(null), null);
});
