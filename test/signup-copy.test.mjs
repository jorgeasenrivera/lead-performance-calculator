import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
const start = app.indexOf('{mode === "signup" && (');
const end = app.indexOf('{mode === "forgot" && (', start);
assert.ok(start > 0 && end > start, "signup mode is bounded by its neighboring mode");
const signup = app.slice(start, end);

test("signup starts with the accessible account-type selector instead of explanatory copy", () => {
  assert.match(signup, /key="signup">\s*<div className="lf-kinds" role="group" aria-label="Account type">/);
  assert.match(signup, /Object\.entries\(ACCOUNT_KINDS\)\.map/);
  assert.match(signup, /onClick=\{\(\) => \{ setKind\(k\); setErr\(""\); \}\} aria-pressed=\{kind === k\}/);
  for (const copy of [
    "Create your account.",
    "What do you do here",
    "Your group admin grants you the stores",
    "You do not need the dashboard.",
  ]) assert.ok(!signup.includes(copy), copy + " is not shown in signup");
});

test("signup retains the salesperson store picker and the shared fields and actions", () => {
  assert.match(signup, /kind === "associate" && \(\s*<ClaimPicker config=\{config\} value=\{claim\}/);
  for (const label of ["Work email", "Full name", "Password", "Confirm password"]) {
    assert.ok(signup.includes('className="lf-label">' + label + "</label>"), label + " remains");
  }
  assert.match(signup, /autoComplete="username"/);
  assert.match(signup, /autoComplete="new-password"/);
  assert.match(signup, /e\.key === "Enter" && signUp\(\)/);
  assert.match(signup, /onClick=\{signUp\} disabled=\{busy\}/);
  assert.match(signup, /\{err && <div className="login-err">\{err\}<\/div>\}/);
  assert.match(signup, /\{ok && <div className="login-ok">\{ok\}<\/div>\}/);
  assert.match(signup, /Back to sign in/);
});
