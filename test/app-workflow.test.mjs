/* The pull request's iOS check spends no Expo build (C95, 24 September).
   It was an Expo build behind a label, and with the merge's own build that
   was two a change against a monthly limit; the limit ran out. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const wf = fs.readFileSync(new URL("../.github/workflows/sage-app.yml", import.meta.url), "utf8");
const job = (name) => {
  const start = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `a ${name} job`);
  const next = wf.slice(start + 1).search(/\n  [a-z][\w-]*:\n/);
  return next < 0 ? wf.slice(start) : wf.slice(start, start + 1 + next);
};

test("the check compiles on GitHub's macOS runner and never on Expo", () => {
  const check = job("check");
  assert.match(check, /if: github\.event_name == 'pull_request'/);
  assert.match(check, /runs-on: macos-/);
  assert.match(check, /xcodebuild -workspace/);
  assert.match(check, /CODE_SIGNING_ALLOWED=NO/);
  assert.ok(!/\beas (build|submit|init)\b/.test(check), "no Expo build or upload in the check");
  assert.ok(!/secrets\./.test(check), "the check needs no secrets");
});

test("the Expo build is for merges and hand-started runs only", () => {
  assert.match(job("build"), /if: github\.event_name != 'pull_request'/);
});

test("a merge still builds only for native changes", () => {
  const push = wf.slice(wf.indexOf("  push:"), wf.indexOf("  pull_request:"));
  assert.match(push, /paths: \['native\/\*\*'\]/);
});
