import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeLoginTrace, installLoginProbe } from "../scripts/login-performance.mjs";

test("the login recorder distinguishes an unmeasured landing from zero blocking", () => {
  const result = summarizeLoginTrace({ hidden: false, events: [], frames: [], longTasks: [] });
  assert.equal(result.revealedAtMs, null);
  assert.equal(result.landingTaskMaxMs, null);
  assert.equal(result.frameMedianMs, null);
});

test("the landing summary excludes work before the reveal", () => {
  const result = summarizeLoginTrace({ hidden: false,
    events: [{ name: "dashboard-revealed", at: 4000 }],
    frames: [{ at: 10, ms: 16 }, { at: 4110, ms: 110 }, { at: 4130, ms: 20 }],
    longTasks: [{ at: 2000, ms: 800 }, { at: 4100, ms: 120 }],
  });
  assert.equal(result.landingTaskMaxMs, 120);
  assert.equal(result.frameMedianMs, 20);
  assert.equal(result.mainThreadGapsOver50ms, 1);
});

test("a backgrounded sample cannot be used as foreground performance evidence", () => {
  assert.equal(summarizeLoginTrace({ hidden: true, events: [], frames: [], longTasks: [] }).validForegroundSample, false);
});

test("the injected recorder and summary remain serializable browser functions", () => {
  assert.doesNotThrow(() => new Function(`(${installLoginProbe.toString()})(${summarizeLoginTrace.toString()})`));
  const source = installLoginProbe.toString();
  assert.ok(!/localStorage\.(setItem|removeItem|clear)/.test(source));
  assert.ok(!/\bfetch\(/.test(source));
  assert.ok(!/\.value\b/.test(source), "never record credentials or field values");
});
