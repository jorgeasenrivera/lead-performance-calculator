/* PROTOTYPE source-contract checks for the identity-bound hold in Login (source-level, node:test only, no browser). Mounted behaviour is covered by the driver scenarios. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const core = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
const at = (s) => { const i = core.indexOf(s); assert.ok(i >= 0, "missing: " + s); assert.equal(core.indexOf(s, i + 1), -1, "not unique: " + s); return i; };
const signInStart = core.indexOf("const signIn = async (authCall, isCurrent = () => true) => {");
const signUpStart = core.indexOf("const signUp = async () => {");

test("authSignIn returns the accepted response's user id and nothing else changes", () => {
  const i = at("async function authSignIn(email, password) {"); const body = core.slice(i, core.indexOf("\n}\n", i));
  assert.ok(body.includes("bumpAuthEpoch();") && body.includes("const { data, error } = await supabase.auth.signInWithPassword({ email, password });"));
  assert.ok(body.includes("return { error: error ? error.message : null, userId };") && body.includes("typeof data.user.id === \"string\""));
});
test("ownership is checked after every await in signIn, and immediately before callbacks and the handover", () => {
  const body = core.slice(signInStart, signUpStart);
  for (const must of ["await settleViewport();\n    if (!isCurrent() || !mine()) return;", "if (!mine() || !isCurrent() || res?.stale) return;", "if (!mine()) return;   // the profile that came back is not an input to the hold", "if (mine() && isCurrent() && authed === null) document.documentElement.classList.add(\"sage-flash-hold\");", "if (!mine() || !a.hold.canHandOver(liveSubject())) { if (attemptRef.current === a) killAttempt(a); return; }"]) assert.ok(body.includes(must), must);
  assert.equal(body.split("await ").length - 1, 3, "three awaits: settleViewport, the auth call, the profile");
});
test("acceptance uses the response user id and the live subject, only for the normal path, before the attempt is treated as signed in", () => {
  const body = core.slice(signInStart, signUpStart);
  const accept = body.indexOf("if (!custom && !a.hold.accept(res.userId, liveSubject())) { killAttempt(a); return; }");
  assert.ok(accept > 0 && accept < body.indexOf("authed = true;") && accept > body.indexOf("if (!res || res.error) {"));
  assert.equal(body.split(".accept(").length - 1, 1);
});
test("only the current attempt touches the hold, the flash class, busy and the jump on kill; an old one ends quietly", () => {
  const r = at("const retireAttempt = (a) => {"); const rb = core.slice(r, core.indexOf("};", r) + 2);
  assert.ok(rb.indexOf("a.hold.kill();") < rb.indexOf("if (attemptRef.current === a) document.documentElement.classList.remove(\"sage-flash-hold\");"), "the owner takes the class down only while still current");
  assert.ok(rb.indexOf("classList.remove(\"sage-flash-hold\")") < rb.indexOf("endAttempt(a);"), "the class goes before the attempt lets go");
  assert.ok(!/set[A-Z][A-Za-z]*\(/.test(rb), "no React state setter in the retire helper (it runs in the unmount cleanup)");
  const i = at("const killAttempt = (a) => {"); const body = core.slice(i, core.indexOf("};", i) + 2);
  assert.ok(body.indexOf("const owned = attemptRef.current === a;") < body.indexOf("retireAttempt(a);") && body.indexOf("if (!owned) return;") < body.indexOf("abortJump();"));
  assert.ok(!body.includes("sage-flash-hold"), "kill leaves the class to the retire helper");
  assert.ok(core.includes("const endAttempt = (a) => { if (a.unsub) { a.unsub(); a.unsub = null; } a.done = true; };"));
  assert.equal(core.split("recoveryFlow.subscribe((snap) =>").length - 1, 1, "one subscription per attempt, ended with it");
});
test("every abortJump in Login is the component's own (kill, generation effect, error path after the ownership check)", () => {
  const login = core.slice(core.indexOf("function Login({ config, onBack"), core.indexOf("\nfunction clearToolMove()"));
  const calls = [...login.matchAll(/abortJump\(\)/g)].map((m) => m.index);
  assert.equal(calls.length, 3, "the kill (current attempt only), the generation effect, and the error branch after the ownership check");
});
test("a new press overtakes an old attempt, the unmount and the generation effect end it through the retire helper, and nothing is revived", () => {
  assert.ok(core.includes("if (prev && !prev.done) { retireAttempt(prev); if (jumping.current)"));
  assert.ok(core.includes("useEffect(() => () => { const a = attemptRef.current; if (a) retireAttempt(a); if (jumping.current)"));
  assert.ok(core.includes("{ const a = attemptRef.current; if (a) retireAttempt(a); }\n    abortJump(); signInPressed = false; setBusy(false);"));
  assert.equal(core.split("a.hold.kill(); endAttempt(").length - 1, 0, "no path ends an attempt without the retire helper");
  const login = core.slice(core.indexOf("function Login({ config, onBack"), core.indexOf("\nfunction clearToolMove()"));
  assert.ok(login.indexOf("retireAttempt(prev)") < login.indexOf("attemptRef.current = a;"), "the old attempt is retired while still current, before the new one is installed");
});
test("retained: generation invalidation, the ordinary failed-notice dismissal (non-custom only), the custom recovery handover, and no blanket status abort", () => {
  const body = core.slice(signInStart, signUpStart);
  assert.ok(core.includes("}, [recoveryGeneration]);") && body.includes("isCurrent = () => recoveryFlow.snapshot().generation === generation && callerCurrent();"));
  assert.ok(body.includes("if (!custom && onRecoveryDismissed) onRecoveryDismissed();"));
  assert.ok(body.includes("if (custom) recoveryFlow.arrivalFinished(generation, arrivalUser);"));
  assert.ok(!/rec\.status|interrupted|linkFailed/.test(body), "no status-based abort inside signIn");
  assert.ok(core.includes('const signInLayer = loginConfig && authReady && rec.status !== "pending"'));
  assert.ok(core.includes("cfgProvisional.current = true; setConfig(null); setStoreData(null); setAdminData({});"));
});
test("the custom recovery save is bound at the press (baseline is the recovery subject, custom: true), not from a response", () => {
  assert.ok(core.includes("createHoldAttempt({ baseline: arrivalUser, custom })"));
  assert.ok(core.includes("return signIn(() => authSetPassword(password), () => recoveryFlow.snapshot().generation === generation && recoveryFlow.snapshot().sessionUserId === sessionUserId);"));
});
